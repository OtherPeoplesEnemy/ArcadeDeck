use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// A path that can differ between Windows and Linux.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PlatformPath {
    pub windows: Option<String>,
    pub linux: Option<String>,
}

impl PlatformPath {
    pub fn resolve(&self) -> Option<String> {
        #[cfg(target_os = "windows")]
        {
            self.windows.clone()
        }
        #[cfg(not(target_os = "windows"))]
        {
            self.linux.clone()
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SteamConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
}

impl Default for SteamConfig {
    fn default() -> Self {
        Self { enabled: true }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MameConfig {
    pub executable: PlatformPath,
    pub rom_path: PlatformPath,
    #[serde(default)]
    pub art_path: PlatformPath,
    /// Extra args appended after the ROM shortname.
    #[serde(default)]
    pub extra_args: Vec<String>,
}

/// FBNeo uses the same fields as MAME (executable, ROM folder, art folder).
pub type FbneoConfig = MameConfig;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct RetroArchConfig {
    #[serde(default)]
    pub executable: PlatformPath,
    /// Optional: where cores live. Defaults to `<exe dir>/cores` on Windows
    /// and the standard locations on Linux.
    #[serde(default)]
    pub cores_path: PlatformPath,
    #[serde(default)]
    pub systems: Vec<RetroSystem>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RetroSystem {
    pub name: String,
    /// Core name without suffix, e.g. "snes9x" -> snes9x_libretro.dll/.so
    pub core: String,
    pub rom_path: PlatformPath,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub art_path: PlatformPath,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SystemConfig {
    pub name: String,
    pub emulator: PlatformPath,
    /// Args as an array; "{rom}" is replaced with the full ROM path.
    pub args: Vec<String>,
    pub rom_path: PlatformPath,
    pub extensions: Vec<String>,
    #[serde(default)]
    pub art_path: PlatformPath,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UiConfig {
    /// Multiplier on wheel tile size (0.7 – 1.4).
    #[serde(default = "default_tile_scale")]
    pub tile_scale: f32,
    /// "grid" (Tron floor), "image" (custom wallpaper), or "none".
    #[serde(default = "default_background")]
    pub background: String,
    /// Wallpaper path when background = "image".
    #[serde(default)]
    pub background_image: Option<String>,
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            tile_scale: default_tile_scale(),
            background: default_background(),
            background_image: None,
        }
    }
}

fn default_background() -> String {
    "grid".into()
}

fn default_tile_scale() -> f32 {
    1.0
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    #[serde(default)]
    pub steam: SteamConfig,
    #[serde(default)]
    pub mame: Option<MameConfig>,
    #[serde(default)]
    pub fbneo: Option<FbneoConfig>,
    #[serde(default)]
    pub retroarch: Option<RetroArchConfig>,
    #[serde(default)]
    pub systems: Vec<SystemConfig>,
    /// Seconds of inactivity before attract mode starts.
    #[serde(default = "default_attract_secs")]
    pub attract_after_secs: u64,
    #[serde(default)]
    pub ui: UiConfig,
    /// Game ids the user has hidden from the wheel.
    #[serde(default)]
    pub hidden_games: Vec<String>,
    #[serde(default)]
    pub sounds: SoundsConfig,
    #[serde(default)]
    pub attract: AttractConfig,
    /// SteamGridDB API key for artwork fetching (free: steamgriddb.com).
    #[serde(default)]
    pub sgdb_api_key: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            steam: SteamConfig::default(),
            mame: None,
            fbneo: None,
            retroarch: None,
            systems: Vec::new(),
            // The derived Default gave 0 here, which made attract mode
            // trigger instantly. Never again.
            attract_after_secs: default_attract_secs(),
            ui: UiConfig::default(),
            hidden_games: Vec::new(),
            sounds: SoundsConfig::default(),
            attract: AttractConfig::default(),
            sgdb_api_key: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SoundsConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Background music tracks (absolute paths, per-machine).
    #[serde(default)]
    pub music: Vec<String>,
    #[serde(default = "default_half")]
    pub music_volume: f32,
    #[serde(default = "default_sfx_vol")]
    pub sfx_volume: f32,
    /// Custom SFX files; None = built-in synth sounds.
    #[serde(default)]
    pub sfx_move: Option<String>,
    #[serde(default)]
    pub sfx_launch: Option<String>,
    #[serde(default)]
    pub sfx_back: Option<String>,
}

impl Default for SoundsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            music: Vec::new(),
            music_volume: default_half(),
            sfx_volume: default_sfx_vol(),
            sfx_move: None,
            sfx_launch: None,
            sfx_back: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AttractConfig {
    /// Video files to loop in attract mode (absolute paths, per-machine).
    /// Empty = art slideshow.
    #[serde(default)]
    pub videos: Vec<String>,
    #[serde(default = "default_half")]
    pub video_volume: f32,
}

impl Default for AttractConfig {
    fn default() -> Self {
        Self {
            videos: Vec::new(),
            video_volume: default_half(),
        }
    }
}

fn default_half() -> f32 {
    0.5
}

fn default_sfx_vol() -> f32 {
    0.7
}

fn default_true() -> bool {
    true
}

fn default_attract_secs() -> u64 {
    45
}

pub fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("arcadedeck")
}

pub fn config_file() -> PathBuf {
    config_dir().join("config.json")
}

/// Load config, writing a commented starter file on first run.
pub fn load() -> AppConfig {
    let path = config_file();
    if let Ok(raw) = fs::read_to_string(&path) {
        match serde_json::from_str::<AppConfig>(&raw) {
            Ok(mut cfg) => {
                // Migrate configs written by the buggy v0.1 default (0 = instant attract).
                if cfg.attract_after_secs == 0 {
                    cfg.attract_after_secs = default_attract_secs();
                    let _ = save(&cfg);
                }
                return cfg;
            }
            Err(e) => eprintln!("[config] parse error in {:?}: {e}", path),
        }
    } else {
        let _ = fs::create_dir_all(config_dir());
        let default = AppConfig::default();
        if let Ok(json) = serde_json::to_string_pretty(&default) {
            let _ = fs::write(&path, json);
        }
    }
    AppConfig::default()
}

/// Persist config (used by the in-app settings menu).
pub fn save(cfg: &AppConfig) -> Result<(), String> {
    fs::create_dir_all(config_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(config_file(), json).map_err(|e| e.to_string())
}
