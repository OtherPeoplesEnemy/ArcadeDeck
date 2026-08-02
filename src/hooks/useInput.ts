import { useEffect, useRef } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { Action } from "../types";

const INITIAL_REPEAT_MS = 320;
const FAST_REPEAT_MS = 85;
const HOLD_WARN_MS = 900; // "keep holding to exit" appears
const HOLD_QUIT_MS = 3000; // app exits

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
  "2": "start",
  F1: "start",
};

const REPEATABLE: Action[] = ["left", "right", "up", "down"];

interface RustInput {
  action: Action;
  state: "press" | "release";
}

export type BackHoldPhase = "warn" | "quit" | "cancel";

export interface InputHandlers {
  onAction: (action: Action) => void;
  /** Long-press lifecycle for the Back input (exit gesture). */
  onBackHold?: (phase: BackHoldPhase) => void;
}

/**
 * One input pipeline for the whole app.
 *
 * - Joysticks/gamepads arrive as `arcade-input` events from the Rust gilrs
 *   thread (works on Windows and Linux regardless of webview quirks).
 * - Keyboard encoders (I-PAC etc.) arrive as plain DOM key events.
 *
 * Held directions repeat with acceleration. Back is special: a quick tap is
 * a normal "back" action (fired on release), while holding it is the exit
 * gesture — warn at ~1s, quit at 3s.
 */
export function useInput(handlers: InputHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const timers = new Map<Action, number>();
    let backDownAt: number | null = null;
    let backWarnTimer: number | null = null;
    let backQuitTimer: number | null = null;
    let backConsumed = false;

    const clearBackTimers = () => {
      if (backWarnTimer !== null) clearTimeout(backWarnTimer);
      if (backQuitTimer !== null) clearTimeout(backQuitTimer);
      backWarnTimer = null;
      backQuitTimer = null;
    };

    const press = (action: Action) => {
      if (action === "back") {
        if (backDownAt !== null) return; // already held
        backDownAt = Date.now();
        backConsumed = false;
        backWarnTimer = window.setTimeout(() => {
          handlersRef.current.onBackHold?.("warn");
        }, HOLD_WARN_MS);
        backQuitTimer = window.setTimeout(() => {
          backConsumed = true;
          handlersRef.current.onBackHold?.("quit");
        }, HOLD_QUIT_MS);
        return;
      }

      handlersRef.current.onAction(action);
      if (!REPEATABLE.includes(action)) return;
      release(action); // never double-schedule
      const first = window.setTimeout(function tick() {
        handlersRef.current.onAction(action);
        timers.set(action, window.setTimeout(tick, FAST_REPEAT_MS));
      }, INITIAL_REPEAT_MS);
      timers.set(action, first);
    };

    const release = (action: Action) => {
      if (action === "back") {
        if (backDownAt === null) return;
        const held = Date.now() - backDownAt;
        backDownAt = null;
        clearBackTimers();
        if (backConsumed) return; // quit already fired
        if (held < HOLD_WARN_MS) {
          handlersRef.current.onAction("back"); // normal tap
        } else {
          handlersRef.current.onBackHold?.("cancel"); // let go mid-hold
        }
        return;
      }
      const t = timers.get(action);
      if (t !== undefined) {
        clearTimeout(t);
        timers.delete(action);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return; // we do our own repeat
      // When a settings text field is focused, only navigation/confirm keys
      // act as arcade inputs — letters must type normally.
      const inField =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;
      if (inField && !["ArrowUp", "ArrowDown", "Enter", "Escape"].includes(e.key)) {
        return;
      }
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
      clearBackTimers();
      unlisten?.();
    };
  }, []);
}
