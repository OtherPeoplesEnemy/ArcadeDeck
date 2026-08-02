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
| Stick or D-pad ▲ ▼ | Arrow keys | Switch system category |
| South button (A / ✕) | Enter, Z, Space | Launch |
| East button (B / ○), tap | Esc or X, tap | Back |
| East button, **hold 3s** | Esc or X, **hold 3s** | Exit ArcadeDeck |
| Start, Select, or Guide | 1, 2, or F1 | Open settings |

"Start" means whatever your encoder reports as the gamepad Start button (☰ on Xbox pads, Options on PlayStation). Because cheap encoders disagree about this, the Select and Guide buttons open settings too, and keyboard `1`, `2`, and `F1` all work. Exiting shows a hold-to-confirm bar so it can't happen by accident; there's also an Exit entry at the bottom of the settings menu.

## System categories

When more than one system is present, a tab strip appears along the top: **All**, plus every system the scan found (Steam, Arcade, and each configured emulator system by name). Up/down on the stick cycles categories; clicking a tab jumps straight to it. Each category remembers its wheel position, and the categories rebuild automatically on every rescan.

## Mouse support

The cursor appears when the mouse moves and hides after 3 seconds idle. Everything is clickable: side tiles select, the center tile launches, footer items open settings or exit (exit takes two clicks), and the whole settings menu works by mouse — including ◀ ▶ arrows on adjustable values.

**Right-click any game tile** for the per-game menu:

- **Set custom image…** — pick a png/jpg; it's copied to the override folder (`config dir/art/`) and wins over Steam or scraped art from then on
- **Remove custom image** — reverts to whatever the provider found
- **Hide game** — removes it from the wheel immediately

Hidden games can be brought back in **Settings → Manage game list**, which shows everything (including hidden entries, dimmed) and toggles by click or Ⓐ. Hiding never touches files — it only filters the wheel.

## Artwork fetching

**Settings → Fetch missing artwork** downloads box art for every game that has none:

- **Steam games** — pulled from Steam's own CDN by app id, no signup needed. Fixes games whose art Steam hadn't cached locally.
- **MAME and emulator games** — searched by title on [SteamGridDB](https://www.steamgriddb.com). This needs a free API key (steamgriddb.com → Profile → Preferences → API), entered once via **Settings → SteamGridDB API key**.

Downloads go to `config dir/art-cache/` and survive rescans. Priority per game: your custom image (right-click → Set custom image) always wins, then art the scanners found, then downloaded art. Name search can occasionally match the wrong game for obscure ROMs — a custom image overrides any bad match.

## Sound & attract media

All in settings:

- **Sound** master toggle, plus separate music / SFX / attract-video volumes
- **Add music tracks** — pick audio files (mp3/ogg/wav/flac/m4a); they shuffle and loop as background music on the wheel and in settings, pausing automatically while a game runs
- **Move / Launch / Back sounds** — built-in synth blips by default (no files needed); press Ⓐ or click to pick a custom file, ◀ to reset to built-in
- **Add attract videos** — pick video files; attract mode plays them in sequence and loops. With videos configured the art slideshow is replaced and background music pauses during attract (videos bring their own audio). Clear the list to go back to the slideshow.

Media paths are absolute and per-machine — set them up on the cabinet itself. On Linux, video playback depends on WebKitGTK's GStreamer codecs: `.webm` (VP9) plays everywhere, while `.mp4`/H.264 needs `gstreamer1.0-libav` installed.

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
