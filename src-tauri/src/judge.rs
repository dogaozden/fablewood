//! The Laconic Clerk, native edition — the Rust twin of app/vite-judge-plugin.ts.
//!
//! Spawns the same headless `claude -p … --model haiku` (subscription CLI, NO API
//! key — hard rule) with MCP disabled for the 3x latency win, 20s cap, strict-JSON
//! parse. On any failure this command returns Err and the frontend
//! (app/src/judge/native.ts) falls back to the deterministic stub with the
//! "away from his desk" line — the game never hangs on the Clerk.
//!
//! A Finder-launched .app has a minimal PATH, so the binary is resolved through a
//! candidate list rather than trusting `claude` to be on PATH (docs/tauri.md).

use serde::Serialize;
use std::env;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

// Measured 2026-07-19 (web judge plugin): MCP-free haiku one-shots run 7–13s idle,
// a few seconds worse busy. 20s converts most would-be fallbacks into real verdicts.
const TIMEOUT: Duration = Duration::from_secs(20);

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
fn resolve_claude_bin() -> Option<PathBuf> {
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
    prompt: String,
    answer: String,
    rubric: String,
) -> Result<JudgeVerdict, String> {
    let t0 = Instant::now();
    let bin = resolve_claude_bin().ok_or_else(|| {
        eprintln!("[clerk-native] fallback: claude CLI not found");
        "claude CLI not found (set FABLEWOOD_CLAUDE_BIN)".to_string()
    })?;
    let full_prompt = build_prompt(&prompt, &answer, &rubric);

    let mut cmd = tokio::process::Command::new(&bin);
    cmd.args([
        "-p",
        &full_prompt,
        "--model",
        "haiku",
        "--strict-mcp-config",
        "--mcp-config",
        "{\"mcpServers\":{}}",
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);

    let out = tokio::time::timeout(TIMEOUT, cmd.output())
        .await
        .map_err(|_| {
            eprintln!("[clerk-native] fallback: judge timeout after {}ms", t0.elapsed().as_millis());
            "judge timeout".to_string()
        })?
        .map_err(|e| {
            eprintln!("[clerk-native] fallback: spawn failed: {e}");
            format!("spawn failed: {e}")
        })?;

    let ms = t0.elapsed().as_millis();
    if !out.status.success() {
        let err: String = String::from_utf8_lossy(&out.stderr).chars().take(200).collect();
        eprintln!("[clerk-native] fallback: claude exited {:?} after {ms}ms: {err}", out.status.code());
        return Err(format!("claude exited {:?}: {err}", out.status.code()));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    match parse_verdict(&stdout) {
        Some(v) => {
            println!("[clerk-native] {} in {ms}ms", v.verdict);
            Ok(v)
        }
        None => {
            let head: String = stdout.chars().take(80).collect();
            eprintln!("[clerk-native] fallback: unparseable output after {ms}ms → {head}");
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
}
