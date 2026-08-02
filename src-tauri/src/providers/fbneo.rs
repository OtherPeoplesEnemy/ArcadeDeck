use super::Game;
use crate::config::{config_dir, FbneoConfig};
use regex::Regex;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::Command;

/// Scan a FinalBurn Neo ROM folder. Titles come from a cached
/// `fbneo -listinfo` dump (FBNeo's datfile output), so "mslug" shows up as
/// "Metal Slug - Super Vehicle-001".
///
/// Note: FBNeo finds ROMs via its own configured paths at launch time — the
/// folder here is only for building the wheel. Point FBNeo's internal ROM
/// path setting at the same folder.
pub fn scan(cfg: &FbneoConfig) -> Result<Vec<Game>, String> {
    let exec = cfg
        .executable
        .resolve()
        .ok_or("fbneo.executable not set for this platform")?;
    let rom_path = cfg
        .rom_path
        .resolve()
        .ok_or("fbneo.rom_path not set for this platform")?;
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
        if ext != "zip" && ext != "7z" {
            continue;
        }
        let Some(shortname) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        // BIOS sets aren't games — skip the common ones.
        if ["neogeo", "pgm", "decocass", "midssio", "skns"].contains(&shortname) {
            continue;
        }
        let title = titles
            .get(shortname)
            .cloned()
            .unwrap_or_else(|| shortname.to_string());

        let mut args = vec![shortname.to_string()];
        args.extend(cfg.extra_args.iter().cloned());

        games.push(Game {
            id: format!("fbneo-{shortname}"),
            title,
            system: "FBNeo".into(),
            provider: "fbneo".into(),
            exec: Some(exec.clone()),
            args,
            steam_app_id: None,
            art: art_path.as_deref().and_then(|a| find_art(a, shortname)),
            hidden: false,
        });
    }
    Ok(games)
}

/// Run `fbneo -listinfo` once and cache the shortname -> title map as JSON.
fn load_titles(exec: &str) -> Result<HashMap<String, String>, String> {
    let cache_file = config_dir().join("fbneo_titles.json");
    if let Ok(raw) = fs::read_to_string(&cache_file) {
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&raw) {
            if !map.is_empty() {
                return Ok(map);
            }
        }
    }

    let output = Command::new(exec)
        .arg("-listinfo")
        .output()
        .map_err(|e| format!("failed to run fbneo -listinfo: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    // Datfile-style output:
    //   <game name="mslug" ...>
    //       <description>Metal Slug - Super Vehicle-001</description>
    let re_game = Regex::new(r#"<game\s+name="([^"]+)""#).unwrap();
    let re_desc = Regex::new(r"<description>([^<]+)</description>").unwrap();

    let mut map = HashMap::new();
    let mut current: Option<String> = None;
    for line in stdout.lines() {
        if let Some(c) = re_game.captures(line) {
            current = Some(c[1].to_string());
        } else if let Some(c) = re_desc.captures(line) {
            if let Some(name) = current.take() {
                map.insert(name, unescape(c[1].trim()));
            }
        }
    }

    let _ = fs::create_dir_all(config_dir());
    if let Ok(json) = serde_json::to_string(&map) {
        let _ = fs::write(&cache_file, json);
    }
    Ok(map)
}

fn unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
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
