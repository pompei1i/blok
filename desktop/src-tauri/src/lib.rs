mod audio;

use audio::{Cmd, NativeAudio};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

// ── native audio state ────────────────────────────────────────────────────────

struct AudioState(Mutex<Option<NativeAudio>>);

/// Returns the actual input sample rate so the JS side can include it in
/// every audio packet, enabling correct resampling on remote peers.
#[tauri::command]
fn audio_start(
    state: tauri::State<AudioState>,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    let (engine, actual_rate) = NativeAudio::start(app)?;
    *state.0.lock().unwrap() = Some(engine);
    Ok(actual_rate)
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

// ── screen source enumeration ─────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct ScreenSource {
    id: String,
    name: String,
}

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
                .menu_on_left_click(false)
                .tooltip("$blok")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
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
            get_screen_sources,
            get_window_sources,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
