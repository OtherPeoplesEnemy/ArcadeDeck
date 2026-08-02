import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import Wheel from "./components/Wheel";
import AttractMode from "./components/AttractMode";
import SettingsMenu, { SettingsHandle } from "./components/SettingsMenu";
import { useInput, BackHoldPhase } from "./hooks/useInput";
import type { Action, AppConfig, Game, Mode } from "./types";

const FALLBACK_CONFIG: AppConfig = {
  steam: { enabled: true },
  mame: null,
  systems: [],
  attract_after_secs: 45,
  ui: { tile_scale: 1.0 },
  hidden_games: [],
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
  const lastInputRef = useRef(Date.now());
  const settingsRef = useRef<SettingsHandle>(null);
  const exitArmTimer = useRef<number | null>(null);

  const visible = useMemo(() => games.filter((g) => !g.hidden), [games]);

  const rescan = useCallback(() => {
    return invoke<Game[]>("scan_games")
      .then((g) => {
        setGames(g);
        const vis = g.filter((x) => !x.hidden).length;
        setSelected((s) => Math.min(s, Math.max(0, vis - 1)));
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
    setMode("playing");
    invoke("launch_game", { game }).catch((e) => {
      console.error("launch failed", e);
      setMode("wheel");
    });
  }, []);

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
        settingsRef.current?.handleAction(action);
        return;
      }

      setCtxMenu(null);

      if (action === "start") {
        setMode("settings");
        return;
      }

      setGames((all) => {
        const g = all.filter((x) => !x.hidden);
        if (g.length === 0) return all;
        switch (action) {
          case "left":
            setSelected((s) => (s - 1 + g.length) % g.length);
            break;
          case "right":
            setSelected((s) => (s + 1) % g.length);
            break;
          case "up":
            setSelected((s) => (s - 10 + g.length * 10) % g.length);
            break;
          case "down":
            setSelected((s) => (s + 10) % g.length);
            break;
          case "select":
            setSelected((s) => {
              launch(g[s]);
              return s;
            });
            break;
          default:
            break;
        }
        return all;
      });
    },
    [launch]
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

  return (
    <div className="app">
      <div className="crt" aria-hidden="true" />

      {mode === "loading" && <div className="boot">SCANNING LIBRARIES…</div>}

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
          <p>NO GAMES FOUND</p>
          <p className="boot__hint">
            Press START (or click SETTINGS below) to add your systems.
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

      {mode === "attract" && <AttractMode games={visible} />}

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
        />
      )}

      {mode === "wheel" && (
        <footer className="controls">
          <span>◀ ▶ BROWSE</span>
          <span>▲ ▼ SKIP ×10</span>
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
