use crate::providers::Game;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_opener::OpenerExt;

/// Launch a game and emit `game-exited` when it finishes so the frontend can
/// take focus back and return to the wheel.
pub fn launch(app: AppHandle, game: Game) -> Result<(), String> {
    match game.provider.as_str() {
        "steam" => {
            let appid = game
                .steam_app_id
                .clone()
                .ok_or("steam game missing app id")?;
            app.opener()
                .open_url(format!("steam://rungameid/{appid}"), None::<&str>)
                .map_err(|e| format!("failed to open steam url: {e}"))?;
            watch_steam(app, appid);
            Ok(())
        }
        _ => {
            let exec = game.exec.clone().ok_or("game missing executable")?;
            let mut child = Command::new(&exec)
                .args(&game.args)
                .spawn()
                .map_err(|e| format!("failed to launch {exec}: {e}"))?;
            thread::spawn(move || {
                let _ = child.wait();
                let _ = app.emit("game-exited", ());
            });
            Ok(())
        }
    }
}

/// The steam:// URL returns immediately, so we poll Steam's RunningAppID:
/// wait for it to become our app id (game started), then for it to clear
/// (game exited). Falls back to a timeout if the game never starts.
fn watch_steam(app: AppHandle, appid: String) {
    thread::spawn(move || {
        let target: u64 = appid.parse().unwrap_or(0);
        let start = Instant::now();
        let mut started = false;

        loop {
            thread::sleep(Duration::from_secs(2));
            let running = running_app_id().unwrap_or(0);

            if !started {
                if running == target && target != 0 {
                    started = true;
                } else if start.elapsed() > Duration::from_secs(90) {
                    // Never started (cancelled update dialog, etc.)
                    let _ = app.emit("game-exited", ());
                    return;
                }
            } else if running != target {
                let _ = app.emit("game-exited", ());
                return;
            }
        }
    });
}

#[cfg(target_os = "windows")]
fn running_app_id() -> Option<u64> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Valve\Steam")
        .ok()?;
    let value: u32 = key.get_value("RunningAppID").ok()?;
    Some(value as u64)
}

#[cfg(not(target_os = "windows"))]
fn running_app_id() -> Option<u64> {
    use regex::Regex;
    let home = dirs::home_dir()?;
    for candidate in [
        home.join(".steam/registry.vdf"),
        home.join(".var/app/com.valvesoftware.Steam/.steam/registry.vdf"),
    ] {
        if let Ok(raw) = std::fs::read_to_string(&candidate) {
            let re = Regex::new(r#""RunningAppID"\s+"(\d+)""#).ok()?;
            if let Some(cap) = re.captures(&raw) {
                return cap[1].parse().ok();
            }
        }
    }
    None
}
