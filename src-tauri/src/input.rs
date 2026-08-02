use gilrs::{Axis, Button, Event, EventType, Gilrs};
use serde::Serialize;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const AXIS_THRESHOLD: f32 = 0.5;

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
                            let new_dir = direction(value);
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
                            let new_dir = direction(value);
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

fn direction(value: f32) -> i8 {
    if value > AXIS_THRESHOLD {
        1
    } else if value < -AXIS_THRESHOLD {
        -1
    } else {
        0
    }
}

fn map_button(button: Button) -> Option<&'static str> {
    match button {
        Button::South => Some("select"),
        Button::East => Some("back"),
        Button::Start => Some("start"),
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
