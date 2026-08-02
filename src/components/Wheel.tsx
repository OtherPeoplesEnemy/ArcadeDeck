import { convertFileSrc } from "@tauri-apps/api/core";
import type { Game } from "../types";

const VISIBLE_EACH_SIDE = 4;

interface Props {
  games: Game[];
  selected: number;
}

/** Deterministic hue per game so art-less tiles still look intentional. */
function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

function Tile({ game, offset }: { game: Game; offset: number }) {
  const abs = Math.abs(offset);
  const style: React.CSSProperties = {
    transform: `translateX(${offset * 240}px) translateZ(${-abs * 120}px) scale(${
      1 - abs * 0.13
    })`,
    opacity: abs > VISIBLE_EACH_SIDE ? 0 : 1 - abs * 0.18,
    zIndex: 100 - abs,
  };
  return (
    <div className={`tile ${offset === 0 ? "tile--selected" : ""}`} style={style}>
      {game.art ? (
        <img className="tile__art" src={convertFileSrc(game.art)} alt="" draggable={false} />
      ) : (
        <div
          className="tile__fallback"
          style={{ ["--tile-hue" as string]: hueFor(game.id) }}
        >
          <span>{game.title}</span>
        </div>
      )}
    </div>
  );
}

export default function Wheel({ games, selected }: Props) {
  if (games.length === 0) return null;
  const current = games[selected];

  // Only render the window of tiles around the selection.
  const window_: { game: Game; offset: number }[] = [];
  for (let off = -VISIBLE_EACH_SIDE - 1; off <= VISIBLE_EACH_SIDE + 1; off++) {
    const idx = (selected + off + games.length * 1000) % games.length;
    window_.push({ game: games[idx], offset: off });
  }

  return (
    <div className="wheel">
      <div className="wheel__track">
        {window_.map(({ game, offset }) => (
          <Tile key={`${game.id}-${offset}`} game={game} offset={offset} />
        ))}
      </div>
      <div className="wheel__info">
        <div className="wheel__system">{current.system}</div>
        <h1 className="wheel__title">{current.title}</h1>
        <div className="wheel__count">
          {selected + 1} / {games.length}
        </div>
      </div>
    </div>
  );
}
