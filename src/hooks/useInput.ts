import { useEffect, useRef } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { Action } from "../types";

const INITIAL_REPEAT_MS = 320;
const FAST_REPEAT_MS = 85;

const KEY_MAP: Record<string, Action> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Enter: "select",
  " ": "select",
  z: "select",
  Z: "select",
  Escape: "back",
  x: "back",
  X: "back",
  "1": "start",
};

const REPEATABLE: Action[] = ["left", "right", "up", "down"];

interface RustInput {
  action: Action;
  state: "press" | "release";
}

/**
 * One input pipeline for the whole app.
 *
 * - Joysticks/gamepads arrive as `arcade-input` events from the Rust gilrs
 *   thread (works on Windows and Linux regardless of webview quirks).
 * - Keyboard encoders (I-PAC etc.) arrive as plain DOM key events.
 *
 * Held directions repeat with an initial delay, then accelerate — without
 * this, scrolling a long wheel feels terrible.
 */
export function useInput(onAction: (action: Action) => void) {
  const handlerRef = useRef(onAction);
  handlerRef.current = onAction;

  useEffect(() => {
    const timers = new Map<Action, number>();

    const press = (action: Action) => {
      handlerRef.current(action);
      if (!REPEATABLE.includes(action)) return;
      release(action); // never double-schedule
      const first = window.setTimeout(function tick() {
        handlerRef.current(action);
        timers.set(action, window.setTimeout(tick, FAST_REPEAT_MS));
      }, INITIAL_REPEAT_MS);
      timers.set(action, first);
    };

    const release = (action: Action) => {
      const t = timers.get(action);
      if (t !== undefined) {
        clearTimeout(t);
        timers.delete(action);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return; // we do our own repeat
      const action = KEY_MAP[e.key];
      if (action) {
        e.preventDefault();
        press(action);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const action = KEY_MAP[e.key];
      if (action) release(action);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    let unlisten: UnlistenFn | undefined;
    listen<RustInput>("arcade-input", (event) => {
      const { action, state } = event.payload;
      if (state === "press") press(action);
      else release(action);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      timers.forEach((t) => clearTimeout(t));
      unlisten?.();
    };
  }, []);
}
