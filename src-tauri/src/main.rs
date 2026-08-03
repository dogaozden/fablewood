// Prevents an extra console window on Windows in release; no effect on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod autopilot;
mod bridge;
mod clerk_log;
mod judge;
mod judge_pool;
mod parse_worker_line;
mod warm_pool;

fn main() {
    tauri::Builder::default()
        .manage(judge_pool::ClaudeJudgePool::new())
        .setup(|app| {
            autopilot::init(app.handle().clone());
            // Eagerly warm the Clerk pool at boot (see judge_pool::prewarm) and log
            // readiness once — this ONE line is the whole smoke check for a new
            // bundle: launch it and read the Clerk log (clerk_log::log_path(),
            // ~/Library/Logs/Fablewood/clerk.log), no UI interaction required.
            // It goes to the file rather than stdout precisely because a
            // Finder-launched .app has no stdout anyone can see.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri::Manager;
                let pool = handle.state::<judge_pool::ClaudeJudgePool>();
                let n = judge_pool::prewarm(&pool).await;
                match judge::resolve_claude_bin() {
                    Some(bin) => clerk_log::record(&format!(
                        "warm pool ready ({n} workers, claude at {})",
                        bin.display()
                    )),
                    None => clerk_log::record(
                        "warm pool NOT ready — claude CLI not found (set FABLEWOOD_CLAUDE_BIN)",
                    ),
                }
            });
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
