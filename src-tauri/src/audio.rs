use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

const TARGET_RATE: u32 = 48_000;
const FRAME_MS: usize = 60; // ms per broadcast chunk → ~17 msgs/sec/participant
const SPEAKING_THRESHOLD: f32 = 0.015; // RMS level to count as speaking

struct CaptureShared {
    muted: bool,
    accumulator: Vec<f32>,
    frame_size: usize,
}

struct PlaybackShared {
    deafened: bool,
    // per-peer ring buffers (mono f32)
    buffers: HashMap<String, VecDeque<f32>>,
    out_channels: usize,
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

impl NativeAudio {
    pub fn start(app: tauri::AppHandle) -> Result<Self, String> {
        let (tx, rx) = std::sync::mpsc::sync_channel::<Cmd>(128);
        std::thread::Builder::new()
            .name("blok-audio".into())
            .spawn(move || {
                if let Err(e) = run_audio(app, rx) {
                    eprintln!("[audio] engine error: {e}");
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self { tx })
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
) -> Result<(), Box<dyn std::error::Error>> {
    let host = cpal::default_host();

    let input_device = host
        .default_input_device()
        .ok_or("no default input device")?;
    let output_device = host
        .default_output_device()
        .ok_or("no default output device")?;

    // --- input config: prefer 48 kHz mono ---
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
                channels: 1,
                sample_rate: cpal::SampleRate(TARGET_RATE),
                buffer_size: cpal::BufferSize::Default,
            }
        } else {
            input_device.default_input_config()?.config()
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
    }));

    // --- input stream ---
    let cap = cap_shared.clone();
    let app_in = app.clone();
    let input_stream = input_device.build_input_stream(
        &input_config,
        move |data: &[f32], _| {
            let mut state = cap.lock().unwrap();
            if state.muted {
                return;
            }
            state.accumulator.extend_from_slice(data);
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
        |e| eprintln!("[audio] input error: {e}"),
        None,
    )?;

    // --- output stream ---
    let play = play_shared.clone();
    let output_stream = output_device.build_output_stream(
        &output_config,
        move |data: &mut [f32], _| {
            for s in data.iter_mut() {
                *s = 0.0;
            }
            let mut state = play.lock().unwrap();
            if state.deafened {
                return;
            }
            let ch = state.out_channels;
            let n_frames = data.len() / ch;
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
        |e| eprintln!("[audio] output error: {e}"),
        None,
    )?;

    input_stream.play()?;
    output_stream.play()?;

    // keep streams alive by holding them; process commands
    let _input = input_stream;
    let _output = output_stream;

    loop {
        match rx.recv() {
            Ok(Cmd::Stop) | Err(_) => break,
            Ok(Cmd::SetMuted(v)) => {
                cap_shared.lock().unwrap().muted = v;
            }
            Ok(Cmd::SetDeafened(v)) => {
                play_shared.lock().unwrap().deafened = v;
            }
            Ok(Cmd::AddSamples { from, samples }) => {
                let mut state = play_shared.lock().unwrap();
                let buf = state.buffers.entry(from).or_default();
                // keep at most 2 s of audio to avoid unbounded growth
                let max = actual_rate * 2;
                while buf.len() + samples.len() > max {
                    buf.pop_front();
                }
                buf.extend(samples);
            }
            Ok(Cmd::RemovePeer(id)) => {
                play_shared.lock().unwrap().buffers.remove(&id);
            }
        }
    }

    Ok(())
}
