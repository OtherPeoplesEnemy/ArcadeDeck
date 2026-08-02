import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { AttractConfig, Game } from "../types";

const CYCLE_MS = 5000;

interface Props {
  games: Game[];
  attract: AttractConfig;
}

/**
 * Idle screensaver. With configured videos: plays them in sequence, looping.
 * Without: slow-pans through game art like a cabinet demo loop.
 */
export default function AttractMode({ games, attract }: Props) {
  const hasVideos = attract.videos.length > 0;

  if (hasVideos) return <VideoAttract attract={attract} />;
  return <ArtAttract games={games} />;
}

function VideoAttract({ attract }: { attract: AttractConfig }) {
  const [index, setIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (el) {
      el.volume = Math.min(1, Math.max(0, attract.video_volume));
      el.play().catch(() => {
        /* codec/autoplay issue — onError advances */
      });
    }
  }, [index, attract.video_volume]);

  const next = () => setIndex((i) => (i + 1) % attract.videos.length);

  return (
    <div className="attract">
      <video
        key={attract.videos[index]}
        ref={videoRef}
        className="attract__video"
        src={convertFileSrc(attract.videos[index])}
        autoPlay
        loop={attract.videos.length === 1}
        onEnded={next}
        onError={attract.videos.length > 1 ? next : undefined}
      />
      <div className="attract__prompt attract__prompt--video">
        PRESS ANY BUTTON
      </div>
    </div>
  );
}

function ArtAttract({ games }: { games: Game[] }) {
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
