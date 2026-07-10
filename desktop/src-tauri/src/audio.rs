use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::Emitter;

const TARGET_RATE: u32 = 48_000;
const FRAME_MS: usize = 40; // ms per chunk → low send-side latency (sent P2P over a per-peer DataChannel, so no shared-channel saturation)
const SPEAKING_THRESHOLD: f32 = 0.015; // RMS level to count as speaking
// Max audio buffered per peer before old samples are dropped — bounds playback
// latency (a deep buffer lets delay accumulate). ~150 ms is a tight jitter buffer.
const JITTER_BUFFER_MS: usize = 150;

struct CaptureShared {
    muted: bool,
    accumulator: Vec<f32>,
    frame_size: usize,
    noise_suppression: bool,
    echo_cancel: bool,
    // Running noise floor estimate (updated from quiet frames)
    noise_floor: f32,
    // Smoothed gate gain (0.0 = silent, 1.0 = full pass-through)
    gate_gain: f32,
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
    SetNoiseSuppression(bool),
    SetEchoCancellation(bool),
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

/// Command handle of the currently running engine, for callers that live outside
/// Tauri state (the native rtc transport ingests remote PCM straight into the
/// mixer from its own runtime). Set on engine start; sends after the engine
/// stops are silently dropped (the channel's receiver is gone).
static MIXER_TX: std::sync::Mutex<Option<std::sync::mpsc::SyncSender<Cmd>>> =
    std::sync::Mutex::new(None);

/// Feed a remote participant's samples into the playback mixer (rtc path).
pub fn mixer_add_samples(from: String, samples: Vec<f32>) {
    if let Some(tx) = MIXER_TX.lock().unwrap().as_ref() {
        let _ = tx.try_send(Cmd::AddSamples { from, samples });
    }
}

/// Drop a remote participant's mixer buffer (rtc path).
pub fn mixer_remove_peer(peer_id: &str) {
    if let Some(tx) = MIXER_TX.lock().unwrap().as_ref() {
        let _ = tx.try_send(Cmd::RemovePeer(peer_id.to_string()));
    }
}

impl NativeAudio {
    /// Start the native audio engine. Returns `(engine, actual_sample_rate)`.
    /// Pass `None` for either device to use the system default.
    pub fn start(
        app: tauri::AppHandle,
        on_chunk: Channel<InvokeResponseBody>,
        input_device: Option<String>,
        output_device: Option<String>,
        noise_suppression: bool,
        echo_cancellation: bool,
    ) -> Result<(Self, u32), String> {
        let (tx, rx) = std::sync::mpsc::sync_channel::<Cmd>(128);
        *MIXER_TX.lock().unwrap() = Some(tx.clone());
        let (rate_tx, rate_rx) = std::sync::mpsc::sync_channel::<u32>(1);
        std::thread::Builder::new()
            .name("blok-audio".into())
            .spawn(move || {
                if let Err(e) = run_audio(app, on_chunk, rx, rate_tx, input_device, output_device, noise_suppression, echo_cancellation) {
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

/// Noise suppression + echo cancellation gate applied to each outgoing frame.
///
/// NS: estimates a running noise floor from quiet frames and attenuates signals
/// near the floor; clear speech (energy well above floor) passes unmodified.
///
/// EC: when `echo_cancel` is set and `playback_active` is true (peers are
/// audible through the speakers), the mic gate threshold is raised 4× to
/// prevent speaker bleed from being re-transmitted to other participants.
fn apply_voice_processing(
    frame: &mut [f32],
    noise_floor: &mut f32,
    gate_gain: &mut f32,
    noise_suppression: bool,
    echo_cancel: bool,
    playback_active: bool,
) {
    // Skip entirely when processing is off, or EC is on but nobody is playing
    if !noise_suppression && !(echo_cancel && playback_active) {
        return;
    }

    let rms = rms_f32(frame);

    // Raise the gate when speaker audio is playing (echo-cancellation effect)
    let threshold = if echo_cancel && playback_active {
        SPEAKING_THRESHOLD * 4.0
    } else {
        SPEAKING_THRESHOLD
    };

    let target_gain = if noise_suppression {
        // Update noise floor from clearly sub-speech frames (slow adaptive EMA)
        if rms < SPEAKING_THRESHOLD * 0.3 {
            *noise_floor = (*noise_floor * 0.98 + rms * 0.02).max(1e-6);
        }
        let floor = *noise_floor;
        let speech_level = threshold.max(floor * 8.0);
        if rms >= speech_level {
            1.0_f32
        } else if rms > floor * 1.5 {
            // Soft-knee region between noise floor and speech level
            ((rms - floor * 1.5) / (speech_level - floor * 1.5)).sqrt()
        } else {
            0.05 // ~26 dB attenuation at the noise floor
        }
    } else {
        // EC-only: binary gate on the raised threshold
        if rms >= threshold { 1.0 } else { 0.0 }
    };

    // Smooth gate gain: fast open (speech starts abruptly), slower close
    // (prevents choppy audio on brief pauses). EC path closes fast to avoid echo.
    let (open_speed, close_speed) = if echo_cancel && playback_active {
        (0.9, 0.7)
    } else {
        (0.9, 0.25)
    };
    let speed = if target_gain > *gate_gain { open_speed } else { close_speed };
    *gate_gain = (*gate_gain * (1.0 - speed) + target_gain * speed).clamp(0.0, 1.0);

    for s in frame.iter_mut() {
        *s *= *gate_gain;
    }
}

fn run_audio(
    app: tauri::AppHandle,
    on_chunk: Channel<InvokeResponseBody>,
    rx: std::sync::mpsc::Receiver<Cmd>,
    rate_tx: std::sync::mpsc::SyncSender<u32>,
    input_device_name: Option<String>,
    output_device_name: Option<String>,
    noise_suppression: bool,
    echo_cancellation: bool,
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

    // Shared flag: output callback sets this true when peer audio is actively playing.
    // Input callback reads it to apply echo-cancellation gating.
    let playback_active = Arc::new(AtomicBool::new(false));

    let cap_shared = Arc::new(Mutex::new(CaptureShared {
        muted: false,
        accumulator: Vec::with_capacity(frame_size * 2),
        frame_size,
        noise_suppression,
        echo_cancel: echo_cancellation,
        noise_floor: SPEAKING_THRESHOLD * 0.2,
        gate_gain: 1.0,
    }));

    let play_shared = Arc::new(Mutex::new(PlaybackShared {
        deafened: false,
        buffers: HashMap::new(),
        out_channels,
        out_rate: output_config.sample_rate.0,
    }));

    // --- input stream ---
    let cap = cap_shared.clone();
    let playback_active_in = playback_active.clone();
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
            let pa = playback_active_in.load(Ordering::Relaxed);
            // Reborrow through Deref so Rust can see distinct fields for split borrows.
            let state: &mut CaptureShared = &mut *state;
            let ns = state.noise_suppression;
            let ec = state.echo_cancel;
            while state.accumulator.len() >= fs {
                let mut frame: Vec<f32> = state.accumulator.drain(..fs).collect();
                apply_voice_processing(
                    &mut frame,
                    &mut state.noise_floor,
                    &mut state.gate_gain,
                    ns,
                    ec,
                    pa,
                );
                let speaking = rms_f32(&frame) > SPEAKING_THRESHOLD;
                // Raw i16-LE bytes over the binary IPC channel — matches the
                // DataChannel wire format on the JS side, zero re-encoding.
                let mut bytes = Vec::with_capacity(frame.len() * 2);
                for &s in frame.iter() {
                    bytes.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32_767.0) as i16).to_le_bytes());
                }
                // Fan out the same frame to connected native-rtc peers (no-op
                // when no rtc session is active). Mute already gated above.
                crate::rtc::broadcast_mic(actual_rate as u32, bytes.clone());
                let _ = on_chunk.send(InvokeResponseBody::Raw(bytes));
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
    let playback_active_out = playback_active.clone();
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
            // Inform the input callback whether peers are currently sending audio
            // (used for echo-cancellation gating of the microphone).
            let had_audio = !state.buffers.is_empty()
                && state.buffers.values().any(|b| !b.is_empty());
            playback_active_out.store(had_audio, Ordering::Relaxed);

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
                let max = state.out_rate as usize * JITTER_BUFFER_MS / 1000;
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
            Ok(Cmd::SetNoiseSuppression(v)) => {
                cap_shared.lock().unwrap_or_else(|e| e.into_inner()).noise_suppression = v;
            }
            Ok(Cmd::SetEchoCancellation(v)) => {
                cap_shared.lock().unwrap_or_else(|e| e.into_inner()).echo_cancel = v;
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

    // ── apply_voice_processing — helpers ──────────────────────────────────────

    /// Run `n` identical DC frames through the processor and return the final gate_gain.
    fn converge(
        dc_val: f32,
        frames: usize,
        noise_suppression: bool,
        echo_cancel: bool,
        playback_active: bool,
    ) -> (f32, f32) {
        let mut noise_floor = SPEAKING_THRESHOLD * 0.2;
        let mut gate_gain = 0.0f32;
        for _ in 0..frames {
            let mut frame = vec![dc_val; 480];
            apply_voice_processing(
                &mut frame,
                &mut noise_floor,
                &mut gate_gain,
                noise_suppression,
                echo_cancel,
                playback_active,
            );
        }
        (gate_gain, noise_floor)
    }

    // ── apply_voice_processing — no-op paths ──────────────────────────────────

    #[test]
    fn avp_both_disabled_frame_unchanged() {
        let original = vec![0.02f32; 480];
        let mut frame = original.clone();
        let mut nf = SPEAKING_THRESHOLD * 0.2;
        let mut gg = 1.0f32;
        apply_voice_processing(&mut frame, &mut nf, &mut gg, false, false, false);
        assert_eq!(frame, original, "frame must be unchanged when NS and EC are disabled");
    }

    #[test]
    fn avp_ec_only_without_playback_frame_unchanged() {
        // EC=true but playback_active=false → early return, no modification
        let original = vec![0.02f32; 480];
        let mut frame = original.clone();
        let mut nf = SPEAKING_THRESHOLD * 0.2;
        let mut gg = 1.0f32;
        apply_voice_processing(&mut frame, &mut nf, &mut gg, false, true, false);
        assert_eq!(frame, original, "EC without playback must not modify the frame");
    }

    // ── apply_voice_processing — noise suppression ────────────────────────────

    #[test]
    fn ns_attenuates_near_silent_frame() {
        // RMS ≪ SPEAKING_THRESHOLD → gate_gain must converge near 0.05 (~26 dB attenuation)
        let quiet = SPEAKING_THRESHOLD * 0.03; // clearly sub-noise DC signal
        let (gate_gain, _) = converge(quiet, 60, true, false, false);
        assert!(
            gate_gain < 0.10,
            "gate_gain should be near 0.05 for silence, got {gate_gain:.4}"
        );
    }

    #[test]
    fn ns_passes_loud_speech_frame() {
        // RMS ≫ SPEAKING_THRESHOLD → gate_gain must converge to 1.0
        let loud = 0.5f32; // RMS = 0.5, way above 0.015
        let (gate_gain, _) = converge(loud, 20, true, false, false);
        assert!(
            gate_gain > 0.95,
            "gate_gain should be near 1.0 for loud speech, got {gate_gain:.4}"
        );
    }

    #[test]
    fn ns_updates_noise_floor_from_quiet_frames() {
        // Quiet frames (RMS < 0.3 × SPEAKING_THRESHOLD) must raise the noise floor via EMA
        let initial_floor = 1e-6_f32; // minimum clamped value
        let quiet = SPEAKING_THRESHOLD * 0.1; // 0.0015 — below 0.3 × 0.015 = 0.0045
        let mut noise_floor = initial_floor;
        let mut gate_gain = 0.0f32;
        for _ in 0..100 {
            let mut frame = vec![quiet; 480];
            apply_voice_processing(&mut frame, &mut noise_floor, &mut gate_gain, true, false, false);
        }
        assert!(
            noise_floor > initial_floor * 10.0,
            "noise_floor should have risen from quiet frames, got {noise_floor:.2e}"
        );
    }

    #[test]
    fn ns_does_not_update_noise_floor_from_loud_frames() {
        // Loud frames (RMS ≥ 0.3 × SPEAKING_THRESHOLD) must NOT touch noise_floor
        let initial_floor = SPEAKING_THRESHOLD * 0.2; // 0.003
        let mut noise_floor = initial_floor;
        let mut gate_gain = 1.0f32;
        for _ in 0..50 {
            let mut frame = vec![0.5f32; 480];
            apply_voice_processing(&mut frame, &mut noise_floor, &mut gate_gain, true, false, false);
        }
        let delta = (noise_floor - initial_floor).abs();
        assert!(
            delta < initial_floor * 0.5,
            "noise_floor must stay stable on loud frames; initial={initial_floor:.4e} current={noise_floor:.4e}"
        );
    }

    #[test]
    fn ns_gate_opens_fast_and_closes_slow() {
        // Verify asymmetric envelope: open_speed (0.9) >> close_speed (0.25)
        let loud = 0.5f32;
        let quiet = SPEAKING_THRESHOLD * 0.02;
        let mut nf = SPEAKING_THRESHOLD * 0.2;

        // Measure single-step open from 0.0
        let mut gg_open = 0.0f32;
        let mut f = vec![loud; 480];
        apply_voice_processing(&mut f, &mut nf, &mut gg_open, true, false, false);
        let open_jump = gg_open; // started at 0 → how much did it rise?

        // Measure single-step close from 1.0
        let mut gg_close = 1.0f32;
        let mut f2 = vec![quiet; 480];
        apply_voice_processing(&mut f2, &mut nf, &mut gg_close, true, false, false);
        let close_step = 1.0 - gg_close; // how much did it fall?

        assert!(
            open_jump > close_step * 2.0,
            "gate should open much faster than it closes: open={open_jump:.3} close={close_step:.3}"
        );
    }

    #[test]
    fn ns_soft_knee_gives_partial_gain() {
        // A signal between noise_floor×1.5 and speech_level gets partial gain ∈ (0.05, 1.0)
        // floor ≈ 0.003, floor×1.5 ≈ 0.0045, speech_level ≈ max(0.015, 0.024) = 0.024
        let floor = SPEAKING_THRESHOLD * 0.2; // 0.003
        let mid = floor * 3.5; // 0.0105 — inside the soft-knee region (0.0045 … 0.024)
        let (gate_gain, _) = converge(mid, 40, true, false, false);
        assert!(
            gate_gain > 0.05 && gate_gain < 0.95,
            "soft-knee signal should yield partial gain ∈ (0.05, 0.95), got {gate_gain:.4}"
        );
    }

    // ── apply_voice_processing — echo cancellation ────────────────────────────

    #[test]
    fn ec_gates_signal_below_4x_threshold_when_playback_active() {
        // EC raises threshold to 4×; a 2× signal must be suppressed
        let rms = SPEAKING_THRESHOLD * 2.0; // > 1× but < 4× → gated
        let (gate_gain, _) = converge(rms, 30, false, true, true);
        assert!(
            gate_gain < 0.10,
            "EC should suppress signal below 4× threshold; gate_gain={gate_gain:.4}"
        );
    }

    #[test]
    fn ec_passes_signal_above_4x_threshold_when_playback_active() {
        // EC raises threshold to 4×; a 5× signal must pass through
        let rms = SPEAKING_THRESHOLD * 5.0; // above 4× → passes
        let (gate_gain, _) = converge(rms, 20, false, true, true);
        assert!(
            gate_gain > 0.80,
            "EC should pass signal above 4× threshold; gate_gain={gate_gain:.4}"
        );
    }

    #[test]
    fn ec_gate_closes_faster_than_ns_gate() {
        // After loud signal stops, EC close_speed (0.7) must produce a bigger
        // single-step drop than NS close_speed (0.25).
        let loud = 0.5f32;
        let quiet_ec = SPEAKING_THRESHOLD * 0.01; // far below 4× EC threshold
        let quiet_ns = SPEAKING_THRESHOLD * 0.03; // far below NS speech level

        // Open both gates from 0 → let converge to ~1.0
        let mut nf = SPEAKING_THRESHOLD * 0.2;
        let mut gg_ns = 0.0f32;
        let mut gg_ec = 0.0f32;
        for _ in 0..30 {
            let mut f = vec![loud; 480];
            apply_voice_processing(&mut f, &mut nf, &mut gg_ns, true, false, false);
            let mut f2 = vec![loud; 480];
            apply_voice_processing(&mut f2, &mut nf, &mut gg_ec, false, true, true);
        }

        let before_ns = gg_ns;
        let before_ec = gg_ec;

        // One quiet frame each
        let mut f_ns = vec![quiet_ns; 480];
        apply_voice_processing(&mut f_ns, &mut nf, &mut gg_ns, true, false, false);
        let mut f_ec = vec![quiet_ec; 480];
        apply_voice_processing(&mut f_ec, &mut nf, &mut gg_ec, false, true, true);

        let ns_drop = before_ns - gg_ns;
        let ec_drop = before_ec - gg_ec;
        assert!(
            ec_drop > ns_drop * 1.5,
            "EC close should be faster than NS close: ec_drop={ec_drop:.3} ns_drop={ns_drop:.3}"
        );
    }

    #[test]
    fn ec_no_effect_when_ns_also_disabled_and_no_playback() {
        // Both NS=false, EC=true, playback=false → processed frame must equal original
        let original = vec![SPEAKING_THRESHOLD * 10.0; 480]; // loud
        let mut frame = original.clone();
        let mut nf = SPEAKING_THRESHOLD * 0.2;
        let mut gg = 1.0f32;
        apply_voice_processing(&mut frame, &mut nf, &mut gg, false, true, false);
        assert_eq!(frame, original);
    }

    // ── stress: large audio buffer does not panic ─────────────────────────────

    #[test]
    fn resample_to_f32_large_burst_no_panic() {
        // 5 seconds of 44.1 kHz audio → should resample to 48 kHz without panic/OOM
        let large = vec![1000i16; 220_500]; // 5 s × 44100
        let out = resample_to_f32(&large, 44_100);
        // 5 s × 48000 = 240000 — allow ±2 for rounding
        assert!(
            (out.len() as i64 - 240_000).abs() <= 2,
            "expected ~240000 samples, got {}",
            out.len()
        );
    }

    #[test]
    fn resample_f32_large_burst_no_panic() {
        // 5 seconds of 48 kHz audio → resample to 44.1 kHz
        let large = vec![0.5f32; 240_000];
        let out = resample_f32(&large, 48_000, 44_100);
        assert!(
            (out.len() as i64 - 220_500).abs() <= 2,
            "expected ~220500 samples, got {}",
            out.len()
        );
    }
}
