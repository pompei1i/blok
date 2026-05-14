mod audio;

use audio::{Cmd, NativeAudio};
use std::sync::Mutex;

// ── native audio state ────────────────────────────────────────────────────────

struct AudioState(Mutex<Option<NativeAudio>>);

#[tauri::command]
fn audio_start(
    state: tauri::State<AudioState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let engine = NativeAudio::start(app)?;
    *state.0.lock().unwrap() = Some(engine);
    Ok(())
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
/// Returns true if the packet's RMS exceeds the speaking threshold.
#[tauri::command]
fn audio_receive(
    from: String,
    samples: Vec<i16>,
    state: tauri::State<AudioState>,
) -> bool {
    let speaking = audio::is_speaking_i16(&samples);
    if let Some(engine) = state.0.lock().unwrap().as_ref() {
        let f32s: Vec<f32> = samples.iter().map(|&s| s as f32 / 32_768.0).collect();
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

// ── app entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AudioState(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            disable_audio_ducking,
            audio_start,
            audio_stop,
            audio_set_muted,
            audio_set_deafened,
            audio_receive,
            audio_remove_peer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
