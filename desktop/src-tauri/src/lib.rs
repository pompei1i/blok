mod audio;

use audio::{Cmd, NativeAudio};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

// ── native audio state ────────────────────────────────────────────────────────

struct AudioState(Mutex<Option<NativeAudio>>);

/// Returns the actual input sample rate so the JS side can include it in
/// every audio packet, enabling correct resampling on remote peers.
#[tauri::command]
fn audio_start(
    state: tauri::State<AudioState>,
    app: tauri::AppHandle,
    input_device: Option<String>,
    output_device: Option<String>,
    noise_suppression: bool,
    echo_cancellation: bool,
) -> Result<u32, String> {
    let (engine, actual_rate) =
        NativeAudio::start(app, input_device, output_device, noise_suppression, echo_cancellation)?;
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

/// Receive i16 samples from a remote participant, queue them for playback.
/// `rate` is the sender's input sample rate; samples are resampled to 48 kHz
/// if necessary. Returns true if the packet's RMS exceeds the speaking threshold.
#[tauri::command]
fn audio_receive(
    from: String,
    samples: Vec<i16>,
    rate: Option<u32>,
    state: tauri::State<AudioState>,
) -> bool {
    let speaking = audio::is_speaking_i16(&samples);
    if let Some(engine) = state.0.lock().unwrap().as_ref() {
        let f32s = audio::resample_to_f32(&samples, rate.unwrap_or(48_000));
        engine.send(Cmd::AddSamples { from, samples: f32s });
    }
    speaking
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

#[cfg(not(target_os = "windows"))]
fn autostart_is_enabled_impl() -> bool { false }

#[cfg(not(target_os = "windows"))]
fn autostart_set_impl(_enabled: bool) -> Result<(), String> {
    Err("Autostart is only supported on Windows".to_string())
}

// ── screen source enumeration ─────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct ScreenSource {
    id: String,
    name: String,
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
    let rgb: Vec<u8> = bgra.chunks(4).flat_map(|p| [p[2], p[1], p[0]]).collect();
    let img = image::RgbImage::from_raw(w, h, rgb)?;
    let img = if max_width > 0 && w > max_width {
        let new_h = (h as f64 * max_width as f64 / w as f64).round() as u32;
        image::imageops::resize(&img, max_width, new_h, image::imageops::FilterType::Nearest)
    } else {
        img
    };
    let (fw, fh) = img.dimensions();
    let mut buf = std::io::Cursor::new(Vec::new());
    let dynamic: image::DynamicImage = img.into();
    let quality = jpeg_quality.clamp(1, 100);
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
    dynamic.write_with_encoder(encoder).ok()?;
    use base64::Engine as _;
    let data = base64::engine::general_purpose::STANDARD.encode(buf.into_inner());
    Some(ScreenFrame { data, w: fw, h: fh })
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

#[tauri::command]
fn capture_screen_frame(
    source_id: String,
    max_width: u32,
    jpeg_quality: u8,
    state: tauri::State<ScreenCaptureState>,
) -> Option<ScreenFrame> {
    let raw = capture_raw_frame(&source_id)?;
    let hash = frame_hash(&raw.bgra);
    let mut hashes = state.last_hashes.lock().unwrap();
    let unchanged = hashes.get(&source_id).copied() == Some(hash);
    hashes.insert(source_id, hash);
    drop(hashes);
    if unchanged {
        return None;
    }
    encode_bgra_to_frame(raw.bgra, raw.w, raw.h, max_width, jpeg_quality)
}

#[cfg(target_os = "windows")]
fn capture_raw_monitor(index: u32) -> Option<RawFrame> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
        EnumDisplayMonitors, GetDC, GetDIBits, ReleaseDC, SelectObject,
        BITMAPINFO, BITMAPINFOHEADER, HDC, HGDIOBJ, HMONITOR, DIB_RGB_COLORS, SRCCOPY,
    };

    struct MData { idx: u32, cur: u32, rect: RECT }

    unsafe extern "system" fn mon_cb(
        _: HMONITOR, _: HDC, lp: *mut RECT, param: LPARAM,
    ) -> BOOL {
        let d = &mut *(param.0 as *mut MData);
        if d.cur == d.idx { d.rect = *lp; }
        d.cur += 1;
        BOOL(1)
    }

    let mut mdata = MData { idx: index, cur: 0, rect: RECT::default() };
    unsafe {
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(mon_cb),
            LPARAM(&mut mdata as *mut MData as isize),
        );
        let r = mdata.rect;
        let w = (r.right - r.left) as u32;
        let h = (r.bottom - r.top) as u32;
        if w == 0 || h == 0 { return None; }

        let sdc = GetDC(None);
        let mdc = CreateCompatibleDC(Some(sdc));
        let bmp = CreateCompatibleBitmap(sdc, w as i32, h as i32);
        let old = SelectObject(mdc, HGDIOBJ(bmp.0));
        let _ = BitBlt(mdc, 0, 0, w as i32, h as i32, Some(sdc), r.left, r.top, SRCCOPY);

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
        let _ = ReleaseDC(None, sdc);

        Some(RawFrame { bgra: px, w, h })
    }
}

#[cfg(target_os = "windows")]
fn capture_raw_window(hwnd_val: isize) -> Option<RawFrame> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
        GetDC, GetDIBits, ReleaseDC, SelectObject,
        BITMAPINFO, BITMAPINFOHEADER, HGDIOBJ, DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

    unsafe {
        let hwnd = HWND(hwnd_val as *mut _);
        let mut rect = RECT::default();
        let _ = GetClientRect(hwnd, &mut rect);
        let w = (rect.right - rect.left) as u32;
        let h = (rect.bottom - rect.top) as u32;
        if w == 0 || h == 0 { return None; }

        let wdc = GetDC(Some(hwnd));
        let mdc = CreateCompatibleDC(Some(wdc));
        let bmp = CreateCompatibleBitmap(wdc, w as i32, h as i32);
        let old = SelectObject(mdc, HGDIOBJ(bmp.0));
        let _ = BitBlt(mdc, 0, 0, w as i32, h as i32, Some(wdc), 0, 0, SRCCOPY);

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
        let _ = ReleaseDC(Some(hwnd), wdc);

        Some(RawFrame { bgra: px, w, h })
    }
}

#[cfg(not(target_os = "windows"))]
fn capture_raw_monitor(_: u32) -> Option<RawFrame> { None }
#[cfg(not(target_os = "windows"))]
fn capture_raw_window(_: isize) -> Option<RawFrame> { None }

/// Returns one entry per monitor. IDs use the Chromium desktop-capture format
/// ("screen:INDEX:0") so they can be passed directly to getUserMedia with
/// chromeMediaSource: 'desktop'.
#[tauri::command]
fn get_screen_sources() -> Vec<ScreenSource> {
    get_screen_sources_impl()
}

#[cfg(target_os = "windows")]
fn get_screen_sources_impl() -> Vec<ScreenSource> {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CMONITORS};
    let count = unsafe { GetSystemMetrics(SM_CMONITORS).max(1) } as u32;
    (0..count)
        .map(|i| ScreenSource {
            id: format!("screen:{}:0", i),
            name: if i == 0 {
                "Primary Display".to_string()
            } else {
                format!("Display {}", i + 1)
            },
        })
        .collect()
}

#[cfg(not(target_os = "windows"))]
fn get_screen_sources_impl() -> Vec<ScreenSource> {
    vec![ScreenSource {
        id: "screen:0:0".to_string(),
        name: "Display".to_string(),
    }]
}

// ── window source enumeration ─────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct WindowSource {
    id: String,
    title: String,
}

#[tauri::command]
fn get_window_sources() -> Vec<WindowSource> {
    get_window_sources_impl()
}

#[cfg(target_os = "windows")]
fn get_window_sources_impl() -> Vec<WindowSource> {
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::EnumWindows;
    use windows::core::BOOL;

    let mut list: Vec<WindowSource> = Vec::new();

    unsafe extern "system" fn callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongW, GetWindowTextLengthW, GetWindowTextW,
            IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
        };
        use windows::core::BOOL;

        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }
        let len = GetWindowTextLengthW(hwnd);
        if len == 0 {
            return BOOL(1);
        }
        // Skip floating toolbars, notification popups, etc.
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if ex_style & WS_EX_TOOLWINDOW.0 != 0 {
            return BOOL(1);
        }
        let mut buf = vec![0u16; (len + 1) as usize];
        GetWindowTextW(hwnd, &mut buf);
        let title = String::from_utf16_lossy(&buf[..len as usize]);
        if title.is_empty() {
            return BOOL(1);
        }
        let list = &mut *(lparam.0 as *mut Vec<WindowSource>);
        list.push(WindowSource {
            id: format!("window:{}:0", hwnd.0 as isize),
            title,
        });
        BOOL(1)
    }

    unsafe {
        let _ = EnumWindows(Some(callback), LPARAM(&mut list as *mut _ as isize));
    }
    list
}

#[cfg(not(target_os = "windows"))]
fn get_window_sources_impl() -> Vec<WindowSource> {
    vec![]
}

// ── app entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Opt-in multi-instance for testing two accounts on one machine: launch a
    // second copy with BLOK_MULTI=1 to skip the single-instance lock and use a
    // separate WebView2 data folder (its own login session). Normal launches keep
    // single-instance (clicking the icon just focuses the existing window).
    let multi = std::env::var_os("BLOK_MULTI").is_some();
    if multi {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let mut dir = std::path::PathBuf::from(local);
            dir.push("blok-multi");
            std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir);
        }
    }

    let mut builder = tauri::Builder::default()
        .manage(AudioState(Mutex::new(None)))
        .manage(ScreenCaptureState { last_hashes: Mutex::new(HashMap::new()) });

    if !multi {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
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
            get_screen_sources,
            get_window_sources,
            capture_screen_frame,
            autostart_is_enabled,
            autostart_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
