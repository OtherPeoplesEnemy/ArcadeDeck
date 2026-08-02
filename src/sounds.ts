import { convertFileSrc } from "@tauri-apps/api/core";
import type { SoundsConfig } from "./types";

const DEFAULT_CFG: SoundsConfig = {
  enabled: true,
  music: [],
  music_volume: 0.5,
  sfx_volume: 0.7,
  sfx_move: null,
  sfx_launch: null,
  sfx_back: null,
};

/**
 * All cabinet audio. SFX are synthesized with WebAudio by default (zero
 * assets, instant playback) and can be overridden with user files. Music is
 * a shuffled playlist that follows the app mode: on for the wheel/settings,
 * paused while a game runs or attract videos play.
 */
class SoundEngine {
  private cfg: SoundsConfig = DEFAULT_CFG;
  private ctx: AudioContext | null = null;
  private music: HTMLAudioElement | null = null;
  private playlist: string[] = [];
  private trackIdx = 0;
  private musicWanted = false;

  configure(cfg: SoundsConfig) {
    const musicChanged =
      JSON.stringify(cfg.music) !== JSON.stringify(this.cfg.music);
    this.cfg = cfg;

    if (this.music) this.music.volume = cfg.music_volume;

    if (musicChanged || (!this.music && cfg.music.length > 0)) {
      this.stopMusic();
      this.playlist = shuffle(cfg.music);
      this.trackIdx = 0;
      if (this.playlist.length > 0) this.buildMusicElement();
    }
    if (!cfg.enabled || cfg.music.length === 0) this.stopMusic();
    this.syncMusic();
  }

  /** Call from any real DOM gesture — resumes audio if autoplay blocked it. */
  unlock() {
    if (this.ctx?.state === "suspended") this.ctx.resume().catch(() => {});
    if (this.musicWanted && this.music?.paused) {
      this.music.play().catch(() => {});
    }
  }

  /* ---------- SFX ---------- */

  playMove() {
    if (!this.cfg.enabled) return;
    if (this.cfg.sfx_move) return this.playFile(this.cfg.sfx_move);
    this.blip([{ f: 880, t: 0 }, { f: 660, t: 0.04 }], 0.05, "square", 0.5);
  }

  playLaunch() {
    if (!this.cfg.enabled) return;
    if (this.cfg.sfx_launch) return this.playFile(this.cfg.sfx_launch);
    this.blip(
      [{ f: 440, t: 0 }, { f: 660, t: 0.06 }, { f: 880, t: 0.12 }],
      0.2,
      "square",
      0.7
    );
  }

  playBack() {
    if (!this.cfg.enabled) return;
    if (this.cfg.sfx_back) return this.playFile(this.cfg.sfx_back);
    this.blip([{ f: 440, t: 0 }, { f: 330, t: 0.05 }], 0.07, "square", 0.5);
  }

  private blip(
    points: { f: number; t: number }[],
    dur: number,
    type: OscillatorType,
    gainScale: number
  ) {
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      for (const p of points) osc.frequency.setValueAtTime(p.f, now + p.t);
      const v = this.cfg.sfx_volume * gainScale * 0.3;
      gain.gain.setValueAtTime(v, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    } catch {
      /* audio unavailable — stay silent */
    }
  }

  private playFile(path: string) {
    try {
      const a = new Audio(convertFileSrc(path));
      a.volume = Math.min(1, this.cfg.sfx_volume);
      a.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }

  /* ---------- music ---------- */

  /** Music should be audible right now (wheel/settings, not in-game). */
  setMusicActive(active: boolean) {
    this.musicWanted = active;
    this.syncMusic();
  }

  private syncMusic() {
    if (!this.music) return;
    const shouldPlay =
      this.musicWanted && this.cfg.enabled && this.playlist.length > 0;
    if (shouldPlay && this.music.paused) {
      this.music.play().catch(() => {
        /* autoplay blocked — unlock() retries on next gesture */
      });
    } else if (!shouldPlay && !this.music.paused) {
      this.music.pause();
    }
  }

  private buildMusicElement() {
    const el = new Audio(convertFileSrc(this.playlist[this.trackIdx]));
    el.volume = this.cfg.music_volume;
    el.onended = () => this.nextTrack();
    el.onerror = () => this.nextTrack(); // skip unreadable tracks
    this.music = el;
  }

  private nextTrack() {
    if (this.playlist.length === 0) return;
    this.trackIdx = (this.trackIdx + 1) % this.playlist.length;
    if (this.trackIdx === 0) this.playlist = shuffle(this.playlist);
    this.buildMusicElement();
    this.syncMusic();
  }

  private stopMusic() {
    if (this.music) {
      this.music.pause();
      this.music.onended = null;
      this.music.onerror = null;
      this.music = null;
    }
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const sounds = new SoundEngine();
