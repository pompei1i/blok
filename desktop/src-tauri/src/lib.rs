mod adapt;
mod audio;
#[cfg(target_os = "windows")]
mod dxgi_capture;
mod h264;
#[cfg(target_os = "windows")]
mod h264_mf;
#[cfg(target_os = "windows")]
mod process_audio;
#[cfg(target_os = "windows")]
mod wgc_capture;
mod rtc;

use audio::{Cmd, NativeAudio};
use rtc::RtcState;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    ipc::{Channel, InvokeBody, InvokeResponseBody, Request},
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

// ── native audio state ────────────────────────────────────────────────────────

struct AudioState(Mutex<Option<NativeAudio>>);

/// Running desktop-audio loopback capture (`parec` child), if any. Kept so a stop
/// command (or a fresh start) can kill the previous recorder.
/// A running desktop-audio capture, however the platform provides it.
enum DesktopAudioCapture {
    /// Linux: a `parec` child reading the default sink's monitor source.
    #[cfg(target_os = "linux")]
    Parec(std::process::Child),
    /// Windows: dropping the sender ends the thread that owns the WASAPI
    /// loopback stream (cpal streams are `!Send`, so one thread owns it).
    #[cfg(target_os = "windows")]
    Loopback(std::sync::mpsc::Sender<()>),
}

impl DesktopAudioCapture {
    fn stop(self) {
        match self {
            #[cfg(target_os = "linux")]
            DesktopAudioCapture::Parec(mut child) => {
                let _ = child.kill();
                let _ = child.wait();
            }
            #[cfg(target_os = "windows")]
            DesktopAudioCapture::Loopback(tx) => drop(tx),
        }
    }
}

/// The running capture and the id its start was issued with. Stops name the id
/// they mean: IPC calls can be handled out of order, and a stop meant for the
/// previous share landing after the next start would otherwise kill the new one.
struct DesktopAudioState(Mutex<Option<(u64, DesktopAudioCapture)>>);

/// Generation counter for the push-based screen-capture loop. Bumping it stops
/// the currently running capture thread (it checks the counter every frame).
struct ScreenCastState(std::sync::Arc<std::sync::atomic::AtomicU64>);

/// Returns the actual input sample rate so the JS side can include it in
/// every audio packet, enabling correct resampling on remote peers.
///
/// `on_chunk` is a binary IPC channel: each captured PCM frame is delivered to
/// JS as raw i16-LE bytes (ArrayBuffer). The old "audio-chunk" event serialized
/// a JSON number array ~25×/sec — measurable main-thread cost during calls.
#[tauri::command]
fn audio_start(
    state: tauri::State<AudioState>,
    app: tauri::AppHandle,
    input_device: Option<String>,
    output_device: Option<String>,
    noise_suppression: bool,
    echo_cancellation: bool,
    on_chunk: Channel<InvokeResponseBody>,
) -> Result<u32, String> {
    let (engine, actual_rate) = NativeAudio::start(
        app,
        on_chunk,
        input_device,
        output_device,
        noise_suppression,
        echo_cancellation,
    )?;
    *state.0.lock().unwrap() = Some(engine);
    Ok(actual_rate)
}

#[tauri::command]
fn audio_set_noise_suppression(enabled: bool, state: tauri::State<AudioState>) {
    if let Some(engine) = state.0.lock().unwrap().as_ref() {
        engine.send(Cmd::SetNoiseSuppression(enabled));
    }
}

#[tauri::command]
fn audio_set_echo_cancellation(enabled: bool, state: tauri::State<AudioState>) {
    if let Some(engine) = state.0.lock().unwrap().as_ref() {
        engine.send(Cmd::SetEchoCancellation(enabled));
    }
}

#[tauri::command]
fn audio_list_input_devices() -> Vec<String> {
    audio::list_input_devices()
}

#[tauri::command]
fn audio_list_output_devices() -> Vec<String> {
    audio::list_output_devices()
}

#[tauri::command]
fn audio_stop(state: tauri::State<AudioState>) {
    if let Some(engine) = state.0.lock().unwrap().take() {
        engine.send(Cmd::Stop);
    }
}

#[tauri::command]
fn audio_set_muted(muted: bool, state: tauri::State<AudioState>) {
    if let Some(engine) = state.0.lock().unwrap().as_ref() {
        engine.send(Cmd::SetMuted(muted));
    }
}

#[tauri::command]
fn audio_set_deafened(deafened: bool, state: tauri::State<AudioState>) {
    if let Some(engine) = state.0.lock().unwrap().as_ref() {
        engine.send(Cmd::SetDeafened(deafened));
    }
}

/// Receive a remote participant's PCM frame as raw i16-LE bytes (binary IPC —
/// the old JSON path serialized a number array per frame per peer). Metadata
/// rides in request headers:
///   x-from   — peer id
///   x-rate   — sender's input sample rate (resampled to 48 kHz here)
///   x-volume — local per-user volume 0.00–2.00, applied here in f32 (was a
///              per-sample map() on the JS main thread)
/// Returns true if the frame's RMS exceeds the speaking threshold — computed
/// BEFORE the volume override, so a quiet local volume doesn't hide the
/// speaking indicator.
#[tauri::command]
fn audio_receive(request: Request<'_>, state: tauri::State<AudioState>) -> Result<bool, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw PCM body".into());
    };
    let header = |name: &str| -> Option<&str> {
        request.headers().get(name).and_then(|v| v.to_str().ok())
    };
    let from = header("x-from").ok_or("missing x-from header")?.to_string();
    let rate: u32 = header("x-rate").and_then(|v| v.parse().ok()).unwrap_or(48_000);
    let volume: f32 = header("x-volume").and_then(|v| v.parse().ok()).unwrap_or(1.0);

    let samples: Vec<i16> = bytes
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect();

    let speaking = audio::is_speaking_i16(&samples);
    if let Some(engine) = state.0.lock().unwrap().as_ref() {
        let mut f32s = audio::resample_to_f32(&samples, rate);
        if (volume - 1.0).abs() > f32::EPSILON {
            for s in f32s.iter_mut() {
                *s = (*s * volume).clamp(-1.0, 1.0);
            }
        }
        engine.send(Cmd::AddSamples { from, samples: f32s });
    }
    Ok(speaking)
}

#[tauri::command]
fn audio_remove_peer(peer_id: String, state: tauri::State<AudioState>) {
    if let Some(engine) = state.0.lock().unwrap().as_ref() {
        engine.send(Cmd::RemovePeer(peer_id));
    }
}

// ── Windows audio-ducking disable ────────────────────────────────────────────

#[tauri::command]
fn disable_audio_ducking() {
    // Sets HKCU\Software\Microsoft\Multimedia\Audio\UserDuckingPreference=3 (disable ducking).
    // Value 3 = "Do nothing" per Windows Communications Activity API; broadcast WM_SETTINGCHANGE
    // to apply without requiring a reboot or re-login.
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::Foundation::{LPARAM, WPARAM};
        use windows::Win32::System::Registry::{
            RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY_CURRENT_USER,
            KEY_SET_VALUE, REG_DWORD, REG_OPTION_NON_VOLATILE,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
        };
        use windows::core::PCWSTR;

        let path = windows::core::w!("Software\\Microsoft\\Multimedia\\Audio");
        let value_name = windows::core::w!("UserDuckingPreference");
        let mut hkey = std::mem::zeroed();

        if RegCreateKeyExW(
            HKEY_CURRENT_USER,
            path,
            Some(0),
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut hkey,
            None,
        )
        .is_ok()
        {
            let value: u32 = 3;
            let _ = RegSetValueExW(
                hkey,
                value_name,
                Some(0),
                REG_DWORD,
                Some(std::slice::from_raw_parts(
                    &value as *const u32 as *const u8,
                    std::mem::size_of::<u32>(),
                )),
            );
            let _ = RegCloseKey(hkey);
        }

        let param = windows::core::w!("Sound");
        let mut result = 0usize;
        let _ = SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(param.as_ptr() as isize),
            SMTO_ABORTIFHUNG,
            2000,
            Some(&mut result),
        );
    }
}

// ── autostart (Windows registry) ─────────────────────────────────────────────

const AUTOSTART_KEY: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";
const AUTOSTART_VALUE: &str = "$blok";

#[tauri::command]
fn autostart_is_enabled() -> bool {
    autostart_is_enabled_impl()
}

#[tauri::command]
fn autostart_set(enabled: bool) -> Result<(), String> {
    autostart_set_impl(enabled)
}

#[cfg(target_os = "windows")]
fn autostart_is_enabled_impl() -> bool {
    use windows::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_CURRENT_USER, KEY_READ};
    use windows::core::PCWSTR;

    unsafe {
        let key_path: Vec<u16> = format!("{AUTOSTART_KEY}\0").encode_utf16().collect();
        let value_name: Vec<u16> = format!("{AUTOSTART_VALUE}\0").encode_utf16().collect();
        let mut hkey = std::mem::zeroed();
        if RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(key_path.as_ptr()), Some(0), KEY_READ, &mut hkey).ok().is_err() {
            return false;
        }
        let found = RegQueryValueExW(hkey, PCWSTR(value_name.as_ptr()), None, None, None, None).ok().is_ok();
        let _ = RegCloseKey(hkey);
        found
    }
}

#[cfg(target_os = "windows")]
fn autostart_set_impl(enabled: bool) -> Result<(), String> {
    use windows::Win32::System::Registry::{RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegSetValueExW, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_SZ};
    use windows::core::PCWSTR;

    unsafe {
        let key_path: Vec<u16> = format!("{AUTOSTART_KEY}\0").encode_utf16().collect();
        let value_name: Vec<u16> = format!("{AUTOSTART_VALUE}\0").encode_utf16().collect();
        let mut hkey = std::mem::zeroed();
        RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(key_path.as_ptr()), Some(0), KEY_SET_VALUE, &mut hkey)
            .ok().map_err(|e| e.to_string())?;

        let result = if enabled {
            let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
            let exe_utf16: Vec<u16> = exe_path.to_string_lossy().encode_utf16().chain(std::iter::once(0)).collect();
            let data = std::slice::from_raw_parts(exe_utf16.as_ptr() as *const u8, exe_utf16.len() * 2);
            RegSetValueExW(hkey, PCWSTR(value_name.as_ptr()), Some(0), REG_SZ, Some(data))
                .ok().map_err(|e| e.to_string())
        } else {
            RegDeleteValueW(hkey, PCWSTR(value_name.as_ptr()))
                .ok().map_err(|e| e.to_string())
        };

        let _ = RegCloseKey(hkey);
        result
    }
}

// ── autostart (Linux XDG autostart) ──────────────────────────────────────────

#[cfg(target_os = "linux")]
fn autostart_dir() -> Result<std::path::PathBuf, String> {
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        if !xdg.is_empty() {
            return Ok(std::path::PathBuf::from(xdg).join("autostart"));
        }
    }
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    Ok(std::path::PathBuf::from(home).join(".config").join("autostart"))
}

#[cfg(target_os = "linux")]
fn autostart_desktop_file() -> Result<std::path::PathBuf, String> {
    Ok(autostart_dir()?.join("blok.desktop"))
}

// AppImages re-exec themselves from a throwaway FUSE mount, so `current_exe()` inside one
// resolves to that ephemeral path. AppImage sets $APPIMAGE to the real, stable file path —
// prefer it so the autostart entry doesn't point at a mount that's gone on next boot.
#[cfg(target_os = "linux")]
fn autostart_exec_path() -> Result<String, String> {
    if let Ok(appimage) = std::env::var("APPIMAGE") {
        return Ok(appimage);
    }
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn autostart_is_enabled_impl() -> bool {
    autostart_desktop_file().map(|p| p.exists()).unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn autostart_set_impl(enabled: bool) -> Result<(), String> {
    let file = autostart_desktop_file()?;
    if enabled {
        let dir = autostart_dir()?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let exec = autostart_exec_path()?;
        let contents = format!(
            "[Desktop Entry]\nType=Application\nName=$blok\nExec={exec}\nIcon=blok\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"
        );
        std::fs::write(&file, contents).map_err(|e| e.to_string())
    } else {
        match std::fs::remove_file(&file) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn autostart_is_enabled_impl() -> bool { false }

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn autostart_set_impl(_enabled: bool) -> Result<(), String> {
    Err("Autostart is only supported on Windows and Linux".to_string())
}

// ── Linux media permissions (WebKitGTK) ──────────────────────────────────────

// WebKitGTK denies every getUserMedia/getDisplayMedia request by default and never shows
// its own prompt — unlike WebView2 (Windows) and WKWebView (macOS), which auto-grant. Our
// in-app UI is already the consent gate (mic/camera/screen-share are explicit user actions),
// so auto-allow exactly the user-media request class here; anything else (geolocation,
// notifications, etc. — unused by this app) falls through to WebKitGTK's default deny.
#[cfg(target_os = "linux")]
fn allow_linux_media_permissions(window: &tauri::WebviewWindow) {
    use webkit2gtk::glib::prelude::*;
    use webkit2gtk::{PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt};
    let _ = window.with_webview(|webview| {
        let wv = webview.inner();
        // WebKitGTK ships WebRTC disabled by default — without this, the page has
        // no RTCPeerConnection at all (voice/screen-share/camera between peers
        // simply can't connect on Linux). The window starts loading before this
        // setup hook runs and JS globals are fixed per page load, so reload once
        // right after enabling to get a page that actually has the API.
        if let Some(settings) = WebViewExt::settings(&wv) {
            if !settings.enables_webrtc() {
                settings.set_enable_webrtc(true);
                settings.set_enable_media_stream(true);
                wv.reload();
            }
        }
        wv.connect_permission_request(|_wv, request| {
            if request
                .dynamic_cast_ref::<UserMediaPermissionRequest>()
                .is_some()
            {
                request.allow();
                true
            } else {
                false
            }
        });
    });
}

// ── screen frame capture ──────────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct ScreenFrame {
    data: String, // base64-encoded JPEG
    w: u32,
    h: u32,
}

struct RawFrame {
    bgra: Vec<u8>,
    w: u32,
    h: u32,
}

struct ScreenCaptureState {
    last_hashes: Mutex<HashMap<String, u64>>,
}

/// Sampled FNV-64a over every 64th byte (~1% of pixels at 720p).
/// Fast enough to run on every frame without measurable overhead.
fn frame_hash(data: &[u8]) -> u64 {
    const OFFSET: u64 = 0xcbf29ce484222325;
    const PRIME: u64 = 0x100000001b3;
    let mut h = OFFSET;
    for i in (0..data.len()).step_by(64) {
        h ^= data[i] as u64;
        h = h.wrapping_mul(PRIME);
    }
    h
}

fn encode_bgra_to_frame(bgra: Vec<u8>, w: u32, h: u32, max_width: u32, jpeg_quality: u8) -> Option<ScreenFrame> {
    let (jpeg, tw, th) = encode_bgra_to_jpeg(bgra, w, h, max_width, jpeg_quality)?;
    use base64::Engine as _;
    let data = base64::engine::general_purpose::STANDARD.encode(&jpeg);
    Some(ScreenFrame { data, w: tw, h: th })
}

/// BGRA/BGR frame → (JPEG bytes, out_w, out_h), downscaling to `max_width` if set.
fn encode_bgra_to_jpeg(bgra: Vec<u8>, w: u32, h: u32, max_width: u32, jpeg_quality: u8) -> Option<(Vec<u8>, u32, u32)> {
    if w == 0 || h == 0 {
        return None;
    }
    // Target size (downscale only). `image`'s generic resize was ~50ms/frame even for
    // Nearest; an integer nearest-neighbour pass is ~10x faster.
    let (tw, th) = if max_width > 0 && w > max_width {
        (max_width, ((h as u64 * max_width as u64 / w as u64) as u32).max(1))
    } else {
        (w, h)
    };

    // Bytes per source pixel: X11 GetImage returns 4 (BGRX) on 32-bit visuals but
    // may return 3 (BGR) on a depth-24 drawable — deriving it from the buffer length
    // (instead of assuming 4) keeps the indexing in-bounds and avoids a panic/crash.
    let pixels = (w as usize) * (h as usize);
    if pixels == 0 {
        return None;
    }
    let bpp = bgra.len() / pixels;
    if bpp < 3 {
        return None; // unexpected/truncated buffer — bail instead of indexing OOB
    }
    // The encoder takes BGR(A) as is, so pixels are only touched to downscale.
    // Converting every frame to RGB first cost a third of the encode (1080p:
    // 13.7ms → 9.0ms without it, measured on a real screen frame).
    let (out_bpp, color) = if bpp == 3 {
        (3, jpeg_encoder::ColorType::Bgr)
    } else {
        (4, jpeg_encoder::ColorType::Bgra)
    };
    let pixels_in: std::borrow::Cow<[u8]> = if (tw, th) == (w, h) && bpp == out_bpp {
        std::borrow::Cow::Borrowed(&bgra)
    } else {
        std::borrow::Cow::Owned(downscale_nearest(&bgra, w, h, bpp, tw, th, out_bpp))
    };

    let quality = jpeg_quality.clamp(1, 100);
    let mut buf = Vec::new();
    let encoder = jpeg_encoder::Encoder::new(&mut buf, quality);
    encoder.encode(&pixels_in, tw as u16, th as u16, color).ok()?;
    Some((buf, tw, th))
}

/// Nearest-neighbour resample of a `bpp`-bytes-per-pixel frame to `tw`x`th`,
/// keeping the first `out_bpp` bytes of each pixel.
fn downscale_nearest(src: &[u8], w: u32, h: u32, bpp: usize, tw: u32, th: u32, out_bpp: usize) -> Vec<u8> {
    let (w, h, tw, th) = (w as usize, h as usize, tw as usize, th as usize);
    let mut out = vec![0u8; tw * th * out_bpp];
    let src_x: Vec<usize> = (0..tw).map(|x| x * w / tw * bpp).collect();
    for (ty, row) in out.chunks_exact_mut(tw * out_bpp).enumerate() {
        let src_row = &src[(ty * h / th) * w * bpp..][..w * bpp];
        for (px, &sx) in row.chunks_exact_mut(out_bpp).zip(&src_x) {
            px.copy_from_slice(&src_row[sx..sx + out_bpp]);
        }
    }
    out
}

fn capture_raw_frame(source_id: &str) -> Option<RawFrame> {
    if let Some(rest) = source_id.strip_prefix("screen:") {
        let idx: u32 = rest.split(':').next()?.parse().ok()?;
        capture_raw_monitor(idx)
    } else if let Some(rest) = source_id.strip_prefix("window:") {
        let hwnd_val: isize = rest.split(':').next()?.parse().ok()?;
        capture_raw_window(hwnd_val)
    } else {
        None
    }
}

/// A pickable capture source (a whole monitor or a single window) for the
/// screen-share picker. `id` matches the `source_id` format `capture_screen_frame`
/// expects (`screen:<index>` / `window:<xid>`).
#[derive(serde::Serialize)]
struct CaptureSource {
    id: String,
    name: String,
    kind: String, // "screen" | "window"
}

#[cfg(target_os = "linux")]
fn list_x11_windows(
    conn: &x11rb::rust_connection::RustConnection,
    root: x11rb::protocol::xproto::Window,
) -> Vec<CaptureSource> {
    use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _};

    let intern = |name: &[u8]| -> Option<u32> {
        conn.intern_atom(true, name).ok()?.reply().ok().map(|r| r.atom).filter(|a| *a != 0)
    };
    let (Some(client_list), Some(net_wm_name), Some(utf8)) =
        (intern(b"_NET_CLIENT_LIST"), intern(b"_NET_WM_NAME"), intern(b"UTF8_STRING"))
    else {
        return Vec::new();
    };

    let Ok(prop) = conn.get_property(false, root, client_list, AtomEnum::WINDOW, 0, u32::MAX) else {
        return Vec::new();
    };
    let Ok(prop) = prop.reply() else { return Vec::new() };
    let Some(wins) = prop.value32() else { return Vec::new() };

    let mut out = Vec::new();
    for win in wins {
        // Skip windows too small to be worth sharing (tooltips, docks, etc.).
        let Ok(geom) = conn.get_geometry(win) else { continue };
        let Ok(geom) = geom.reply() else { continue };
        if geom.width < 32 || geom.height < 32 {
            continue;
        }
        // Title: prefer _NET_WM_NAME (UTF-8), fall back to legacy WM_NAME.
        let title = conn
            .get_property(false, win, net_wm_name, utf8, 0, 1024)
            .ok()
            .and_then(|c| c.reply().ok())
            .map(|r| r.value)
            .filter(|v| !v.is_empty())
            .or_else(|| {
                conn.get_property(false, win, AtomEnum::WM_NAME, AtomEnum::STRING, 0, 1024)
                    .ok()
                    .and_then(|c| c.reply().ok())
                    .map(|r| r.value)
                    .filter(|v| !v.is_empty())
            })
            .map(|v| String::from_utf8_lossy(&v).into_owned())
            .unwrap_or_else(|| format!("Window {win}"));

        out.push(CaptureSource { id: format!("window:{win}"), name: title, kind: "window".into() });
    }
    out
}

/// Enumerate shareable sources (monitors + top-level windows) for the in-app
/// picker. Implemented natively on Linux (X11/RandR) and Windows (Win32) so the
/// exact same picker UI and capture path run on both.
#[tauri::command]
fn list_capture_sources() -> Vec<CaptureSource> {
    #[cfg(target_os = "linux")]
    {
        use x11rb::connection::Connection;
        let Ok((conn, screen_num)) = x11rb::connect(None) else { return Vec::new() };
        let Some(screen) = conn.setup().roots.get(screen_num) else { return Vec::new() };
        let root = screen.root;

        let mut sources: Vec<CaptureSource> = x11_monitors(&conn, root)
            .iter()
            .enumerate()
            .map(|(i, m)| CaptureSource {
                id: format!("screen:{i}"),
                name: if i == 0 {
                    format!("Whole screen ({}×{})", m.w, m.h)
                } else {
                    format!("Screen {} ({}×{})", i + 1, m.w, m.h)
                },
                kind: "screen".into(),
            })
            .collect();
        sources.extend(list_x11_windows(&conn, root));
        sources
    }
    #[cfg(target_os = "windows")]
    {
        win_list_capture_sources()
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        Vec::new()
    }
}

/// Windows source enumeration: monitors via EnumDisplayMonitors (index-ordered,
/// primary first to match `capture_raw_monitor`), then visible top-level windows
/// with a title that aren't cloaked (UWP ghosts / other virtual desktops).
#[cfg(target_os = "windows")]
fn win_list_capture_sources() -> Vec<CaptureSource> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
    };
    const MONITORINFOF_PRIMARY: u32 = 1;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
    };

    // ── monitors ──
    struct MList {
        primary: Vec<(RECT, ())>,
        others: Vec<RECT>,
    }
    unsafe extern "system" fn mon_cb(hm: HMONITOR, _: HDC, _: *mut RECT, param: LPARAM) -> BOOL {
        let list = &mut *(param.0 as *mut MList);
        let mut mi = MONITORINFO {
            cbSize: core::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(hm, &mut mi).as_bool() {
            if mi.dwFlags & MONITORINFOF_PRIMARY != 0 {
                list.primary.push((mi.rcMonitor, ()));
            } else {
                list.others.push(mi.rcMonitor);
            }
        }
        BOOL(1)
    }

    let mut mlist = MList { primary: Vec::new(), others: Vec::new() };
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(mon_cb), LPARAM(&mut mlist as *mut _ as isize));
    }
    let mut rects: Vec<RECT> = mlist.primary.into_iter().map(|(r, _)| r).collect();
    rects.extend(mlist.others);

    let mut sources: Vec<CaptureSource> = rects
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let (w, h) = ((r.right - r.left), (r.bottom - r.top));
            CaptureSource {
                id: format!("screen:{i}"),
                name: if i == 0 {
                    format!("Whole screen ({w}×{h})")
                } else {
                    format!("Screen {} ({w}×{h})", i + 1)
                },
                kind: "screen".into(),
            }
        })
        .collect();

    // ── windows ──
    unsafe extern "system" fn win_cb(hwnd: windows::Win32::Foundation::HWND, param: LPARAM) -> BOOL {
        let out = &mut *(param.0 as *mut Vec<CaptureSource>);
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }
        // Skip cloaked windows (other virtual desktops, suspended UWP shells).
        let mut cloaked: u32 = 0;
        let _ = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut _ as *mut _,
            core::mem::size_of::<u32>() as u32,
        );
        if cloaked != 0 {
            return BOOL(1);
        }
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return BOOL(1);
        }
        let mut buf = vec![0u16; len as usize + 1];
        let n = GetWindowTextW(hwnd, &mut buf);
        if n <= 0 {
            return BOOL(1);
        }
        let title = String::from_utf16_lossy(&buf[..n as usize]);
        let hwnd_val = hwnd.0 as isize;
        out.push(CaptureSource { id: format!("window:{hwnd_val}"), name: title, kind: "window".into() });
        BOOL(1)
    }

    let mut windows_out: Vec<CaptureSource> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(win_cb), LPARAM(&mut windows_out as *mut _ as isize));
    }
    sources.extend(windows_out);
    sources
}

/// Hint for which monitor audio source is the desktop-audio loopback of the
/// *currently active* output, so the frontend can pick the right one (a machine
/// can expose many monitor sources — HDMI ports, speakers, Bluetooth — most of
/// them silent). Returns the PulseAudio/PipeWire Description of the default sink's
/// `.monitor` source, which matches the device label WebKitGTK reports. `None` if
/// pactl is unavailable or the default sink can't be resolved (frontend then falls
/// back to a generic "first monitor" heuristic).
#[tauri::command]
fn default_audio_monitor_hint() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let sink = Command::new("pactl").arg("get-default-sink").output().ok()?;
        let sink = String::from_utf8_lossy(&sink.stdout).trim().to_string();
        if sink.is_empty() {
            return None;
        }
        let monitor_name = format!("{sink}.monitor");
        let out = Command::new("pactl").args(["list", "sources"]).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        let mut in_target = false;
        for line in text.lines() {
            let l = line.trim();
            if let Some(name) = l.strip_prefix("Name: ") {
                in_target = name == monitor_name;
            } else if in_target {
                if let Some(desc) = l.strip_prefix("Description: ") {
                    return Some(desc.to_string());
                }
            }
        }
        None
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

/// Opens a WASAPI loopback capture on the default output device and hands every
/// chunk to `on_pcm` as (sample rate, mono i16-LE). Returns the rate plus a
/// sender whose drop stops the capture.
///
/// Loopback is cpal's documented behaviour for an *input* stream built on an
/// *output* device: it sets AUDCLNT_STREAMFLAGS_LOOPBACK, which records what the
/// endpoint is playing. The callback is a parameter so this can be exercised in a
/// test without the rtc runtime.
#[cfg(target_os = "windows")]
fn start_windows_loopback(
    on_pcm: impl Fn(u32, Vec<u8>) + Send + Sync + 'static,
) -> Result<(u32, std::sync::mpsc::Sender<()>), String> {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let host = cpal::default_host();
    let device = host
        .default_output_device()
        .ok_or("no default audio output to capture")?;
    // The endpoint's own mix format: shared mode rejects anything else, so the
    // rate travels with the frames rather than being forced to 48k.
    let default_cfg = device
        .default_output_config()
        .map_err(|e| format!("output config unavailable: {e}"))?;
    let rate = default_cfg.sample_rate().0;
    let channels = default_cfg.channels() as usize;
    let sample_format = default_cfg.sample_format();
    let config: cpal::StreamConfig = default_cfg.into();

    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();

    // cpal's Stream is !Send, so one thread builds, plays and drops it; the
    // thread parks on `rx` and unwinds when the sender is dropped.
    std::thread::spawn(move || {
        let on_pcm = std::sync::Arc::new(on_pcm);
        let on_err = |e| eprintln!("[desktop-audio] stream error: {e}");
        let build = || -> Result<cpal::Stream, cpal::BuildStreamError> {
            // Every format downmixed to the mono i16-LE the mixer expects.
            macro_rules! stream {
                ($t:ty, $to_i16:expr) => {{
                    let cb = on_pcm.clone();
                    device.build_input_stream(
                        &config,
                        move |data: &[$t], _: &_| {
                            let conv: fn($t) -> i32 = $to_i16;
                            let mut mono = Vec::with_capacity(data.len() / channels * 2);
                            for frame in data.chunks(channels) {
                                let sum: i32 = frame.iter().map(|s| conv(*s)).sum();
                                let avg = (sum / channels as i32).clamp(i16::MIN as i32, i16::MAX as i32);
                                mono.extend_from_slice(&(avg as i16).to_le_bytes());
                            }
                            cb(rate, mono);
                        },
                        on_err,
                        None,
                    )
                }};
            }
            match sample_format {
                cpal::SampleFormat::F32 => {
                    Ok(stream!(f32, |s| (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i32)?)
                }
                cpal::SampleFormat::I16 => Ok(stream!(i16, |s| s as i32)?),
                cpal::SampleFormat::U16 => Ok(stream!(u16, |s| s as i32 - 32768)?),
                other => {
                    eprintln!("[desktop-audio] unsupported sample format {other:?}");
                    Err(cpal::BuildStreamError::StreamConfigNotSupported)
                }
            }
        };

        let stream = match build() {
            Ok(s) => s,
            Err(e) => {
                let _ = ready_tx.send(Err(format!("loopback capture failed: {e}")));
                return;
            }
        };
        if let Err(e) = stream.play() {
            let _ = ready_tx.send(Err(format!("loopback stream would not start: {e}")));
            return;
        }
        let _ = ready_tx.send(Ok(()));
        let _ = rx.recv();
        drop(stream);
    });

    ready_rx
        .recv()
        .map_err(|_| "loopback capture thread died".to_string())??;
    Ok((rate, tx))
}

/// Start native desktop-audio capture and fan it out to peers as tag 2.
///
/// Linux records the default sink's `.monitor` source via `parec`
/// (PulseAudio/PipeWire CLI), bypassing WebKitGTK's getUserMedia, which doesn't
/// expose monitor sources and crashes when asked for one.
///
/// Windows records per process (see `process_audio`): a window share hears only
/// that window's app, a monitor share hears everything except blok itself. Where
/// process loopback is missing (before build 20348) it falls back to a WASAPI
/// loopback stream on the default render endpoint — cpal turns an input stream on
/// an output device into loopback — which records the whole system.
///
/// `source_id` is the shared capture source; Linux ignores it (the whole sink).
/// `capture_id` is what a later `desktop_audio_stop` names to stop this capture.
///
/// Returns the capture sample rate.
#[tauri::command]
fn desktop_audio_start(
    state: tauri::State<DesktopAudioState>,
    on_chunk: Channel<InvokeResponseBody>,
    source_id: Option<String>,
    capture_id: Option<u64>,
) -> Result<u32, String> {
    let capture_id = capture_id.unwrap_or(0);
    // Held for the whole start, so a stop can't slip in between the previous
    // capture ending and this one being recorded.
    let mut slot = state.0.lock().unwrap();
    if let Some((_, old)) = slot.take() {
        old.stop();
    }

    #[cfg(target_os = "linux")]
    {
        use std::io::Read;
        let _ = source_id;

        let sink = std::process::Command::new("pactl")
            .arg("get-default-sink")
            .output()
            .map_err(|e| format!("pactl not available: {e}"))?;
        let sink = String::from_utf8_lossy(&sink.stdout).trim().to_string();
        if sink.is_empty() {
            return Err("no default audio output (pactl get-default-sink returned nothing)".into());
        }
        let device = format!("{sink}.monitor");

        let mut child = std::process::Command::new("parec")
            .args([
                "--device", &device,
                "--format=s16le",
                "--rate=48000",
                "--channels=2",
                "--latency-msec=20",
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("parec failed to start: {e}"))?;
        let mut stdout = child.stdout.take().ok_or("parec has no stdout")?;
        *slot = Some((capture_id, DesktopAudioCapture::Parec(child)));

        // on_chunk is unused now that desktop audio rides the native transport
        // (it fans out to peers in Rust, not through the webview).
        let _ = on_chunk;
        std::thread::spawn(move || {
            // 20ms of s16le stereo @48kHz = 48000 * 0.02 * 2ch * 2B = 3840 bytes.
            let mut buf = vec![0u8; 3840];
            loop {
                let mut filled = 0;
                while filled < buf.len() {
                    match stdout.read(&mut buf[filled..]) {
                        Ok(0) => return, // parec exited (killed by desktop_audio_stop)
                        Ok(n) => filled += n,
                        Err(_) => return,
                    }
                }
                // Downmix stereo → mono i16-LE (the mixer, like the mic path, is
                // mono), then fan out to remote peers as desktop-audio (tag 2).
                let mut mono = Vec::with_capacity(buf.len() / 2);
                for st in buf.chunks_exact(4) {
                    let l = i16::from_le_bytes([st[0], st[1]]) as i32;
                    let r = i16::from_le_bytes([st[2], st[3]]) as i32;
                    mono.extend_from_slice(&(((l + r) / 2) as i16).to_le_bytes());
                }
                rtc::broadcast_desktop_audio(48000, mono);
            }
        });
        Ok(48000)
    }
    #[cfg(target_os = "windows")]
    {
        // on_chunk is unused: desktop audio rides the native transport, fanning
        // out to peers in Rust rather than through the webview.
        let _ = on_chunk;
        // Level log every 5s. Desktop audio is deliberately not played back
        // locally (the sharer already hears it), so without this there is no way
        // to tell "capture is silent" from "capture never started" short of
        // asking a viewer.
        let stats = std::sync::Arc::new(std::sync::Mutex::new((0u64, 0i32, std::time::Instant::now())));
        let on_pcm = move |rate: u32, pcm: Vec<u8>| {
            {
                let mut s = stats.lock().unwrap();
                s.0 += (pcm.len() / 2) as u64;
                for b in pcm.chunks_exact(2) {
                    s.1 = s.1.max(i16::from_le_bytes([b[0], b[1]]).unsigned_abs() as i32);
                }
                if s.2.elapsed() >= std::time::Duration::from_secs(5) {
                    eprintln!("[desktop-audio] {} samples/s @ {rate}Hz, peak {}", s.0 / 5, s.1);
                    *s = (0, 0, std::time::Instant::now());
                }
            }
            rtc::broadcast_desktop_audio(rate, pcm);
        };
        let target = process_audio::target_for_source(source_id.as_deref().unwrap_or(""));
        let (rate, tx) = match process_audio::start(target, on_pcm.clone()) {
            Ok(tx) => {
                eprintln!("[desktop-audio] process loopback {target:?}");
                (process_audio::RATE, tx)
            }
            Err(e) => {
                eprintln!("[desktop-audio] {e}; recording all system audio instead");
                start_windows_loopback(on_pcm)?
            }
        };
        *slot = Some((capture_id, DesktopAudioCapture::Loopback(tx)));
        Ok(rate)
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = (slot, on_chunk, source_id, capture_id);
        Err("desktop audio capture is not supported on this platform".into())
    }
}

/// Stops the desktop-audio capture started with `capture_id`, or whatever is
/// running when it's omitted. A late stop for an earlier capture is a no-op.
#[tauri::command]
fn desktop_audio_stop(state: tauri::State<DesktopAudioState>, capture_id: Option<u64>) {
    let mut slot = state.0.lock().unwrap();
    if slot.as_ref().is_some_and(|(id, _)| capture_id.is_none_or(|c| c == *id)) {
        if let Some((_, capture)) = slot.take() {
            capture.stop();
        }
    }
}

// ── native P2P transport commands (see rtc.rs for the architecture) ───────────

/// Open the multiplexed rtc event channel and (re)start the transport runtime.
/// Must be called before any other rtc_* command.
#[tauri::command]
fn rtc_start(state: tauri::State<RtcState>, on_event: Channel<InvokeResponseBody>) {
    let handle = rtc::start(on_event);
    *state.0.lock().unwrap() = Some(handle);
}

#[tauri::command]
fn rtc_set_ice_servers(state: tauri::State<RtcState>, json: String) -> Result<(), String> {
    let handle = state.0.lock().unwrap().clone();
    handle.ok_or("rtc not started")?.set_ice_servers_json(&json)
}

#[tauri::command]
fn rtc_create_peer(state: tauri::State<RtcState>, peer_id: String, initiator: bool) -> Result<(), String> {
    let handle = state.0.lock().unwrap().clone();
    handle.ok_or("rtc not started")?.create_peer(peer_id, initiator);
    Ok(())
}

#[tauri::command]
fn rtc_signal_remote(
    state: tauri::State<RtcState>,
    peer_id: String,
    kind: String,
    payload: String,
) -> Result<(), String> {
    let handle = state.0.lock().unwrap().clone();
    handle.ok_or("rtc not started")?.signal_remote(peer_id, kind, payload);
    Ok(())
}

#[tauri::command]
fn rtc_close_peer(state: tauri::State<RtcState>, peer_id: String) {
    if let Some(h) = state.0.lock().unwrap().clone() {
        h.close_peer(peer_id);
    }
}

#[tauri::command]
fn rtc_close_all(state: tauri::State<RtcState>) {
    if let Some(h) = state.0.lock().unwrap().clone() {
        h.close_all();
    }
}

#[tauri::command]
fn rtc_set_user_volume(state: tauri::State<RtcState>, peer_id: String, volume: f32) {
    if let Some(h) = state.0.lock().unwrap().clone() {
        h.set_user_volume(peer_id, volume);
    }
}

/// Broadcast one JPEG video frame to all peers (camera path; screen share fans
/// out inside Rust directly). Body = raw JPEG; headers: x-tag ("screen"|"camera"),
/// x-w, x-h.
#[tauri::command]
fn rtc_broadcast_video(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(jpeg) = request.body() else {
        return Err("expected raw JPEG body".into());
    };
    let header = |name: &str| -> Option<&str> {
        request.headers().get(name).and_then(|v| v.to_str().ok())
    };
    let tag = match header("x-tag") {
        Some("screen") => 1u8,
        Some("camera") => 2u8,
        _ => return Err("bad x-tag".into()),
    };
    let w: u32 = header("x-w").and_then(|v| v.parse().ok()).ok_or("bad x-w")?;
    let h: u32 = header("x-h").and_then(|v| v.parse().ok()).ok_or("bad x-h")?;
    rtc::broadcast_video_frame(tag, w, h, jpeg.clone(), false);
    Ok(())
}

/// Record whether a peer can decode H.264, from its join/hello announcement.
/// Peers that never announce (older clients) stay on JPEG.
#[tauri::command]
fn rtc_set_peer_caps(peer_id: String, h264: bool) {
    rtc::set_peer_caps(&peer_id, h264);
}

/// Our H.264 decoder for `peer_id`'s share lost the stream: ask them for a keyframe.
#[tauri::command]
fn rtc_request_keyframe(peer_id: String) {
    rtc::request_keyframe(peer_id);
}

/// Probe TURN reachability natively (replaces the browser testTurnConnectivity
/// internals — WebKitGTK has no RTCPeerConnection). Returns a summary the JS
/// wrapper reshapes for the settings UI.
#[tauri::command]
async fn rtc_test_turn(ice_servers_json: String) -> Result<rtc::TurnProbe, String> {
    rtc::test_turn(ice_servers_json).await
}

/// Number of parallel JPEG encoders behind the capture thread. A 1080p frame
/// costs ~35ms to encode even on the AVX2 path, so a single encoder caps the
/// share at ~28fps no matter how fast capture is; frames are independent JPEGs,
/// so they parallelise perfectly. Half the cores (2-4) leaves room for the app,
/// the WebRTC stack and whatever the user is actually sharing.
fn encode_worker_count() -> usize {
    (std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4) / 2).clamp(2, 4)
}

/// Rolling 5-second window of screen-share throughput, shared by the capture
/// thread and the encoder pool.
struct CastStats {
    window: std::time::Instant,
    /// JPEG frames sent to peers.
    sent: u32,
    capture_ms: f64,
    captured: u32,
    encode_ms: f64,
    encoded: u32,
    /// JPEG encode time over the current second, for the adapter.
    second_encode_ms: f64,
    second_encoded: u32,
    /// The running H.264 encoder, if any, and what it produced this window.
    h264: Option<String>,
    h264_frames: u32,
    h264_bytes: u64,
    h264_encode_ms: f64,
}

impl CastStats {
    fn new() -> Self {
        CastStats {
            window: std::time::Instant::now(),
            sent: 0,
            capture_ms: 0.0,
            captured: 0,
            encode_ms: 0.0,
            encoded: 0,
            second_encode_ms: 0.0,
            second_encoded: 0,
            h264: None,
            h264_frames: 0,
            h264_bytes: 0,
            h264_encode_ms: 0.0,
        }
    }

    fn record_jpeg_encode(&mut self, ms: f64) {
        self.encoded += 1;
        self.encode_ms += ms;
        self.second_encoded += 1;
        self.second_encode_ms += ms;
    }

    /// Mean JPEG encode time since the last call.
    fn recent_encode_ms(&mut self) -> f64 {
        let avg = self.second_encode_ms / self.second_encoded.max(1) as f64;
        (self.second_encode_ms, self.second_encoded) = (0.0, 0);
        avg
    }

    fn record_h264(&mut self, s: &h264::EncoderStats) {
        self.h264_frames += s.encoded;
        self.h264_bytes += s.bytes;
        self.h264_encode_ms += s.avg_encode_ms * s.encoded as f64;
    }

    /// Prints and resets once per 5s window. Stage averages are per *frame*, so a
    /// low fps with small stage numbers means an idle screen, while a stage above
    /// the frame budget is the thing capping the rate.
    fn tick(&mut self) {
        let secs = self.window.elapsed().as_secs_f64();
        if secs < 5.0 {
            return;
        }
        let capture = self.capture_ms / self.captured.max(1) as f64;
        if let Some(h264) = &self.h264 {
            eprintln!(
                "[screencast] h264 {h264}: {:.0} fps, {:.0} kbit, encode {:.1}ms; jpeg {:.0} fps; capture {capture:.1}ms",
                self.h264_frames as f64 / secs,
                self.h264_bytes as f64 * 8.0 / secs / 1000.0,
                self.h264_encode_ms / self.h264_frames.max(1) as f64,
                self.sent as f64 / secs,
            );
        } else {
            eprintln!(
                "[screencast] jpeg {:.0} fps sent (capture {capture:.1}ms, encode {:.1}ms x{} workers)",
                self.sent as f64 / secs,
                self.encode_ms / self.encoded.max(1) as f64,
                encode_worker_count(),
            );
        }
        let h264 = self.h264.take();
        *self = CastStats::new();
        self.h264 = h264;
    }
}

/// Minimum spacing of frames sent to the sharer's own preview (~15fps).
const PREVIEW_INTERVAL: std::time::Duration = std::time::Duration::from_millis(66);

/// One captured frame on its way to the JPEG pool. `seq` orders the output: an
/// encoder that finishes after a newer frame has already shipped drops its
/// result rather than sending the screen backwards.
struct EncodeJob {
    seq: u64,
    bgra: Vec<u8>,
    w: u32,
    h: u32,
    max_width: u32,
    /// Send to peers on JPEG (otherwise the frame is only for the preview).
    to_peers: bool,
    /// Skip peers taking H.264 — they already get this frame that way.
    jpeg_peers_only: bool,
    /// Also deliver to the sharer's own preview.
    preview: bool,
}

/// Frame source for the push loop. On Windows each kind of source has an API that
/// actually works for it: Desktop Duplication for monitors, Windows.Graphics.
/// Capture for a single window. The generic grab-per-frame path covers Linux and
/// anything neither of those can open.
enum Capturer {
    #[cfg(target_os = "windows")]
    Dxgi(Box<dxgi_capture::Duplicator>),
    #[cfg(target_os = "windows")]
    Wgc(Box<wgc_capture::WindowCapture>),
    Generic,
}

impl Capturer {
    /// Picks the best available source. Both Windows paths fall through to the
    /// generic one if they can't initialise (pre-1903 for WGC, RDP or an odd
    /// driver for duplication).
    fn for_source(source_id: &str) -> Self {
        #[cfg(target_os = "windows")]
        {
            if let Some(rest) = source_id.strip_prefix("screen:") {
                if let Some(idx) = rest.split(':').next().and_then(|v| v.parse::<u32>().ok()) {
                    if let Some(rect) = dxgi_capture::monitor_rect(idx) {
                        if let Some(d) = dxgi_capture::Duplicator::new(rect) {
                            return Capturer::Dxgi(Box::new(d));
                        }
                    }
                }
            }
            // GDI cannot capture a composited window at all — it returns a black,
            // never-changing surface for anything GPU-drawn — so falling through to
            // the generic path here is a broken share, not a slower one. It stays
            // only as the last resort for a Windows old enough to lack WGC.
            if let Some(rest) = source_id.strip_prefix("window:") {
                if wgc_capture::is_supported() {
                    if let Some(hwnd) = rest.split(':').next().and_then(|v| v.parse::<isize>().ok()) {
                        if let Some(c) = wgc_capture::WindowCapture::new(hwnd) {
                            return Capturer::Wgc(Box::new(c));
                        }
                    }
                }
            }
        }
        let _ = source_id;
        Capturer::Generic
    }

    fn kind(&self) -> &'static str {
        match self {
            #[cfg(target_os = "windows")]
            Capturer::Dxgi(_) => "desktop duplication",
            #[cfg(target_os = "windows")]
            Capturer::Wgc(_) => "graphics capture",
            Capturer::Generic => "generic grab",
        }
    }

    /// Blocks up to `budget` for a changed frame. `None` means nothing new — the
    /// caller just loops (DXGI reports this exactly; the generic path leans on
    /// the frame hash instead).
    fn grab(&mut self, source_id: &str, budget: std::time::Duration) -> Option<Grabbed> {
        match self {
            #[cfg(target_os = "windows")]
            Capturer::Dxgi(dupl) => {
                // Capped well below a slow frame budget so a stop (or a settings
                // change, which starts a new generation) takes effect promptly
                // instead of waiting out a 1fps budget. Missing a change during the
                // cap costs nothing: the next acquire returns the current desktop.
                let ms = budget.as_millis().min(100) as u32;
                let (bgra, w, h) = match dupl.grab(ms) {
                    dxgi_capture::Grab::Frame(px, w, h) => (px.to_vec(), w, h),
                    dxgi_capture::Grab::Unchanged => return None,
                    dxgi_capture::Grab::Lost => {
                        // Resolution change, UAC/secure desktop, driver reset: the
                        // duplication object is dead but the device is fine. Retry
                        // next tick; a persistent failure just yields no frames,
                        // which is how a failed capture already behaves.
                        dupl.reacquire();
                        return None;
                    }
                };
                // `last_work` excludes the wait for the desktop to change, which is
                // idleness rather than cost; the copy-out above is ours to add.
                let work = dupl.last_work.as_secs_f64() * 1000.0;
                Some(Grabbed { bgra, w, h, work_ms: work })
            }
            #[cfg(target_os = "windows")]
            Capturer::Wgc(cap) => {
                // Same cap as the duplication path, and for the same reason: a stop
                // must not have to wait out a slow frame budget.
                let ms = budget.as_millis().min(100) as u32;
                let (bgra, w, h) = {
                    let (px, w, h) = cap.grab(ms)?;
                    (px.to_vec(), w, h)
                };
                let work = cap.last_work.as_secs_f64() * 1000.0;
                Some(Grabbed { bgra, w, h, work_ms: work })
            }
            Capturer::Generic => {
                let started = std::time::Instant::now();
                let raw = capture_raw_frame(source_id)?;
                // This path never waits — every millisecond of it is work.
                let work_ms = started.elapsed().as_secs_f64() * 1000.0;
                Some(Grabbed { bgra: raw.bgra, w: raw.w, h: raw.h, work_ms })
            }
        }
    }
}

/// A captured frame plus what the capture stage actually cost, so the throughput
/// log can tell a slow capture apart from an idle screen.
struct Grabbed {
    bgra: Vec<u8>,
    w: u32,
    h: u32,
    work_ms: f64,
}

/// Push-based native screen capture: a capture thread grabs frames at the
/// requested rate and ships them to viewers in the best form each can take —
/// H.264 (see `h264`) for peers that decode it, JPEG through a pool of encoder
/// threads for the rest — while `adapt::ShareAdapter` keeps frame rate,
/// resolution and bitrate within what this machine and its link can carry.
///
/// The sharer's own preview arrives on `on_frame` as an 8-byte header (u32-LE
/// width, u32-LE height) + JPEG, at a preview rate. An unchanged frame (hash
/// dedup, or DXGI's own no-change signal) sends nothing. The loop exits when a
/// newer start bumps the generation counter, `screen_capture_stop` is called,
/// or the channel dies (webview reloaded).
///
/// `jpeg_quality` also picks the H.264 bitrate tier (see `quality_factor`).
/// Returns this capture's generation, for `screen_capture_stop` to name.
#[tauri::command]
fn screen_capture_start(
    source_id: String,
    max_width: u32,
    jpeg_quality: u8,
    fps: u32,
    state: tauri::State<ScreenCastState>,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<u64, String> {
    use std::sync::atomic::Ordering;
    use std::sync::{Arc, Condvar};
    use std::time::{Duration, Instant};

    let generation = state.0.clone();
    let my_gen = generation.fetch_add(1, Ordering::SeqCst) + 1;
    let fps = fps.clamp(1, 60);

    // Single-slot mailbox between capture and the JPEG pool. Keeping only the
    // newest frame is deliberate: when every encoder is busy, a live screen share
    // wants the freshest frame, not a backlog of stale ones.
    let mailbox: Arc<(Mutex<Option<EncodeJob>>, Condvar)> =
        Arc::new((Mutex::new(None), Condvar::new()));
    // Serialises output and enforces frame order across the pool: an encoder that
    // finishes out of order sees a newer seq already shipped and drops its frame.
    let sent_seq = Arc::new(Mutex::new(0u64));
    let stats = Arc::new(Mutex::new(CastStats::new()));
    let preview_delivered = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let cast_started = Instant::now();

    for _ in 0..encode_worker_count() {
        let (generation, mailbox, sent_seq, stats) =
            (generation.clone(), mailbox.clone(), sent_seq.clone(), stats.clone());
        let preview_delivered = preview_delivered.clone();
        let on_frame = on_frame.clone();
        std::thread::spawn(move || {
            while generation.load(Ordering::SeqCst) == my_gen {
                let job = {
                    let (lock, cv) = &*mailbox;
                    let mut slot = lock.lock().unwrap();
                    loop {
                        if generation.load(Ordering::SeqCst) != my_gen {
                            return;
                        }
                        if let Some(job) = slot.take() {
                            break job;
                        }
                        // Timed wait so a generation bump still ends the thread.
                        slot = cv.wait_timeout(slot, Duration::from_millis(200)).unwrap().0;
                    }
                };
                let encode_started = Instant::now();
                let encoded = encode_bgra_to_jpeg(job.bgra, job.w, job.h, job.max_width, jpeg_quality);
                let encode_ms = encode_started.elapsed().as_secs_f64() * 1000.0;
                // Counted whether or not the frame ships: it's the cost of an
                // encode, and a stale-drop still consumed a worker for it.
                stats.lock().unwrap().record_jpeg_encode(encode_ms);
                let Some((jpeg, w, h)) = encoded else { continue };

                let mut last = sent_seq.lock().unwrap();
                if *last >= job.seq {
                    continue; // a newer frame already went out
                }
                // An encode that outlived its generation would ship after the new
                // capture's first frames — a flash of the old size or source.
                if generation.load(Ordering::SeqCst) != my_gen {
                    return;
                }
                *last = job.seq;
                if job.preview {
                    let mut msg = Vec::with_capacity(8 + jpeg.len());
                    msg.extend_from_slice(&w.to_le_bytes());
                    msg.extend_from_slice(&h.to_le_bytes());
                    msg.extend_from_slice(&jpeg);
                    if on_frame.send(InvokeResponseBody::Raw(msg)).is_err() {
                        // Frontend went away — end this generation for every thread.
                        let _ = generation.compare_exchange(my_gen, my_gen + 1, Ordering::SeqCst, Ordering::SeqCst);
                        return;
                    }
                    if !preview_delivered.swap(true, Ordering::Relaxed) {
                        eprintln!("[screencast] gen {my_gen}: first preview {w}x{h} delivered after {:?}", cast_started.elapsed());
                    }
                }
                if job.to_peers {
                    rtc::broadcast_video_frame(1, w, h, jpeg, job.jpeg_peers_only);
                    stats.lock().unwrap().sent += 1;
                }
            }
        });
    }

    std::thread::spawn(move || {
        let mut capturer = Capturer::for_source(&source_id);
        eprintln!(
            "[screencast] gen {my_gen}: {source_id} via {} at {fps}fps, max width {max_width}",
            capturer.kind()
        );
        let started = Instant::now();
        let quality = quality_factor(jpeg_quality);
        let mut adapter = adapt::ShareAdapter::new(fps, max_width);
        let mut pacer = FramePacer::new(Duration::from_secs_f64(1.0 / fps as f64), started);
        let mut h264 = H264Share::new(my_gen);
        let mut last_hash: Option<u64> = None;
        let mut seq = 0u64;
        let mut last_preview: Option<Instant> = None;
        let mut native_width = 0u32;
        let mut next_tick = started + Duration::from_secs(1);
        let (mut jpeg_offered, mut jpeg_dropped) = (0u32, 0u32);
        // A share that never produces a frame fails in JS after 3s with no clue
        // why; these say how far the pipeline got.
        let mut keyframe_pending = false;
        let mut last_keyframe: Option<Instant> = None;
        let mut first_frame_logged = false;
        let mut first_preview_logged = false;
        let mut last_frame_at = started;

        while generation.load(Ordering::SeqCst) == my_gen {
            std::thread::sleep(pacer.wait(Instant::now()));
            let budget = Duration::from_secs_f64(1.0 / adapter.fps() as f64);
            let grabbed = capturer.grab(&source_id, budget);
            if grabbed.is_none() && last_frame_at.elapsed() >= Duration::from_secs(10) {
                // Sources only deliver on change, so this is normal for a static
                // window; a share that never started is caught by the first-frame log.
                eprintln!("[screencast] gen {my_gen}: no new frames from {source_id} for 10s (static content, or minimized)");
                last_frame_at = Instant::now();
            }
            if let Some(frame) = grabbed {
                let now = Instant::now();
                last_frame_at = now;
                if !first_frame_logged {
                    first_frame_logged = true;
                    eprintln!(
                        "[screencast] gen {my_gen}: first frame {}x{} ({} bytes) after {:?}",
                        frame.w, frame.h, frame.bgra.len(), now.duration_since(started)
                    );
                }
                pacer.frame_taken(now);
                {
                    let mut s = stats.lock().unwrap();
                    s.captured += 1;
                    s.capture_ms += frame.work_ms;
                }
                let hash = frame_hash(&frame.bgra);
                if last_hash != Some(hash) {
                    last_hash = Some(hash);
                    seq += 1;
                    native_width = frame.w;

                    let (h264_peers, jpeg_peers) = rtc::video_audience();
                    let h264_live = h264_peers > 0 && h264.ensure_ready(now);
                    if h264_peers == 0 {
                        h264.idle(now);
                    }
                    let preview = last_preview.is_none_or(|t| now.duration_since(t) >= PREVIEW_INTERVAL);

                    let Grabbed { bgra, w, h, .. } = frame;
                    // H.264 first: whether it actually took the frame decides if
                    // the peers waiting for it need JPEG instead.
                    let (bgra, h264_sent) = if h264_live {
                        let spare = bgra.clone();
                        let sent = h264.encode(bgra, w, h, adapter.max_width(), adapter.fps(), quality * adapter.bitrate_factor(), now, started);
                        (spare, sent)
                    } else {
                        (bgra, false)
                    };
                    let jpeg_to_peers = jpeg_peers > 0 || (h264_peers > 0 && !h264_sent && !h264.is_open());
                    if !first_preview_logged {
                        first_preview_logged = true;
                        eprintln!(
                            "[screencast] gen {my_gen}: first frame routed after {:?} (h264 peers {h264_peers}, jpeg peers {jpeg_peers}, h264 took it {h264_sent}, preview {preview})",
                            now.duration_since(started)
                        );
                    }
                    if jpeg_to_peers || preview {
                        if preview {
                            last_preview = Some(now);
                        }
                        let (lock, cv) = &*mailbox;
                        let mut slot = lock.lock().unwrap();
                        if jpeg_to_peers {
                            jpeg_offered += 1;
                            if slot.as_ref().is_some_and(|j| j.to_peers) {
                                jpeg_dropped += 1; // the pool never got to the last one
                            }
                        }
                        *slot = Some(EncodeJob {
                            seq,
                            bgra,
                            w,
                            h,
                            max_width: if jpeg_to_peers { adapter.max_width() } else { PREVIEW_MAX_WIDTH },
                            to_peers: jpeg_to_peers,
                            jpeg_peers_only: h264.is_open(),
                            preview,
                        });
                        cv.notify_one();
                    }
                }
            }

            // At most one keyframe a second: a keyframe is several frames' worth
            // of data, and on a struggling link every dropped frame asking for
            // one fed the congestion that dropped it. Requests in between are
            // honoured when the interval ends, so a new viewer still gets one.
            keyframe_pending |= rtc::take_keyframe_request();
            if keyframe_pending && last_keyframe.is_none_or(|t| t.elapsed() >= KEYFRAME_MIN_INTERVAL) {
                keyframe_pending = false;
                last_keyframe = Some(Instant::now());
                h264.request_keyframe();
            }

            let now = Instant::now();
            if now >= next_tick {
                next_tick = now + Duration::from_secs(1);
                let congestion = rtc::take_congestion();
                let h264_stats = h264.take_stats();
                if let Some(s) = &h264_stats {
                    stats.lock().unwrap().record_h264(s);
                }
                let measurements = match h264_stats {
                    Some(s) => adapt::Measurements {
                        offered: s.encoded + s.busy_drops,
                        dropped: s.busy_drops,
                        avg_encode_ms: s.avg_encode_ms,
                        congestion,
                    },
                    None => {
                        // The JPEG pool encodes in parallel, so what limits it is
                        // per-worker time: compare the budget against that.
                        let avg = stats.lock().unwrap().recent_encode_ms() / encode_worker_count() as f64;
                        let m = adapt::Measurements { offered: jpeg_offered, dropped: jpeg_dropped, avg_encode_ms: avg, congestion };
                        (jpeg_offered, jpeg_dropped) = (0, 0);
                        m
                    }
                };
                if let Some(change) = adapter.tick(measurements, native_width) {
                    eprintln!(
                        "[screencast] gen {my_gen}: adapt ({:?}) -> {}fps, max width {}, bitrate x{:.2} ({measurements:?})",
                        change.reason,
                        change.fps,
                        if change.max_width == 0 { "native".to_string() } else { change.max_width.to_string() },
                        change.bitrate_factor,
                    );
                    if change.fps != pacer.fps() {
                        pacer = FramePacer::new(Duration::from_secs_f64(1.0 / change.fps as f64), now);
                    }
                    h264.set_quality(change.fps, quality * change.bitrate_factor);
                }
                let mut s = stats.lock().unwrap();
                s.h264 = h264.describe();
                s.tick();
            }
        }
        drop(h264);
        eprintln!("[screencast] gen {my_gen}: stopped");
    });
    Ok(my_gen)
}

/// H.264 bitrate tier for the share's quality setting, from the JPEG quality
/// the settings already map it to (high 85, medium 65, low 40).
fn quality_factor(jpeg_quality: u8) -> f64 {
    match jpeg_quality {
        80.. => 1.0,
        55..=79 => 0.6,
        _ => 0.35,
    }
}

/// Width of the JPEG preview frames for the sharer's own tile while viewers are
/// on H.264: the tile is small, and a full-size JPEG cost ~30ms.
const PREVIEW_MAX_WIDTH: u32 = 960;
/// How long a resized source must hold still before the encoder is reopened at
/// the new size; until then frames are scaled to the running encoder's size, so
/// dragging a window edge doesn't reopen the encoder on every frame.
const RESIZE_SETTLE: std::time::Duration = std::time::Duration::from_millis(400);
/// An encoder no one has watched for this long is closed (reopened on demand).
const H264_IDLE_CLOSE: std::time::Duration = std::time::Duration::from_secs(10);
/// Minimum spacing of keyframes forced on viewers' request.
const KEYFRAME_MIN_INTERVAL: std::time::Duration = std::time::Duration::from_secs(1);
/// After failing to open any encoder, when to try again.
const H264_RETRY: std::time::Duration = std::time::Duration::from_secs(30);

/// An encoder being opened on its own thread, for `size`.
type OpeningEncoder = ((u32, u32), std::sync::mpsc::Receiver<Result<h264::H264Encoder, String>>);

/// The H.264 side of one capture generation: owns the encoder, reopens it when
/// the size changes (debounced), and reports when none can be opened so the
/// caller serves JPEG instead.
///
/// Opening happens off the capture thread: a hardware encoder takes ~0.4s to
/// open (longer right after another session closed), and while the capture
/// thread waited the share delivered no frame at all — past 3s the frontend
/// gave up with "produced no frames". Frames meanwhile go out as JPEG.
struct H264Share {
    generation: u64,
    encoder: Option<h264::H264Encoder>,
    opening: Option<OpeningEncoder>,
    failed_at: Option<std::time::Instant>,
    idle_since: Option<std::time::Instant>,
    /// A size the source moved to, and since when, while the encoder runs the old one.
    pending_size: Option<((u32, u32), std::time::Instant)>,
    fps: u32,
    quality: f64,
}

impl H264Share {
    fn new(generation: u64) -> Self {
        H264Share { generation, encoder: None, opening: None, failed_at: None, idle_since: None, pending_size: None, fps: 30, quality: 1.0 }
    }

    /// Installs an encoder that finished opening, if one did.
    fn poll_opening(&mut self) {
        let Some((size, rx)) = &self.opening else { return };
        let result = match rx.try_recv() {
            Ok(result) => result,
            Err(std::sync::mpsc::TryRecvError::Empty) => return,
            Err(std::sync::mpsc::TryRecvError::Disconnected) => Err("encoder open thread died".into()),
        };
        let (w, h) = *size;
        self.opening = None;
        match result {
            Ok(enc) => {
                eprintln!(
                    "[screencast] gen {}: h264 via {} at {w}x{h}, {}fps, {} kbit",
                    self.generation, enc.name, self.fps, enc.bitrate() / 1000
                );
                enc.set_bitrate(h264::bitrate_for(w, h, self.fps, self.quality));
                enc.request_keyframe();
                self.encoder = Some(enc);
                self.failed_at = None;
            }
            Err(e) => {
                eprintln!("[screencast] gen {}: h264 unavailable ({e}); viewers get JPEG", self.generation);
                self.failed_at = Some(std::time::Instant::now());
            }
        }
    }

    fn is_open(&self) -> bool {
        self.encoder.as_ref().is_some_and(|e| e.is_alive())
    }

    /// Whether to try H.264 for this frame: an encoder is open, or opening one
    /// hasn't failed recently.
    fn ensure_ready(&mut self, now: std::time::Instant) -> bool {
        self.idle_since = None;
        self.poll_opening();
        if self.encoder.as_ref().is_some_and(|e| !e.is_alive()) {
            eprintln!("[screencast] gen {}: encoder died; reopening", self.generation);
            self.encoder = None;
        }
        self.encoder.is_some() || self.failed_at.is_none_or(|t| now.duration_since(t) >= H264_RETRY)
    }

    fn idle(&mut self, now: std::time::Instant) {
        let since = *self.idle_since.get_or_insert(now);
        if (self.encoder.is_some() || self.opening.is_some()) && now.duration_since(since) >= H264_IDLE_CLOSE {
            eprintln!("[screencast] gen {}: no H.264 viewers, closing the encoder", self.generation);
            self.encoder = None;
            self.opening = None;
        }
    }

    /// Starts opening an encoder for `w`x`h` in the background. The running
    /// encoder, if any, keeps serving until the new one is ready.
    fn open(&mut self, w: u32, h: u32) {
        if self.opening.as_ref().is_some_and(|(size, _)| *size == (w, h)) {
            return;
        }
        let (fps, bitrate) = (self.fps, h264::bitrate_for(w, h, self.fps, self.quality));
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let result = h264::H264Encoder::open(w, h, fps, bitrate, move |f| {
                rtc::broadcast_h264_frame(f.key, w, h, f.timestamp_us, f.data);
            });
            let _ = tx.send(result); // a dropped receiver just closes the encoder
        });
        self.opening = Some(((w, h), rx));
    }

    /// Scales `bgra` to the share's width cap and offers it to the encoder,
    /// opening or reopening the encoder as the size requires. Returns whether a
    /// running encoder took the frame's size (a busy encoder still counts: it
    /// drops the frame by design).
    #[allow(clippy::too_many_arguments)]
    fn encode(
        &mut self,
        bgra: Vec<u8>,
        w: u32,
        h: u32,
        max_width: u32,
        fps: u32,
        quality: f64,
        now: std::time::Instant,
        started: std::time::Instant,
    ) -> bool {
        self.fps = fps;
        self.quality = quality;
        self.poll_opening();
        let pixels = (w as usize) * (h as usize);
        if pixels == 0 || bgra.len() < pixels * 3 {
            return false;
        }
        let bpp = bgra.len() / pixels;
        let (sw, sh) = if max_width > 0 && w > max_width {
            (max_width, ((h as u64 * max_width as u64 / w as u64) as u32).max(2))
        } else {
            (w, h)
        };
        let target = h264::even_size(sw, sh);
        if target.0 < 2 || target.1 < 2 {
            return false;
        }

        let running = self.encoder.as_ref().map(|e| (e.width, e.height));
        let size = match running {
            Some(size) if size == target => {
                self.pending_size = None;
                size
            }
            Some(size) => match self.pending_size {
                Some((s, since)) if s == target && now.duration_since(since) >= RESIZE_SETTLE => {
                    self.pending_size = None;
                    self.open(target.0, target.1);
                    target
                }
                Some((s, _)) if s == target => size,
                _ => {
                    self.pending_size = Some((target, now));
                    size
                }
            },
            None => {
                self.open(target.0, target.1);
                target
            }
        };
        let Some(enc) = &self.encoder else { return false };
        if (enc.width, enc.height) != size {
            return false;
        }
        let frame = if (w, h) == size && bpp == 4 {
            bgra
        } else {
            downscale_nearest(&bgra, w, h, bpp, size.0, size.1, 4)
        };
        enc.encode(h264::RawFrame {
            bgra: frame,
            width: size.0,
            height: size.1,
            timestamp_us: now.duration_since(started).as_micros() as u64,
        });
        true
    }

    fn request_keyframe(&self) {
        if let Some(enc) = &self.encoder {
            enc.request_keyframe();
        }
    }

    /// Applies a new frame rate / bitrate tier to the running encoder.
    fn set_quality(&mut self, fps: u32, quality: f64) {
        self.fps = fps;
        self.quality = quality;
        if let Some(enc) = &self.encoder {
            enc.set_bitrate(h264::bitrate_for(enc.width, enc.height, fps, quality));
        }
    }

    fn take_stats(&self) -> Option<h264::EncoderStats> {
        let enc = self.encoder.as_ref().filter(|e| e.is_alive())?;
        Some(enc.take_stats())
    }

    fn describe(&self) -> Option<String> {
        self.encoder.as_ref().map(|e| format!("{} {}x{} @ {} kbit", e.name, e.width, e.height, e.bitrate() / 1000))
    }
}

/// Paces the capture loop to the requested rate on a fixed schedule.
///
/// The old loop slept out a whole frame budget after every grab, so each
/// iteration ran slightly longer than one frame. Against a source at the same
/// rate the phase slipped until a frame was skipped: a 60fps share of a 60Hz
/// screen came out at ~56. Here the schedule advances by exactly one budget per
/// frame, and a grab may start a little early so a frame landing just ahead of
/// its slot still counts for it.
struct FramePacer {
    budget: std::time::Duration,
    next_due: std::time::Instant,
}

impl FramePacer {
    const SLACK: std::time::Duration = std::time::Duration::from_millis(2);

    fn new(budget: std::time::Duration, now: std::time::Instant) -> Self {
        FramePacer { budget, next_due: now }
    }

    fn fps(&self) -> u32 {
        (1.0 / self.budget.as_secs_f64()).round() as u32
    }

    /// How long to hold off before the next grab. Sources that wait for a new
    /// frame themselves (DXGI, WGC) accumulate changes meanwhile, so holding off
    /// loses nothing.
    fn wait(&self, now: std::time::Instant) -> std::time::Duration {
        self.next_due.saturating_duration_since(now + Self::SLACK)
    }

    /// Schedules the slot after a frame taken at `now`. After an idle screen or a
    /// stall the schedule restarts from `now` rather than bursting to catch up.
    fn frame_taken(&mut self, now: std::time::Instant) {
        self.next_due = (self.next_due + self.budget).max(now + self.budget - Self::SLACK);
    }
}

/// Stops the capture of `generation`, or whatever is running when it's omitted.
/// Bumping the generation makes the loop exit on its next iteration.
///
/// Scoped because IPC calls can be handled out of order: switching the share's
/// audio sends a stop and then a start, and a stop handled second used to kill
/// the capture that had just started — the sharer's share died after 3s without
/// frames and viewers were left on a frozen frame.
#[tauri::command]
fn screen_capture_stop(state: tauri::State<ScreenCastState>, generation: Option<u64>) {
    stop_generation(&state.0, generation);
}

fn stop_generation(counter: &std::sync::atomic::AtomicU64, generation: Option<u64>) {
    use std::sync::atomic::Ordering;
    match generation {
        Some(g) => {
            let _ = counter.compare_exchange(g, g + 1, Ordering::SeqCst, Ordering::SeqCst);
        }
        None => {
            counter.fetch_add(1, Ordering::SeqCst);
        }
    }
}

#[tauri::command]
fn capture_screen_frame(
    source_id: String,
    max_width: u32,
    jpeg_quality: u8,
    force: bool,
    state: tauri::State<ScreenCaptureState>,
) -> Option<ScreenFrame> {
    let raw = capture_raw_frame(&source_id)?;
    let hash = frame_hash(&raw.bgra);
    let mut hashes = state.last_hashes.lock().unwrap();
    // `force` bypasses the unchanged-frame check: last_hashes lives for the whole
    // app process, so without it, re-sharing an unchanged screen right after
    // stopping a previous share would wrongly look like a capture failure on the
    // very first frame of the new session.
    let unchanged = !force && hashes.get(&source_id).copied() == Some(hash);
    hashes.insert(source_id, hash);
    drop(hashes);
    if unchanged {
        return None;
    }
    encode_bgra_to_frame(raw.bgra, raw.w, raw.h, max_width, jpeg_quality)
}

/// Monitor rects, primary first — the ordering the picker's `screen:<i>` ids and
/// `capture_raw_monitor(i)` must agree on.
#[cfg(target_os = "windows")]
fn win_monitor_rects() -> Vec<windows::Win32::Foundation::RECT> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
    };
    const MONITORINFOF_PRIMARY: u32 = 1;
    struct Acc { primary: Vec<RECT>, others: Vec<RECT> }
    unsafe extern "system" fn cb(hm: HMONITOR, _: HDC, _: *mut RECT, param: LPARAM) -> BOOL {
        let acc = &mut *(param.0 as *mut Acc);
        let mut mi = MONITORINFO { cbSize: core::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        if GetMonitorInfoW(hm, &mut mi).as_bool() {
            if mi.dwFlags & MONITORINFOF_PRIMARY != 0 { acc.primary.push(mi.rcMonitor); }
            else { acc.others.push(mi.rcMonitor); }
        }
        BOOL(1)
    }
    let mut acc = Acc { primary: Vec::new(), others: Vec::new() };
    unsafe { let _ = EnumDisplayMonitors(None, None, Some(cb), LPARAM(&mut acc as *mut _ as isize)); }
    let mut out = acc.primary;
    out.extend(acc.others);
    out
}

/// Draw the current mouse cursor onto a memory DC at (cursor - origin), so the
/// captured frame includes it (GDI BitBlt never captures the cursor). Matches
/// the XFixes cursor overlay on Linux.
#[cfg(target_os = "windows")]
unsafe fn win_draw_cursor(mdc: windows::Win32::Graphics::Gdi::HDC, origin_x: i32, origin_y: i32) {
    use windows::Win32::UI::WindowsAndMessaging::{
        DrawIconEx, GetCursorInfo, GetIconInfo, CURSORINFO, CURSOR_SHOWING, DI_NORMAL, HICON, ICONINFO,
    };
    let mut ci = CURSORINFO { cbSize: core::mem::size_of::<CURSORINFO>() as u32, ..Default::default() };
    if GetCursorInfo(&mut ci).is_err() || ci.flags.0 & CURSOR_SHOWING.0 == 0 {
        return;
    }
    // HCURSOR and HICON are the same underlying handle; the windows crate types
    // them separately, so convert explicitly for GetIconInfo/DrawIconEx.
    let hicon = HICON(ci.hCursor.0);
    // Subtract the cursor hotspot so the pointer tip lands correctly.
    let mut ii = ICONINFO::default();
    let (mut hx, mut hy) = (0i32, 0i32);
    if GetIconInfo(hicon, &mut ii).is_ok() {
        hx = ii.xHotspot as i32;
        hy = ii.yHotspot as i32;
        use windows::Win32::Graphics::Gdi::DeleteObject;
        use windows::Win32::Graphics::Gdi::HGDIOBJ;
        if !ii.hbmColor.is_invalid() { let _ = DeleteObject(HGDIOBJ(ii.hbmColor.0)); }
        if !ii.hbmMask.is_invalid() { let _ = DeleteObject(HGDIOBJ(ii.hbmMask.0)); }
    }
    let x = ci.ptScreenPos.x - origin_x - hx;
    let y = ci.ptScreenPos.y - origin_y - hy;
    let _ = DrawIconEx(mdc, x, y, hicon, 0, 0, 0, None, DI_NORMAL);
}

/// Shared GDI blit → BGRA readback, with the cursor drawn in. `src` is the DC to
/// copy from, `(sx, sy)` the top-left within it, `origin` the source rect's
/// screen coordinates (for placing the cursor).
#[cfg(target_os = "windows")]
unsafe fn win_grab_bgra(
    src: windows::Win32::Graphics::Gdi::HDC,
    sx: i32,
    sy: i32,
    w: u32,
    h: u32,
    origin: (i32, i32),
) -> Option<RawFrame> {
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
        SelectObject, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, HGDIOBJ, SRCCOPY,
    };
    if w == 0 || h == 0 { return None; }
    let mdc = CreateCompatibleDC(Some(src));
    let bmp = CreateCompatibleBitmap(src, w as i32, h as i32);
    let old = SelectObject(mdc, HGDIOBJ(bmp.0));
    let _ = BitBlt(mdc, 0, 0, w as i32, h as i32, Some(src), sx, sy, SRCCOPY);
    win_draw_cursor(mdc, origin.0, origin.1);

    let mut bmi = core::mem::zeroed::<BITMAPINFO>();
    bmi.bmiHeader.biSize = core::mem::size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = w as i32;
    bmi.bmiHeader.biHeight = -(h as i32);
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = 0u32; // BI_RGB

    let mut px = vec![0u8; (w * h * 4) as usize];
    GetDIBits(mdc, bmp, 0, h, Some(px.as_mut_ptr().cast()), &mut bmi, DIB_RGB_COLORS);

    let _ = SelectObject(mdc, old);
    let _ = DeleteObject(HGDIOBJ(bmp.0));
    let _ = DeleteDC(mdc);
    Some(RawFrame { bgra: px, w, h })
}

#[cfg(target_os = "windows")]
fn capture_raw_monitor(index: u32) -> Option<RawFrame> {
    use windows::Win32::Graphics::Gdi::{GetDC, ReleaseDC};
    let rects = win_monitor_rects();
    let r = rects.get(index as usize)?;
    let (w, h) = ((r.right - r.left) as u32, (r.bottom - r.top) as u32);
    unsafe {
        let sdc = GetDC(None);
        let frame = win_grab_bgra(sdc, r.left, r.top, w, h, (r.left, r.top));
        let _ = ReleaseDC(None, sdc);
        frame
    }
}

#[cfg(target_os = "windows")]
fn capture_raw_window(hwnd_val: isize) -> Option<RawFrame> {
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::{ClientToScreen, GetDC, ReleaseDC};
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

    unsafe {
        let hwnd = HWND(hwnd_val as *mut _);
        let mut rect = RECT::default();
        let _ = GetClientRect(hwnd, &mut rect);
        let (w, h) = ((rect.right - rect.left) as u32, (rect.bottom - rect.top) as u32);
        // Client origin in screen coords, so the cursor overlay lands correctly.
        let mut origin = POINT { x: 0, y: 0 };
        let _ = ClientToScreen(hwnd, &mut origin);
        let wdc = GetDC(Some(hwnd));
        let frame = win_grab_bgra(wdc, 0, 0, w, h, (origin.x, origin.y));
        let _ = ReleaseDC(Some(hwnd), wdc);
        frame
    }
}

// Direct X11 capture (no xdg-desktop-portal involved) — the fallback path used
// when the browser's own getDisplayMedia() has no ScreenCast portal to call
// (e.g. Cinnamon/MATE/XFCE on X11, which ship no portal backend implementing
// org.freedesktop.portal.ScreenCast at all).

/// One monitor as reported by RandR: its pixel rect on the root window.
#[cfg(target_os = "linux")]
struct X11Monitor { x: i16, y: i16, w: u16, h: u16 }

/// Monitors ordered primary-first, so `screen:0` is always the primary display —
/// both `list_capture_sources` and `capture_raw_monitor` share this ordering so a
/// picked index means the same thing on both sides.
#[cfg(target_os = "linux")]
fn x11_monitors(
    conn: &x11rb::rust_connection::RustConnection,
    root: x11rb::protocol::xproto::Window,
) -> Vec<X11Monitor> {
    use x11rb::protocol::randr::ConnectionExt as _;
    let Ok(cookie) = conn.randr_get_monitors(root, true) else { return Vec::new() };
    let Ok(reply) = cookie.reply() else { return Vec::new() };
    let mut mons: Vec<(bool, X11Monitor)> = reply
        .monitors
        .iter()
        .map(|m| (m.primary, X11Monitor { x: m.x, y: m.y, w: m.width, h: m.height }))
        .collect();
    mons.sort_by(|a, b| b.0.cmp(&a.0)); // primary (true) first
    mons.into_iter().map(|(_, m)| m).collect()
}

#[cfg(target_os = "linux")]
thread_local! {
    // Reused across frames. Opening a fresh X11 connection per frame (socket +
    // auth + setup handshake) was the dominant per-frame cost and cratered the
    // capture frame rate — cache it per worker thread instead.
    static X11_CONN: std::cell::RefCell<Option<(x11rb::rust_connection::RustConnection, usize)>>
        = const { std::cell::RefCell::new(None) };
}

/// Run `f` with a cached X11 connection, (re)connecting on first use or if the
/// previous connection has died (a `None` from `f` is treated as a possible dead
/// connection and retried once on a fresh one).
#[cfg(target_os = "linux")]
fn with_x11<T>(
    f: impl Fn(&x11rb::rust_connection::RustConnection, usize) -> Option<T>,
) -> Option<T> {
    fn connect() -> Option<(x11rb::rust_connection::RustConnection, usize)> {
        use x11rb::protocol::xfixes::ConnectionExt as _;
        let (conn, screen_num) = x11rb::connect(None).ok()?;
        // XFixes requires a version handshake once per connection before use
        // (needed for cursor capture); ignore failure — we just skip the cursor then.
        let _ = conn.xfixes_query_version(5, 0).ok().and_then(|c| c.reply().ok());
        Some((conn, screen_num))
    }
    X11_CONN.with(|cell| {
        if cell.borrow().is_none() {
            *cell.borrow_mut() = connect();
        }
        if let Some((conn, screen_num)) = cell.borrow().as_ref() {
            if let Some(v) = f(conn, *screen_num) {
                return Some(v);
            }
        }
        // Retry once on a fresh connection — the cached one may have dropped.
        *cell.borrow_mut() = connect();
        let slot = cell.borrow();
        let (conn, screen_num) = slot.as_ref()?;
        f(conn, *screen_num)
    })
}

/// Alpha-blend the current mouse cursor into a captured frame (X11's GetImage
/// never includes it). `region_x/y` is the captured area's origin in root-window
/// coordinates. Only handles 4-byte-per-pixel buffers (the normal case); silently
/// skips otherwise — a missing cursor beats a corrupted frame.
#[cfg(target_os = "linux")]
fn overlay_cursor(
    conn: &x11rb::rust_connection::RustConnection,
    frame: &mut RawFrame,
    region_x: i32,
    region_y: i32,
) {
    use x11rb::protocol::xfixes::ConnectionExt as _;

    let Ok(cookie) = conn.xfixes_get_cursor_image() else { return };
    let Ok(cur) = cookie.reply() else { return };
    let (fw, fh) = (frame.w as i32, frame.h as i32);
    if frame.bgra.len() != (fw as usize) * (fh as usize) * 4 {
        return;
    }
    // cur.x/y = hotspot position on the root window; top-left of the cursor sprite.
    let ox = cur.x as i32 - cur.xhot as i32 - region_x;
    let oy = cur.y as i32 - cur.yhot as i32 - region_y;
    let cw = cur.width as i32;
    for row in 0..cur.height as i32 {
        let fy = oy + row;
        if fy < 0 || fy >= fh {
            continue;
        }
        for col in 0..cw {
            let fx = ox + col;
            if fx < 0 || fx >= fw {
                continue;
            }
            let Some(&p) = cur.cursor_image.get((row * cw + col) as usize) else { continue };
            let a = p >> 24;
            if a == 0 {
                continue;
            }
            // Cursor pixels are premultiplied ARGB; frame is BGRX.
            let (r, g, b) = ((p >> 16) & 0xff, (p >> 8) & 0xff, p & 0xff);
            let d = ((fy * fw + fx) * 4) as usize;
            let inv = 255 - a;
            frame.bgra[d] = (b + frame.bgra[d] as u32 * inv / 255).min(255) as u8;
            frame.bgra[d + 1] = (g + frame.bgra[d + 1] as u32 * inv / 255).min(255) as u8;
            frame.bgra[d + 2] = (r + frame.bgra[d + 2] as u32 * inv / 255).min(255) as u8;
        }
    }
}

#[cfg(target_os = "linux")]
fn capture_raw_monitor(index: u32) -> Option<RawFrame> {
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{ConnectionExt as _, ImageFormat};

    with_x11(|conn, screen_num| {
        let root = conn.setup().roots.get(screen_num)?.root;
        let mons = x11_monitors(conn, root);
        let mon = mons.get(index as usize)?;
        if mon.w == 0 || mon.h == 0 {
            return None;
        }
        let reply = conn
            .get_image(ImageFormat::Z_PIXMAP, root, mon.x, mon.y, mon.w, mon.h, !0)
            .ok()?
            .reply()
            .ok()?;
        if reply.depth != 24 && reply.depth != 32 {
            return None;
        }
        let mut frame = RawFrame { bgra: reply.data, w: mon.w as u32, h: mon.h as u32 };
        overlay_cursor(conn, &mut frame, mon.x as i32, mon.y as i32);
        Some(frame)
    })
}

#[cfg(target_os = "linux")]
fn capture_raw_window(xid: isize) -> Option<RawFrame> {
    use x11rb::protocol::xproto::{ConnectionExt as _, ImageFormat, Window};

    let win = xid as u32 as Window;
    with_x11(move |conn, screen_num| {
        use x11rb::connection::Connection;
        let geom = conn.get_geometry(win).ok()?.reply().ok()?;
        if geom.width == 0 || geom.height == 0 {
            return None;
        }
        // Capture from the window drawable itself (0,0 is its top-left). On a composited
        // X11 desktop (Cinnamon has a compositor) the server can satisfy this even when
        // the window is partially occluded.
        let reply = conn
            .get_image(ImageFormat::Z_PIXMAP, win, 0, 0, geom.width, geom.height, !0)
            .ok()?
            .reply()
            .ok()?;
        if reply.depth != 24 && reply.depth != 32 {
            return None;
        }
        let mut frame = RawFrame { bgra: reply.data, w: geom.width as u32, h: geom.height as u32 };
        // Cursor position is in root coordinates — find the window's origin on root
        // so the cursor lands at the right spot inside the captured window.
        if let Some(root) = conn.setup().roots.get(screen_num).map(|s| s.root) {
            if let Ok(tc) = conn.translate_coordinates(win, root, 0, 0) {
                if let Ok(tc) = tc.reply() {
                    overlay_cursor(conn, &mut frame, tc.dst_x as i32, tc.dst_y as i32);
                }
            }
        }
        Some(frame)
    })
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn capture_raw_monitor(_: u32) -> Option<RawFrame> { None }
#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn capture_raw_window(_: isize) -> Option<RawFrame> { None }

// ── app entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Single-instance by default (a second launch just focuses the running window).
    // Opt-in multi-instance for local two-account testing: launch a second copy
    // with BLOK_MULTI=1 to skip the lock and use a separate WebView2 data folder
    // (its own login session). End users never set it → they stay single-instance.
    let multi = std::env::var_os("BLOK_MULTI").is_some();
    if multi {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let mut dir = std::path::PathBuf::from(local);
            dir.push("blok-multi");
            std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir);
        }
    }

    let mut builder = tauri::Builder::default();
    if !multi {
        // The app's `identifier` ("2303") is numeric-only, which is not a valid D-Bus
        // well-known name (each dot-separated segment must start with a letter) — the
        // Linux backend of this plugin uses it verbatim and panics without an override.
        builder = builder.plugin(
            tauri_plugin_single_instance::Builder::new()
                .callback(|app, _args, _cwd| {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                })
                .dbus_id("com.blok.app")
                .build(),
        );
    }

    builder
        .manage(AudioState(Mutex::new(None)))
        .manage(ScreenCaptureState { last_hashes: Mutex::new(HashMap::new()) })
        .manage(DesktopAudioState(Mutex::new(None)))
        .manage(ScreenCastState(std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0))))
        .manage(RtcState(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            if let Some(window) = app.get_webview_window("main") {
                allow_linux_media_permissions(&window);
            }

            let show_item = MenuItem::with_id(app, "show", "Show $blok", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("$blok")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        // Give JS 1 s to set presence "offline" before the process dies.
                        let _ = app.emit("app:quitting", ());
                        let handle = app.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(1000));
                            handle.exit(0);
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|icon, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = icon.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            disable_audio_ducking,
            audio_start,
            audio_stop,
            audio_set_muted,
            audio_set_deafened,
            audio_set_noise_suppression,
            audio_set_echo_cancellation,
            audio_receive,
            audio_remove_peer,
            audio_list_input_devices,
            audio_list_output_devices,
            capture_screen_frame,
            list_capture_sources,
            default_audio_monitor_hint,
            desktop_audio_start,
            desktop_audio_stop,
            rtc_start,
            rtc_set_ice_servers,
            rtc_create_peer,
            rtc_signal_remote,
            rtc_close_peer,
            rtc_close_all,
            rtc_set_user_volume,
            rtc_set_peer_caps,
            rtc_request_keyframe,
            rtc_broadcast_video,
            rtc_test_turn,
            screen_capture_start,
            screen_capture_stop,
            autostart_is_enabled,
            autostart_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    // TEMP: run with `cargo test bench_encode -- --nocapture --ignored` to time the
    // JPEG encode path with the current profile (checks whether opt-level is applied).
    #[test]
    #[ignore]
    fn bench_encode() {
        let (w, h) = (1920u32, 1080u32);
        // Noisy data so JPEG has realistic entropy (solid colour encodes unrealistically fast).
        let mut bgra = vec![0u8; (w * h * 4) as usize];
        for (i, b) in bgra.iter_mut().enumerate() {
            *b = ((i * 2654435761) >> 13) as u8;
        }
        let _ = encode_bgra_to_frame(bgra.clone(), w, h, 1280, 65); // warmup
        let n = 30;
        let t = std::time::Instant::now();
        for _ in 0..n {
            let _ = encode_bgra_to_frame(bgra.clone(), w, h, 1280, 65);
        }
        eprintln!("[bench] encode total = {}ms/frame over {n} iters", t.elapsed().as_millis() / n as u128);
    }

    /// Reference path: convert to RGB by hand, downscale nearest, encode as RGB —
    /// what the encoder did before it took BGR(A) directly.
    fn jpeg_via_rgb(src: &[u8], w: u32, h: u32, bpp: usize, tw: u32, th: u32, q: u8) -> Vec<u8> {
        let mut rgb = Vec::with_capacity((tw * th * 3) as usize);
        for ty in 0..th as usize {
            for tx in 0..tw as usize {
                let s = ((ty * h as usize / th as usize) * w as usize + tx * w as usize / tw as usize) * bpp;
                rgb.extend_from_slice(&[src[s + 2], src[s + 1], src[s]]);
            }
        }
        let mut out = Vec::new();
        jpeg_encoder::Encoder::new(&mut out, q)
            .encode(&rgb, tw as u16, th as u16, jpeg_encoder::ColorType::Rgb)
            .unwrap();
        out
    }

    fn gradient(w: u32, h: u32, bpp: usize) -> Vec<u8> {
        let mut v = Vec::with_capacity((w * h) as usize * bpp);
        for y in 0..h {
            for x in 0..w {
                v.extend_from_slice(&[(x * 7) as u8, (y * 5) as u8, ((x + y) * 3) as u8, 255][..bpp]);
            }
        }
        v
    }

    /// Encoding BGR(A) directly must give exactly the JPEG the RGB conversion did —
    /// same colours (no swapped red/blue), same size, with and without downscale.
    #[test]
    fn direct_bgr_encode_matches_the_rgb_conversion() {
        for bpp in [4usize, 3] {
            let (w, h) = (160u32, 90u32);
            let src = gradient(w, h, bpp);
            for (max_width, tw, th) in [(0u32, 160u32, 90u32), (160, 160, 90), (80, 80, 45)] {
                let (jpeg, ow, oh) = encode_bgra_to_jpeg(src.clone(), w, h, max_width, 80).unwrap();
                assert_eq!((ow, oh), (tw, th), "bpp {bpp}, max width {max_width}");
                assert!(
                    jpeg == jpeg_via_rgb(&src, w, h, bpp, tw, th, 80),
                    "bpp {bpp}, max width {max_width}: output differs from the RGB path"
                );
            }
        }
    }

    // ── encode_bgra_to_frame ──────────────────────────────────────────────────

    #[test]
    fn encode_bgra_frame_1x1_produces_non_empty_jpeg() {
        // Single BGRA pixel: B=0, G=128, R=255, A=255
        let bgra = vec![0u8, 128, 255, 255];
        let result = encode_bgra_to_frame(bgra, 1, 1, 0, 80);
        assert!(result.is_some());
        let frame = result.unwrap();
        assert_eq!(frame.w, 1);
        assert_eq!(frame.h, 1);
        assert!(!frame.data.is_empty(), "base64 data must not be empty");
    }

    #[test]
    fn encode_bgra_frame_returns_none_when_data_too_short() {
        // 2x2 requires 16 bytes; 4 bytes is too short → from_raw returns None
        let bgra = vec![0u8; 4];
        assert!(encode_bgra_to_frame(bgra, 2, 2, 0, 80).is_none());
    }

    #[test]
    fn encode_bgra_frame_scales_down_when_max_width_exceeded() {
        // 4x4 BGRA (64 bytes), max_width=2 → output must be 2x2
        let bgra = vec![128u8; 4 * 4 * 4];
        let frame = encode_bgra_to_frame(bgra, 4, 4, 2, 80).expect("should produce a frame");
        assert_eq!(frame.w, 2);
        assert_eq!(frame.h, 2);
    }

    #[test]
    fn encode_bgra_frame_no_scale_when_width_not_exceeded() {
        let bgra = vec![64u8; 4 * 4 * 4];
        let frame = encode_bgra_to_frame(bgra, 4, 4, 0, 80).expect("should produce a frame");
        assert_eq!(frame.w, 4);
        assert_eq!(frame.h, 4);
    }

    #[test]
    fn encode_bgra_frame_does_not_panic_on_extreme_quality_values() {
        let bgra = vec![200u8; 2 * 2 * 4];
        // quality 0 is clamped to 1 by the encoder
        assert!(encode_bgra_to_frame(bgra.clone(), 2, 2, 0, 0).is_some());
        // quality 255 is clamped to 100 by the encoder
        assert!(encode_bgra_to_frame(bgra, 2, 2, 0, 255).is_some());
    }

    // ── capture_raw_frame — routing logic (no OS required) ───────────────────

    #[test]
    fn capture_raw_frame_returns_none_for_unknown_prefix() {
        assert!(capture_raw_frame("unknown:1:0").is_none());
    }

    #[test]
    fn capture_raw_frame_returns_none_for_non_numeric_screen_index() {
        assert!(capture_raw_frame("screen:abc:0").is_none());
    }

    #[test]
    fn capture_raw_frame_returns_none_for_non_numeric_window_hwnd() {
        assert!(capture_raw_frame("window:xyz:0").is_none());
    }

    // ── frame_hash ────────────────────────────────────────────────────────────

    #[test]
    fn frame_hash_is_deterministic() {
        let data: Vec<u8> = (0u8..=255).cycle().take(1024).collect();
        assert_eq!(frame_hash(&data), frame_hash(&data));
    }

    #[test]
    fn frame_hash_differs_for_different_data() {
        let a = vec![0u8; 256];
        let mut b = vec![0u8; 256];
        b[64] = 1; // flip one sampled byte
        assert_ne!(frame_hash(&a), frame_hash(&b));
    }

    #[test]
    fn frame_hash_handles_empty_input() {
        // should not panic
        let _ = frame_hash(&[]);
    }

    // ── encode_bgra_to_frame — correctness ───────────────────────────────────

    /// Synthetic BGRA image: pseudo-random pixel values, varied enough to stress JPEG encoder.
    fn make_bgra(w: u32, h: u32) -> Vec<u8> {
        (0..(w * h * 4) as usize)
            .map(|i| ((i.wrapping_mul(131).wrapping_add(i >> 2)) % 256) as u8)
            .collect()
    }

    #[test]
    fn encode_bgra_frame_channel_swap_distinguishes_colors() {
        // Pure blue pixel in BGRA = [B=255, G=0, R=0, A=0]
        // Pure red pixel in BGRA  = [B=0,   G=0, R=255, A=0]
        // After BGRA→RGB swap they differ; JPEG output must differ.
        let bgra_blue = vec![255u8, 0, 0, 0];
        let bgra_red = vec![0u8, 0, 255, 0];
        let frame_blue = encode_bgra_to_frame(bgra_blue, 1, 1, 0, 95).expect("blue encode");
        let frame_red = encode_bgra_to_frame(bgra_red, 1, 1, 0, 95).expect("red encode");
        assert_ne!(
            frame_blue.data, frame_red.data,
            "pure-blue and pure-red BGRA pixels must produce different JPEG data after channel swap"
        );
    }

    #[test]
    fn encode_bgra_frame_quality_affects_jpeg_size() {
        // Lower JPEG quality → smaller file.  Use a varied image so quantisation actually matters.
        let bgra = make_bgra(64, 64);
        let small = encode_bgra_to_frame(bgra.clone(), 64, 64, 0, 10).expect("quality-10 encode");
        let large = encode_bgra_to_frame(bgra, 64, 64, 0, 90).expect("quality-90 encode");
        assert!(
            large.data.len() > small.data.len(),
            "quality-90 JPEG should be larger than quality-10: q90={} q10={}",
            large.data.len(), small.data.len()
        );
    }

    #[test]
    fn encode_bgra_frame_output_is_valid_base64() {
        // The base64 string must decode back to a non-empty buffer that starts
        // with the JPEG magic bytes (FF D8 FF).
        let bgra = make_bgra(16, 16);
        let frame = encode_bgra_to_frame(bgra, 16, 16, 0, 80).expect("encode");
        use base64::Engine as _;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&frame.data)
            .expect("valid base64");
        assert!(bytes.starts_with(&[0xFF, 0xD8, 0xFF]), "decoded bytes must start with JPEG magic");
    }

    // ── encode_bgra_to_frame — screen-share performance ───────────────────────
    // These are regression guards, not micro-benchmarks.  Thresholds are
    // intentionally generous (debug-profile builds are ~5–10× slower than release).

    #[test]
    fn encode_bgra_frame_480p_single_encode_within_budget() {
        // 640×480 single frame must encode within 2 s even in debug builds
        let bgra = make_bgra(640, 480);
        let t = std::time::Instant::now();
        let result = encode_bgra_to_frame(bgra, 640, 480, 0, 75);
        let ms = t.elapsed().as_millis();
        assert!(result.is_some(), "480p encode must succeed");
        assert!(
            ms < 2_000,
            "480p encode took {ms}ms — catastrophic performance regression (budget: 2000ms)"
        );
    }

    #[test]
    fn encode_bgra_frame_720p_with_downscale_within_budget() {
        // 1280×720 downscaled to 640 px wide — typical low-bandwidth screen-share config
        let bgra = make_bgra(1280, 720);
        let t = std::time::Instant::now();
        let frame = encode_bgra_to_frame(bgra, 1280, 720, 640, 75).expect("720p encode");
        let ms = t.elapsed().as_millis();
        assert_eq!(frame.w, 640, "output width should match max_width=640");
        assert_eq!(frame.h, 360, "height must be halved proportionally");
        assert!(
            ms < 3_000,
            "720p→360p encode took {ms}ms — catastrophic regression (budget: 3000ms)"
        );
    }

    #[test]
    fn encode_bgra_frame_10fps_at_480p_within_budget() {
        // 10 consecutive 640×480 frames must finish within 10 s in debug mode
        // (real target: 33 ms/frame; 10s allows 100× headroom for debug+CI)
        let bgra = make_bgra(640, 480);
        let t = std::time::Instant::now();
        for _ in 0..10 {
            let r = encode_bgra_to_frame(bgra.clone(), 640, 480, 0, 75);
            assert!(r.is_some(), "each frame encode must succeed");
        }
        let ms = t.elapsed().as_millis();
        assert!(
            ms < 10_000,
            "10 frames at 480p took {ms}ms — regression (budget: 10000ms)"
        );
    }

    #[test]
    fn encode_bgra_frame_near_max_resolution_does_not_panic() {
        // 3840×2160 (4K) without downscale — must not panic or OOM even in tests.
        // We use a tiny uniform buffer to avoid allocation of 33 MB on CI;
        // encode_bgra_to_frame returns None for mismatched sizes, which is fine.
        // The goal is to verify no panic on large width/height metadata.
        let tiny_bgra = vec![128u8; 4]; // 1 pixel — mismatch with w×h → returns None
        let result = encode_bgra_to_frame(tiny_bgra, 3840, 2160, 0, 75);
        // Returns None because buffer is too small — must not panic
        assert!(result.is_none(), "undersized buffer for 4K should return None, not panic");
    }

    // ── autostart ────────────────────────────────────────────────────────────

    #[test]
    fn autostart_is_enabled_does_not_panic() {
        let _ = autostart_is_enabled_impl();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn autostart_round_trip_enable_then_disable() {
        // Writes to HKCU — cleans up after itself.
        autostart_set_impl(true).expect("should enable autostart");
        assert!(autostart_is_enabled_impl(), "should be enabled after set(true)");
        autostart_set_impl(false).expect("should disable autostart");
        assert!(!autostart_is_enabled_impl(), "should be disabled after set(false)");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn autostart_round_trip_enable_then_disable() {
        // Redirects XDG_CONFIG_HOME to a scratch dir so this doesn't touch the
        // real ~/.config/autostart — cleans up after itself.
        let tmp = std::env::temp_dir().join(format!("blok-autostart-test-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        std::env::set_var("XDG_CONFIG_HOME", &tmp);

        autostart_set_impl(true).expect("should enable autostart");
        assert!(autostart_is_enabled_impl(), "should be enabled after set(true)");
        autostart_set_impl(false).expect("should disable autostart");
        assert!(!autostart_is_enabled_impl(), "should be disabled after set(false)");

        std::env::remove_var("XDG_CONFIG_HOME");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ── push-capture pipeline ────────────────────────────────────────────────

    #[test]
    fn encode_worker_count_stays_within_pool_bounds() {
        // A single encoder caps a 1080p share at ~28fps; an unbounded pool would
        // starve the app it's sharing. Both ends of the clamp matter.
        let n = encode_worker_count();
        assert!((2..=4).contains(&n), "worker count {n} outside 2..=4");
    }

    #[test]
    fn capturer_falls_back_to_generic_for_non_monitor_sources() {
        // A source id that resolves to no real monitor or window has nothing for
        // either native path to open, so it must land on grab-per-frame rather
        // than fail. (A *valid* window id goes to WGC — see the test below.)
        assert!(matches!(Capturer::for_source("window:12345:0"), Capturer::Generic));
        assert!(matches!(Capturer::for_source("bogus:1"), Capturer::Generic));
        assert!(matches!(Capturer::for_source("screen:notanumber"), Capturer::Generic));
    }

    /// The regression this path exists for: GDI returns a black, byte-identical
    /// surface for any composited window, so a window share must not silently end
    /// up on it. Skips when no window is listed or WGC is unavailable, since
    /// neither is a defect.
    #[cfg(target_os = "windows")]
    #[test]
    fn window_source_uses_wgc_not_the_black_gdi_path() {
        if !wgc_capture::is_supported() {
            return;
        }
        let sources = list_capture_sources();
        let Some(win) = sources.iter().find(|s| s.kind == "window") else { return };
        assert!(
            matches!(Capturer::for_source(&win.id), Capturer::Wgc(_)),
            "window share fell back to the GDI path, which captures nothing"
        );
    }

    /// Exercises the unsafe WinRT plumbing end to end where a desktop exists.
    #[cfg(target_os = "windows")]
    #[test]
    fn wgc_frame_is_tightly_packed_bgra_or_declines() {
        if !wgc_capture::is_supported() {
            return;
        }
        let sources = list_capture_sources();
        let Some(win) = sources.iter().find(|s| s.kind == "window") else { return };
        let hwnd: isize = win.id.strip_prefix("window:").unwrap().split(':').next().unwrap().parse().unwrap();
        let Some(mut cap) = wgc_capture::WindowCapture::new(hwnd) else { return };
        // A still window may compose nothing inside one timeout; several tries.
        for _ in 0..10 {
            if let Some((px, w, h)) = cap.grab(200) {
                assert_eq!(px.len(), (w * h * 4) as usize, "frame is not tightly packed BGRA");
                assert!(w > 0 && h > 0);
                return;
            }
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn wgc_declines_an_invalid_window_handle() {
        // Must return None rather than panic — `for_source` relies on that to fall
        // back instead of taking down the capture thread.
        assert!(wgc_capture::WindowCapture::new(0).is_none());
        assert!(wgc_capture::WindowCapture::new(12345).is_none());
    }

    /// Runs the capture loop's pacing against a simulated vsync source: frames
    /// land every `period`, a grab takes the newest landed frame or waits for the
    /// next one, each frame then costs `work`, and every sleep overshoots by
    /// `overshoot` (the drift that cost the old loop a frame every ~17).
    fn simulated_fps(target_fps: f64, period_ms: f64, work_ms: f64, overshoot_ms: f64) -> f64 {
        use std::time::{Duration, Instant};
        let ms = |v: f64| Duration::from_secs_f64(v / 1000.0);
        let start = Instant::now();
        let at = |t: Instant| (t - start).as_secs_f64() * 1000.0;
        let mut pacer = FramePacer::new(Duration::from_secs_f64(1.0 / target_fps), start);
        let mut now = start;
        let mut last_taken: i64 = -1;
        let mut frames = 0;
        let seconds = 20.0;
        while at(now) < seconds * 1000.0 {
            let wait = pacer.wait(now);
            if !wait.is_zero() {
                now += wait + ms(overshoot_ms);
            }
            let landed = (at(now) / period_ms).floor() as i64;
            let taken = if landed > last_taken { landed } else { last_taken + 1 };
            now = now.max(start + ms(taken as f64 * period_ms));
            last_taken = taken;
            pacer.frame_taken(now);
            frames += 1;
            now += ms(work_ms);
        }
        frames as f64 / seconds
    }

    #[test]
    fn a_stale_screen_capture_stop_leaves_the_newer_capture_running() {
        use std::sync::atomic::{AtomicU64, Ordering};
        let counter = AtomicU64::new(0);
        let old = counter.fetch_add(1, Ordering::SeqCst) + 1;
        let new = counter.fetch_add(1, Ordering::SeqCst) + 1;

        stop_generation(&counter, Some(old)); // handled after the new start
        assert_eq!(counter.load(Ordering::SeqCst), new, "stale stop killed the new capture");

        stop_generation(&counter, Some(new));
        assert_ne!(counter.load(Ordering::SeqCst), new, "stop for the running capture did nothing");

        let before = counter.load(Ordering::SeqCst);
        stop_generation(&counter, None);
        assert_ne!(counter.load(Ordering::SeqCst), before, "unscoped stop did nothing");
    }

    #[test]
    fn pacer_holds_the_target_against_a_same_rate_source() {
        for (period, overshoot) in [(1000.0 / 60.0, 0.5), (1000.0 / 59.94, 0.5), (1000.0 / 60.0, 1.5)] {
            let fps = simulated_fps(60.0, period, 3.0, overshoot);
            assert!(fps > 59.5, "{fps:.2}fps for a {:.2}Hz source", 1000.0 / period);
        }
    }

    #[test]
    fn pacer_caps_a_faster_source_at_the_target() {
        for target in [15.0, 30.0, 60.0] {
            let fps = simulated_fps(target, 1000.0 / 144.0, 3.0, 0.5);
            assert!((fps - target).abs() < target * 0.02, "{fps:.2}fps for a {target}fps target on 144Hz");
        }
    }

    #[test]
    fn pacer_follows_a_slower_source_without_bursting() {
        let fps = simulated_fps(60.0, 1000.0 / 48.0, 3.0, 0.5);
        assert!((fps - 48.0).abs() < 0.5, "{fps:.2}fps for a 48Hz source");
    }

    /// End to end on a real window: the WGC source plus the pacer must deliver
    /// the requested rate. Skipped where the display can't produce 60 compositions
    /// a second (or WGC is missing) — that's the environment, not a defect.
    #[cfg(target_os = "windows")]
    #[test]
    fn window_capture_loop_reaches_60fps() {
        use std::time::{Duration, Instant};
        if !wgc_capture::is_supported() {
            return;
        }
        let win = wgc_capture::TestWindow::new();
        let source = format!("window:{}", win.hwnd());
        let run = |fps: f64, secs: f64| {
            let mut capturer = Capturer::for_source(&source);
            let budget = Duration::from_secs_f64(1.0 / fps);
            let mut pacer = FramePacer::new(budget, Instant::now());
            let end = Instant::now() + Duration::from_secs_f64(secs);
            let mut frames = 0;
            while Instant::now() < end {
                std::thread::sleep(pacer.wait(Instant::now()));
                if let Some(frame) = capturer.grab(&source, budget) {
                    pacer.frame_taken(Instant::now());
                    std::hint::black_box(frame_hash(&frame.bgra));
                    frames += 1;
                }
            }
            frames as f64 / secs
        };
        if run(1000.0, 1.0) < 70.0 {
            return;
        }
        let fps = run(60.0, 3.0);
        eprintln!("window share loop: {fps:.1}fps at a 60fps target");
        assert!(fps > 58.5, "window share ran at {fps:.1}fps for a 60fps target");
    }

    #[test]
    fn capturer_grab_on_missing_source_yields_nothing() {
        let mut cap = Capturer::for_source("screen:9999");
        assert!(cap.grab("screen:9999", std::time::Duration::from_millis(20)).is_none());
    }

    /// Exercises the real duplication path end to end where a desktop exists, and
    /// asserts a clean `None` where it doesn't (headless CI) rather than a panic —
    /// the module is full of `unsafe`, so "doesn't crash" is the load-bearing part.
    #[cfg(target_os = "windows")]
    #[test]
    fn dxgi_duplicator_either_captures_a_real_frame_or_declines() {
        let Some(rect) = dxgi_capture::monitor_rect(0) else { return };
        let Some(mut dupl) = dxgi_capture::Duplicator::new(rect) else { return };
        let (w, h) = ((rect.right - rect.left) as u32, (rect.bottom - rect.top) as u32);
        // A change may not land inside one timeout on a still desktop, so allow a
        // few attempts before giving up — an idle screen is not a failure.
        for _ in 0..5 {
            if let dxgi_capture::Grab::Frame(px, fw, fh) = dupl.grab(200) {
                assert_eq!(px.len(), (fw * fh * 4) as usize, "frame is not tightly packed BGRA");
                assert_eq!((fw, fh), (w, h), "duplicated frame does not match the monitor rect");
                assert!(dupl.last_work > std::time::Duration::ZERO);
                return;
            }
        }
    }
}
