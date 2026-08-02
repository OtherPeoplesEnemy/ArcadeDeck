import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Game } from "../types";

const CYCLE_MS = 5000;

interface Props {
  games: Game[];
}

/**
 * Idle screensaver: slow-pans through game art like a cabinet demo loop.
 * Transform/opacity only, so it stays smooth on WebKitGTK too.
 */
export default function AttractMode({ games }: Props) {
  const withArt = games.filter((g) => g.art);
  const pool = withArt.length > 0 ? withArt : games;
  const [index, setIndex] = useState(() =>
    pool.length ? Math.floor(Math.random() * pool.length) : 0
  );

  useEffect(() => {
    if (pool.length < 2) return;
    const t = window.setInterval(
      () => setIndex((i) => (i + 1) % pool.length),
      CYCLE_MS
    );
    return () => window.clearInterval(t);
  }, [pool.length]);

  if (pool.length === 0) {
    return (
      <div className="attract">
        <div className="attract__logo">ARCADE&#8203;DECK</div>
        <div className="attract__prompt">PRESS ANY BUTTON</div>
      </div>
    );
  }

  const game = pool[index];

  return (
    <div className="attract">
      {game.art && (
        // Key forces a remount so the zoom animation restarts per game.
        <img
          key={game.id}
          className="attract__art"
          src={convertFileSrc(game.art)}
          alt=""
          draggable={false}
        />
      )}
      <div className="attract__scrim" />
      <div className="attract__logo">ARCADE&#8203;DECK</div>
      <div key={`t-${game.id}`} className="attract__title">
        {game.title}
      </div>
      <div className="attract__prompt">PRESS ANY BUTTON</div>
    </div>
  );
}
