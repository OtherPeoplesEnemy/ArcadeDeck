import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Wheel from "./components/Wheel";
import AttractMode from "./components/AttractMode";
import { useInput } from "./hooks/useInput";
import type { Action, Game, Mode } from "./types";

export default function App() {
  const [games, setGames] = useState<Game[]>([]);
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<Mode>("loading");
  const [configPath, setConfigPath] = useState("");
  const [attractDelay, setAttractDelay] = useState(45);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const lastInputRef = useRef(Date.now());

  // Initial scan
  useEffect(() => {
    invoke<Game[]>("scan_games")
      .then((g) => {
        setGames(g);
        setMode("wheel");
      })
      .catch(() => setMode("wheel"));
    invoke<string>("get_config_path").then(setConfigPath).catch(() => {});
    invoke<number>("get_attract_delay").then(setAttractDelay).catch(() => {});
  }, []);

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

  // Idle -> attract mode
  useEffect(() => {
    const t = window.setInterval(() => {
      if (
        modeRef.current === "wheel" &&
        Date.now() - lastInputRef.current > attractDelay * 1000
      ) {
        setMode("attract");
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [attractDelay]);

  const launch = useCallback((game: Game) => {
    setMode("playing");
    invoke("launch_game", { game }).catch((e) => {
      console.error("launch failed", e);
      setMode("wheel");
    });
  }, []);

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
          case "start":
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
        <Wheel games={games} selected={selected} />
      )}

      {mode === "wheel" && games.length === 0 && (
        <div className="boot">
          <p>NO GAMES FOUND</p>
          <p className="boot__hint">
            Add systems in {configPath || "the config file"} and restart.
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

      {mode === "wheel" && (
        <footer className="controls">
          <span>◀ ▶ BROWSE</span>
          <span>▲ ▼ SKIP ×10</span>
          <span>Ⓐ LAUNCH</span>
        </footer>
      )}
    </div>
  );
}
