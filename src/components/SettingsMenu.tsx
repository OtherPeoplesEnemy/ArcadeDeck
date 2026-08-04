import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import type {
  Action,
  AppConfig,
  AppEntry,
  Game,
  MameConfig,
  RetroArchConfig,
  RetroSystem,
  SystemConfig,
} from "../types";

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const stepVol = (v: number, dir: -1 | 1) =>
  Math.min(1, Math.max(0, +(v + dir * 0.1).toFixed(1)));
const orNull = (s: string) => (s.trim() ? s.trim() : null);

/** Curated RetroArch presets: pick one and only the ROM folder is left. */
const RETRO_PRESETS = [
  { name: "NES", core: "mesen", ext: ".nes" },
  { name: "SNES", core: "snes9x", ext: ".sfc, .smc" },
  { name: "Genesis / Mega Drive", core: "genesis_plus_gx", ext: ".md, .gen, .bin" },
  { name: "Game Boy / Color", core: "gambatte", ext: ".gb, .gbc" },
  { name: "Game Boy Advance", core: "mgba", ext: ".gba" },
  { name: "Nintendo 64", core: "mupen64plus_next", ext: ".n64, .z64, .v64" },
  { name: "PlayStation", core: "swanstation", ext: ".cue, .chd, .pbp" },
  { name: "PC Engine", core: "mednafen_pce_fast", ext: ".pce, .chd" },
  { name: "Master System", core: "genesis_plus_gx", ext: ".sms" },
  { name: "Atari 2600", core: "stella", ext: ".a26" },
  { name: "Dreamcast", core: "flycast", ext: ".chd, .gdi" },
  { name: "Custom core…", core: "", ext: "" },
];

export interface SettingsHandle {
  handleAction: (action: Action) => void;
}

interface Props {
  config: AppConfig;
  configPath: string;
  games: Game[];
  onSave: (cfg: AppConfig) => void;
  onCancel: () => void;
  onQuit: () => void;
  onFetchArt: (key: string | null) => Promise<{ fetched: number; failed: number }>;
}

type View =
  | { kind: "menu" }
  | { kind: "mame" }
  | { kind: "fbneo" }
  | { kind: "retroarch" }
  | { kind: "retro-preset" }
  | { kind: "retro-system"; editIndex: number | null }
  | { kind: "app"; editIndex: number | null }
  | { kind: "system"; editIndex: number | null }
  | { kind: "games" }
  | { kind: "sgdb" };

interface Row {
  id: string;
  label: string;
  value?: string;
  adjustable?: boolean;
  danger?: boolean;
}

interface FormState {
  name: string;
  core: string;
  category: string;
  execWin: string;
  execLinux: string;
  args: string;
  romWin: string;
  romLinux: string;
  extensions: string;
  artWin: string;
  artLinux: string;
}

const blankForm = (): FormState => ({
  name: "",
  core: "",
  category: "",
  execWin: "",
  execLinux: "",
  args: "{rom}",
  romWin: "",
  romLinux: "",
  extensions: "",
  artWin: "",
  artLinux: "",
});

const formFromSystem = (s: SystemConfig): FormState => ({
  ...blankForm(),
  name: s.name,
  execWin: s.emulator.windows ?? "",
  execLinux: s.emulator.linux ?? "",
  args: s.args.join(" "),
  romWin: s.rom_path.windows ?? "",
  romLinux: s.rom_path.linux ?? "",
  extensions: s.extensions.join(", "),
  artWin: s.art_path.windows ?? "",
  artLinux: s.art_path.linux ?? "",
});

const formFromMame = (m: MameConfig | null): FormState => ({
  ...blankForm(),
  args: "",
  execWin: m?.executable.windows ?? "",
  execLinux: m?.executable.linux ?? "",
  romWin: m?.rom_path.windows ?? "",
  romLinux: m?.rom_path.linux ?? "",
  artWin: m?.art_path.windows ?? "",
  artLinux: m?.art_path.linux ?? "",
});

const formFromRetroArch = (r: RetroArchConfig | null): FormState => ({
  ...blankForm(),
  execWin: r?.executable.windows ?? "",
  execLinux: r?.executable.linux ?? "",
  // rom fields double as the optional cores-folder fields in this view
  romWin: r?.cores_path.windows ?? "",
  romLinux: r?.cores_path.linux ?? "",
});

const formFromApp = (a: AppEntry): FormState => ({
  ...blankForm(),
  name: a.name,
  category: a.category ?? "",
  execWin: a.executable.windows ?? "",
  execLinux: a.executable.linux ?? "",
  args: a.args.join(" "),
});

const formFromRetroSystem = (s: RetroSystem): FormState => ({
  ...blankForm(),
  name: s.name,
  core: s.core,
  romWin: s.rom_path.windows ?? "",
  romLinux: s.rom_path.linux ?? "",
  extensions: s.extensions.join(", "),
  artWin: s.art_path.windows ?? "",
  artLinux: s.art_path.linux ?? "",
});

const SettingsMenu = forwardRef<SettingsHandle, Props>(function SettingsMenu(
  { config, configPath, games, onSave, onCancel, onQuit, onFetchArt },
  ref
) {
  const [draft, setDraft] = useState<AppConfig>(() =>
    JSON.parse(JSON.stringify(config))
  );
  const [view, setView] = useState<View>({ kind: "menu" });
  const [cursor, setCursor] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [sgdbKey, setSgdbKey] = useState("");
  const [fetchStatus, setFetchStatus] = useState("");
  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const sgdbInputRef = useRef<HTMLInputElement | null>(null);

  const retroSystems = draft.retroarch?.systems ?? [];

  /* ---------------- menu rows ---------------- */

  const menuRows: Row[] = [
    {
      id: "steam",
      label: "Steam library",
      value: draft.steam.enabled ? "ON" : "OFF",
      adjustable: true,
    },
    {
      id: "attract",
      label: "Attract mode after",
      value: `${draft.attract_after_secs}s`,
      adjustable: true,
    },
    {
      id: "tiles",
      label: "Tile size",
      value: `${Math.round(draft.ui.tile_scale * 100)}%`,
      adjustable: true,
    },
    {
      id: "bg",
      label: "Background",
      value:
        draft.ui.background === "grid"
          ? "Tron grid"
          : draft.ui.background === "image"
            ? "Custom image"
            : "Off",
      adjustable: true,
    },
    ...(draft.ui.background === "image"
      ? [
          {
            id: "bg-image",
            label: "Background image",
            value: draft.ui.background_image
              ? basename(draft.ui.background_image)
              : "not set — press Ⓐ",
          },
        ]
      : []),
    {
      id: "sounds",
      label: "Sound",
      value: draft.sounds.enabled ? "ON" : "OFF",
      adjustable: true,
    },
    {
      id: "mvol",
      label: "Music volume",
      value: pct(draft.sounds.music_volume),
      adjustable: true,
    },
    {
      id: "svol",
      label: "SFX volume",
      value: pct(draft.sounds.sfx_volume),
      adjustable: true,
    },
    {
      id: "music-add",
      label: "+ Add music tracks",
      value: `${draft.sounds.music.length} loaded`,
    },
    ...(draft.sounds.music.length > 0
      ? [{ id: "music-clear", label: "Clear music tracks" }]
      : []),
    {
      id: "sfx-move",
      label: "Move sound",
      value: draft.sounds.sfx_move ? basename(draft.sounds.sfx_move) : "built-in",
      adjustable: true,
    },
    {
      id: "sfx-launch",
      label: "Launch sound",
      value: draft.sounds.sfx_launch
        ? basename(draft.sounds.sfx_launch)
        : "built-in",
      adjustable: true,
    },
    {
      id: "sfx-back",
      label: "Back sound",
      value: draft.sounds.sfx_back ? basename(draft.sounds.sfx_back) : "built-in",
      adjustable: true,
    },
    {
      id: "videos-add",
      label: "+ Add attract videos",
      value: `${draft.attract.videos.length} loaded`,
    },
    ...(draft.attract.videos.length > 0
      ? [
          { id: "videos-clear", label: "Clear attract videos" },
          {
            id: "vvol",
            label: "Attract video volume",
            value: pct(draft.attract.video_volume),
            adjustable: true,
          },
        ]
      : []),
    {
      id: "fetch-art",
      label: "Fetch missing artwork",
      value:
        fetchStatus ||
        (draft.sgdb_api_key ? "Steam CDN + SteamGridDB" : "Steam CDN only"),
    },
    {
      id: "sgdb-key",
      label: "SteamGridDB API key",
      value: draft.sgdb_api_key ? "set" : "not set",
    },
    {
      id: "mame",
      label: "MAME",
      value: draft.mame ? "configured" : "not set up",
    },
    {
      id: "fbneo",
      label: "FinalBurn Neo",
      value: draft.fbneo ? "configured" : "not set up",
    },
    {
      id: "retroarch",
      label: "RetroArch",
      value: draft.retroarch?.executable.windows || draft.retroarch?.executable.linux
        ? "configured"
        : "not set up",
    },
    ...retroSystems.map((s, i) => ({
      id: `retro-${i}`,
      label: `RetroArch: ${s.name}`,
      value:
        confirmRemove === `retro-${i}`
          ? "press Ⓐ / click again to remove"
          : "edit · ◀ remove",
      danger: confirmRemove === `retro-${i}`,
    })),
    { id: "retro-add", label: "+ Add RetroArch system" },
    ...draft.apps.map((a, i) => ({
      id: `app-${i}`,
      label: `App: ${a.name}`,
      value:
        confirmRemove === `app-${i}`
          ? "press Ⓐ / click again to remove"
          : "edit · ◀ remove",
      danger: confirmRemove === `app-${i}`,
    })),
    { id: "app-add", label: "+ Add app shortcut (Fightcade, Kodi…)" },
    ...draft.systems.map((s, i) => ({
      id: `sys-${i}`,
      label: `System: ${s.name}`,
      value:
        confirmRemove === `sys-${i}`
          ? "press Ⓐ / click again to remove"
          : "edit · ◀ remove",
      danger: confirmRemove === `sys-${i}`,
    })),
    { id: "add", label: "+ Add emulator system (custom)" },
    {
      id: "games",
      label: "Manage game list",
      value: `${draft.hidden_games.length} hidden`,
    },
    { id: "rescan", label: "Save & rescan library" },
    { id: "cancel", label: "Cancel (discard changes)" },
    { id: "quit", label: "Exit ArcadeDeck", danger: true },
  ];

  /* ---------------- form field sets ---------------- */

  const formFields: { key: keyof FormState; label: string; ph?: string }[] =
    view.kind === "mame" || view.kind === "fbneo"
      ? [
          {
            key: "execWin",
            label: view.kind === "mame" ? "MAME exe (Windows)" : "FBNeo exe (Windows)",
            ph: view.kind === "mame" ? "C:\\mame\\mame.exe" : "C:\\fbneo\\fbneo64.exe",
          },
          {
            key: "execLinux",
            label: view.kind === "mame" ? "MAME binary (Linux)" : "FBNeo binary (Linux)",
            ph: view.kind === "mame" ? "/usr/bin/mame" : "/usr/bin/fbneo",
          },
          { key: "romWin", label: "ROM folder (Windows)", ph: "D:\\roms\\arcade" },
          { key: "romLinux", label: "ROM folder (Linux)" },
          { key: "artWin", label: "Art folder (Windows)" },
          { key: "artLinux", label: "Art folder (Linux)" },
        ]
      : view.kind === "retroarch"
        ? [
            {
              key: "execWin",
              label: "RetroArch exe (Windows)",
              ph: "C:\\RetroArch-Win64\\retroarch.exe",
            },
            {
              key: "execLinux",
              label: "RetroArch binary (Linux)",
              ph: "/usr/bin/retroarch",
            },
            {
              key: "romWin",
              label: "Cores folder (Windows) — optional",
              ph: "auto: <exe folder>\\cores",
            },
            {
              key: "romLinux",
              label: "Cores folder (Linux) — optional",
              ph: "auto: ~/.config/retroarch/cores",
            },
          ]
        : view.kind === "retro-system"
          ? [
              { key: "name", label: "System name", ph: "SNES" },
              {
                key: "core",
                label: "Core (without _libretro suffix)",
                ph: "snes9x",
              },
              { key: "romWin", label: "ROM folder (Windows)" },
              { key: "romLinux", label: "ROM folder (Linux)" },
              { key: "extensions", label: "Extensions (comma separated)", ph: ".sfc, .smc" },
              { key: "artWin", label: "Art folder (Windows)" },
              { key: "artLinux", label: "Art folder (Linux)" },
            ]
          : view.kind === "app"
            ? [
                { key: "name", label: "App name", ph: "Fightcade" },
                {
                  key: "execWin",
                  label: "Executable (Windows)",
                  ph: "C:\\Fightcade\\Fightcade2.exe",
                },
                {
                  key: "execLinux",
                  label: "Executable (Linux)",
                  ph: "/home/payman/Fightcade/Fightcade2.sh",
                },
                { key: "args", label: "Arguments (optional)" },
                { key: "category", label: "Wheel category (optional)", ph: "Apps" },
              ]
            : [
              { key: "name", label: "System name", ph: "Dolphin" },
              { key: "execWin", label: "Emulator (Windows)", ph: "C:\\Dolphin\\Dolphin.exe" },
              { key: "execLinux", label: "Emulator (Linux)", ph: "/usr/bin/dolphin-emu" },
              {
                key: "args",
                label: "Arguments ({rom} = ROM path)",
                ph: "-b -e {rom}",
              },
              { key: "romWin", label: "ROM folder (Windows)" },
              { key: "romLinux", label: "ROM folder (Linux)" },
              { key: "extensions", label: "Extensions (comma separated)", ph: ".iso, .rvz" },
              { key: "artWin", label: "Art folder (Windows)" },
              { key: "artLinux", label: "Art folder (Linux)" },
            ];

  const formRowCount = formFields.length + 2; // + Save, Back
  const gamesRowCount = games.length + 1; // + Back
  const presetRowCount = RETRO_PRESETS.length + 1; // + Back

  /* ---------------- actions ---------------- */

  const toggleHidden = (game: Game) => {
    setDraft((d) => {
      const hidden = d.hidden_games.includes(game.id)
        ? d.hidden_games.filter((id) => id !== game.id)
        : [...d.hidden_games, game.id];
      return { ...d, hidden_games: hidden };
    });
  };

  const ensureRetroArch = (d: AppConfig): RetroArchConfig =>
    d.retroarch ?? {
      executable: { windows: null, linux: null },
      cores_path: { windows: null, linux: null },
      systems: [],
    };

  const commitForm = () => {
    if (view.kind === "mame" || view.kind === "fbneo") {
      const which = view.kind;
      const entry: MameConfig = {
        executable: { windows: orNull(form.execWin), linux: orNull(form.execLinux) },
        rom_path: { windows: orNull(form.romWin), linux: orNull(form.romLinux) },
        art_path: { windows: orNull(form.artWin), linux: orNull(form.artLinux) },
        extra_args: (which === "mame" ? draft.mame : draft.fbneo)?.extra_args ?? [],
      };
      setDraft((d) =>
        which === "mame" ? { ...d, mame: entry } : { ...d, fbneo: entry }
      );
    } else if (view.kind === "retroarch") {
      setDraft((d) => {
        const ra = ensureRetroArch(d);
        return {
          ...d,
          retroarch: {
            ...ra,
            executable: {
              windows: orNull(form.execWin),
              linux: orNull(form.execLinux),
            },
            cores_path: {
              windows: orNull(form.romWin),
              linux: orNull(form.romLinux),
            },
          },
        };
      });
    } else if (view.kind === "retro-system") {
      const editIndex = view.editIndex;
      const sys: RetroSystem = {
        name: form.name.trim() || "Custom",
        core: form.core.trim(),
        rom_path: { windows: orNull(form.romWin), linux: orNull(form.romLinux) },
        extensions: form.extensions
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean),
        art_path: { windows: orNull(form.artWin), linux: orNull(form.artLinux) },
      };
      setDraft((d) => {
        const ra = ensureRetroArch(d);
        const systems = [...ra.systems];
        if (editIndex === null) systems.push(sys);
        else systems[editIndex] = sys;
        return { ...d, retroarch: { ...ra, systems } };
      });
    } else if (view.kind === "app") {
      const editIndex = view.editIndex;
      const entry: AppEntry = {
        name: form.name.trim() || "App",
        executable: {
          windows: orNull(form.execWin),
          linux: orNull(form.execLinux),
        },
        args: form.args.trim() === "{rom}" ? [] : form.args.trim().split(/\s+/).filter(Boolean),
        category: orNull(form.category),
      };
      setDraft((d) => {
        const apps = [...d.apps];
        if (editIndex === null) apps.push(entry);
        else apps[editIndex] = entry;
        return { ...d, apps };
      });
    } else if (view.kind === "system") {
      const editIndex = view.editIndex;
      const sys: SystemConfig = {
        name: form.name.trim() || "Custom",
        emulator: { windows: orNull(form.execWin), linux: orNull(form.execLinux) },
        args: form.args.trim().split(/\s+/).filter(Boolean),
        rom_path: { windows: orNull(form.romWin), linux: orNull(form.romLinux) },
        extensions: form.extensions
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean),
        art_path: { windows: orNull(form.artWin), linux: orNull(form.artLinux) },
      };
      setDraft((d) => {
        const systems = [...d.systems];
        if (editIndex === null) systems.push(sys);
        else systems[editIndex] = sys;
        return { ...d, systems };
      });
    }
    setView({ kind: "menu" });
    setCursor(0);
  };

  const pickMusic = async () => {
    const files = await openFileDialog({
      multiple: true,
      filters: [
        { name: "Audio", extensions: ["mp3", "ogg", "wav", "flac", "m4a"] },
      ],
    }).catch(() => null);
    const list = Array.isArray(files) ? files : typeof files === "string" ? [files] : [];
    if (list.length === 0) return;
    setDraft((d) => ({
      ...d,
      sounds: {
        ...d.sounds,
        music: Array.from(new Set([...d.sounds.music, ...list])),
      },
    }));
  };

  const pickVideos = async () => {
    const files = await openFileDialog({
      multiple: true,
      filters: [{ name: "Video", extensions: ["mp4", "webm", "mov", "mkv"] }],
    }).catch(() => null);
    const list = Array.isArray(files) ? files : typeof files === "string" ? [files] : [];
    if (list.length === 0) return;
    setDraft((d) => ({
      ...d,
      attract: {
        ...d.attract,
        videos: Array.from(new Set([...d.attract.videos, ...list])),
      },
    }));
  };

  const pickSfx = async (key: "sfx_move" | "sfx_launch" | "sfx_back") => {
    const file = await openFileDialog({
      multiple: false,
      filters: [{ name: "Audio", extensions: ["mp3", "ogg", "wav"] }],
    }).catch(() => null);
    if (typeof file !== "string") return;
    setDraft((d) => ({ ...d, sounds: { ...d.sounds, [key]: file } }));
  };

  const activateMenuRow = (row: Row) => {
    if (row.id === "bg-image") {
      void (async () => {
        const file = await openFileDialog({
          multiple: false,
          filters: [
            { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] },
          ],
        }).catch(() => null);
        if (typeof file === "string") {
          setDraft((d) => ({ ...d, ui: { ...d.ui, background_image: file } }));
        }
      })();
      return;
    }
    if (
      row.id === "bg" ||
      row.id === "steam" ||
      row.id === "attract" ||
      row.id === "tiles" ||
      row.id === "sounds" ||
      row.id === "mvol" ||
      row.id === "svol" ||
      row.id === "vvol"
    ) {
      adjustMenuRow(row, 1);
    } else if (row.id === "music-add") {
      void pickMusic();
    } else if (row.id === "music-clear") {
      setDraft((d) => ({ ...d, sounds: { ...d.sounds, music: [] } }));
    } else if (row.id === "videos-add") {
      void pickVideos();
    } else if (row.id === "videos-clear") {
      setDraft((d) => ({ ...d, attract: { ...d.attract, videos: [] } }));
    } else if (row.id === "sfx-move") {
      void pickSfx("sfx_move");
    } else if (row.id === "sfx-launch") {
      void pickSfx("sfx_launch");
    } else if (row.id === "sfx-back") {
      void pickSfx("sfx_back");
    } else if (row.id === "fetch-art") {
      if (fetchStatus === "fetching…") return;
      setFetchStatus("fetching…");
      onFetchArt(draft.sgdb_api_key)
        .then((r) =>
          setFetchStatus(`+${r.fetched} found · ${r.failed} missing`)
        )
        .catch(() => setFetchStatus("fetch failed"));
    } else if (row.id === "sgdb-key") {
      setSgdbKey(draft.sgdb_api_key ?? "");
      setView({ kind: "sgdb" });
      setCursor(0);
    } else if (row.id === "mame") {
      setForm({ ...formFromMame(draft.mame) });
      setView({ kind: "mame" });
      setCursor(0);
    } else if (row.id === "fbneo") {
      setForm({ ...formFromMame(draft.fbneo) });
      setView({ kind: "fbneo" });
      setCursor(0);
    } else if (row.id === "retroarch") {
      setForm(formFromRetroArch(draft.retroarch));
      setView({ kind: "retroarch" });
      setCursor(0);
    } else if (row.id === "retro-add") {
      setView({ kind: "retro-preset" });
      setCursor(0);
    } else if (row.id.startsWith("retro-")) {
      const i = Number(row.id.slice(6));
      if (confirmRemove === row.id) {
        setDraft((d) => {
          const ra = ensureRetroArch(d);
          return {
            ...d,
            retroarch: {
              ...ra,
              systems: ra.systems.filter((_, j) => j !== i),
            },
          };
        });
        setConfirmRemove(null);
        setCursor((c) => Math.max(0, c - 1));
      } else {
        setForm(formFromRetroSystem(retroSystems[i]));
        setView({ kind: "retro-system", editIndex: i });
        setCursor(0);
      }
    } else if (row.id === "app-add") {
      setForm(blankForm());
      setView({ kind: "app", editIndex: null });
      setCursor(0);
    } else if (row.id.startsWith("app-")) {
      const i = Number(row.id.slice(4));
      if (confirmRemove === row.id) {
        setDraft((d) => ({ ...d, apps: d.apps.filter((_, j) => j !== i) }));
        setConfirmRemove(null);
        setCursor((c) => Math.max(0, c - 1));
      } else {
        setForm(formFromApp(draft.apps[i]));
        setView({ kind: "app", editIndex: i });
        setCursor(0);
      }
    } else if (row.id.startsWith("sys-")) {
      const i = Number(row.id.slice(4));
      if (confirmRemove === row.id) {
        setDraft((d) => ({
          ...d,
          systems: d.systems.filter((_, j) => j !== i),
        }));
        setConfirmRemove(null);
        setCursor((c) => Math.max(0, c - 1));
      } else {
        setForm(formFromSystem(draft.systems[i]));
        setView({ kind: "system", editIndex: i });
        setCursor(0);
      }
    } else if (row.id === "add") {
      setForm(blankForm());
      setView({ kind: "system", editIndex: null });
      setCursor(0);
    } else if (row.id === "games") {
      setView({ kind: "games" });
      setCursor(0);
    } else if (row.id === "rescan") {
      onSave(draft);
    } else if (row.id === "cancel") {
      onCancel();
    } else if (row.id === "quit") {
      onQuit();
    }
  };

  const BG_MODES = ["grid", "image", "none"];

  const adjustMenuRow = (row: Row, dir: -1 | 1) => {
    if (row.id === "bg") {
      setDraft((d) => {
        const i = BG_MODES.indexOf(d.ui.background);
        const next =
          BG_MODES[(Math.max(0, i) + dir + BG_MODES.length) % BG_MODES.length];
        return { ...d, ui: { ...d.ui, background: next } };
      });
      return;
    }
    if (row.id === "sounds") {
      setDraft((d) => ({ ...d, sounds: { ...d.sounds, enabled: !d.sounds.enabled } }));
      return;
    }
    if (row.id === "mvol") {
      setDraft((d) => ({
        ...d,
        sounds: { ...d.sounds, music_volume: stepVol(d.sounds.music_volume, dir) },
      }));
      return;
    }
    if (row.id === "svol") {
      setDraft((d) => ({
        ...d,
        sounds: { ...d.sounds, sfx_volume: stepVol(d.sounds.sfx_volume, dir) },
      }));
      return;
    }
    if (row.id === "vvol") {
      setDraft((d) => ({
        ...d,
        attract: { ...d.attract, video_volume: stepVol(d.attract.video_volume, dir) },
      }));
      return;
    }
    if (row.id.startsWith("sfx-") && dir === -1) {
      const key = ("sfx_" + row.id.slice(4)) as "sfx_move" | "sfx_launch" | "sfx_back";
      setDraft((d) => ({ ...d, sounds: { ...d.sounds, [key]: null } }));
      return;
    }
    if (row.id === "steam") {
      setDraft((d) => ({ ...d, steam: { enabled: !d.steam.enabled } }));
    } else if (row.id === "attract") {
      setDraft((d) => ({
        ...d,
        attract_after_secs: Math.max(10, d.attract_after_secs + dir * 5),
      }));
    } else if (row.id === "tiles") {
      setDraft((d) => ({
        ...d,
        ui: {
          ...d.ui,
          tile_scale: Math.min(
            1.4,
            Math.max(0.7, +(d.ui.tile_scale + dir * 0.1).toFixed(1))
          ),
        },
      }));
    } else if (
      (row.id.startsWith("sys-") ||
        row.id.startsWith("retro-") ||
        row.id.startsWith("app-")) &&
      row.id !== "retro-add" &&
      row.id !== "app-add" &&
      dir === -1
    ) {
      setConfirmRemove(row.id);
    }
  };

  useImperativeHandle(ref, () => ({
    handleAction(action: Action) {
      if (view.kind === "menu") {
        if (action !== "select") setConfirmRemove(null);
        if (action === "up") setCursor((c) => (c - 1 + menuRows.length) % menuRows.length);
        else if (action === "down") setCursor((c) => (c + 1) % menuRows.length);
        else if (action === "left") adjustMenuRow(menuRows[cursor], -1);
        else if (action === "right") adjustMenuRow(menuRows[cursor], 1);
        else if (action === "select") activateMenuRow(menuRows[cursor]);
        else if (action === "back" || action === "start") onCancel();
      } else if (view.kind === "games") {
        if (action === "up") setCursor((c) => (c - 1 + gamesRowCount) % gamesRowCount);
        else if (action === "down") setCursor((c) => (c + 1) % gamesRowCount);
        else if (action === "select") {
          if (cursor === games.length) {
            setView({ kind: "menu" });
            setCursor(0);
          } else {
            toggleHidden(games[cursor]);
          }
        } else if (action === "back") {
          setView({ kind: "menu" });
          setCursor(0);
        }
      } else if (view.kind === "retro-preset") {
        if (action === "up") setCursor((c) => (c - 1 + presetRowCount) % presetRowCount);
        else if (action === "down") setCursor((c) => (c + 1) % presetRowCount);
        else if (action === "select") {
          if (cursor === RETRO_PRESETS.length) {
            setView({ kind: "menu" });
            setCursor(0);
          } else {
            applyPreset(cursor);
          }
        } else if (action === "back") {
          setView({ kind: "menu" });
          setCursor(0);
        }
      } else if (view.kind === "sgdb") {
        const rows = 3;
        if (action === "up") setCursor((c) => (c - 1 + rows) % rows);
        else if (action === "down") setCursor((c) => (c + 1) % rows);
        else if (action === "select") {
          if (cursor === 0) setCursor(1);
          else if (cursor === 1) {
            setDraft((d) => ({
              ...d,
              sgdb_api_key: sgdbKey.trim() ? sgdbKey.trim() : null,
            }));
            setView({ kind: "menu" });
            setCursor(0);
          } else {
            setView({ kind: "menu" });
            setCursor(0);
          }
        } else if (action === "back") {
          setView({ kind: "menu" });
          setCursor(0);
        }
      } else {
        // form views
        if (action === "up") setCursor((c) => (c - 1 + formRowCount) % formRowCount);
        else if (action === "down") setCursor((c) => (c + 1) % formRowCount);
        else if (action === "select") {
          if (cursor === formFields.length) commitForm();
          else if (cursor === formFields.length + 1) {
            setView({ kind: "menu" });
            setCursor(0);
          } else {
            setCursor((c) => c + 1);
          }
        } else if (action === "back") {
          setView({ kind: "menu" });
          setCursor(0);
        }
      }
    },
  }));

  const applyPreset = (i: number) => {
    const p = RETRO_PRESETS[i];
    setForm({
      ...blankForm(),
      name: p.core ? p.name : "",
      core: p.core,
      extensions: p.ext,
    });
    setView({ kind: "retro-system", editIndex: null });
    setCursor(0);
  };

  /* ---------------- focus / scroll ---------------- */

  useEffect(() => {
    const isForm =
      view.kind === "mame" ||
      view.kind === "fbneo" ||
      view.kind === "retroarch" ||
      view.kind === "retro-system" ||
      view.kind === "app" ||
      view.kind === "system";
    if (isForm) {
      if (cursor < formFields.length) fieldRefs.current[cursor]?.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
    } else if (view.kind === "sgdb") {
      if (cursor === 0) sgdbInputRef.current?.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
    } else {
      rowRefs.current[cursor]?.scrollIntoView({ block: "nearest" });
    }
  }, [view.kind, cursor, formFields.length]);

  /* ---------------- render ---------------- */

  const header = (title: string) => (
    <div className="settings__headrow">
      <div className="settings__header">{title}</div>
      <button
        className="settings__close"
        onClick={() =>
          view.kind === "menu"
            ? onCancel()
            : (setView({ kind: "menu" }), setCursor(0))
        }
      >
        ✕
      </button>
    </div>
  );

  if (view.kind === "menu") {
    return (
      <div className="settings">
        <div className="settings__panel">
          {header("SETTINGS")}
          <ul className="settings__list settings__list--scroll">
            {menuRows.map((row, i) => (
              <li
                key={row.id}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className={`settings__row ${i === cursor ? "settings__row--active" : ""} ${
                  row.danger ? "settings__row--danger" : ""
                }`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => activateMenuRow(row)}
              >
                <span>{row.label}</span>
                <span className="settings__value">
                  {row.adjustable && (
                    <button
                      className="settings__arrow"
                      onClick={(e) => {
                        e.stopPropagation();
                        adjustMenuRow(row, -1);
                      }}
                    >
                      {"◀"}
                    </button>
                  )}
                  {row.value}
                  {row.adjustable && (
                    <button
                      className="settings__arrow"
                      onClick={(e) => {
                        e.stopPropagation();
                        adjustMenuRow(row, 1);
                      }}
                    >
                      {"▶"}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="settings__footer">config: {configPath}</div>
        </div>
      </div>
    );
  }

  if (view.kind === "games") {
    return (
      <div className="settings">
        <div className="settings__panel">
          {header("MANAGE GAME LIST")}
          <div className="settings__note">
            Click or press Ⓐ to hide/unhide a game. Hidden games stay
            installed — they just leave the wheel.
          </div>
          <ul className="settings__list settings__list--scroll">
            {games.map((g, i) => {
              const hidden = draft.hidden_games.includes(g.id);
              return (
                <li
                  key={g.id}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  className={`settings__row ${i === cursor ? "settings__row--active" : ""} ${
                    hidden ? "settings__row--dim" : ""
                  }`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => toggleHidden(g)}
                >
                  <span>
                    {g.title}
                    <em className="settings__sys"> {g.system}</em>
                  </span>
                  <span className="settings__value">
                    {hidden ? "HIDDEN" : "shown"}
                  </span>
                </li>
              );
            })}
            <li
              ref={(el) => {
                rowRefs.current[games.length] = el;
              }}
              className={`settings__row ${cursor === games.length ? "settings__row--active" : ""}`}
              onMouseEnter={() => setCursor(games.length)}
              onClick={() => {
                setView({ kind: "menu" });
                setCursor(0);
              }}
            >
              <span>Back</span>
            </li>
          </ul>
        </div>
      </div>
    );
  }

  if (view.kind === "retro-preset") {
    return (
      <div className="settings">
        <div className="settings__panel">
          {header("ADD RETROARCH SYSTEM")}
          <div className="settings__note">
            Pick a system — the core and file extensions are prefilled,
            you just add the ROM folder. Cores must be installed in RetroArch
            (Online Updater → Core Downloader).
          </div>
          <ul className="settings__list settings__list--scroll">
            {RETRO_PRESETS.map((p, i) => (
              <li
                key={p.name}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className={`settings__row ${i === cursor ? "settings__row--active" : ""}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => applyPreset(i)}
              >
                <span>{p.name}</span>
                <span className="settings__value">{p.core || "—"}</span>
              </li>
            ))}
            <li
              ref={(el) => {
                rowRefs.current[RETRO_PRESETS.length] = el;
              }}
              className={`settings__row ${
                cursor === RETRO_PRESETS.length ? "settings__row--active" : ""
              }`}
              onMouseEnter={() => setCursor(RETRO_PRESETS.length)}
              onClick={() => {
                setView({ kind: "menu" });
                setCursor(0);
              }}
            >
              <span>Back</span>
            </li>
          </ul>
        </div>
      </div>
    );
  }

  if (view.kind === "sgdb") {
    return (
      <div className="settings">
        <div className="settings__panel">
          {header("STEAMGRIDDB")}
          <div className="settings__note">
            Free API key from steamgriddb.com → Profile → Preferences
            → API. Enables artwork search for MAME, FBNeo, and emulator
            games; Steam games work without it.
          </div>
          <ul className="settings__list">
            <li
              className={`settings__row settings__row--field ${
                cursor === 0 ? "settings__row--active" : ""
              }`}
            >
              <label>API key</label>
              <input
                ref={sgdbInputRef}
                value={sgdbKey}
                spellCheck={false}
                onChange={(e) => setSgdbKey(e.target.value)}
                onFocus={() => setCursor(0)}
              />
            </li>
            <li
              className={`settings__row ${cursor === 1 ? "settings__row--active" : ""}`}
              onMouseEnter={() => setCursor(1)}
              onClick={() => {
                setDraft((d) => ({
                  ...d,
                  sgdb_api_key: sgdbKey.trim() ? sgdbKey.trim() : null,
                }));
                setView({ kind: "menu" });
                setCursor(0);
              }}
            >
              <span>Save key</span>
            </li>
            <li
              className={`settings__row ${cursor === 2 ? "settings__row--active" : ""}`}
              onMouseEnter={() => setCursor(2)}
              onClick={() => {
                setView({ kind: "menu" });
                setCursor(0);
              }}
            >
              <span>Back</span>
            </li>
          </ul>
        </div>
      </div>
    );
  }

  const formTitle =
    view.kind === "mame"
      ? "MAME SETUP"
      : view.kind === "fbneo"
        ? "FINALBURN NEO SETUP"
        : view.kind === "retroarch"
          ? "RETROARCH SETUP"
          : view.kind === "retro-system"
            ? view.editIndex === null
              ? "ADD RETROARCH SYSTEM"
              : "EDIT RETROARCH SYSTEM"
            : view.kind === "app"
              ? view.editIndex === null
                ? "ADD APP SHORTCUT"
                : "EDIT APP SHORTCUT"
            : view.kind === "system" && view.editIndex === null
              ? "ADD SYSTEM"
              : "EDIT SYSTEM";

  const formNote =
    view.kind === "fbneo"
      ? "Also set the same ROM folder inside FBNeo itself (it loads ROMs via its own paths). Use FBNeo-compatible romsets."
      : view.kind === "retroarch"
        ? "Configure once; then add systems from presets. Cores folder is auto-detected if left blank."
        : view.kind === "app"
          ? "Any program as a wheel entry. Right-click its tile later to set an icon image."
          : "Type or paste paths. Leave a platform's paths blank if unused.";

  const saveLabel =
    view.kind === "mame"
      ? "MAME setup"
      : view.kind === "fbneo"
        ? "FBNeo setup"
        : view.kind === "retroarch"
          ? "RetroArch setup"
          : view.kind === "app"
            ? "app shortcut"
            : "system";

  return (
    <div className="settings">
      <div className="settings__panel">
        {header(formTitle)}
        <div className="settings__note">{formNote}</div>
        <ul className="settings__list">
          {formFields.map((f, i) => (
            <li
              key={f.key}
              className={`settings__row settings__row--field ${
                i === cursor ? "settings__row--active" : ""
              }`}
            >
              <label>{f.label}</label>
              <input
                ref={(el) => {
                  fieldRefs.current[i] = el;
                }}
                value={form[f.key]}
                placeholder={f.ph}
                spellCheck={false}
                onChange={(e) =>
                  setForm((s) => ({ ...s, [f.key]: e.target.value }))
                }
                onFocus={() => setCursor(i)}
              />
            </li>
          ))}
          <li
            className={`settings__row ${
              cursor === formFields.length ? "settings__row--active" : ""
            }`}
            onMouseEnter={() => setCursor(formFields.length)}
            onClick={commitForm}
          >
            <span>Save {saveLabel}</span>
          </li>
          <li
            className={`settings__row ${
              cursor === formFields.length + 1 ? "settings__row--active" : ""
            }`}
            onMouseEnter={() => setCursor(formFields.length + 1)}
            onClick={() => {
              setView({ kind: "menu" });
              setCursor(0);
            }}
          >
            <span>Back</span>
          </li>
        </ul>
      </div>
    </div>
  );
});

export default SettingsMenu;
