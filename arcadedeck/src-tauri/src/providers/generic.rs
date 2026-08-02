use super::Game;
use crate::config::SystemConfig;
use std::fs;
use std::path::Path;

/// Scan one configured system (RetroArch, Dolphin, PCSX2, ...).
pub fn scan(cfg: &SystemConfig) -> Result<Vec<Game>, String> {
    let exec = cfg
        .emulator
        .resolve()
        .ok_or("emulator path not set for this platform")?;
    let rom_path = cfg
        .rom_path
        .resolve()
        .ok_or("rom_path not set for this platform")?;
    let art_path = cfg.art_path.resolve();

    let extensions: Vec<String> = cfg
        .extensions
        .iter()
        .map(|e| e.trim_start_matches('.').to_lowercase())
        .collect();

    let mut games = Vec::new();
    let entries = fs::read_dir(&rom_path).map_err(|e| format!("rom_path unreadable: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !extensions.contains(&ext) {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let rom_full = path.to_string_lossy().to_string();
        let args: Vec<String> = cfg
            .args
            .iter()
            .map(|a| a.replace("{rom}", &rom_full))
            .collect();

        games.push(Game {
            id: format!("{}-{stem}", cfg.name.to_lowercase().replace(' ', "-")),
            title: clean_title(stem),
            system: cfg.name.clone(),
            provider: "emulator".into(),
            exec: Some(exec.clone()),
            args,
            steam_app_id: None,
            art: art_path.as_deref().and_then(|a| find_art(a, stem)),
        });
    }
    Ok(games)
}

/// Strip common ROM filename noise: "Super Metroid (USA) [!]" -> "Super Metroid".
fn clean_title(stem: &str) -> String {
    let mut out = String::new();
    let mut depth = 0i32;
    for ch in stem.chars() {
        match ch {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    let cleaned = out.trim().to_string();
    if cleaned.is_empty() {
        stem.to_string()
    } else {
        cleaned
    }
}

fn find_art(art_dir: &str, stem: &str) -> Option<String> {
    for ext in ["png", "jpg", "jpeg"] {
        let p = Path::new(art_dir).join(format!("{stem}.{ext}"));
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}
