import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type {
  Action,
  AppConfig,
  MameConfig,
  SystemConfig,
} from "../types";
import { emptyPlatformPath } from "../types";

export interface SettingsHandle {
  handleAction: (action: Action) => void;
}

interface Props {
  config: AppConfig;
  configPath: string;
  onSave: (cfg: AppConfig) => void;
  onCancel: () => void;
  onQuit: () => void;
}

type View =
  | { kind: "menu" }
  | { kind: "mame" }
  | { kind: "system"; editIndex: number | null };

interface Row {
  id: string;
  label: string;
  value?: string;
  hint?: string;
  danger?: boolean;
}

/* ---------- form state helpers ---------- */

interface FormState {
  name: string;
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
  name: "MAME",
  args: "",
  execWin: m?.executable.windows ?? "",
  execLinux: m?.executable.linux ?? "",
  romWin: m?.rom_path.windows ?? "",
  romLinux: m?.rom_path.linux ?? "",
  artWin: m?.art_path.windows ?? "",
  artLinux: m?.art_path.linux ?? "",
});

const orNull = (s: string) => (s.trim() ? s.trim() : null);

/* ---------- component ---------- */

const SettingsMenu = forwardRef<SettingsHandle, Props>(function SettingsMenu(
  { config, configPath, onSave, onCancel, onQuit },
  ref
) {
  const [draft, setDraft] = useState<AppConfig>(() =>
    JSON.parse(JSON.stringify(config))
  );
  const [view, setView] = useState<View>({ kind: "menu" });
  const [cursor, setCursor] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);

  /* ----- menu rows ----- */

  const menuRows: Row[] = [
    {
      id: "steam",
      label: "Steam library",
      value: draft.steam.enabled ? "ON" : "OFF",
      hint: "◀ ▶ toggle",
    },
    {
      id: "attract",
      label: "Attract mode after",
      value: `${draft.attract_after_secs}s`,
      hint: "◀ ▶ adjust",
    },
    {
      id: "tiles",
      label: "Tile size",
      value: `${Math.round(draft.ui.tile_scale * 100)}%`,
      hint: "◀ ▶ adjust",
    },
    {
      id: "mame",
      label: "MAME",
      value: draft.mame ? "configured" : "not set up",
    },
    ...draft.systems.map((s, i) => ({
      id: `sys-${i}`,
      label: `System: ${s.name}`,
      value: confirmRemove === i ? "press Ⓐ again to remove" : "edit / ◀ remove",
      danger: confirmRemove === i,
    })),
    { id: "add", label: "+ Add emulator system" },
    { id: "rescan", label: "Save & rescan library" },
    { id: "cancel", label: "Cancel (discard changes)" },
    { id: "quit", label: "Exit ArcadeDeck", danger: true },
  ];

  /* ----- form rows ----- */

  const formFields: { key: keyof FormState; label: string; ph?: string }[] =
    view.kind === "mame"
      ? [
          { key: "execWin", label: "MAME exe (Windows)", ph: "C:\\mame\\mame.exe" },
          { key: "execLinux", label: "MAME binary (Linux)", ph: "/usr/bin/mame" },
          { key: "romWin", label: "ROM folder (Windows)", ph: "D:\\roms\\arcade" },
          { key: "romLinux", label: "ROM folder (Linux)" },
          { key: "artWin", label: "Art folder (Windows)" },
          { key: "artLinux", label: "Art folder (Linux)" },
        ]
      : [
          { key: "name", label: "System name", ph: "SNES" },
          { key: "execWin", label: "Emulator (Windows)", ph: "C:\\RetroArch\\retroarch.exe" },
          { key: "execLinux", label: "Emulator (Linux)", ph: "/usr/bin/retroarch" },
          { key: "args", label: "Arguments ({rom} = ROM path)", ph: "-L snes9x_libretro {rom} -f" },
          { key: "romWin", label: "ROM folder (Windows)" },
          { key: "romLinux", label: "ROM folder (Linux)" },
          { key: "extensions", label: "Extensions (comma separated)", ph: ".sfc, .smc" },
          { key: "artWin", label: "Art folder (Windows)" },
          { key: "artLinux", label: "Art folder (Linux)" },
        ];

  const formButtonCount = 2; // Save, Back
  const formRowCount = formFields.length + formButtonCount;

  /* ----- actions ----- */

  const commitForm = () => {
    if (view.kind === "mame") {
      const mame: MameConfig = {
        executable: { windows: orNull(form.execWin), linux: orNull(form.execLinux) },
        rom_path: { windows: orNull(form.romWin), linux: orNull(form.romLinux) },
        art_path: { windows: orNull(form.artWin), linux: orNull(form.artLinux) },
        extra_args: draft.mame?.extra_args ?? [],
      };
      setDraft((d) => ({ ...d, mame }));
    } else if (view.kind === "system") {
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
        if (view.editIndex === null) systems.push(sys);
        else systems[view.editIndex] = sys;
        return { ...d, systems };
      });
    }
    setView({ kind: "menu" });
    setCursor(0);
  };

  const activateMenuRow = (row: Row) => {
    if (row.id === "mame") {
      setForm(formFromMame(draft.mame));
      setView({ kind: "mame" });
      setCursor(0);
    } else if (row.id === "add") {
      setForm(blankForm());
      setView({ kind: "system", editIndex: null });
      setCursor(0);
    } else if (row.id.startsWith("sys-")) {
      const i = Number(row.id.slice(4));
      if (confirmRemove === i) {
        setDraft((d) => ({ ...d, systems: d.systems.filter((_, j) => j !== i) }));
        setConfirmRemove(null);
        setCursor((c) => Math.max(0, c - 1));
      } else {
        setForm(formFromSystem(draft.systems[i]));
        setView({ kind: "system", editIndex: i });
        setCursor(0);
      }
    } else if (row.id === "rescan") {
      onSave(draft);
    } else if (row.id === "cancel") {
      onCancel();
    } else if (row.id === "quit") {
      onQuit();
    }
  };

  const adjustMenuRow = (row: Row, dir: -1 | 1) => {
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
          tile_scale: Math.min(1.4, Math.max(0.7, +(d.ui.tile_scale + dir * 0.1).toFixed(1))),
        },
      }));
    } else if (row.id.startsWith("sys-") && dir === -1) {
      setConfirmRemove(Number(row.id.slice(4)));
    }
  };

  useImperativeHandle(ref, () => ({
    handleAction(action: Action) {
      if (view.kind === "menu") {
        setConfirmRemove((c) => (action === "select" ? c : null));
        if (action === "up") setCursor((c) => (c - 1 + menuRows.length) % menuRows.length);
        else if (action === "down") setCursor((c) => (c + 1) % menuRows.length);
        else if (action === "left") adjustMenuRow(menuRows[cursor], -1);
        else if (action === "right") adjustMenuRow(menuRows[cursor], 1);
        else if (action === "select") activateMenuRow(menuRows[cursor]);
        else if (action === "back" || action === "start") onCancel();
      } else {
        // form view
        if (action === "up") setCursor((c) => (c - 1 + formRowCount) % formRowCount);
        else if (action === "down") setCursor((c) => (c + 1) % formRowCount);
        else if (action === "select") {
          if (cursor === formFields.length) commitForm();
          else if (cursor === formFields.length + 1) {
            setView({ kind: "menu" });
            setCursor(0);
          } else {
            // Enter on a field: move to the next row (typing flow)
            setCursor((c) => c + 1);
          }
        } else if (action === "back") {
          setView({ kind: "menu" });
          setCursor(0);
        }
      }
    },
  }));

  /* ----- focus the active text field ----- */
  if (view.kind !== "menu") {
    // Runs during render; safe because it's idempotent focus management.
    queueMicrotask(() => {
      if (cursor < formFields.length) fieldRefs.current[cursor]?.focus();
      else (document.activeElement as HTMLElement | null)?.blur();
    });
  }

  /* ----- render ----- */

  if (view.kind === "menu") {
    return (
      <div className="settings">
        <div className="settings__panel">
          <div className="settings__header">SETTINGS</div>
          <ul className="settings__list">
            {menuRows.map((row, i) => (
              <li
                key={row.id}
                className={`settings__row ${i === cursor ? "settings__row--active" : ""} ${
                  row.danger ? "settings__row--danger" : ""
                }`}
              >
                <span>{row.label}</span>
                <span className="settings__value">
                  {row.value}
                  {i === cursor && row.hint ? (
                    <em className="settings__hint"> {row.hint}</em>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <div className="settings__footer">config: {configPath}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings">
      <div className="settings__panel">
        <div className="settings__header">
          {view.kind === "mame"
            ? "MAME SETUP"
            : view.editIndex === null
              ? "ADD SYSTEM"
              : "EDIT SYSTEM"}
        </div>
        <div className="settings__note">
          Keyboard required for text entry. Leave a platform's paths blank if unused.
        </div>
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
          >
            <span>Save {view.kind === "mame" ? "MAME setup" : "system"}</span>
          </li>
          <li
            className={`settings__row ${
              cursor === formFields.length + 1 ? "settings__row--active" : ""
            }`}
          >
            <span>Back</span>
          </li>
        </ul>
      </div>
    </div>
  );
});

export default SettingsMenu;
