//! Warm process-pool orchestration for the native Clerk — Rust port of
//! app/judge-worker.ts (see that file's doc comment for the full mechanism and
//! measured-latency rationale). Wires the generic warm_pool::WarmPool against
//! real `claude --input-format stream-json --output-format stream-json` child
//! processes, so judge.rs's judge_grade command can skip the CLI boot cost on
//! a warm hit before falling back to its own per-call spawn (tier 2, unchanged
//! — see judge.rs).
//!
//! Config surface (mirrors judge-worker.ts's own two consts):
//!   POOL_TARGET_SIZE — how many spare processes stay pre-warmed. One spare
//!     amortizes the common case (one grade in flight); a second absorbs the
//!     rare back-to-back overlap. Kept small — a single-player desktop app,
//!     not a multi-tenant service.
//!   WARM_TIMEOUT — per-grade cap on a warm (or cold-fresh) attempt before it
//!     is abandoned and the caller falls back to judge.rs's tier-2 spawn.
//!     Matches judge-worker.ts's WORKER_TIMEOUT_MS (20s) and judge.rs's own
//!     existing TIMEOUT for the same reason: a slow-but-progressing attempt
//!     should finish here rather than being killed just short of success.
//!
//! Design deviations from the TS reference (also called out in the worktree
//! report):
//!   - No live idle-crash event listener. judge-worker.ts flips a pooled
//!     entry's `alive` flag the instant node reports the child exited/errored,
//!     even while it sits unused in the pool. Rust's `tokio::process::Child`
//!     has no equivalent standing "event" callback — reproducing one exactly
//!     would need a background reaper task per pooled process plus a
//!     kill-vs-reaper ownership handoff (a channel), which is real added
//!     complexity for a narrow benefit. Instead, a pooled entry that silently
//!     died while idle is discovered lazily the next time it is taken — the
//!     write to its stdin fails (broken pipe) or its stdout EOFs immediately,
//!     both surfacing fast as a JudgeError, not a hang. That failure still
//!     triggers judge.rs's tier-2 fallback for that one grade, and the
//!     unconditional replenish() after every attempt spawns a fresh
//!     replacement — so the pool still self-heals, just one grade later than
//!     TS's best-effort early skip would in the same crash scenario.
//!   - Shutdown cleanup relies on `kill_on_drop(true)` (Rust RAII: dropping a
//!     pooled entry kills its process) instead of a `process.on('exit')` hook
//!     — simpler, and Tauri drops managed state on a normal app exit.
//!   - `spawn_fresh()`/`GradeWorker` are a small addition with no direct TS
//!     analogue: Rust's static typing needs an explicit trait boundary to let
//!     the pool's state machine be unit tested against a fake worker instead
//!     of a real child process (TS gets this for free from duck typing, and
//!     in fact never unit-tests judge-worker.ts's orchestration at all — see
//!     that file's own doc comment). The trait is the mechanism for the
//!     "mock the child process boundary" test coverage requested for this port.

use crate::parse_worker_line::{parse_worker_line, WorkerLineResult};
use crate::warm_pool::{PoolEntry, WarmPool};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

/// How many spare `claude` processes stay pre-warmed. See module doc.
const POOL_TARGET_SIZE: usize = 2;

/// Per-grade cap on a warm (or cold-fresh) attempt. See module doc.
const WARM_TIMEOUT: Duration = Duration::from_secs(20);

/// Same stream-json invocation as judge-worker.ts's SPAWN_ARGS.
const SPAWN_ARGS: &[&str] = &[
    "-p",
    "--model",
    "haiku",
    "--strict-mcp-config",
    "--mcp-config",
    "{\"mcpServers\":{}}",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose", // required by the CLI when --output-format=stream-json is combined with --print
    "--no-session-persistence", // the Clerk is a backend judge, not a resumable chat
];

#[derive(Debug)]
enum JudgeError {
    /// The OS-level spawn itself failed (or the claude binary could not be
    /// resolved at all) — the string already carries full context.
    Spawn(String),
    Io(String),
    /// A terminal `result` event reported is_error, or a non-string result.
    Worker(String),
    /// stdout closed before any terminal result line arrived.
    ClosedEarly,
    Timeout,
}

impl std::fmt::Display for JudgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JudgeError::Spawn(e) => write!(f, "{e}"),
            JudgeError::Io(e) => write!(f, "io error: {e}"),
            JudgeError::Worker(e) => write!(f, "{e}"),
            JudgeError::ClosedEarly => write!(f, "warm worker closed early"),
            JudgeError::Timeout => write!(f, "warm worker timeout"),
        }
    }
}

/// Anything that can run exactly one grading turn, then is discarded — the
/// abstraction boundary that lets the pool's state machine (spawn / replace /
/// single-use / fallback) be unit tested with a fake worker instead of a real
/// OS process (see the tests below). `prompt` is owned (not `&str`) so callers
/// never juggle a lifetime for it. Every use of this trait (grade_with_pool's
/// `T: GradeWorker`) is instantiated at one concrete, fully-Send type
/// (ClaudeChild in production, FakeWorker in tests) — never behind `dyn` or a
/// further-generic wrapper — so plain `async fn` here is enough for the
/// resulting futures to be Send where it matters (judge_grade's Tauri command
/// boundary); no manual `-> impl Future<...> + Send` desugaring needed.
trait GradeWorker {
    async fn grade(self, prompt: String) -> Result<String, JudgeError>;
}

/// One pooled `claude` child process, wired for the stream-json protocol.
/// `Err` inside means the OS-level spawn itself failed (or the binary could
/// not be resolved) — the entry is "born dead" so WarmPool::take() skips it
/// exactly like a process that died idle, and grade() surfaces the recorded
/// reason instead of ever touching a live child.
struct ClaudeChild(Result<tokio::process::Child, String>);

fn spawn_claude_child() -> PoolEntry<ClaudeChild> {
    let outcome: Result<tokio::process::Child, String> = match crate::judge::resolve_claude_bin() {
        None => Err("claude CLI not found (set FABLEWOOD_CLAUDE_BIN)".to_string()),
        Some(bin) => tokio::process::Command::new(&bin)
            .args(SPAWN_ARGS.iter().copied())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("spawn failed: {e}")),
    };
    let alive = outcome.is_ok();
    PoolEntry {
        proc: ClaudeChild(outcome),
        alive,
    }
}

impl GradeWorker for ClaudeChild {
    async fn grade(self, prompt: String) -> Result<String, JudgeError> {
        let mut child = self.0.map_err(JudgeError::Spawn)?;
        let mut stdin = child.stdin.take().expect("spawned with piped stdin");
        let stdout = child.stdout.take().expect("spawned with piped stdout");
        let mut lines = BufReader::new(stdout).lines();

        let user_message = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": [{ "type": "text", "text": prompt }] }
        })
        .to_string()
            + "\n";

        if let Err(e) = stdin.write_all(user_message.as_bytes()).await {
            let _ = child.start_kill();
            return Err(JudgeError::Io(format!("stdin write failed: {e}")));
        }

        let result = loop {
            match lines.next_line().await {
                Ok(Some(line)) => match parse_worker_line(&line) {
                    WorkerLineResult::Success(text) => break Ok(text),
                    WorkerLineResult::Error(msg) => break Err(JudgeError::Worker(msg)),
                    WorkerLineResult::Pending => continue, // system/assistant/rate_limit_event — keep reading
                },
                Ok(None) => break Err(JudgeError::ClosedEarly),
                Err(e) => break Err(JudgeError::Io(format!("stdout read failed: {e}"))),
            }
        };
        // Single-use by design: always kill, whether this grade succeeded
        // or not — never a second turn on the same process.
        let _ = child.start_kill();
        result
    }
}

/// The pool's factory is a plain fn item (spawn_claude_child captures
/// nothing), so no boxing/dyn is needed — named here purely to keep
/// ClaudeJudgePool's field type readable.
type ClaudeChildFactory = fn() -> PoolEntry<ClaudeChild>;

/// Tauri-managed state: a small pool of pre-warmed Clerk processes, lazily
/// started on first grade (an empty pool just pays the same cold cost as
/// today's per-call spawn — see grade_with_warm_worker).
pub struct ClaudeJudgePool {
    inner: Mutex<WarmPool<ClaudeChild, ClaudeChildFactory>>,
}

impl ClaudeJudgePool {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(WarmPool::new(POOL_TARGET_SIZE, spawn_claude_child as ClaudeChildFactory)),
        }
    }
}

impl Default for ClaudeJudgePool {
    fn default() -> Self {
        Self::new()
    }
}

/// Grade one prompt via the warm pool. Mirrors judge-worker.ts's
/// gradeWithWarmWorker exactly: take a live spare (or spawn one fresh if the
/// pool is empty/exhausted), run exactly one turn on it, then always
/// replenish — whether this call succeeded or not — so the NEXT grade has a
/// warm spare ready. See judge.rs for the tier-2 fallback this feeds on Err.
pub async fn grade_with_warm_worker(pool: &ClaudeJudgePool, prompt: &str) -> Result<String, String> {
    grade_with_pool(&pool.inner, prompt.to_string(), WARM_TIMEOUT)
        .await
        .map_err(|e| e.to_string())
}

/// Generic core, parametrized over the worker type so tests can supply a fake
/// (see `tests` below) without spawning a real OS process. The pool mutex is
/// only ever held around take()/spawn_fresh() and replenish() — never across
/// the (up to WARM_TIMEOUT-long) grade() call itself, so concurrent grades
/// never contend on a shared lock while a slow prompt is in flight.
async fn grade_with_pool<T, F>(pool: &Mutex<WarmPool<T, F>>, prompt: String, timeout: Duration) -> Result<String, JudgeError>
where
    T: GradeWorker,
    F: FnMut() -> PoolEntry<T>,
{
    let entry = {
        let mut guard = pool.lock().await;
        match guard.take() {
            Some(e) => e,
            None => guard.spawn_fresh(),
        }
    };

    let outcome = tokio::time::timeout(timeout, entry.proc.grade(prompt)).await;

    {
        let mut guard = pool.lock().await;
        guard.replenish();
    }

    match outcome {
        Ok(result) => result,
        Err(_) => Err(JudgeError::Timeout),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    /// A fake worker standing in for the child-process boundary: each variant
    /// exercises one transition of grade_with_pool's state machine without
    /// ever spawning a real OS process.
    enum FakeWorker {
        Succeeds(&'static str),
        DiesEarly,
        Hangs,
    }

    impl GradeWorker for FakeWorker {
        async fn grade(self, _prompt: String) -> Result<String, JudgeError> {
            match self {
                FakeWorker::Succeeds(s) => Ok(s.to_string()),
                FakeWorker::DiesEarly => Err(JudgeError::ClosedEarly),
                FakeWorker::Hangs => {
                    std::future::pending::<()>().await;
                    unreachable!()
                }
            }
        }
    }

    fn counting_factory<G: Fn() -> FakeWorker>(n: Arc<AtomicU32>, make: G) -> impl FnMut() -> PoolEntry<FakeWorker> {
        move || {
            n.fetch_add(1, Ordering::SeqCst);
            PoolEntry { proc: make(), alive: true }
        }
    }

    #[tokio::test]
    async fn empty_pool_falls_back_to_an_ad_hoc_fresh_spawn_and_still_grades() {
        let spawns = Arc::new(AtomicU32::new(0));
        let pool = Mutex::new(WarmPool::new(2, counting_factory(spawns.clone(), || FakeWorker::Succeeds("ok"))));

        let result = grade_with_pool(&pool, "q".to_string(), Duration::from_secs(1)).await;

        assert_eq!(result.unwrap(), "ok");
        // 1 ad-hoc fresh spawn (pool was empty) + 2 more to replenish back to target_size=2
        assert_eq!(spawns.load(Ordering::SeqCst), 3);
        assert_eq!(pool.lock().await.size(), 2);
    }

    #[tokio::test]
    async fn a_warm_hit_skips_the_ad_hoc_spawn() {
        let spawns = Arc::new(AtomicU32::new(0));
        let pool = Mutex::new(WarmPool::new(1, counting_factory(spawns.clone(), || FakeWorker::Succeeds("warm"))));
        pool.lock().await.replenish(); // pre-warm one spare, as pool construction would
        assert_eq!(spawns.load(Ordering::SeqCst), 1);

        let result = grade_with_pool(&pool, "q".to_string(), Duration::from_secs(1)).await;

        assert_eq!(result.unwrap(), "warm");
        // 1 pre-warm + 1 replenish-after — never a 2nd (ad-hoc) spawn for this grade
        assert_eq!(spawns.load(Ordering::SeqCst), 2);
        assert_eq!(pool.lock().await.size(), 1);
    }

    #[tokio::test]
    async fn single_use_never_returns_a_graded_entry_to_the_pool() {
        let spawns = Arc::new(AtomicU32::new(0));
        let pool = Mutex::new(WarmPool::new(1, counting_factory(spawns.clone(), || FakeWorker::Succeeds("once"))));
        pool.lock().await.replenish();

        grade_with_pool(&pool, "q".to_string(), Duration::from_secs(1)).await.unwrap();

        // pool was drained to 0 by take(), then replenished back to 1 (never 2),
        // proving the graded entry itself was discarded, not recycled.
        assert_eq!(pool.lock().await.size(), 1);
        assert_eq!(spawns.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn mid_grade_death_surfaces_as_an_error_and_the_pool_still_self_heals() {
        let spawns = Arc::new(AtomicU32::new(0));
        let pool = Mutex::new(WarmPool::new(1, counting_factory(spawns.clone(), || FakeWorker::DiesEarly)));
        pool.lock().await.replenish();

        let result = grade_with_pool(&pool, "q".to_string(), Duration::from_secs(1)).await;

        assert!(matches!(result, Err(JudgeError::ClosedEarly)));
        assert_eq!(pool.lock().await.size(), 1); // replenished for the next caller regardless
    }

    #[tokio::test]
    async fn a_hung_worker_times_out_and_the_pool_still_self_heals() {
        let spawns = Arc::new(AtomicU32::new(0));
        let pool = Mutex::new(WarmPool::new(1, counting_factory(spawns.clone(), || FakeWorker::Hangs)));
        pool.lock().await.replenish();

        let result = grade_with_pool(&pool, "q".to_string(), Duration::from_millis(30)).await;

        assert!(matches!(result, Err(JudgeError::Timeout)));
        assert_eq!(pool.lock().await.size(), 1);
    }

    // --- Real (non-mocked) process-boundary coverage -----------------------
    // The tests above mock the child-process boundary per the pool's own
    // testing contract; these two exercise ClaudeChild::grade's actual NDJSON
    // stdin/stdout handling against a REAL OS process — /bin/sh standing in
    // for `claude` so the test is deterministic and needs no CLI install.

    #[cfg(unix)]
    #[tokio::test]
    async fn claude_child_grade_reads_a_real_process_stdout_end_to_end() {
        let child = tokio::process::Command::new("/bin/sh")
            .arg("-c")
            // drain exactly one line of stdin (the NDJSON user message), then
            // reply with a terminal `result` event, matching the real protocol.
            .arg(r#"read _line; printf '%s\n' '{"type":"result","is_error":false,"result":"echoed"}'"#)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .expect("spawn /bin/sh");
        let worker = ClaudeChild(Ok(child));

        let result = worker.grade("hello".to_string()).await;

        assert_eq!(result.unwrap(), "echoed");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn claude_child_grade_detects_a_process_that_closes_before_a_result() {
        let child = tokio::process::Command::new("/bin/sh")
            .arg("-c")
            .arg("read _line") // exits right after reading — never writes a result line
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .expect("spawn /bin/sh");
        let worker = ClaudeChild(Ok(child));

        let result = worker.grade("hello".to_string()).await;

        assert!(matches!(result, Err(JudgeError::ClosedEarly)));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn claude_child_grade_reports_a_spawn_failure_without_touching_a_process() {
        let worker = ClaudeChild(Err("claude CLI not found (set FABLEWOOD_CLAUDE_BIN)".to_string()));

        let result = worker.grade("hello".to_string()).await;

        assert!(matches!(result, Err(JudgeError::Spawn(_))));
    }

    /// Ignored by default: spawns REAL `claude` subscription-CLI processes (no
    /// API key involved) and costs real wall-clock time, so it doesn't run as
    /// part of the normal fast unit-test suite. Re-verify the tier-1 warm-pool
    /// path end-to-end against a live CLI with:
    ///   cargo test --ignored claude_judge_pool_warm_grade_smoke -- --nocapture
    ///
    /// Two grades against the SAME pool, mirroring judge-worker.ts's own
    /// measurement methodology (see that file's doc comment): grade #1 hits an
    /// empty pool (ad-hoc fresh spawn, ~cold); a short real sleep then gives
    /// the spares replenish() spawned after grade #1 time to finish booting
    /// before grade #2, which should hit one of them warm.
    #[tokio::test]
    #[ignore]
    async fn claude_judge_pool_warm_grade_smoke() {
        let pool = ClaudeJudgePool::new();
        let prompt = "Respond with STRICT JSON only, no prose, no markdown fence: \
                       {\"verdict\":\"pass\",\"line\":\"ok\"}";

        let t0 = std::time::Instant::now();
        let first = grade_with_warm_worker(&pool, prompt).await;
        println!("[smoke] grade #1 (pool was empty, ad-hoc fresh spawn) in {:?}: {first:?}", t0.elapsed());
        assert!(first.is_ok(), "first warm grade failed: {first:?}");

        tokio::time::sleep(Duration::from_secs(5)).await;

        let t1 = std::time::Instant::now();
        let second = grade_with_warm_worker(&pool, prompt).await;
        println!("[smoke] grade #2 (should hit a pre-warmed spare) in {:?}: {second:?}", t1.elapsed());
        assert!(second.is_ok(), "second warm grade failed: {second:?}");
    }
}
