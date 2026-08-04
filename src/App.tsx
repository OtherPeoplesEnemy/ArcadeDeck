import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import Wheel from "./components/Wheel";
import AttractMode from "./components/AttractMode";
import SettingsMenu, { SettingsHandle } from "./components/SettingsMenu";
import { useInput, BackHoldPhase } from "./hooks/useInput";
import { sounds } from "./sounds";
import type { Action, AppConfig, Game, Mode } from "./types";

const FALLBACK_CONFIG: AppConfig = {
  steam: { enabled: true },
  mame: null,
  fbneo: null,
  retroarch: null,
  apps: [],
  systems: [],
  attract_after_secs: 45,
  ui: { tile_scale: 1.0, background: "grid", background_image: null },
  hidden_games: [],
  sounds: {
    enabled: true,
    music: [],
    music_volume: 0.5,
    sfx_volume: 0.7,
    sfx_move: null,
    sfx_launch: null,
    sfx_back: null,
  },
  attract: { videos: [], video_volume: 0.5 },
  sgdb_api_key: null,
};

interface CtxMenu {
  game: Game;
  x: number;
  y: number;
}

export default function App() {
  const [games, setGames] = useState<Game[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>("loading");
  const [config, setConfig] = useState<AppConfig>(FALLBACK_CONFIG);
  const [configPath, setConfigPath] = useState("");
  const [exitWarn, setExitWarn] = useState(false);
  const [exitArmed, setExitArmed] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const visibleRef = useRef<Game[]>([]);
  const lastInputRef = useRef(Date.now());
  const settingsRef = useRef<SettingsHandle>(null);
  const exitArmTimer = useRef<number | null>(null);

  const [systemIdx, setSystemIdx] = useState(0);
  const selMemRef = useRef<Record<string, number>>({});

  const shown = useMemo(() => games.filter((g) => !g.hidden), [games]);

  // Category tabs, derived from whatever the scan found. "All" only exists
  // when there's more than one system.
  const categories = useMemo(() => {
    const sys = Array.from(new Set(shown.map((g) => g.system))).sort();
    return sys.length > 1 ? ["All", ...sys] : sys;
  }, [shown]);

  const category = categories[Math.min(systemIdx, Math.max(0, categories.length - 1))] ?? "All";

  const visible = useMemo(
    () =>
      category === "All" ? shown : shown.filter((g) => g.system === category),
    [shown, category]
  );

  visibleRef.current = visible;

  // Remember the wheel position per system.
  useEffect(() => {
    selMemRef.current[category] = selected;
  }, [selected, category]);

  const switchSystem = useCallback(
    (dir: number) => {
      if (categories.length < 2) return;
      sounds.playMove();
      setSystemIdx((i) => {
        const next = (i + dir + categories.length) % categories.length;
        const cat = categories[next];
        const list =
          cat === "All" ? shown : shown.filter((g) => g.system === cat);
        setSelected(
          Math.min(selMemRef.current[cat] ?? 0, Math.max(0, list.length - 1))
        );
        return next;
      });
    },
    [categories, shown]
  );

  const jumpToSystem = useCallback(
    (idx: number) => {
      if (idx === systemIdx) return;
      sounds.playMove();
      const cat = categories[idx];
      const list = cat === "All" ? shown : shown.filter((g) => g.system === cat);
      setSelected(
        Math.min(selMemRef.current[cat] ?? 0, Math.max(0, list.length - 1))
      );
      setSystemIdx(idx);
    },
    [categories, shown, systemIdx]
  );

  const rescan = useCallback(() => {
    return invoke<Game[]>("scan_games")
      .then((g) => {
        setGames(g);
        const vis = g.filter((x) => !x.hidden).length;
        setSelected((s) => Math.min(s, Math.max(0, vis - 1)));
        setSystemIdx(0);
      })
      .catch((e) => console.error("scan failed", e));
  }, []);

  // Initial load
  useEffect(() => {
    Promise.all([
      invoke<AppConfig>("get_full_config").catch(() => FALLBACK_CONFIG),
      invoke<string>("get_config_path").catch(() => ""),
    ]).then(([cfg, path]) => {
      setConfig(cfg);
      setConfigPath(path);
    });
    rescan().finally(() => setMode("wheel"));
  }, [rescan]);

  // Return to the wheel when a launched game exits.
  useEffect(() => {
    const p = listen("game-exited", async () => {
      setMode("wheel");
      setExitWarn(false);
      lastInputRef.current = Date.now();
      try {
        const win = getCurrentWindow();
        await win.setFocus();
        await win.setFullscreen(true);
      } catch {
        /* focus steal can fail harmlessly */
      }
    });
    return () => {
      p.then((un) => un());
    };
  }, []);

  // Idle -> attract mode (never from settings or while playing)
  useEffect(() => {
    const t = window.setInterval(() => {
      if (
        modeRef.current === "wheel" &&
        Date.now() - lastInputRef.current > config.attract_after_secs * 1000
      ) {
        setCtxMenu(null);
        setMode("attract");
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [config.attract_after_secs]);

  // Audio engine follows config…
  useEffect(() => {
    sounds.configure(config.sounds);
  }, [config.sounds]);

  // …and music follows mode: on for wheel/settings, on in attract only if
  // it's the art slideshow (videos bring their own audio), off in-game.
  useEffect(() => {
    sounds.setMusicActive(
      mode === "wheel" ||
        mode === "settings" ||
        (mode === "attract" && config.attract.videos.length === 0)
    );
  }, [mode, config.attract.videos.length]);

  // Real DOM gestures unlock audio if the autoplay policy blocked it.
  useEffect(() => {
    const unlock = () => sounds.unlock();
    window.addEventListener("keydown", unlock);
    window.addEventListener("mousedown", unlock);
    return () => {
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("mousedown", unlock);
    };
  }, []);

  // Mouse: cursor auto-hide, activity counts as input, click wakes attract.
  useEffect(() => {
    let hideTimer: number;
    const scheduleHide = () => {
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(
        () => document.body.classList.add("cursor-hidden"),
        3000
      );
    };
    const wake = () => {
      document.body.classList.remove("cursor-hidden");
      lastInputRef.current = Date.now();
      if (modeRef.current === "attract") setMode("wheel");
      scheduleHide();
    };
    window.addEventListener("mousemove", wake);
    window.addEventListener("mousedown", wake);
    scheduleHide();
    return () => {
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("mousedown", wake);
      window.clearTimeout(hideTimer);
    };
  }, []);

  const launch = useCallback((game: Game) => {
    setCtxMenu(null);
    sounds.playLaunch();
    setMode("playing");
    invoke("launch_game", { game }).catch((e) => {
      console.error("launch failed", e);
      setMode("wheel");
    });
  }, []);

  const fetchArt = useCallback(
    async (key: string | null) => {
      const res = await invoke<{ fetched: number; failed: number }>(
        "fetch_missing_art",
        { apiKey: key }
      );
      await rescan();
      return res;
    },
    [rescan]
  );

  const saveSettings = useCallback(
    (cfg: AppConfig) => {
      invoke("save_config", { cfg })
        .then(() => {
          setConfig(cfg);
          setMode("loading");
          return rescan();
        })
        .then(() => setMode("wheel"))
        .catch((e) => {
          console.error("save failed", e);
          setMode("wheel");
        });
    },
    [rescan]
  );

  const hideGame = useCallback(
    (game: Game) => {
      setCtxMenu(null);
      const cfg: AppConfig = {
        ...config,
        hidden_games: [...config.hidden_games, game.id],
      };
      invoke("save_config", { cfg })
        .then(() => {
          setConfig(cfg);
          return rescan();
        })
        .catch((e) => console.error("hide failed", e));
    },
    [config, rescan]
  );

  const setCustomArt = useCallback(
    async (game: Game) => {
      setCtxMenu(null);
      try {
        const file = await openFileDialog({
          multiple: false,
          filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
        });
        if (typeof file === "string") {
          await invoke("set_custom_art", { gameId: game.id, source: file });
          await rescan();
        }
      } catch (e) {
        console.error("set art failed", e);
      }
    },
    [rescan]
  );

  const removeCustomArt = useCallback(
    (game: Game) => {
      setCtxMenu(null);
      invoke("remove_custom_art", { gameId: game.id })
        .then(() => rescan())
        .catch((e) => console.error("remove art failed", e));
    },
    [rescan]
  );

  const onAction = useCallback(
    (action: Action) => {
      lastInputRef.current = Date.now();
      const m = modeRef.current;

      if (m === "playing" || m === "loading") return;

      if (m === "attract") {
        setMode("wheel");
        return;
      }

      if (m === "settings") {
        if (action === "up" || action === "down") sounds.playMove();
        else if (action === "back") sounds.playBack();
        settingsRef.current?.handleAction(action);
        return;
      }

      setCtxMenu(null);

      if (action === "start") {
        setMode("settings");
        return;
      }

      const g = visibleRef.current;
      switch (action) {
        case "left":
          if (g.length > 0) {
            sounds.playMove();
            setSelected((s) => (s - 1 + g.length) % g.length);
          }
          break;
        case "right":
          if (g.length > 0) {
            sounds.playMove();
            setSelected((s) => (s + 1) % g.length);
          }
          break;
        case "up":
          switchSystem(-1);
          break;
        case "down":
          switchSystem(1);
          break;
        case "select":
          if (g.length > 0) {
            setSelected((s) => {
              launch(g[Math.min(s, g.length - 1)]);
              return s;
            });
          }
          break;
        default:
          break;
      }
    },
    [launch, switchSystem]
  );

  const onBackHold = useCallback((phase: BackHoldPhase) => {
    lastInputRef.current = Date.now();
    const m = modeRef.current;
    if (phase === "warn") {
      // From the wheel/attract this is the app-exit gesture; from the
      // NOW PLAYING screen it's the escape hatch back to the menu.
      if (m === "wheel" || m === "attract" || m === "playing") {
        setExitWarn(true);
      }
    } else if (phase === "cancel") {
      setExitWarn(false);
    } else if (phase === "quit") {
      setExitWarn(false);
      if (m === "playing") {
        setMode("wheel");
      } else if (m === "wheel" || m === "attract") {
        invoke("quit_app").catch(() => {});
      }
    }
  }, []);

  useInput({ onAction, onBackHold });

  const onTileClick = useCallback(
    (offset: number) => {
      lastInputRef.current = Date.now();
      if (offset === 0) {
        if (visible[selected]) launch(visible[selected]);
      } else {
        sounds.playMove();
        setSelected((s) => (s + offset + visible.length * 10) % visible.length);
      }
    },
    [visible, selected, launch]
  );

  const onTileContext = useCallback((game: Game, x: number, y: number) => {
    lastInputRef.current = Date.now();
    setCtxMenu({ game, x, y });
  }, []);

  const clickExit = useCallback(() => {
    if (exitArmed) {
      invoke("quit_app").catch(() => {});
      return;
    }
    setExitArmed(true);
    if (exitArmTimer.current !== null) window.clearTimeout(exitArmTimer.current);
    exitArmTimer.current = window.setTimeout(() => setExitArmed(false), 3000);
  }, [exitArmed]);

  // Attract fully covers the background now, so pause the grid there too —
  // and always while a game runs.
  const gridPaused = mode === "playing" || mode === "attract";

  return (
    <div className="app">
      {config.ui.background === "grid" && (
        <div
          className={`grid-bg ${gridPaused ? "grid-bg--paused" : ""}`}
          aria-hidden="true"
        >
          <div className="grid-bg__sun" />
          <div className="grid-bg__ceiling" />
          <div className="grid-bg__floor" />
          <div className="grid-bg__horizon" />
        </div>
      )}
      {config.ui.background === "image" && config.ui.background_image && (
        <div className="bg-image" aria-hidden="true">
          <img
            src={convertFileSrc(config.ui.background_image)}
            alt=""
            draggable={false}
          />
        </div>
      )}
      <div className="crt" aria-hidden="true" />

      {mode === "loading" && <div className="boot">SCANNING LIBRARIES…</div>}

      {mode === "wheel" && categories.length > 1 && (
        <nav className="systems">
          {categories.map((c, i) => (
            <button
              key={c}
              className={`systems__tab ${i === systemIdx ? "systems__tab--active" : ""}`}
              onClick={() => jumpToSystem(i)}
            >
              {c}
            </button>
          ))}
        </nav>
      )}

      {mode === "wheel" && visible.length > 0 && (
        <Wheel
          games={visible}
          selected={selected}
          tileScale={config.ui.tile_scale}
          onTileClick={onTileClick}
          onTileContext={onTileContext}
        />
      )}

      {mode === "wheel" && visible.length === 0 && (
        <div className="boot">
          <p>{shown.length === 0 ? "NO GAMES FOUND" : "NOTHING IN THIS CATEGORY"}</p>
          <p className="boot__hint">
            {shown.length === 0
              ? "Press START (or click SETTINGS below) to add your systems."
              : "▲ ▼ to switch systems."}
          </p>
        </div>
      )}

      {mode === "playing" && (
        <div className="playing">
          <div className="playing__label">NOW PLAYING</div>
          <div className="playing__title">{visible[selected]?.title}</div>
          <div className="playing__hint">
            Didn't launch? Hold Ⓑ / Esc for 3s, or
          </div>
          <button
            className="playing__escape"
            onClick={() => {
              setExitWarn(false);
              setMode("wheel");
            }}
          >
            BACK TO MENU
          </button>
        </div>
      )}

      {mode === "attract" && <AttractMode games={visible} attract={config.attract} />}

      {ctxMenu && mode === "wheel" && (
        <>
          <div className="ctx-backdrop" onClick={() => setCtxMenu(null)} />
          <div
            className="ctx-menu"
            style={{
              left: Math.min(ctxMenu.x, window.innerWidth - 260),
              top: Math.min(ctxMenu.y, window.innerHeight - 190),
            }}
          >
            <div className="ctx-menu__title">{ctxMenu.game.title}</div>
            <button onClick={() => setCustomArt(ctxMenu.game)}>
              Set custom image…
            </button>
            <button onClick={() => removeCustomArt(ctxMenu.game)}>
              Remove custom image
            </button>
            <button
              className="ctx-menu__danger"
              onClick={() => hideGame(ctxMenu.game)}
            >
              Hide game
            </button>
            <button onClick={() => setCtxMenu(null)}>Cancel</button>
          </div>
        </>
      )}

      {exitWarn && (
        <div className="exit-warn">
          <div className="exit-warn__box">
            <div className="exit-warn__label">
              {mode === "playing"
                ? "KEEP HOLDING TO RETURN TO MENU"
                : "KEEP HOLDING TO EXIT"}
            </div>
            <div className="exit-warn__bar">
              <div className="exit-warn__fill" />
            </div>
          </div>
        </div>
      )}

      {mode === "settings" && (
        <SettingsMenu
          ref={settingsRef}
          config={config}
          configPath={configPath}
          games={games}
          onSave={saveSettings}
          onCancel={() => setMode("wheel")}
          onQuit={() => invoke("quit_app").catch(() => {})}
          onFetchArt={fetchArt}
        />
      )}

      {mode === "wheel" && (
        <footer className="controls">
          <span>◀ ▶ BROWSE</span>
          <span>▲ ▼ SYSTEM</span>
          <span>Ⓐ LAUNCH</span>
          <button className="controls__btn" onClick={() => setMode("settings")}>
            START · 1 SETTINGS
          </button>
          <button
            className={`controls__btn ${exitArmed ? "controls__btn--armed" : ""}`}
            onClick={clickExit}
          >
            {exitArmed ? "CLICK AGAIN TO EXIT" : "HOLD Ⓑ · ESC EXIT"}
          </button>
        </footer>
      )}
    </div>
  );
}
