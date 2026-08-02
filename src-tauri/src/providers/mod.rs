pub mod generic;
pub mod mame;
pub mod steam;

use serde::{Deserialize, Serialize};

/// Normalized game entry. The UI never cares where a game came from.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub title: String,
    pub system: String,
    /// "steam" | "mame" | "emulator"
    pub provider: String,
    /// Absolute path to the executable (None for Steam games).
    pub exec: Option<String>,
    /// Fully resolved argument list (empty for Steam games).
    pub args: Vec<String>,
    /// Steam app id (Steam games only).
    pub steam_app_id: Option<String>,
    /// Absolute path to box art / snap, if found.
    pub art: Option<String>,
    /// Hidden from the wheel by the user.
    #[serde(default)]
    pub hidden: bool,
}

/// Filesystem-safe version of a game id, used for custom art filenames.
pub fn sanitize_id(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

pub fn scan_all(cfg: &crate::config::AppConfig) -> Vec<Game> {
    let mut games: Vec<Game> = Vec::new();

    if cfg.steam.enabled {
        match steam::scan() {
            Ok(mut g) => games.append(&mut g),
            Err(e) => eprintln!("[steam] scan failed: {e}"),
        }
    }

    if let Some(mame_cfg) = &cfg.mame {
        match mame::scan(mame_cfg) {
            Ok(mut g) => games.append(&mut g),
            Err(e) => eprintln!("[mame] scan failed: {e}"),
        }
    }

    for system in &cfg.systems {
        match generic::scan(system) {
            Ok(mut g) => games.append(&mut g),
            Err(e) => eprintln!("[{}] scan failed: {e}", system.name),
        }
    }

    // Custom art overrides win over anything the providers found, and the
    // hidden flag comes from config.
    let art_dir = crate::config::config_dir().join("art");
    for g in &mut games {
        let base = sanitize_id(&g.id);
        for ext in ["png", "jpg", "jpeg"] {
            let p = art_dir.join(format!("{base}.{ext}"));
            if p.exists() {
                g.art = Some(p.to_string_lossy().to_string());
                break;
            }
        }
        g.hidden = cfg.hidden_games.contains(&g.id);
    }

    games.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    games
}
