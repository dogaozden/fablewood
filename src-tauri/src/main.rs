// Prevents an extra console window on Windows in release; no effect on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod autopilot;
mod bridge;
mod judge;
mod judge_pool;
mod parse_worker_line;
mod warm_pool;

fn main() {
    tauri::Builder::default()
        .manage(judge_pool::ClaudeJudgePool::new())
        .setup(|app| {
            autopilot::init(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            bridge::state_read,
            bridge::state_write,
            bridge::packs_list,
            bridge::pack_asset,
            judge::judge_grade,
            autopilot::probe_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running fablewood");
}
