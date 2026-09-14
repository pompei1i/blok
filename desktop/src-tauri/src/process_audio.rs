//! Per-process desktop-audio capture on Windows (WASAPI process loopback).
//!
//! Plain endpoint loopback records everything the speakers play, so a single
//! window share leaked every other app's sound — and blok's own playback of the
//! other participants, who then heard themselves echoed. Process loopback
//! (Windows 10 build 20348+ / Windows 11) records either one process tree
//! (a window share: the window's owner, which also covers a browser's audio
//! child process) or everything *except* one tree (a monitor share: all but
//! blok itself).
//!
//! Older Windows rejects the activation; the caller falls back to endpoint
//! loopback there.

use std::sync::mpsc;
use std::time::Duration;

use windows::core::{implement, Interface, Ref, HRESULT, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WAIT_FAILED};
use windows::Win32::Media::Audio::{
    ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_EVENTCALLBACK, AUDCLNT_STREAMFLAGS_LOOPBACK, AUDIOCLIENT_ACTIVATION_PARAMS,
    AUDIOCLIENT_ACTIVATION_PARAMS_0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
    WAVEFORMATEX, WAVE_FORMAT_PCM,
};
use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, BLOB, COINIT_MULTITHREADED};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};
use windows::Win32::System::Variant::VT_BLOB;
use windows::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GetClassNameW, GetWindowThreadProcessId};
use windows::core::BOOL;

/// Process loopback converts to whatever format is asked for, so the capture is
/// pinned to the rate the rest of the audio path already runs at.
pub const RATE: u32 = 48_000;
const CHANNELS: u16 = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    /// Only this process and its children.
    Include(u32),
    /// Everything but this process and its children.
    Exclude(u32),
}

/// The loopback target for a capture source id: the owning process of a
/// `window:` source, or everything but blok for a monitor (or anything else).
pub fn target_for_source(source_id: &str) -> Target {
    source_id
        .strip_prefix("window:")
        .and_then(|rest| rest.split(':').next()?.parse::<isize>().ok())
        .and_then(window_pid)
        .map(Target::Include)
        .unwrap_or(Target::Exclude(std::process::id()))
}

/// Owning process of a top-level window. A UWP app's top-level window belongs
/// to ApplicationFrameHost, which plays nothing — the app's own process owns a
/// CoreWindow child, so that child's process is the one to record.
fn window_pid(hwnd: isize) -> Option<u32> {
    let hwnd = HWND(hwnd as *mut _);
    let mut pid = 0u32;
    if unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) } == 0 || pid == 0 {
        return None;
    }

    let mut class = [0u16; 64];
    let n = unsafe { GetClassNameW(hwnd, &mut class) };
    if String::from_utf16_lossy(&class[..n.max(0) as usize]) != "ApplicationFrameWindow" {
        return Some(pid);
    }

    unsafe extern "system" fn find_app(child: HWND, lparam: LPARAM) -> BOOL {
        let (frame_pid, found) = unsafe { &mut *(lparam.0 as *mut (u32, u32)) };
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(child, Some(&mut pid)) };
        if pid != 0 && pid != *frame_pid {
            *found = pid;
            return BOOL(0);
        }
        BOOL(1)
    }
    let mut search = (pid, 0u32);
    unsafe {
        let _ = EnumChildWindows(Some(hwnd), Some(find_app), LPARAM(&mut search as *mut _ as isize));
    }
    Some(if search.1 != 0 { search.1 } else { pid })
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Activated(mpsc::Sender<()>);

impl IActivateAudioInterfaceCompletionHandler_Impl for Activated_Impl {
    fn ActivateCompleted(&self, _: Ref<'_, IActivateAudioInterfaceAsyncOperation>) -> windows::core::Result<()> {
        let _ = self.0.send(());
        Ok(())
    }
}

/// Starts capturing `target` and hands every chunk to `on_pcm` as mono i16-LE
/// at [`RATE`]. Returns once the stream is running, with a sender whose drop
/// stops it — the same contract as the endpoint-loopback path.
pub fn start(
    target: Target,
    on_pcm: impl Fn(u32, Vec<u8>) + Send + 'static,
) -> Result<mpsc::Sender<()>, String> {
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

    // COM objects stay on the thread that made them; it runs until stop_tx drops.
    std::thread::spawn(move || {
        if unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_err() {
            let _ = ready_tx.send(Err("COM init failed".into()));
            return;
        }
        match open(target) {
            Ok((client, capture, event)) => {
                let _ = ready_tx.send(Ok(()));
                pump(&capture, event, &stop_rx, &on_pcm);
                unsafe {
                    let _ = client.Stop();
                    let _ = CloseHandle(event);
                }
            }
            Err(e) => {
                let _ = ready_tx.send(Err(e));
            }
        }
        unsafe { CoUninitialize() };
    });

    ready_rx
        .recv()
        .map_err(|_| "process loopback thread died".to_string())??;
    Ok(stop_tx)
}

fn open(
    target: Target,
) -> Result<(IAudioClient, IAudioCaptureClient, windows::Win32::Foundation::HANDLE), String> {
    let (pid, mode) = match target {
        Target::Include(pid) => (pid, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE),
        Target::Exclude(pid) => (pid, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE),
    };
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: mode,
            },
        },
    };
    // ManuallyDrop: PROPVARIANT's Drop runs PropVariantClear, which would
    // CoTaskMemFree the blob — and the blob is `params` on this stack frame.
    let prop = std::mem::ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: &mut params as *mut _ as *mut u8,
                    },
                },
            }),
        },
    });

    let (done_tx, done_rx) = mpsc::channel();
    let handler: IActivateAudioInterfaceCompletionHandler = Activated(done_tx).into();
    let op = unsafe {
        ActivateAudioInterfaceAsync(
            PCWSTR(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK.0),
            &IAudioClient::IID,
            Some(&*prop),
            &handler,
        )
    }
    .map_err(|e| format!("process loopback unavailable: {e}"))?;
    done_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "process loopback activation timed out".to_string())?;

    let mut hr = HRESULT(0);
    let mut unknown = None;
    unsafe { op.GetActivateResult(&mut hr, &mut unknown) }
        .and_then(|_| hr.ok())
        .map_err(|e| format!("process loopback activation failed: {e}"))?;
    let client: IAudioClient = unknown
        .ok_or("process loopback returned no client")?
        .cast()
        .map_err(|e| format!("process loopback client: {e}"))?;

    let block_align = CHANNELS * 2;
    let format = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: CHANNELS,
        nSamplesPerSec: RATE,
        nAvgBytesPerSec: RATE * block_align as u32,
        nBlockAlign: block_align,
        wBitsPerSample: 16,
        cbSize: 0,
    };
    unsafe {
        client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                200_000, // 20ms, in 100ns units
                0,
                &format,
                None,
            )
            .map_err(|e| format!("process loopback init failed: {e}"))?;
        let event = CreateEventW(None, false, false, PCWSTR::null()).map_err(|e| e.to_string())?;
        let started = client
            .SetEventHandle(event)
            .and_then(|_| client.GetService::<IAudioCaptureClient>())
            .and_then(|capture| client.Start().map(|_| capture));
        match started {
            Ok(capture) => Ok((client, capture, event)),
            Err(e) => {
                let _ = CloseHandle(event);
                Err(format!("process loopback would not start: {e}"))
            }
        }
    }
}

fn pump(
    capture: &IAudioCaptureClient,
    event: windows::Win32::Foundation::HANDLE,
    stop: &mpsc::Receiver<()>,
    on_pcm: &impl Fn(u32, Vec<u8>),
) {
    let channels = CHANNELS as usize;
    loop {
        if matches!(stop.try_recv(), Err(mpsc::TryRecvError::Disconnected)) {
            return;
        }
        // The event only fires while the target plays something; the timeout
        // keeps the stop check responsive through silence.
        if unsafe { WaitForSingleObject(event, 50) } == WAIT_FAILED {
            return;
        }
        loop {
            match unsafe { capture.GetNextPacketSize() } {
                Ok(0) => break,
                Ok(_) => {}
                Err(e) => {
                    eprintln!("[desktop-audio] process loopback read failed: {e}");
                    return;
                }
            }
            let mut data = std::ptr::null_mut();
            let mut frames = 0u32;
            let mut flags = 0u32;
            if unsafe { capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None) }.is_err() {
                return;
            }
            let mut mono = vec![0u8; frames as usize * 2];
            if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 == 0 && !data.is_null() {
                let bytes = unsafe { std::slice::from_raw_parts(data, frames as usize * channels * 2) };
                for (out, frame) in mono.chunks_exact_mut(2).zip(bytes.chunks_exact(channels * 2)) {
                    let sum: i32 = frame
                        .chunks_exact(2)
                        .map(|s| i16::from_le_bytes([s[0], s[1]]) as i32)
                        .sum();
                    out.copy_from_slice(&((sum / channels as i32) as i16).to_le_bytes());
                }
            }
            unsafe {
                let _ = capture.ReleaseBuffer(frames);
            }
            if frames > 0 {
                on_pcm(RATE, mono);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monitor_and_unknown_sources_exclude_blok_itself() {
        let me = Target::Exclude(std::process::id());
        assert_eq!(target_for_source("screen:0"), me);
        assert_eq!(target_for_source("window:0"), me);
        assert_eq!(target_for_source("window:nope"), me);
    }

    /// A real window resolves to its owner's pid, proving the hwnd → pid path.
    #[test]
    fn window_source_targets_its_owning_process() {
        use windows::Win32::UI::WindowsAndMessaging::GetDesktopWindow;
        let desktop = unsafe { GetDesktopWindow() };
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(desktop, Some(&mut pid)) };
        if pid == 0 {
            return;
        }
        assert_eq!(target_for_source(&format!("window:{}", desktop.0 as isize)), Target::Include(pid));
    }

    /// Where process loopback exists (Win11), capturing everything but this test
    /// process must open and stop cleanly; older builds must decline, not panic.
    #[test]
    fn process_loopback_opens_or_declines() {
        match start(Target::Exclude(std::process::id()), |_, _| {}) {
            Ok(stop) => {
                std::thread::sleep(Duration::from_millis(100));
                drop(stop);
            }
            Err(e) => eprintln!("process loopback declined: {e}"),
        }
    }
}
