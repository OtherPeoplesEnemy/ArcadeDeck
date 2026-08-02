use super::Game;
use regex::Regex;
use std::fs;
use std::path::{Path, PathBuf};

/// Names we never want on the wheel.
const JUNK: &[&str] = &[
    "Steamworks Common Redistributables",
    "Steam Linux Runtime",
    "Proton",
];

pub fn scan() -> Result<Vec<Game>, String> {
    let root = find_steam_root().ok_or("Steam install not found")?;
    let libraries = find_libraries(&root);
    let appid_re = Regex::new(r#""appid"\s+"(\d+)""#).unwrap();
    let name_re = Regex::new(r#""name"\s+"([^"]+)""#).unwrap();

    let mut games = Vec::new();
    for lib in libraries {
        let steamapps = lib.join("steamapps");
        let Ok(entries) = fs::read_dir(&steamapps) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let fname = path.file_name().and_then(|f| f.to_str()).unwrap_or("");
            if !fname.starts_with("appmanifest_") || !fname.ends_with(".acf") {
                continue;
            }
            let Ok(raw) = fs::read_to_string(&path) else {
                continue;
            };
            let appid = appid_re
                .captures(&raw)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string());
            let name = name_re
                .captures(&raw)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string());
            let (Some(appid), Some(name)) = (appid, name) else {
                continue;
            };
            if JUNK.iter().any(|j| name.contains(j)) {
                continue;
            }
            games.push(Game {
                id: format!("steam-{appid}"),
                title: name,
                system: "Steam".into(),
                provider: "steam".into(),
                exec: None,
                args: Vec::new(),
                steam_app_id: Some(appid.clone()),
                art: find_art(&root, &appid),
            });
        }
    }
    Ok(games)
}

/// Locate the Steam root directory per-platform.
fn find_steam_root() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Valve\Steam") {
            if let Ok(path) = key.get_value::<String, _>("SteamPath") {
                let p = PathBuf::from(path);
                if p.exists() {
                    return Some(p);
                }
            }
        }
        for candidate in [
            r"C:\Program Files (x86)\Steam",
            r"C:\Program Files\Steam",
        ] {
            let p = PathBuf::from(candidate);
            if p.exists() {
                return Some(p);
            }
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = dirs::home_dir()?;
        for candidate in [
            home.join(".steam/steam"),
            home.join(".local/share/Steam"),
            home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
        ] {
            if candidate.exists() {
                return Some(candidate);
            }
        }
        None
    }
}

/// The root library plus everything listed in libraryfolders.vdf.
fn find_libraries(root: &Path) -> Vec<PathBuf> {
    let mut libs = vec![root.to_path_buf()];
    let vdf = root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(raw) = fs::read_to_string(vdf) {
        let path_re = Regex::new(r#""path"\s+"([^"]+)""#).unwrap();
        for cap in path_re.captures_iter(&raw) {
            let p = PathBuf::from(cap[1].replace("\\\\", "\\"));
            if p.exists() && !libs.contains(&p) {
                libs.push(p);
            }
        }
    }
    libs
}

/// Steam has used two librarycache layouts over the years; check both.
fn find_art(root: &Path, appid: &str) -> Option<String> {
    let cache = root.join("appcache").join("librarycache");
    let candidates = [
        cache.join(format!("{appid}_library_600x900.jpg")),
        cache.join(appid).join("library_600x900.jpg"),
        cache.join(format!("{appid}_header.jpg")),
        cache.join(appid).join("header.jpg"),
    ];
    candidates
        .iter()
        .find(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string())
}
