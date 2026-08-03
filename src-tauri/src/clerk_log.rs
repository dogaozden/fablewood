//! Durable diagnostic log for the Laconic Clerk.
//!
//! Why this exists: every judge outcome used to be reported with println!/
//! eprintln! only. That is fine when the app is started from a terminal, but
//! Fablewood is normally launched from Finder (or by a background agent), and
//! a LaunchServices-launched .app has nowhere for stdout/stderr to go — so
//! every "the Clerk is momentarily away from his desk" arrived with its reason
//! discarded, and the bug could never be told apart from its own symptom.
//! Writing the same lines to a file the developer can read afterwards is what
//! makes a Clerk failure diagnosable at all.
//!
//! Location (deliberately NOT the game's state/ directory — this is developer
//! diagnostics, never gameplay state, and state/ is precious):
//!   FABLEWOOD_CLERK_LOG env → that exact file (used by the tests)
//!   otherwise, macOS        → ~/Library/Logs/Fablewood/clerk.log
//!   otherwise               → <temp>/fablewood-clerk.log
//!
//! The file is self-capping: once it passes MAX_BYTES it is truncated and
//! restarted, so an app left running for weeks can never fill a disk. Recent
//! lines are the useful ones, so dropping the oldest is the right trade.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Truncate-and-restart threshold. Roughly ten thousand grade lines — far more
/// history than any diagnosis needs, still trivially small on disk.
const MAX_BYTES: u64 = 1 << 20; // 1 MiB

/// Where the diagnostics land. See the module doc for the resolution order.
pub fn log_path() -> PathBuf {
    if let Ok(p) = std::env::var("FABLEWOOD_CLERK_LOG") {
        if !p.trim().is_empty() {
            return PathBuf::from(p);
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            return PathBuf::from(home).join("Library/Logs/Fablewood/clerk.log");
        }
    }
    std::env::temp_dir().join("fablewood-clerk.log")
}

/// Record one Clerk event: to stderr (so a terminal launch still shows it live)
/// and to the durable log (so a Finder launch still has it afterwards).
///
/// Best-effort by construction: a diagnostic that panicked, or that propagated
/// an error into the grading path, would be worse than no diagnostic at all —
/// so every filesystem failure here is swallowed and the grade continues.
pub fn record(msg: &str) {
    eprintln!("[clerk-native] {msg}");

    let path = log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        let _ = fs::write(&path, b"");
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} {msg}", stamp(now_epoch_secs()));
    }
}

fn now_epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Format epoch seconds as `YYYY-MM-DDTHH:MM:SSZ`.
///
/// Hand-rolled rather than pulling in chrono/time: the whole need is one UTC
/// timestamp on a log line, and `civil_from_days` below is a well-known exact
/// algorithm — cheaper than a new dependency, and unit-testable as a pure fn.
fn stamp(epoch_secs: i64) -> String {
    let days = epoch_secs.div_euclid(86_400);
    let secs = epoch_secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        secs / 3600,
        (secs % 3600) / 60,
        secs % 60
    )
}

/// Days-since-1970 → (year, month, day). Howard Hinnant's civil_from_days.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 }.div_euclid(146_097);
    let doe = (z - era * 146_097) as i64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamps_known_epochs_exactly() {
        assert_eq!(stamp(0), "1970-01-01T00:00:00Z");
        // 2026-08-02T17:44:17Z — the afternoon this bug was root-caused.
        assert_eq!(stamp(1_785_692_657), "2026-08-02T17:44:17Z");
        // leap day, and the last second of a year
        assert_eq!(stamp(1_709_164_800), "2024-02-29T00:00:00Z");
        assert_eq!(stamp(1_735_689_599), "2024-12-31T23:59:59Z");
    }

    #[test]
    fn records_append_to_the_overridden_path() {
        let path = std::env::temp_dir().join(format!("fw-clerk-test-{}.log", std::process::id()));
        let _ = fs::remove_file(&path);
        std::env::set_var("FABLEWOOD_CLERK_LOG", &path);

        record("pass in 1234ms (warm)");
        record("fallback: judge timeout after 60000ms");

        let body = fs::read_to_string(&path).expect("log file written");
        let lines: Vec<&str> = body.lines().collect();
        assert_eq!(lines.len(), 2, "one line per record, got {body:?}");
        assert!(lines[0].ends_with(" pass in 1234ms (warm)"), "got {:?}", lines[0]);
        assert!(lines[1].contains("judge timeout"), "got {:?}", lines[1]);
        // every line is timestamped, so a failure can be placed in time
        assert!(lines[0].starts_with("20"), "expected a leading timestamp, got {:?}", lines[0]);

        std::env::remove_var("FABLEWOOD_CLERK_LOG");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn truncates_once_past_the_cap_instead_of_growing_forever() {
        let path = std::env::temp_dir().join(format!("fw-clerk-cap-{}.log", std::process::id()));
        fs::write(&path, vec![b'x'; (MAX_BYTES + 1) as usize]).expect("seed an oversized log");
        std::env::set_var("FABLEWOOD_CLERK_LOG", &path);

        record("after the cap");

        let body = fs::read_to_string(&path).expect("log file readable");
        assert!(body.len() < 200, "expected a fresh file, got {} bytes", body.len());
        assert!(body.contains("after the cap"));

        std::env::remove_var("FABLEWOOD_CLERK_LOG");
        let _ = fs::remove_file(&path);
    }
}
