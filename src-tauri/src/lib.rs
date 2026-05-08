// Disable Windows audio ducking (communication mode) that makes all audio
// sound like radio when a microphone stream is active.
#[tauri::command]
fn disable_audio_ducking() {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // UserDuckingPreference = 3 means "Do nothing" (no ducking/filtering)
        let _ = std::process::Command::new("reg")
            .args([
                "add",
                "HKCU\\Software\\Microsoft\\Multimedia\\Audio",
                "/v", "UserDuckingPreference",
                "/t", "REG_DWORD",
                "/d", "3",
                "/f",
            ])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![disable_audio_ducking])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
