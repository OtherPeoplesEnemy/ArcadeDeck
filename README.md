# ArcadeDeck

Arcade cabinet frontend for Windows and Linux. One fullscreen wheel for Steam games, MAME, and any configured emulator, driven entirely by joystick or keyboard-encoder input, with an attract mode that kicks in when the cabinet sits idle.

Built with Tauri v2 + React. Joystick input is read in Rust via `gilrs` (XInput/DirectInput on Windows, evdev on Linux), so it works identically on both platforms regardless of webview gamepad support. Keyboard encoders (I-PAC style) work out of the box as key events.

## How it works

- **Steam** — auto-discovered. Parses `libraryfolders.vdf` and every `appmanifest_*.acf`, launches via `steam://rungameid/`, watches Steam's `RunningAppID` to detect game exit, and pulls box art from Steam's local `librarycache`. Zero configuration.
- **MAME** — point the config at your MAME executable and ROM folder. Titles are resolved by running `mame -listfull` once and caching the shortname→title map, so `sf2.zip` shows up as *Street Fighter II*. Art is matched by shortname in the configured art folder (Progetto Snaps packs line up automatically).
- **Everything else** — config-driven systems. Each entry defines an emulator, an args template (`{rom}` is replaced with the full ROM path), a ROM folder, extensions, and an optional art folder matched by filename.

All three feed one normalized game list; the UI doesn't care where a game came from.

## Config

Config lives at:

- Windows: `%APPDATA%\arcadedeck\config.json`
- Linux: `~/.config/arcadedeck/config.json`

A default file is created on first run (Steam enabled, nothing else). See `config/config.example.json` for a full example with MAME and a RetroArch SNES system. Note that `args` is an **array**, not a string — this avoids quoting problems with paths containing spaces.

To force a MAME title-cache refresh, delete `mame_titles.json` next to the config file.

## Controls

| Gamepad / arcade stick | Keyboard | Action |
|---|---|---|
| Stick or D-pad ◀ ▶ | Arrow keys | Browse the wheel |
| Stick or D-pad ▲ ▼ | Arrow keys | Skip ×10 |
| South button (A / ✕) | Enter, Z, Space | Launch |
| East button (B / ○), tap | Esc or X, tap | Back |
| East button, **hold 3s** | Esc or X, **hold 3s** | Exit ArcadeDeck |
| Start, Select, or Guide | 1, 2, or F1 | Open settings |

"Start" means whatever your encoder reports as the gamepad Start button (☰ on Xbox pads, Options on PlayStation). Because cheap encoders disagree about this, the Select and Guide buttons open settings too, and keyboard `1`, `2`, and `F1` all work. Exiting shows a hold-to-confirm bar so it can't happen by accident; there's also an Exit entry at the bottom of the settings menu.

## Settings menu

Press **Start** (or `1`) on the wheel to open settings — fully joystick-navigable:

- Toggle the Steam library on/off
- Adjust the attract-mode idle delay and wheel tile size
- Set up MAME (executable, ROM folder, art folder)
- Add, edit, or remove emulator systems — hold left then press Ⓐ to confirm a removal
- **Save & rescan library** writes the config and re-scans immediately

Text entry in the MAME/system forms needs a keyboard plugged in (normal for cabinet setup); day-to-day navigation is joystick-only. Everything saves to the same `config.json`, so you can still hand-edit it.

Held directions repeat with acceleration. Any input wakes the cabinet from attract mode.

## Building

### GitHub Actions (recommended)

Push to `main` and the workflow builds Windows (`.msi`, NSIS `.exe`) and Linux (`.deb`, `.rpm`, `.AppImage`) bundles as downloadable artifacts on every run. Push a tag like `v0.1.0` and it also publishes a GitHub Release with all bundles attached.

### Local

Prereqs: Node 20+, Rust stable, and on Linux:

```
sudo apt-get install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libudev-dev
```

Then:

```
npm install
npm run tauri dev     # development
npm run tauri build   # production bundles
```

## Cabinet setup notes

- The window opens fullscreen with no decorations and hides the cursor.
- **Windows kiosk**: drop a shortcut to ArcadeDeck in `shell:startup`, or replace the shell for a dedicated account.
- **Linux kiosk**: the cleanest setup is [cage](https://github.com/cage-kiosk/cage) — boot straight into `cage arcadedeck` with no desktop environment at all.
- When a launched game exits, ArcadeDeck retakes focus and fullscreen automatically. Steam games are detected via `RunningAppID` polling (registry on Windows, `~/.steam/registry.vdf` on Linux), with a 90-second timeout if a launch never starts.

## Project layout

```
src/                    React frontend (wheel, attract mode, input hook)
src-tauri/src/
  input.rs              gilrs joystick polling → arcade-input events
  launcher.rs           process spawn + exit watching, Steam URL launch
  config.rs             config load with per-platform paths
  providers/
    steam.rs            VDF/ACF discovery + librarycache art
    mame.rs             -listfull title cache + ROM scan
    generic.rs          config-driven emulator systems
```

## Roadmap ideas

- Video snaps in attract mode
- Per-system wheel filtering (up/down switches system instead of skip ×10)
- SteamGridDB integration for missing art
- Sound effects on wheel movement
- Favorites / most-played sorting
