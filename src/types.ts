export interface Game {
  id: string;
  title: string;
  system: string;
  provider: "steam" | "mame" | "emulator";
  exec: string | null;
  args: string[];
  steamAppId: string | null;
  art: string | null;
  hidden: boolean;
}

export type Action =
  | "left"
  | "right"
  | "up"
  | "down"
  | "select"
  | "back"
  | "start";

export type Mode = "loading" | "wheel" | "playing" | "attract" | "settings";

/* ---- Config (field names match the Rust structs: snake_case) ---- */

export interface PlatformPath {
  windows: string | null;
  linux: string | null;
}

export interface SteamConfig {
  enabled: boolean;
}

export interface MameConfig {
  executable: PlatformPath;
  rom_path: PlatformPath;
  art_path: PlatformPath;
  extra_args: string[];
}

export interface SystemConfig {
  name: string;
  emulator: PlatformPath;
  args: string[];
  rom_path: PlatformPath;
  extensions: string[];
  art_path: PlatformPath;
}

export interface UiConfig {
  tile_scale: number;
  background: "grid" | "image" | "none" | string;
  background_image: string | null;
}

export interface SoundsConfig {
  enabled: boolean;
  music: string[];
  music_volume: number;
  sfx_volume: number;
  sfx_move: string | null;
  sfx_launch: string | null;
  sfx_back: string | null;
}

export interface AttractConfig {
  videos: string[];
  video_volume: number;
}

export interface AppConfig {
  steam: SteamConfig;
  mame: MameConfig | null;
  systems: SystemConfig[];
  attract_after_secs: number;
  ui: UiConfig;
  hidden_games: string[];
  sounds: SoundsConfig;
  attract: AttractConfig;
  sgdb_api_key: string | null;
}

export const emptyPlatformPath = (): PlatformPath => ({
  windows: null,
  linux: null,
});
