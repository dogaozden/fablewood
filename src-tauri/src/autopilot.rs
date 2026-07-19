//! Dev-only instrumentation harness (the native cousin of the e2e suite's
//! page.evaluate). Enabled ONLY when FW_AUTOPILOT=<path-to-js-file> is set at
//! launch: the file is polled and its contents evaluated in the main webview on
//! every change, so a terminal can drive and probe the native window — dispatch
//! synthetic input, read __FABLEWOOD_STATE, screenshot the canvas. Evaluated JS
//! reports back by invoking `probe_report`, which prints to this process's stdout.
//!
//! Never enabled in normal use: no env var, no watcher thread, and probe_report
//! degenerates to a stdout print.

use std::{env, fs, thread, time::Duration};
use tauri::{AppHandle, Manager};

pub fn init(app: AppHandle) {
    let Ok(path) = env::var("FW_AUTOPILOT") else {
        return;
    };
    if path.trim().is_empty() {
        return;
    }
    println!("[autopilot] watching {path}");
    thread::spawn(move || {
        let mut last: Option<std::time::SystemTime> = None;
        loop {
            thread::sleep(Duration::from_millis(400));
            let Ok(meta) = fs::metadata(&path) else { continue };
            let Ok(mtime) = meta.modified() else { continue };
            if last.as_ref() == Some(&mtime) {
                continue;
            }
            last = Some(mtime);
            let Ok(js) = fs::read_to_string(&path) else { continue };
            if js.trim().is_empty() {
                continue;
            }
            if let Some(win) = app.get_webview_window("main") {
                println!("[autopilot] eval {} bytes", js.len());
                if let Err(e) = win.eval(&js) {
                    eprintln!("[autopilot] eval error: {e}");
                }
            }
        }
    });
}

#[tauri::command]
pub fn probe_report(tag: String, data: String) {
    println!("[probe:{tag}] {data}");
}
