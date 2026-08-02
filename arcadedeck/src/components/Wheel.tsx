import { convertFileSrc } from "@tauri-apps/api/core";
import type { Game } from "../types";

const VISIBLE_EACH_SIDE = 4;
const BASE_SPACING = 240;

interface Props {
  games: Game[];
  selected: number;
  tileScale: number;
}

/** Deterministic hue per game so art-less tiles still look intentional. */
function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

function Tile({
  game,
  offset,
  spacing,
}: {
  game: Game;
  offset: number;
  spacing: number;
}) {
  const abs = Math.abs(offset);
  const style: React.CSSProperties = {
    transform: `translateX(${offset * spacing}px) translateZ(${-abs * 120}px) scale(${
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

export default function Wheel({ games, selected, tileScale }: Props) {
  if (games.length === 0) return null;
  const current = games[selected];
  const spacing = BASE_SPACING * tileScale;

  // Render a window of tiles around the selection, KEYED BY GAME ID so DOM
  // nodes (and decoded images) persist across selection changes and slide
  // into place instead of remounting. If the library is smaller than the
  // window, shrink the window so no game appears twice (duplicate keys).
  const eachSide = Math.min(
    VISIBLE_EACH_SIDE + 1,
    Math.floor((games.length - 1) / 2)
  );
  const window_: { game: Game; offset: number }[] = [];
  for (let off = -eachSide; off <= eachSide; off++) {
    const idx = (selected + off + games.length * 1000) % games.length;
    window_.push({ game: games[idx], offset: off });
  }

  return (
    <div
      className="wheel"
      style={{ ["--tile-scale" as string]: tileScale }}
    >
      <div className="wheel__track">
        {window_.map(({ game, offset }) => (
          <Tile key={game.id} game={game} offset={offset} spacing={spacing} />
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
