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
}

export interface AppConfig {
  steam: SteamConfig;
  mame: MameConfig | null;
  systems: SystemConfig[];
  attract_after_secs: number;
  ui: UiConfig;
  hidden_games: string[];
}

export const emptyPlatformPath = (): PlatformPath => ({
  windows: null,
  linux: null,
});
