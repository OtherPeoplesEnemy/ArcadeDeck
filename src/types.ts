export interface Game {
  id: string;
  title: string;
  system: string;
  provider: "steam" | "mame" | "emulator";
  exec: string | null;
  args: string[];
  steamAppId: string | null;
  art: string | null;
}

export type Action =
  | "left"
  | "right"
  | "up"
  | "down"
  | "select"
  | "back"
  | "start";

export type Mode = "loading" | "wheel" | "playing" | "attract";
