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
fn get_attract_delay() -> u64 {
    config::load().attract_after_secs
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            input::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_games,
            launch_game,
            get_config_path,
            get_attract_delay
        ])
        .run(tauri::generate_context!())
        .expect("error while running ArcadeDeck");
}
