/**
 * The Laconic Clerk — dev-server judge bridge (Fable_SPEC §2, slice-blueprint §2).
 * POST /api/judge {prompt, answer, rubric} → {verdict, line}.
 *
 * Lives outside app/src on purpose: it uses node APIs (child_process), and the app
 * tsconfig compiles all of app/src without node types. The node tsconfig picks this up
 * through the vite.config.ts import instead — mirroring app/src/bridge/plugin.ts.
 *
 *   JUDGE_MODE=stub → deterministic heuristic (e2e + offline).
 *   otherwise       → 3-tier chain: warm worker pool (./judge-worker.ts — skips the CLI
 *                      boot cost when a pre-spawned spare is ready; see judge-worker.ts
 *                      for real measured latencies) → this file's own per-call
 *                      `claude -p … --model haiku` spawn (unchanged, 20s cap) →
 *                      heuristic. STRICT-JSON out at every tier.
 *
 * The game must never hang on the Clerk: spawn error / timeout / unparseable output at
 * any tier fall back to the next, ending at the stub's verdict with the "away from his
 * desk" line — and every fallback logs its layer + latency here, so "why did the Clerk
 * fail" is answerable.
 */
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { stubJudge, AWAY_LINE, type JudgeArgs } from './src/judge/stub';
import type { JudgeVerdict } from './src/game/contracts';
import { gradeWithWarmWorker, prewarmJudgePool } from './judge-worker';

// Measured 2026-07-19: with the user's MCP servers loading, a haiku one-shot ran
// 17–26s; with MCP disabled, 7–13s from an idle shell and a few seconds worse when
// the dev server is busy. Re-measured 2026-08-02 (4.4–14.4s): 20s left almost no
// headroom, so 60s — the deliberating quill covers the wait, and a wrong
// "Clerk is away" costs far more than a few extra seconds.
const TIMEOUT_MS = 60_000;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** The Clerk's grading instruction. He answers with STRICT JSON and nothing he'd regret. */
function buildPrompt({ prompt, answer, rubric }: JudgeArgs): string {
  return [
    "You are the Laconic Clerk, the Ledger's assessor in a cozy high-fantasy knowledge RPG.",
    'Grade the player\'s cast-from-memory answer against the rubric. Be fair but exacting:',
    'reward correct substance, ignore spelling and phrasing, do not credit an empty or evasive answer.',
    '',
    `QUESTION: ${prompt}`,
    `RUBRIC (what earns credit): ${rubric}`,
    `PLAYER'S ANSWER: ${answer}`,
    '',
    'Respond with STRICT JSON only — no prose, no markdown fence, no preamble:',
    '{"verdict":"pass"|"partial"|"fail","line":"<one dry in-world line the Clerk says, <=90 chars>"}',
    'verdict: pass = satisfies the rubric; partial = partially right or missing a key piece; fail = wrong or empty.',
    'The line is the Clerk speaking — terse, dry, never explains at length. One short sentence.',
    // A line that names the mechanism and names it WRONG teaches the miss instead of correcting
    // it. Observed: on the nonparticipating-preferred question the Clerk said "your preference
    // takes the greater spoil" when the rubric has the holder CONVERTING. Nudge, or say nothing.
    'The line must never contradict the rubric. If you name the rule or the figure, it must be the',
    "rubric's — otherwise just mark the answer wrong without explaining why.",
  ].join('\n');
}

/** Extract the first balanced {...} object from arbitrary text (tolerates a ```json fence). */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function parseVerdict(raw: string): JudgeVerdict | null {
  const json = firstJsonObject(raw);
  if (!json) return null;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const v = o.verdict;
    if (v !== 'pass' && v !== 'partial' && v !== 'fail') return null;
    let line = typeof o.line === 'string' ? o.line.trim() : '';
    if (!line) line = 'The Clerk marks the page.';
    if (line.length > 120) line = `${line.slice(0, 117)}…`;
    return { verdict: v, line };
  } catch {
    return null;
  }
}

/** Spawn the headless Clerk. Resolves stdout; rejects on nonzero exit, spawn error, timeout. */
function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // stdin ignored → the CLI gets immediate EOF and never waits on stdin.
    // The Clerk needs zero tools: skipping MCP server startup is a 3x latency win.
    const child = spawn(
      'claude',
      [
        '-p', prompt, '--model', 'haiku',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        // Closed-book grading: no user/project/local settings. See
        // src-tauri/src/judge.rs's tier-2 spawn for the measured rationale.
        '--setting-sources', '',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      },
    );
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('judge timeout'));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve(out);
      else reject(new Error(`claude exited ${code}: ${err.slice(0, 200)}`));
    });
  });
}

async function grade(args: JudgeArgs): Promise<JudgeVerdict> {
  if (process.env.JUDGE_MODE === 'stub') {
    const t0 = Date.now();
    return { ...stubJudge(args), latencyMs: Date.now() - t0, tier: 'stub-mode' };
  }
  const prompt = buildPrompt(args);

  // Tier 1: warm worker pool — kills the per-call CLI boot on repeat grades.
  const t0 = Date.now();
  try {
    const raw = await gradeWithWarmWorker(prompt);
    const parsed = parseVerdict(raw);
    if (parsed) {
      const latencyMs = Date.now() - t0;
      console.log(`[clerk] ${parsed.verdict} in ${latencyMs}ms (warm)`);
      return { ...parsed, latencyMs, tier: 'warm' };
    }
    console.warn(`[clerk] warm worker fallback: unparseable output after ${Date.now() - t0}ms → ${raw.slice(0, 80)}`);
  } catch (e) {
    console.warn(`[clerk] warm worker fallback: ${(e as Error).message} after ${Date.now() - t0}ms`);
  }

  // Tier 2: the original per-call spawn, unchanged — same safety net as before.
  const t1 = Date.now();
  try {
    const raw = await runClaude(prompt);
    const parsed = parseVerdict(raw);
    if (parsed) {
      const latencyMs = Date.now() - t1;
      console.log(`[clerk] ${parsed.verdict} in ${latencyMs}ms (spawn fallback)`);
      return { ...parsed, latencyMs, tier: 'spawn' };
    }
    console.warn(`[clerk] fallback: unparseable output after ${Date.now() - t1}ms → ${raw.slice(0, 80)}`);
  } catch (e) {
    console.warn(`[clerk] fallback: ${(e as Error).message} after ${Date.now() - t1}ms`);
  }

  // Tier 3: keep a fair grade (stub verdict) but tell the player the Clerk was away
  return { ...stubJudge(args), line: AWAY_LINE, latencyMs: Date.now() - t0, tier: 'away' };
}

export function fablewoodJudge(): Plugin {
  return {
    name: 'fablewood-judge',
    configureServer(server: ViteDevServer) {
      // Eagerly warm the Clerk pool at server boot (mirrors judge_pool.rs's prewarm() in the
      // native Tauri shell, called from main.rs's setup()) — the first real grade of a dev
      // session then already has a warm spare instead of cold-booting the CLI (see
      // judge-worker.ts's prewarmJudgePool doc comment for the measured numbers). Skipped
      // entirely under JUDGE_MODE=stub: that path never spawns a real `claude` process at
      // all (grade() below returns via stubJudge before ever touching the warm pool), so
      // prewarming here would just spawn real CLI processes no e2e/stub run will ever use.
      // ALSO skipped under vitest (process.env.VITEST, set by vitest itself): `npx vitest
      // run` builds its own internal Vite server from this same vite.config.ts plugin list
      // (confirmed empirically — a bare vitest run hung on shutdown for ~10s the first time
      // this guard only checked JUDGE_MODE, because it eagerly spawned two real, unused
      // `claude` processes whose open stdin pipes stalled the server's close), and no test
      // in the suite ever hits /api/judge — plain `npx vitest run` and `npm run
      // check:zero-packs` must both stay side-effect-free per this repo's verification
      // culture (AGENTS.md), and neither sets JUDGE_MODE. configureServer never runs at all
      // for `vite build`/`vite preview` (the static-build path), so that path is unaffected
      // either way.
      if (process.env.JUDGE_MODE !== 'stub' && !process.env.VITEST) {
        const n = prewarmJudgePool();
        console.log(`[clerk] warm pool ready (${n} workers)`);
      }
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (path !== '/api/judge') return next();
        if (req.method !== 'POST') {
          send(res, 405, { error: 'method not allowed' });
          return;
        }
        try {
          const body = await readBody(req);
          const parsed = body ? JSON.parse(body) : {};
          const args: JudgeArgs = {
            prompt: String(parsed.prompt ?? ''),
            answer: String(parsed.answer ?? ''),
            rubric: String(parsed.rubric ?? ''),
          };
          send(res, 200, await grade(args));
        } catch {
          // even a malformed request must not 500 the game
          send(res, 200, { verdict: 'partial', line: AWAY_LINE } satisfies JudgeVerdict);
        }
      });
    },
  };
}
