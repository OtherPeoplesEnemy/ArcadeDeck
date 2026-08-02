use super::Game;
use crate::config::{config_dir, MameConfig};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;

/// Scan a MAME ROM folder. Titles come from a cached `mame -listfull` dump so
/// "sf2" shows up as "Street Fighter II: The World Warrior".
pub fn scan(cfg: &MameConfig) -> Result<Vec<Game>, String> {
    let exec = cfg
        .executable
        .resolve()
        .ok_or("mame.executable not set for this platform")?;
    let rom_path = cfg
        .rom_path
        .resolve()
        .ok_or("mame.rom_path not set for this platform")?;
    let art_path = cfg.art_path.resolve();

    let titles = load_titles(&exec)?;

    let mut games = Vec::new();
    let entries = fs::read_dir(&rom_path).map_err(|e| format!("rom_path unreadable: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if ext != "zip" && ext != "7z" && ext != "chd" {
            continue;
        }
        let Some(shortname) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let title = titles
            .get(shortname)
            .cloned()
            .unwrap_or_else(|| shortname.to_string());

        let mut args = vec![shortname.to_string(), "-rompath".into(), rom_path.clone()];
        args.extend(cfg.extra_args.iter().cloned());

        games.push(Game {
            id: format!("mame-{shortname}"),
            title,
            system: "Arcade".into(),
            provider: "mame".into(),
            exec: Some(exec.clone()),
            args,
            steam_app_id: None,
            art: art_path.as_deref().and_then(|a| find_art(a, shortname)),
            hidden: false,
        });
    }
    Ok(games)
}

/// Run `mame -listfull` once and cache the shortname -> title map as JSON.
fn load_titles(exec: &str) -> Result<HashMap<String, String>, String> {
    let cache_file = config_dir().join("mame_titles.json");
    if let Ok(raw) = fs::read_to_string(&cache_file) {
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&raw) {
            if !map.is_empty() {
                return Ok(map);
            }
        }
    }

    let output = Command::new(exec)
        .arg("-listfull")
        .output()
        .map_err(|e| format!("failed to run mame -listfull: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut map = HashMap::new();
    for line in stdout.lines().skip(1) {
        // Format: `shortname        "Full Title"`
        let Some((short, rest)) = line.split_once(char::is_whitespace) else {
            continue;
        };
        let title = rest.trim().trim_matches('"');
        if !short.is_empty() && !title.is_empty() {
            map.insert(short.to_string(), title.to_string());
        }
    }

    let _ = fs::create_dir_all(config_dir());
    if let Ok(json) = serde_json::to_string(&map) {
        let _ = fs::write(&cache_file, json);
    }
    Ok(map)
}

fn find_art(art_dir: &str, shortname: &str) -> Option<String> {
    for ext in ["png", "jpg", "jpeg"] {
        let p = Path::new(art_dir).join(format!("{shortname}.{ext}"));
        if p.exists() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}
