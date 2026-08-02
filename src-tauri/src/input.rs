use gilrs::{Axis, Button, Event, EventType, Gilrs};
use serde::Serialize;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// Hysteresis: engage past 0.55, release only under 0.35 — stops drifting
// sticks and noisy encoders from firing phantom press/release pairs.
const AXIS_PRESS: f32 = 0.55;
const AXIS_RELEASE: f32 = 0.35;

#[derive(Serialize, Clone)]
struct InputPayload {
    action: &'static str,
    state: &'static str, // "press" | "release"
}

/// Poll all connected gamepads/joysticks on a background thread and emit
/// normalized `arcade-input` events. Works identically for XInput on Windows
/// and evdev on Linux; keyboard encoders (I-PAC) are handled as DOM key
/// events on the frontend instead.
pub fn start(app: AppHandle) {
    thread::spawn(move || {
        let mut gilrs = match Gilrs::new() {
            Ok(g) => g,
            Err(e) => {
                eprintln!("[input] gilrs init failed (keyboard-only mode): {e}");
                return;
            }
        };

        // Track stick direction so we emit clean press/release pairs.
        let mut x_dir: i8 = 0;
        let mut y_dir: i8 = 0;

        loop {
            while let Some(Event { event, .. }) = gilrs.next_event() {
                match event {
                    EventType::ButtonPressed(button, _) => {
                        if let Some(action) = map_button(button) {
                            emit(&app, action, "press");
                        }
                    }
                    EventType::ButtonReleased(button, _) => {
                        if let Some(action) = map_button(button) {
                            emit(&app, action, "release");
                        }
                    }
                    EventType::AxisChanged(axis, value, _) => match axis {
                        Axis::LeftStickX | Axis::RightStickX => {
                            let new_dir = direction_hys(value, x_dir);
                            if new_dir != x_dir {
                                if x_dir != 0 {
                                    emit(&app, if x_dir < 0 { "left" } else { "right" }, "release");
                                }
                                if new_dir != 0 {
                                    emit(&app, if new_dir < 0 { "left" } else { "right" }, "press");
                                }
                                x_dir = new_dir;
                            }
                        }
                        Axis::LeftStickY | Axis::RightStickY => {
                            // gilrs: positive Y = up
                            let new_dir = direction_hys(value, y_dir);
                            if new_dir != y_dir {
                                if y_dir != 0 {
                                    emit(&app, if y_dir > 0 { "up" } else { "down" }, "release");
                                }
                                if new_dir != 0 {
                                    emit(&app, if new_dir > 0 { "up" } else { "down" }, "press");
                                }
                                y_dir = new_dir;
                            }
                        }
                        _ => {}
                    },
                    _ => {}
                }
            }
            thread::sleep(Duration::from_millis(8));
        }
    });
}

fn direction_hys(value: f32, current: i8) -> i8 {
    match current {
        0 => {
            if value > AXIS_PRESS {
                1
            } else if value < -AXIS_PRESS {
                -1
            } else {
                0
            }
        }
        d => {
            // Only release once the stick returns well toward center.
            if value.abs() < AXIS_RELEASE || (value.signum() as i8) != d {
                if value > AXIS_PRESS {
                    1
                } else if value < -AXIS_PRESS {
                    -1
                } else {
                    0
                }
            } else {
                d
            }
        }
    }
}

fn map_button(button: Button) -> Option<&'static str> {
    match button {
        Button::South => Some("select"),
        Button::East => Some("back"),
        // Start, Select, and the guide/mode button all open settings —
        // cheap encoders disagree about which one the physical Start
        // button reports as, so accept all of them.
        Button::Start => Some("start"),
        Button::Select => Some("start"),
        Button::Mode => Some("start"),
        Button::DPadLeft => Some("left"),
        Button::DPadRight => Some("right"),
        Button::DPadUp => Some("up"),
        Button::DPadDown => Some("down"),
        _ => None,
    }
}

fn emit(app: &AppHandle, action: &'static str, state: &'static str) {
    let _ = app.emit("arcade-input", InputPayload { action, state });
}
