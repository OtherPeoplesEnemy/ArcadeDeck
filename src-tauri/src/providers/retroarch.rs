use super::generic::clean_title;
use super::Game;
use crate::config::RetroArchConfig;
use std::fs;
use std::path::{Path, PathBuf};

/// Scan every configured RetroArch system. One executable, one cores folder,
/// N systems each pairing a core with a ROM folder.
pub fn scan(cfg: &RetroArchConfig) -> Result<Vec<Game>, String> {
    let exec = cfg
        .executable
        .resolve()
        .ok_or("retroarch.executable not set for this platform")?;
    let cores_dir = resolve_cores_dir(cfg, &exec);

    let mut games = Vec::new();
    for sys in &cfg.systems {
        match scan_system(cfg, sys, &exec, &cores_dir) {
            Ok(mut g) => games.append(&mut g),
            Err(e) => eprintln!("[retroarch:{}] {e}", sys.name),
        }
    }
    Ok(games)
}

fn scan_system(
    _cfg: &RetroArchConfig,
    sys: &crate::config::RetroSystem,
    exec: &str,
    cores_dir: &Path,
) -> Result<Vec<Game>, String> {
    let rom_path = sys
        .rom_path
        .resolve()
        .ok_or("rom_path not set for this platform")?;
    let art_path = sys.art_path.resolve();

    let core_file = cores_dir.join(format!("{}_libretro.{}", sys.core, core_ext()));
    let core_str = core_file.to_string_lossy().to_string();

    let extensions: Vec<String> = sys
        .extensions
        .iter()
        .map(|e| e.trim_start_matches('.').to_lowercase())
        .collect();

    let slug = sys.name.to_lowercase().replace(' ', "-");
    let mut games = Vec::new();
    let entries = fs::read_dir(&rom_path).map_err(|e| format!("rom_path unreadable: {e}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !extensions.is_empty() && !extensions.contains(&ext) {
            continue;
        }
        if extensions.is_empty() {
            continue; // require explicit extensions to avoid scooping up junk
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let rom_full = path.to_string_lossy().to_string();

        games.push(Game {
            id: format!("ra-{slug}-{stem}"),
            title: clean_title(stem),
            system: sys.name.clone(),
            provider: "retroarch".into(),
            exec: Some(exec.to_string()),
            args: vec![
                "-L".into(),
                core_str.clone(),
                rom_full,
                "-f".into(),
            ],
            steam_app_id: None,
            art: art_path.as_deref().and_then(|a| find_art(a, stem)),
            hidden: false,
        });
    }
    Ok(games)
}

fn core_ext() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "dll"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "so"
    }
}

/// Cores folder: explicit config wins, then platform defaults.
fn resolve_cores_dir(cfg: &RetroArchConfig, exec: &str) -> PathBuf {
    if let Some(p) = cfg.cores_path.resolve() {
        return PathBuf::from(p);
    }
    #[cfg(target_os = "windows")]
    {
        Path::new(exec)
            .parent()
            .map(|p| p.join("cores"))
            .unwrap_or_else(|| PathBuf::from("cores"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(home) = dirs::home_dir() {
            let user_cores = home.join(".config/retroarch/cores");
            if user_cores.exists() {
                return user_cores;
            }
        }
        for candidate in ["/usr/lib/libretro", "/usr/lib/x86_64-linux-gnu/libretro"] {
            let p = PathBuf::from(candidate);
            if p.exists() {
                return p;
            }
        }
        Path::new(exec)
            .parent()
            .map(|p| p.join("cores"))
            .unwrap_or_else(|| PathBuf::from("cores"))
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
