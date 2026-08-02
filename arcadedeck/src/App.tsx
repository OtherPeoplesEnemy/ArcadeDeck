import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Wheel from "./components/Wheel";
import AttractMode from "./components/AttractMode";
import SettingsMenu, { SettingsHandle } from "./components/SettingsMenu";
import { useInput } from "./hooks/useInput";
import type { Action, AppConfig, Game, Mode } from "./types";

const FALLBACK_CONFIG: AppConfig = {
  steam: { enabled: true },
  mame: null,
  systems: [],
  attract_after_secs: 45,
  ui: { tile_scale: 1.0 },
};

export default function App() {
  const [games, setGames] = useState<Game[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>("loading");
  const [config, setConfig] = useState<AppConfig>(FALLBACK_CONFIG);
  const [configPath, setConfigPath] = useState("");

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const lastInputRef = useRef(Date.now());
  const settingsRef = useRef<SettingsHandle>(null);

  const rescan = useCallback(() => {
    return invoke<Game[]>("scan_games")
      .then((g) => {
        setGames(g);
        setSelected((s) => Math.min(s, Math.max(0, g.length - 1)));
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
        setMode("attract");
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [config.attract_after_secs]);

  const launch = useCallback((game: Game) => {
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

  const onAction = useCallback(
    (action: Action) => {
      lastInputRef.current = Date.now();
      const m = modeRef.current;

      if (m === "playing" || m === "loading") return;

      if (m === "attract") {
        // First input only wakes the cabinet.
        setMode("wheel");
        return;
      }

      if (m === "settings") {
        settingsRef.current?.handleAction(action);
        return;
      }

      if (action === "start") {
        setMode("settings");
        return;
      }

      setGames((g) => {
        if (g.length === 0) return g;
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
        return g;
      });
    },
    [launch]
  );

  useInput(onAction);

  return (
    <div className="app">
      <div className="crt" aria-hidden="true" />

      {mode === "loading" && <div className="boot">SCANNING LIBRARIES…</div>}

      {mode === "wheel" && games.length > 0 && (
        <Wheel games={games} selected={selected} tileScale={config.ui.tile_scale} />
      )}

      {mode === "wheel" && games.length === 0 && (
        <div className="boot">
          <p>NO GAMES FOUND</p>
          <p className="boot__hint">
            Press START to open settings and add your systems.
          </p>
        </div>
      )}

      {mode === "playing" && (
        <div className="playing">
          <div className="playing__label">NOW PLAYING</div>
          <div className="playing__title">{games[selected]?.title}</div>
        </div>
      )}

      {mode === "attract" && <AttractMode games={games} />}

      {mode === "settings" && (
        <SettingsMenu
          ref={settingsRef}
          config={config}
          configPath={configPath}
          onSave={saveSettings}
          onCancel={() => setMode("wheel")}
        />
      )}

      {mode === "wheel" && (
        <footer className="controls">
          <span>◀ ▶ BROWSE</span>
          <span>▲ ▼ SKIP ×10</span>
          <span>Ⓐ LAUNCH</span>
          <span>START SETTINGS</span>
        </footer>
      )}
    </div>
  );
}
