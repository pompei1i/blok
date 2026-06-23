#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Emitter;

#[tauri::command]
async fn download_and_install(
    app: tauri::AppHandle,
    url: String,
    install_path: String,
) -> Result<(), String> {
    let temp_path = std::env::temp_dir().join("blok-setup-dl.exe");
    let temp_str = temp_path.to_str().ok_or("invalid temp path")?;

    let dl = std::process::Command::new("curl")
        .args(["-L", "-o", temp_str, "--silent", "--show-error", &url])
        .status()
        .map_err(|e| format!("curl not available: {e}"))?;

    if !dl.success() {
        return Err("download failed".to_string());
    }

    app.emit("install-status", "installing").ok();

    // Pass custom install path via NSIS /D flag (must be last arg, unquoted)
    let mut cmd = std::process::Command::new(&temp_path);
    cmd.arg("/S");
    if !install_path.is_empty() {
        cmd.arg(format!("/D={install_path}"));
    }
    let install = cmd.status().map_err(|e| e.to_string())?;

    std::fs::remove_file(&temp_path).ok();

    if !install.success() {
        return Err(format!("installer exited with code {:?}", install.code()));
    }

    app.emit("install-status", "done").ok();
    Ok(())
}

#[tauri::command]
fn get_default_install_path() -> String {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    std::path::Path::new(&local)
        .join("blok")
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn launch_blok(install_path: String) -> Result<(), String> {
    let path = if install_path.is_empty() {
        let local = std::env::var("LOCALAPPDATA").map_err(|e| e.to_string())?;
        std::path::Path::new(&local).join("blok").join("blok.exe").to_string_lossy().to_string()
    } else {
        std::path::Path::new(&install_path).join("blok.exe").to_string_lossy().to_string()
    };

    std::process::Command::new(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn close_app(window: tauri::Window) {
    window.close().ok();
}

/// Fetch the release manifest (latest.json) and return it as text. Uses the stable
/// /releases/latest/download/latest.json URL via curl (not the GitHub API), so it
/// avoids the API's 60/hour anonymous rate limit and webview CORS that previously
/// left the installer with no download URL.
#[tauri::command]
fn fetch_latest_json() -> Result<String, String> {
    let url = "https://github.com/pompei1i/blok-releases/releases/latest/download/latest.json";
    let out = std::process::Command::new("curl")
        .args(["-L", "--silent", "--show-error", "--fail", url])
        .output()
        .map_err(|e| format!("curl not available: {e}"))?;
    if !out.status.success() {
        return Err(format!("fetch failed: {}", String::from_utf8_lossy(&out.stderr)));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            download_and_install,
            get_default_install_path,
            launch_blok,
            close_app,
            fetch_latest_json,
        ])
        .run(tauri::generate_context!())
        .expect("error while running blok installer");
}
