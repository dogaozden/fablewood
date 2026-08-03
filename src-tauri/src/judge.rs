//! The Laconic Clerk, native edition — the Rust twin of app/vite-judge-plugin.ts.
//!
//! Two-tier fallback chain, mirroring the web judge plugin (queue item 7,
//! closed 2026-07-20 — this doc comment previously recorded the parity gap;
//! see judge_pool.rs, warm_pool.rs and parse_worker_line.rs for the port):
//!   Tier 1: judge_pool::grade_with_warm_worker — a small pool of pre-spawned
//!           `claude --input-format stream-json --output-format stream-json`
//!           processes kept idle between grades (Tauri-managed state, see
//!           main.rs's `.manage(...)`), so a warm grade skips the CLI boot
//!           cost. Single-use: a pooled process grades exactly once, then
//!           dies; a replacement is pre-warmed in the background. Falls back
//!           to an ad-hoc fresh spawn of the same stream-json process if the
//!           pool is empty or exhausted.
//!   Tier 2: this file's own per-call `claude -p … --model haiku` spawn
//!           (below), unchanged — 20s cap, strict-JSON parse. The original
//!           safety net, kept exactly as it was before tier 1 existed.
//!
//! On failure at BOTH tiers this command returns Err and the frontend
//! (app/src/judge/native.ts) falls back to the deterministic stub with the
//! "away from his desk" line — the game never hangs on the Clerk. Every such
//! failure names its own reason in the durable Clerk log (clerk_log.rs), so an
//! away-line is always traceable to spawn error vs timeout vs non-zero exit vs
//! unparseable output rather than being a silent shrug.
//!
//! A Finder-launched .app has a minimal PATH, so the binary is resolved through a
//! candidate list rather than trusting `claude` to be on PATH (docs/tauri.md) —
//! shared by both tiers via resolve_claude_bin() below.

use crate::clerk_log;
use serde::Serialize;
use std::env;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

// Measured 2026-07-19 (web judge plugin): MCP-free haiku one-shots run 7–13s idle,
// a few seconds worse busy. Re-measured 2026-08-02 against the live CLI: 4.4s best
// case, 14.4s typical, and that is on a healthy link — the original 20s cap left
// almost no headroom, so an ordinary slow network (the author grading over airplane
// Starlink) tipped straight into a fallback the player read as a broken Clerk.
//
// The budget is therefore split two ways: a generous per-tier cap, plus a bound on
// the WHOLE grade so two slow tiers can't stack into a three-minute wait. Combat
// already shows "the Clerk deliberates…" throughout, so waiting is cheap; being
// wrong is not.
const TIER_TIMEOUT: Duration = Duration::from_secs(60);
const GRADE_BUDGET: Duration = Duration::from_secs(90);
/// Never leave tier 2 less than this, even if tier 1 ate the whole budget.
const TIER2_FLOOR: Duration = Duration::from_secs(20);

#[derive(Serialize, Debug, PartialEq)]
pub struct JudgeVerdict {
    pub verdict: String,
    pub line: String,
}

/// The Clerk's grading instruction — verbatim port of the vite plugin's buildPrompt.
fn build_prompt(prompt: &str, answer: &str, rubric: &str) -> String {
    [
        "You are the Laconic Clerk, the Ledger's assessor in a cozy high-fantasy knowledge RPG.",
        "Grade the player's cast-from-memory answer against the rubric. Be fair but exacting:",
        "reward correct substance, ignore spelling and phrasing, do not credit an empty or evasive answer.",
        "",
        &format!("QUESTION: {prompt}"),
        &format!("RUBRIC (what earns credit): {rubric}"),
        &format!("PLAYER'S ANSWER: {answer}"),
        "",
        "Respond with STRICT JSON only — no prose, no markdown fence, no preamble:",
        "{\"verdict\":\"pass\"|\"partial\"|\"fail\",\"line\":\"<one dry in-world line the Clerk says, <=90 chars>\"}",
        "verdict: pass = satisfies the rubric; partial = partially right or missing a key piece; fail = wrong or empty.",
        "The line is the Clerk speaking — terse, dry, never explains at length. One short sentence.",
    ]
    .join("\n")
}

/// Find the claude CLI: env override → PATH scan → known install locations.
/// `pub(crate)`: also used by judge_pool.rs's tier-1 warm-pool spawn, so both
/// tiers agree on where "claude" lives.
pub(crate) fn resolve_claude_bin() -> Option<PathBuf> {
    if let Ok(p) = env::var("FABLEWOOD_CLAUDE_BIN") {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    if let Ok(path_var) = env::var("PATH") {
        for dir in env::split_paths(&path_var) {
            let cand = dir.join("claude");
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    let home = env::var("HOME").unwrap_or_default();
    for cand in [
        format!("{home}/.local/bin/claude"),
        "/opt/homebrew/bin/claude".to_string(),
        "/usr/local/bin/claude".to_string(),
        format!("{home}/.claude/local/claude"),
    ] {
        let pb = PathBuf::from(cand);
        if pb.is_file() {
            return Some(pb);
        }
    }
    None
}

/// Build the `claude` child's entire execution context EXPLICITLY — both env
/// and cwd — instead of letting it silently inherit whatever (possibly
/// minimal, possibly wrong) context this process itself happened to receive.
/// This is the root-cause fix for the Finder-launch bug (docs/tauri.md,
/// worktree report), which turned out to be two compounding issues:
///
///   1. PATH: a Finder/LaunchServices launch gives this process a stripped
///      `PATH=/usr/bin:/bin:/usr/sbin:/sbin` — enough for resolve_claude_bin()'s
///      own candidate-list fallback to find the binary (it doesn't need PATH),
///      but that same stripped PATH was then handed straight through to the
///      spawned claude CHILD, measurably slowing its own startup (confirmed
///      live: under a stripped/LaunchServices-launched env, a "warm" reused
///      process showed NO speedup over a cold one — 11.1s vs 10.9s — vs. a
///      full terminal env's 2.49s warm / 6.68s cold, meaning claude's own
///      startup does real PATH-dependent work).
///   2. cwd: a Finder/LaunchServices-launched GUI app's own cwd is typically
///      $HOME or `/`, NOT a project directory — and with no `.current_dir()`
///      call here, the claude child inherited THAT. Live evidence during this
///      investigation: a Photos-library TCC prompt ("Fablewood.app would like
///      to access your Photo Library") appeared on the user's desktop —
///      strong evidence the child's own startup does some cwd-rooted
///      directory scan that, rooted at $HOME or `/`, can wander into
///      ~/Pictures, with macOS attributing the access to the responsible
///      parent app. A hung/unanswered TCC authorization prompt for a headless
///      child is also a very plausible mechanism for the ORIGINAL reported
///      symptom (spins 30s+ then fails): the child blocks waiting on a prompt
///      nobody can click, eating the full per-tier timeout.
///
/// Both are fixed the same way: never let this subprocess's context depend on
/// whatever the parent happened to receive. It has no legitimate reason to
/// read PATH tools beyond `claude` itself, and no legitimate reason to care
/// about cwd at all (it's a pure text-in/text-out grading call) — so it gets
/// a sane, complete PATH and a boring, dedicated cwd, always, regardless of
/// whether we were launched from Finder or a terminal.
pub(crate) fn configure_judge_child(cmd: &mut tokio::process::Command, bin: &std::path::Path) {
    let home = env::var("HOME").unwrap_or_default();
    let mut path_dirs: Vec<String> = Vec::new();
    if let Some(dir) = bin.parent() {
        path_dirs.push(dir.display().to_string());
    }
    for p in [
        format!("{home}/.local/bin"),
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ] {
        if !path_dirs.contains(&p) {
            path_dirs.push(p);
        }
    }

    cmd.env_clear();
    cmd.env("PATH", path_dirs.join(":"));
    // Pass through whatever this process itself has for these — never
    // hardcoded, since HOME/USER/etc. are legitimately per-user/per-machine.
    // HOME specifically must stay the REAL user home (not the pinned cwd
    // below) — claude needs it to find its own ~/.claude auth/config — so this
    // is a deliberate, narrow exception to "never point the child at a broad
    // directory": it's a var claude reads for a specific known file, not a
    // root the child scans outward from.
    for key in ["HOME", "USER", "LOGNAME", "TMPDIR", "SHELL", "LANG", "LC_ALL"] {
        if let Ok(v) = env::var(key) {
            cmd.env(key, v);
        }
    }
    // Keep the override itself honored end-to-end, in case claude ever
    // re-execs based on it.
    if let Ok(v) = env::var("FABLEWOOD_CLAUDE_BIN") {
        cmd.env("FABLEWOOD_CLAUDE_BIN", v);
    }

    cmd.current_dir(safe_child_cwd());
}

/// A boring, deterministic cwd for the claude child — never $HOME, never `/`.
/// Lives under the system temp dir (env::temp_dir(), which resolves via the
/// TMPDIR we already pass through above) purely so there's a real, writable,
/// unremarkable directory to chdir into; the child has no reason to read or
/// write anything there. See configure_judge_child's doc for why this exists.
fn safe_child_cwd() -> PathBuf {
    let dir = env::temp_dir().join("fablewood-judge-cwd");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// How long tier 2 may run, given what tier 1 already spent. Keeps the whole
/// grade inside GRADE_BUDGET while guaranteeing tier 2 a usable slice: a tier 1
/// that failed instantly (dead pooled worker) leaves tier 2 its full cap, and a
/// tier 1 that burned the entire budget still leaves TIER2_FLOOR rather than a
/// zero-length timeout that would fail before `claude` could even boot.
fn tier2_timeout(tier1_elapsed: Duration) -> Duration {
    GRADE_BUDGET
        .saturating_sub(tier1_elapsed)
        .clamp(TIER2_FLOOR, TIER_TIMEOUT)
}

/// Extract the first balanced {...} object from arbitrary text (tolerates fences).
fn first_json_object(text: &str) -> Option<&str> {
    let bytes = text.as_bytes();
    let start = text.find('{')?;
    let mut depth = 0usize;
    let mut in_str = false;
    let mut escaped = false;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        let ch = b as char;
        if in_str {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_str = false;
            }
        } else if ch == '"' {
            in_str = true;
        } else if ch == '{' {
            depth += 1;
        } else if ch == '}' {
            depth -= 1;
            if depth == 0 {
                return Some(&text[start..=i]);
            }
        }
    }
    None
}

fn parse_verdict(raw: &str) -> Option<JudgeVerdict> {
    let json = first_json_object(raw)?;
    let o: serde_json::Value = serde_json::from_str(json).ok()?;
    let verdict = match o.get("verdict").and_then(|v| v.as_str()) {
        Some(v @ ("pass" | "partial" | "fail")) => v.to_string(),
        _ => return None,
    };
    let mut line = o
        .get("line")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if line.is_empty() {
        line = "The Clerk marks the page.".to_string();
    }
    if line.chars().count() > 120 {
        line = line.chars().take(117).collect::<String>() + "…";
    }
    Some(JudgeVerdict { verdict, line })
}

#[tauri::command]
pub async fn judge_grade(
    pool: tauri::State<'_, crate::judge_pool::ClaudeJudgePool>,
    prompt: String,
    answer: String,
    rubric: String,
) -> Result<JudgeVerdict, String> {
    grade(&pool, &prompt, &answer, &rubric).await
}

/// The whole two-tier grade, split out of the `#[tauri::command]` above so the
/// live end-to-end test can drive the REAL fallback chain with a plain pool —
/// `tauri::State` is only constructible inside a running Tauri app, and a test
/// that could only reach tier 1 would miss the tier-2 recovery that is the
/// entire reason the chain exists.
pub(crate) async fn grade(
    pool: &crate::judge_pool::ClaudeJudgePool,
    prompt: &str,
    answer: &str,
    rubric: &str,
) -> Result<JudgeVerdict, String> {
    let full_prompt = build_prompt(prompt, answer, rubric);

    // Tier 1: warm worker pool — skips the per-call CLI boot on a warm hit.
    let t0 = Instant::now();
    match crate::judge_pool::grade_with_warm_worker(pool, &full_prompt).await {
        Ok(raw) => match parse_verdict(&raw) {
            Some(v) => {
                clerk_log::record(&format!("{} in {}ms (warm)", v.verdict, t0.elapsed().as_millis()));
                return Ok(v);
            }
            None => {
                let head: String = raw.chars().take(80).collect();
                clerk_log::record(&format!(
                    "warm fallback: unparseable output after {}ms → {head}",
                    t0.elapsed().as_millis()
                ));
            }
        },
        Err(e) => clerk_log::record(&format!("warm fallback: {e} after {}ms", t0.elapsed().as_millis())),
    }

    // Tier 2: the original per-call spawn — same safety net as before, now on
    // whatever is left of the whole-grade budget (see GRADE_BUDGET).
    let t1 = Instant::now();
    let tier2_timeout = tier2_timeout(t0.elapsed());
    let bin = resolve_claude_bin().ok_or_else(|| {
        clerk_log::record("fallback: claude CLI not found");
        "claude CLI not found (set FABLEWOOD_CLAUDE_BIN)".to_string()
    })?;

    let mut cmd = tokio::process::Command::new(&bin);
    configure_judge_child(&mut cmd, &bin);
    cmd.args([
        "-p",
        &full_prompt,
        "--model",
        "haiku",
        "--strict-mcp-config",
        "--mcp-config",
        "{\"mcpServers\":{}}",
        // Grade with NO user/project/local settings loaded. The Clerk is a
        // closed-book grader, but by default the CLI hands it the developer's
        // whole ambient Claude Code config — global CLAUDE.md, every installed
        // plugin and skill. Measured 2026-08-02: that is 28.3k cached prompt
        // tokens, and one observed grade spent a 547-token thinking block
        // arguing with a plugin's "you MUST invoke a skill before ANY response"
        // reminder instead of answering. Isolated, the same grade is 24.1k
        // tokens and 110 output tokens. A judge whose verdict can be swayed by
        // an unrelated plugin install is not a judge.
        "--setting-sources",
        "",
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
        clerk_log::record(&format!("fallback: spawn failed: {e}"));
        format!("spawn failed: {e}")
    })?;
    // See judge_pool::spawn_stderr_logger's doc: draining stderr on its own
    // independent task (started here, before the timeout race below) is what
    // makes a hang-then-timeout surface the child's own error text, instead of
    // that text being discarded along with the killed Child on a cancelled wait.
    if let Some(stderr) = child.stderr.take() {
        crate::judge_pool::spawn_stderr_logger("fallback", stderr);
    }

    let out = tokio::time::timeout(tier2_timeout, child.wait_with_output())
        .await
        .map_err(|_| {
            clerk_log::record(&format!(
                "fallback: judge timeout after {}ms (cap {}s)",
                t1.elapsed().as_millis(),
                tier2_timeout.as_secs()
            ));
            "judge timeout".to_string()
        })?
        .map_err(|e| {
            clerk_log::record(&format!("fallback: wait failed: {e}"));
            format!("wait failed: {e}")
        })?;

    let ms = t1.elapsed().as_millis();
    if !out.status.success() {
        clerk_log::record(&format!(
            "fallback: claude exited {:?} after {ms}ms (see child stderr line above, if any)",
            out.status.code()
        ));
        return Err(format!("claude exited {:?}", out.status.code()));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    match parse_verdict(&stdout) {
        Some(v) => {
            clerk_log::record(&format!("{} in {ms}ms (spawn fallback)", v.verdict));
            Ok(v)
        }
        None => {
            let head: String = stdout.chars().take(80).collect();
            clerk_log::record(&format!("fallback: unparseable output after {ms}ms → {head}"));
            Err("unparseable judge output".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_strict_json() {
        let v = parse_verdict(r#"{"verdict":"pass","line":"The ink holds."}"#).unwrap();
        assert_eq!(v.verdict, "pass");
        assert_eq!(v.line, "The ink holds.");
    }

    #[test]
    fn tolerates_fences_and_preamble() {
        let raw = "Here you go:\n```json\n{\"verdict\":\"partial\",\"line\":\"Nearly.\"}\n```";
        let v = parse_verdict(raw).unwrap();
        assert_eq!(v.verdict, "partial");
    }

    #[test]
    fn rejects_bad_verdicts() {
        assert!(parse_verdict(r#"{"verdict":"meh","line":"x"}"#).is_none());
        assert!(parse_verdict("no json here").is_none());
    }

    #[test]
    fn handles_nested_and_escaped() {
        let raw = r#"{"verdict":"fail","line":"He said \"no\" {twice}."}"#;
        let v = parse_verdict(raw).unwrap();
        assert_eq!(v.line, "He said \"no\" {twice}.");
    }

    #[test]
    fn empty_line_gets_default_and_long_line_clamps() {
        let v = parse_verdict(r#"{"verdict":"pass","line":""}"#).unwrap();
        assert_eq!(v.line, "The Clerk marks the page.");
        let long = "x".repeat(200);
        let v = parse_verdict(&format!(r#"{{"verdict":"pass","line":"{long}"}}"#)).unwrap();
        assert_eq!(v.line.chars().count(), 118); // 117 + ellipsis
    }

    #[test]
    fn prompt_matches_plugin_shape() {
        let p = build_prompt("Q?", "A.", "R.");
        assert!(p.contains("QUESTION: Q?"));
        assert!(p.contains("RUBRIC (what earns credit): R."));
        assert!(p.contains("PLAYER'S ANSWER: A."));
        assert!(p.starts_with("You are the Laconic Clerk"));
    }

    #[test]
    fn tier2_gets_the_rest_of_the_budget_bounded_at_both_ends() {
        // tier 1 died instantly (e.g. a pooled worker that expired while idle):
        // tier 2 gets its full cap, not the whole 90s budget.
        assert_eq!(tier2_timeout(Duration::from_secs(0)), TIER_TIMEOUT);
        // tier 1 was merely slow: tier 2 gets what's left of the budget.
        assert_eq!(tier2_timeout(Duration::from_secs(45)), Duration::from_secs(45));
        // tier 1 burned its whole cap: tier 2 still gets a usable slice…
        assert_eq!(tier2_timeout(TIER_TIMEOUT), Duration::from_secs(30));
        // …and never less than the floor, even past the budget.
        assert_eq!(tier2_timeout(Duration::from_secs(600)), TIER2_FLOOR);
    }

    /// The whole grade must stay bounded: a player watching "the Clerk
    /// deliberates…" should never wait more than both caps combined.
    #[test]
    fn the_worst_case_grade_is_bounded() {
        let worst = TIER_TIMEOUT + tier2_timeout(TIER_TIMEOUT);
        assert_eq!(worst, Duration::from_secs(90));
        assert!(worst <= GRADE_BUDGET, "worst case {worst:?} escapes the budget");
    }

    /// Ignored by default: spawns the REAL `claude` subscription CLI (no API
    /// key) and costs real wall-clock time. This is the end-to-end proof that
    /// LIVE judging works — everything judge_grade does except the Tauri IPC
    /// extractor, driving the real two-tier chain via grade(): production
    /// build_prompt, the tier-1 warm-pool spawn with its real args, tier-2
    /// recovery when tier 1 wedges, and parse_verdict over whatever the model
    /// actually said. It grades a right answer and a wrong one, so a Clerk that
    /// had derailed into refusing/prose (the failure mode the --setting-sources
    /// isolation exists to prevent) fails this test instead of shipping.
    ///
    /// Observed 2026-08-02 while writing this: on a congested link a warm
    /// worker really can wedge past the full 60s tier-1 cap. That is exactly
    /// what tier 2 is for, and going through grade() means this test recovers
    /// the same way the game does instead of failing on a network hiccup.
    /// Re-verify with:
    ///   cargo test --ignored live_clerk_grades_a_real_answer -- --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_clerk_grades_a_real_answer() {
        let pool = crate::judge_pool::ClaudeJudgePool::new();
        let question = "Why did the Ledger's clerks adopt double-entry?";
        let rubric = "Full credit for saying it let errors be caught by cross-checking \
                      two matching records. No credit for answers about taxation.";

        for (answer, want) in [
            ("Because every entry appears twice, so the two sides must agree and a mistake shows up as a mismatch.", "pass"),
            ("Because the king wanted to tax the merchants.", "fail"),
        ] {
            let t0 = Instant::now();
            let v = grade(&pool, question, answer, rubric)
                .await
                .unwrap_or_else(|e| panic!("live Clerk failed to answer for {answer:?}: {e}"));
            println!("[live] {:?}s {answer:.48}… → {} / {:?}", t0.elapsed().as_secs(), v.verdict, v.line);
            assert_eq!(v.verdict, want, "unexpected verdict for {answer:?} (line: {:?})", v.line);
            assert!(!v.line.is_empty(), "the Clerk must always say something");
        }
    }

    /// Regression guard for the Photos-TCC-prompt theory (see
    /// configure_judge_child's doc): proves the claude child's cwd is ALWAYS
    /// pinned to a boring, dedicated directory — never $HOME, never `/` —
    /// regardless of what this test process's own cwd happens to be. Uses
    /// `/bin/sh -c pwd` as a deterministic stand-in for claude (same pattern
    /// judge_pool.rs's real-process tests use), so this runs fast, with no
    /// live CLI dependency, as part of the normal test suite.
    #[cfg(unix)]
    #[tokio::test]
    async fn configure_judge_child_pins_a_safe_cwd_never_home_or_root() {
        let bin = PathBuf::from("/bin/sh");
        let mut cmd = tokio::process::Command::new(&bin);
        configure_judge_child(&mut cmd, &bin);
        let out = cmd.arg("-c").arg("pwd").output().await.expect("run /bin/sh -c pwd");
        let cwd = String::from_utf8_lossy(&out.stdout).trim().to_string();

        assert_ne!(cwd, "/", "child cwd must never be root");
        let home = env::var("HOME").unwrap_or_default();
        assert!(!home.is_empty(), "test setup: HOME must be set to make this assertion meaningful");
        assert_ne!(cwd, home, "child cwd must never be $HOME");
        assert!(cwd.contains("fablewood-judge-cwd"), "expected the pinned scratch cwd, got {cwd}");
    }
}
