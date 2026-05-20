mod audio;

use audio::{Cmd, NativeAudio};
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
) -> Result<u32, String> {
    let (engine, actual_rate) = NativeAudio::start(app, input_device, output_device)?;
    *state.0.lock().unwrap() = Some(engine);
    Ok(actual_rate)
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

fn encode_bgra_to_frame(bgra: Vec<u8>, w: u32, h: u32, max_width: u32, jpeg_quality: u8) -> Option<ScreenFrame> {
    let rgb: Vec<u8> = bgra.chunks(4).flat_map(|p| [p[2], p[1], p[0]]).collect();
    let img = image::RgbImage::from_raw(w, h, rgb)?;
    let img = if max_width > 0 && w > max_width {
        let new_h = (h as f64 * max_width as f64 / w as f64).round() as u32;
        image::imageops::resize(&img, max_width, new_h, image::imageops::FilterType::Triangle)
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

#[tauri::command]
fn capture_screen_frame(source_id: String, max_width: u32, jpeg_quality: u8) -> Option<ScreenFrame> {
    if let Some(rest) = source_id.strip_prefix("screen:") {
        let idx: u32 = rest.split(':').next()?.parse().ok()?;
        capture_monitor(idx, max_width, jpeg_quality)
    } else if let Some(rest) = source_id.strip_prefix("window:") {
        let hwnd_val: isize = rest.split(':').next()?.parse().ok()?;
        capture_window(hwnd_val, max_width, jpeg_quality)
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn capture_monitor(index: u32, max_width: u32, jpeg_quality: u8) -> Option<ScreenFrame> {
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

        encode_bgra_to_frame(px, w, h, max_width, jpeg_quality)
    }
}

#[cfg(target_os = "windows")]
fn capture_window(hwnd_val: isize, max_width: u32, jpeg_quality: u8) -> Option<ScreenFrame> {
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

        encode_bgra_to_frame(px, w, h, max_width, jpeg_quality)
    }
}

#[cfg(not(target_os = "windows"))]
fn capture_monitor(_: u32, _: u32, _: u8) -> Option<ScreenFrame> { None }
#[cfg(not(target_os = "windows"))]
fn capture_window(_: isize, _: u32, _: u8) -> Option<ScreenFrame> { None }

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
    tauri::Builder::default()
        .manage(AudioState(Mutex::new(None)))
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
