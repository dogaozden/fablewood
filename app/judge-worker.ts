/**
 * The Laconic Clerk's warm worker — a small pool of pre-spawned `claude`
 * processes so repeat grades skip the CLI boot cost a fresh `claude -p` pays
 * every time (Fable_SPEC judge queue item 7; augments vite-judge-plugin.ts's
 * per-call spawn, which stays in place as the fallback tier — see grade()
 * there). Lives outside app/src for the same reason vite-judge-plugin.ts
 * does: it uses node's child_process, and the app tsconfig compiles all of
 * app/src without node types.
 *
 * Mechanism: `claude -p --input-format stream-json --output-format
 * stream-json` keeps ONE process alive, emitting NDJSON events on stdout in
 * response to a single NDJSON user message written to stdin — the same raw
 * primitive the Claude Agent SDK's streaming mode wraps. Using the CLI
 * directly here (instead of adding the @anthropic-ai/claude-agent-sdk
 * dependency) sidesteps that package's own published guidance against
 * third-party products relying on subscription/claude.ai login through the
 * SDK, while getting the identical effect: the child process authenticates
 * exactly the way today's `claude -p` spawn already does (subscription CLI
 * session, NO API key, same credential store).
 *
 * Isolation: every pooled process is used for exactly ONE grade, then
 * killed — never a second turn on the same process. A grade therefore
 * always gets a categorically fresh context (nothing to leak between
 * grades) without needing to prove a shared session stays clean. The boot
 * cost is still amortized because processes are pre-spawned BEFORE a grade
 * request exists: by the time a real prompt arrives, an idle spare has
 * usually already finished booting and authenticating and is just sitting
 * at stdin waiting.
 *
 * Measured 2026-07-20: a synthetic probe (trivial prompt, no CLAUDE.md
 * context, this shell) showed the core hypothesis holds — a brand-new
 * stream-json process's first turn landed in ~4.1s, a second turn sent to
 * an already-idle process on the SAME process landed in ~2.1s, vs ~10.9s
 * for today's plain `claude -p "<prompt>"` argv spawn on the same trivial
 * prompt. Real end-to-end grades through POST /api/judge (real vc-law
 * fixtures, the actual Clerk persona prompt, this project's CLAUDE.md
 * loaded into every call) landed higher — ~8.8-14.7s on a successful warm
 * (tier-1) hit — with visible variance from other Claude sessions active
 * on the same subscription concurrently during testing; see the worktree
 * report for the full honest numbers and the timeout-tuning history below.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { WarmPool, type PoolEntry } from './src/judge/warm-pool';
import { parseWorkerLine } from './src/judge/parse-worker-line';

// One spare amortizes boot cost for the common case (one grade in flight at
// a time); a second absorbs the rare overlap of two encounters resolving
// back-to-back. Kept small — this is a single-player dev server, not a
// multi-tenant service.
const POOL_TARGET_SIZE = 2;

// Real end-to-end grades against this project (2026-07-20, via /api/judge,
// real vc-law fixtures — not a bare scratchpad) landed anywhere from ~6.5s
// to ~15.5s on a successful attempt (warm or cold), with visible variance
// from other Claude sessions active on the same subscription concurrently
// (this is a shared dev account, not an isolated benchmark). An earlier,
// shorter cap (15s, then 18s) repeatedly killed attempts that were still
// legitimately in flight, forcing a wasteful double-pay: kill tier 1 at the
// cap, then re-spend the old spawn path's own up-to-20s budget on tier 2
// for equivalent work. Matching the old path's 20s cap here removes that
// bias — tier 1 gets the same generous budget tier 2 already relies on, so
// a slow-but-progressing attempt finishes on tier 1 instead of being killed
// just short of success. Worst case if tier 1 is genuinely wedged (not just
// slow) is ~40s before the heuristic, vs today's single 20s — that only
// bites on a true double failure, which every real run so far has avoided.
const WORKER_TIMEOUT_MS = 20_000;

const SPAWN_ARGS = [
  '-p',
  '--model', 'haiku',
  '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose', // required by the CLI when --output-format=stream-json is combined with --print
  '--no-session-persistence', // the Clerk is a backend judge, not a resumable chat — don't clutter `claude --resume`
];

function spawnWarmProcess(): PoolEntry<ChildProcessWithoutNullStreams> {
  const child = spawn('claude', SPAWN_ARGS, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
  const entry: PoolEntry<ChildProcessWithoutNullStreams> = { proc: child, alive: true };
  child.on('exit', () => {
    entry.alive = false;
  });
  child.on('error', () => {
    entry.alive = false;
  });
  return entry;
}

const pool = new WarmPool<ChildProcessWithoutNullStreams>(POOL_TARGET_SIZE, spawnWarmProcess);

// Best-effort cleanup so a Ctrl-C / npm-script-stop doesn't leave idle
// `claude` spares waiting on a stdin that will never get a message. A
// `kill -9` on this process can't be caught, but this covers the normal
// shutdown paths, which is all a dev-server judge needs.
process.on('exit', () => {
  pool.forEach((entry) => {
    if (entry.alive) entry.proc.kill('SIGKILL');
  });
});

/** Run exactly one grading turn on `entry`, then always kill it — a pooled
 *  process is single-use by design (see the isolation note above). */
function runTurn(entry: PoolEntry<ChildProcessWithoutNullStreams>, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = entry.proc;
    let buf = '';
    let settled = false;

    const finish = (err: Error | null, text?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.removeAllListeners('data');
      child.kill('SIGKILL');
      if (err) reject(err);
      else resolve(text as string);
    };

    const timer = setTimeout(() => finish(new Error('warm worker timeout')), WORKER_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const result = parseWorkerLine(line);
        if (result.kind === 'success') finish(null, result.text);
        else if (result.kind === 'error') finish(new Error(result.message));
        // 'pending' → keep reading (system/assistant/rate_limit_event, etc.)
      }
    });
    child.on('error', (e) => finish(e));
    child.on('close', (code) => finish(new Error(`warm worker closed early code=${code}`)));
    child.stdin.on('error', (e) => finish(e as Error));

    const userMessage =
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: prompt }] },
      }) + '\n';
    try {
      child.stdin.write(userMessage);
    } catch (e) {
      finish(e as Error);
    }
  });
}

/**
 * Grade one prompt via the warm pool. Lazily starts the pool on first call —
 * an empty pool means this call pays the same cold cost today's per-call
 * spawn does (see the doc comment above), it does not slow server boot.
 * Every call replenishes the pool afterward so the NEXT grade has a warm
 * spare ready, whether this one succeeded or not — that is the auto-restart
 * on crash/wedge: a dead or wedged-then-killed process is simply not
 * returned to the pool, and replenish() spawns its replacement. Concurrent
 * calls are safe without any lock because each one gets its own dedicated
 * process (from the pool, or freshly spawned if the pool is empty) — there
 * is no shared mutable session for two in-flight grades to contend over.
 *
 * Throws on any failure (timeout, spawn error, non-success result, or an
 * unparseable/empty response). The caller (vite-judge-plugin.ts's grade())
 * catches this and falls back to the old spawn path, then the heuristic,
 * exactly as it already does for the old path's own failures.
 */
export async function gradeWithWarmWorker(prompt: string): Promise<string> {
  const entry = pool.take() ?? spawnWarmProcess();
  try {
    return await runTurn(entry, prompt);
  } finally {
    pool.replenish();
  }
}
