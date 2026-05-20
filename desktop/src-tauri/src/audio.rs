use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

const TARGET_RATE: u32 = 48_000;
const FRAME_MS: usize = 100; // ms per broadcast chunk → 10 msgs/sec/participant
const SPEAKING_THRESHOLD: f32 = 0.015; // RMS level to count as speaking

struct CaptureShared {
    muted: bool,
    accumulator: Vec<f32>,
    frame_size: usize,
}

struct PlaybackShared {
    deafened: bool,
    // per-peer ring buffers (mono f32 at out_rate Hz)
    buffers: HashMap<String, VecDeque<f32>>,
    out_channels: usize,
    out_rate: u32,
}

pub enum Cmd {
    SetMuted(bool),
    SetDeafened(bool),
    AddSamples { from: String, samples: Vec<f32> },
    RemovePeer(String),
    Stop,
}

pub struct NativeAudio {
    tx: std::sync::mpsc::SyncSender<Cmd>,
}

/// Resample i16 PCM from `from_rate` to TARGET_RATE (48 kHz) and convert to f32.
/// Uses linear interpolation; if rates match just converts in-place.
pub fn resample_to_f32(samples: &[i16], from_rate: u32) -> Vec<f32> {
    if from_rate == TARGET_RATE || samples.is_empty() {
        return samples.iter().map(|&s| s as f32 / 32_768.0).collect();
    }
    let ratio = from_rate as f64 / TARGET_RATE as f64;
    let out_len = ((samples.len() as f64) / ratio).ceil() as usize;
    (0..out_len)
        .map(|i| {
            let src_pos = i as f64 * ratio;
            let idx = src_pos as usize;
            let frac = (src_pos - idx as f64) as f32;
            let s0 = samples.get(idx).copied().unwrap_or(0) as f32 / 32_768.0;
            let s1 = samples.get(idx + 1).copied().unwrap_or(0) as f32 / 32_768.0;
            s0 + (s1 - s0) * frac
        })
        .collect()
}

/// Resample f32 PCM from `from_rate` to `to_rate` using linear interpolation.
/// Used to match decoded remote audio to the local output device's actual rate.
pub fn resample_f32(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = ((samples.len() as f64) / ratio).ceil() as usize;
    (0..out_len)
        .map(|i| {
            let src_pos = i as f64 * ratio;
            let idx = src_pos as usize;
            let frac = (src_pos - idx as f64) as f32;
            let s0 = samples.get(idx).copied().unwrap_or(0.0);
            let s1 = samples.get(idx + 1).copied().unwrap_or(0.0);
            s0 + (s1 - s0) * frac
        })
        .collect()
}

/// List the names of all available input (microphone) devices.
pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|iter| iter.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

/// List the names of all available output (speaker/headphone) devices.
pub fn list_output_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.output_devices()
        .map(|iter| iter.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

impl NativeAudio {
    /// Start the native audio engine. Returns `(engine, actual_sample_rate)`.
    /// Pass `None` for either device to use the system default.
    pub fn start(app: tauri::AppHandle, input_device: Option<String>, output_device: Option<String>) -> Result<(Self, u32), String> {
        let (tx, rx) = std::sync::mpsc::sync_channel::<Cmd>(128);
        let (rate_tx, rate_rx) = std::sync::mpsc::sync_channel::<u32>(1);
        std::thread::Builder::new()
            .name("blok-audio".into())
            .spawn(move || {
                if let Err(e) = run_audio(app, rx, rate_tx, input_device, output_device) {
                    eprintln!("[audio] engine error: {e}");
                }
            })
            .map_err(|e| e.to_string())?;
        // Block until audio thread reports its actual sample rate (or dies).
        let actual_rate = rate_rx
            .recv()
            .map_err(|_| "Audio thread failed to start (check microphone permissions)".to_string())?;
        Ok((Self { tx }, actual_rate))
    }

    pub fn send(&self, cmd: Cmd) {
        let _ = self.tx.try_send(cmd);
    }
}

/// Compute RMS of i16 samples, return true if above speaking threshold.
pub fn is_speaking_i16(samples: &[i16]) -> bool {
    if samples.is_empty() {
        return false;
    }
    let sum_sq: f64 = samples
        .iter()
        .map(|&s| {
            let f = s as f64 / 32_768.0;
            f * f
        })
        .sum();
    let rms = (sum_sq / samples.len() as f64).sqrt();
    rms as f32 > SPEAKING_THRESHOLD
}

fn rms_f32(s: &[f32]) -> f32 {
    if s.is_empty() {
        return 0.0;
    }
    (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
}

fn run_audio(
    app: tauri::AppHandle,
    rx: std::sync::mpsc::Receiver<Cmd>,
    rate_tx: std::sync::mpsc::SyncSender<u32>,
    input_device_name: Option<String>,
    output_device_name: Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    let host = cpal::default_host();

    let input_device = if let Some(ref name) = input_device_name {
        host.input_devices()?
            .find(|d| d.name().ok().as_deref() == Some(name.as_str()))
            .or_else(|| host.default_input_device())
            .ok_or("no input device found")?
    } else {
        host.default_input_device().ok_or("no default input device")?
    };

    let output_device = if let Some(ref name) = output_device_name {
        host.output_devices()?
            .find(|d| d.name().ok().as_deref() == Some(name.as_str()))
            .or_else(|| host.default_output_device())
            .ok_or("no output device found")?
    } else {
        host.default_output_device().ok_or("no default output device")?
    };

    // --- input config: prefer 48 kHz at the device's native channel count ---
    // Forcing channels: 1 (mono) causes WASAPI to reject the stream on most
    // Windows devices that only expose stereo in shared mode.  Use the native
    // channel count here and downmix to mono inside the capture callback.
    let input_default = input_device.default_input_config()?;
    let input_channels = input_default.channels() as usize;
    let input_config: cpal::StreamConfig = {
        let supports_target = input_device
            .supported_input_configs()
            .map(|mut iter| {
                iter.any(|c| {
                    c.min_sample_rate().0 <= TARGET_RATE
                        && c.max_sample_rate().0 >= TARGET_RATE
                })
            })
            .unwrap_or(false);

        if supports_target {
            cpal::StreamConfig {
                channels: input_default.channels(),
                sample_rate: cpal::SampleRate(TARGET_RATE),
                buffer_size: cpal::BufferSize::Default,
            }
        } else {
            input_default.config()
        }
    };

    // --- output config: prefer 48 kHz, keep device channel count ---
    let output_default = output_device.default_output_config()?;
    let out_channels = output_default.channels() as usize;
    let output_config: cpal::StreamConfig = {
        let supports_target = output_device
            .supported_output_configs()
            .map(|mut iter| {
                iter.any(|c| {
                    c.min_sample_rate().0 <= TARGET_RATE
                        && c.max_sample_rate().0 >= TARGET_RATE
                })
            })
            .unwrap_or(false);

        if supports_target {
            cpal::StreamConfig {
                channels: output_default.channels(),
                sample_rate: cpal::SampleRate(TARGET_RATE),
                buffer_size: cpal::BufferSize::Default,
            }
        } else {
            output_default.config()
        }
    };

    let actual_rate = input_config.sample_rate.0 as usize;
    let frame_size = actual_rate * FRAME_MS / 1000;

    let cap_shared = Arc::new(Mutex::new(CaptureShared {
        muted: false,
        accumulator: Vec::with_capacity(frame_size * 2),
        frame_size,
    }));

    let play_shared = Arc::new(Mutex::new(PlaybackShared {
        deafened: false,
        buffers: HashMap::new(),
        out_channels,
        out_rate: output_config.sample_rate.0,
    }));

    // --- input stream ---
    let cap = cap_shared.clone();
    let app_in = app.clone();
    let app_in_err = app.clone();
    let input_stream = input_device.build_input_stream(
        &input_config,
        move |data: &[f32], _| {
            let mut state = match cap.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if state.muted {
                return;
            }
            // Downmix multichannel (e.g. stereo) to mono by averaging channels.
            if input_channels <= 1 {
                state.accumulator.extend_from_slice(data);
            } else {
                state.accumulator.extend(
                    data.chunks_exact(input_channels)
                        .map(|ch| ch.iter().sum::<f32>() / input_channels as f32),
                );
            }
            let fs = state.frame_size;
            while state.accumulator.len() >= fs {
                let frame: Vec<f32> = state.accumulator.drain(..fs).collect();
                let speaking = rms_f32(&frame) > SPEAKING_THRESHOLD;
                let samples_i16: Vec<i16> = frame
                    .iter()
                    .map(|&s| (s.clamp(-1.0, 1.0) * 32_767.0) as i16)
                    .collect();
                let _ = app_in.emit("audio-chunk", &samples_i16);
                let _ = app_in.emit("audio-speaking", speaking);
            }
        },
        move |e| {
            eprintln!("[audio] input error: {e}");
            let _ = app_in_err.emit("audio-error", e.to_string());
        },
        None,
    )?;

    // --- output stream ---
    let play = play_shared.clone();
    let app_out_err = app.clone();
    let output_stream = output_device.build_output_stream(
        &output_config,
        move |data: &mut [f32], _| {
            for s in data.iter_mut() {
                *s = 0.0;
            }
            let mut state = match play.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if state.deafened {
                return;
            }
            let ch = state.out_channels;
            let n_frames = data.len() / ch;
            // Divide by total connected peers (not just those with data this callback)
            // so the divisor is stable across the whole frame and doesn't oscillate
            // when one peer's buffer runs dry mid-frame.
            let n_peers = state.buffers.len().max(1) as f32;

            for buf in state.buffers.values_mut() {
                for i in 0..n_frames {
                    if let Some(v) = buf.pop_front() {
                        for c in 0..ch {
                            data[i * ch + c] += v / n_peers;
                        }
                    }
                }
            }
            for s in data.iter_mut() {
                *s = s.clamp(-1.0, 1.0);
            }
        },
        move |e| {
            eprintln!("[audio] output error: {e}");
            let _ = app_out_err.emit("audio-error", e.to_string());
        },
        None,
    )?;

    input_stream.play()?;
    output_stream.play()?;

    // Report actual input rate to the caller before entering the command loop.
    let _ = rate_tx.send(input_config.sample_rate.0);

    // keep streams alive by holding them; process commands
    let _input = input_stream;
    let _output = output_stream;

    loop {
        match rx.recv() {
            Ok(Cmd::Stop) | Err(_) => break,
            Ok(Cmd::SetMuted(v)) => {
                cap_shared.lock().unwrap_or_else(|e| e.into_inner()).muted = v;
            }
            Ok(Cmd::SetDeafened(v)) => {
                play_shared.lock().unwrap_or_else(|e| e.into_inner()).deafened = v;
            }
            Ok(Cmd::AddSamples { from, samples }) => {
                let mut state = play_shared.lock().unwrap_or_else(|e| e.into_inner());
                // Resample from TARGET_RATE to the actual output device rate so pitch
                // is correct regardless of what sample rate the DAC uses (e.g. 44.1 kHz,
                // 96 kHz). No-op when rates match.
                let resampled_tmp;
                let incoming_all: &[f32] = if state.out_rate != TARGET_RATE {
                    resampled_tmp = resample_f32(&samples, TARGET_RATE, state.out_rate);
                    &resampled_tmp
                } else {
                    &samples
                };
                // Read out_rate before the mutable borrow of buffers.
                let max = state.out_rate as usize * 2;
                let buf = state.buffers.entry(from).or_default();
                let tail_start = incoming_all.len().saturating_sub(max);
                let incoming = &incoming_all[tail_start..];
                let total = buf.len() + incoming.len();
                if total > max {
                    buf.drain(..total - max);
                }
                buf.extend(incoming);
            }
            Ok(Cmd::RemovePeer(id)) => {
                play_shared.lock().unwrap_or_else(|e| e.into_inner()).buffers.remove(&id);
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── resample_to_f32 ───────────────────────────────────────────────────────

    #[test]
    fn resample_empty_input_is_empty() {
        assert!(resample_to_f32(&[], 44_100).is_empty());
        assert!(resample_to_f32(&[], TARGET_RATE).is_empty());
    }

    #[test]
    fn resample_same_rate_converts_without_resampling() {
        let input = vec![0i16, 16_384, -16_384, 32_767];
        let out = resample_to_f32(&input, TARGET_RATE);
        assert_eq!(out.len(), 4);
        assert!((out[0] - 0.0).abs() < 1e-4, "silence should map to 0.0");
        assert!((out[1] - 0.5).abs() < 1e-3, "16384 should map to ~0.5");
        assert!((out[2] + 0.5).abs() < 1e-3, "-16384 should map to ~-0.5");
        assert!(out[3] > 0.99, "32767 should be close to 1.0");
    }

    #[test]
    fn resample_upsample_44100_to_48000_produces_more_samples() {
        // 100 ms at 44.1 kHz = 4410 samples → expect ~4800 at 48 kHz
        let input = vec![0i16; 4410];
        let out = resample_to_f32(&input, 44_100);
        let expected = 4800usize;
        assert!(
            (out.len() as i64 - expected as i64).abs() <= 2,
            "expected ~{expected} samples, got {}",
            out.len()
        );
    }

    #[test]
    fn resample_downsample_96000_to_48000_produces_fewer_samples() {
        let input = vec![0i16; 9600]; // 100 ms at 96 kHz
        let out = resample_to_f32(&input, 96_000);
        let expected = 4800usize;
        assert!(
            (out.len() as i64 - expected as i64).abs() <= 2,
            "expected ~{expected} samples, got {}",
            out.len()
        );
    }

    #[test]
    fn resample_preserves_values_on_same_rate() {
        let input: Vec<i16> = (0..10).map(|i| (i * 3000) as i16).collect();
        let out = resample_to_f32(&input, TARGET_RATE);
        for (i, (&s, &f)) in input.iter().zip(out.iter()).enumerate() {
            let expected = s as f32 / 32_768.0;
            assert!(
                (f - expected).abs() < 1e-4,
                "sample {i}: expected {expected}, got {f}"
            );
        }
    }

    // ── is_speaking_i16 ───────────────────────────────────────────────────────

    #[test]
    fn is_speaking_empty_returns_false() {
        assert!(!is_speaking_i16(&[]));
    }

    #[test]
    fn is_speaking_silence_returns_false() {
        let silence = vec![0i16; 480];
        assert!(!is_speaking_i16(&silence));
    }

    #[test]
    fn is_speaking_near_threshold_noise_returns_false() {
        // RMS ≈ 0.005, well below SPEAKING_THRESHOLD (0.015)
        let quiet: Vec<i16> = (0..480)
            .map(|i| if i % 2 == 0 { 160 } else { -160 })
            .collect();
        assert!(!is_speaking_i16(&quiet));
    }

    #[test]
    fn is_speaking_loud_audio_returns_true() {
        // Alternating ±30000 → RMS ≈ 0.916, well above threshold
        let loud: Vec<i16> = (0..480)
            .map(|i| if i % 2 == 0 { 30_000 } else { -30_000 })
            .collect();
        assert!(is_speaking_i16(&loud));
    }

    #[test]
    fn is_speaking_single_loud_sample() {
        let samples = vec![32_767i16];
        assert!(is_speaking_i16(&samples));
    }

    // ── rms_f32 ───────────────────────────────────────────────────────────────

    #[test]
    fn rms_empty_is_zero() {
        assert_eq!(rms_f32(&[]), 0.0);
    }

    #[test]
    fn rms_dc_signal() {
        let dc = vec![0.5f32; 100];
        let rms = rms_f32(&dc);
        assert!((rms - 0.5).abs() < 1e-5, "RMS of 0.5 DC should be 0.5, got {rms}");
    }

    #[test]
    fn rms_square_wave() {
        // ±1.0 square wave → RMS = 1.0
        let sq: Vec<f32> = (0..100).map(|i| if i % 2 == 0 { 1.0 } else { -1.0 }).collect();
        let rms = rms_f32(&sq);
        assert!((rms - 1.0).abs() < 1e-5, "RMS of ±1.0 square wave should be 1.0, got {rms}");
    }

    #[test]
    fn rms_sine_like() {
        // sin²(x) averaged over full cycle = 0.5 → RMS = √0.5 ≈ 0.707
        let sine: Vec<f32> = (0..1000)
            .map(|i| (i as f32 * std::f32::consts::TAU / 1000.0).sin())
            .collect();
        let rms = rms_f32(&sine);
        let expected = std::f32::consts::FRAC_1_SQRT_2;
        assert!(
            (rms - expected).abs() < 1e-2,
            "RMS of sine should be ~{expected:.4}, got {rms:.4}"
        );
    }

    // ── resample_f32 ─────────────────────────────────────────────────────────

    #[test]
    fn resample_f32_same_rate_is_passthrough() {
        let input = vec![0.0f32, 0.5, -0.5, 1.0];
        let out = resample_f32(&input, 48_000, 48_000);
        assert_eq!(out, input);
    }

    #[test]
    fn resample_f32_empty_is_empty() {
        assert!(resample_f32(&[], 48_000, 44_100).is_empty());
    }

    #[test]
    fn resample_f32_downsample_48000_to_44100_produces_fewer_samples() {
        // 100 ms at 48 kHz = 4800 samples → expect ~4410 at 44.1 kHz
        let input = vec![0.0f32; 4800];
        let out = resample_f32(&input, 48_000, 44_100);
        let expected = 4410usize;
        assert!(
            (out.len() as i64 - expected as i64).abs() <= 2,
            "expected ~{expected} samples, got {}",
            out.len()
        );
    }

    #[test]
    fn resample_f32_upsample_48000_to_96000_produces_more_samples() {
        let input = vec![0.0f32; 4800];
        let out = resample_f32(&input, 48_000, 96_000);
        let expected = 9600usize;
        assert!(
            (out.len() as i64 - expected as i64).abs() <= 2,
            "expected ~{expected} samples, got {}",
            out.len()
        );
    }

    #[test]
    fn resample_f32_dc_preserves_value() {
        // DC signal at 0.5 should remain 0.5 after resampling
        let input = vec![0.5f32; 480];
        let out = resample_f32(&input, 48_000, 44_100);
        for s in &out {
            assert!((*s - 0.5).abs() < 1e-4, "DC 0.5 should be preserved, got {s}");
        }
    }

    // ── device enumeration ────────────────────────────────────────────────────

    #[test]
    fn list_input_devices_does_not_panic() {
        // Can't assert specific devices in CI, just verify no panic/crash.
        let devices = list_input_devices();
        // On a machine with no audio hardware this may be empty — that's fine.
        let _ = devices;
    }

    #[test]
    fn list_output_devices_does_not_panic() {
        let devices = list_output_devices();
        let _ = devices;
    }
}
