// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod input;
mod launcher;
mod providers;

use providers::Game;
use tauri::AppHandle;

#[tauri::command]
fn scan_games() -> Vec<Game> {
    let cfg = config::load();
    providers::scan_all(&cfg)
}

#[tauri::command]
fn launch_game(app: AppHandle, game: Game) -> Result<(), String> {
    launcher::launch(app, game)
}

#[tauri::command]
fn get_config_path() -> String {
    config::config_file().to_string_lossy().to_string()
}

#[tauri::command]
fn get_full_config() -> config::AppConfig {
    config::load()
}

#[tauri::command]
fn save_config(cfg: config::AppConfig) -> Result<(), String> {
    config::save(&cfg)
}

#[tauri::command]
fn get_attract_delay() -> u64 {
    config::load().attract_after_secs
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn set_custom_art(game_id: String, source: String) -> Result<(), String> {
    let ext = std::path::Path::new(&source)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !["png", "jpg", "jpeg"].contains(&ext.as_str()) {
        return Err("unsupported image type (use png or jpg)".into());
    }
    let dir = config::config_dir().join("art");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let base = providers::sanitize_id(&game_id);
    for e in ["png", "jpg", "jpeg"] {
        let _ = std::fs::remove_file(dir.join(format!("{base}.{e}")));
    }
    std::fs::copy(&source, dir.join(format!("{base}.{ext}")))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn remove_custom_art(game_id: String) -> Result<(), String> {
    let dir = config::config_dir().join("art");
    let base = providers::sanitize_id(&game_id);
    for e in ["png", "jpg", "jpeg"] {
        let _ = std::fs::remove_file(dir.join(format!("{base}.{e}")));
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            input::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_games,
            launch_game,
            get_config_path,
            get_full_config,
            save_config,
            get_attract_delay,
            quit_app,
            set_custom_art,
            remove_custom_art
        ])
        .run(tauri::generate_context!())
        .expect("error while running ArcadeDeck");
}
