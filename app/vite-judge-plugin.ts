/**
 * The Laconic Clerk — dev-server judge bridge (Fable_SPEC §2, slice-blueprint §2).
 * POST /api/judge {prompt, answer, rubric} → {verdict, line}.
 *
 * Lives outside app/src on purpose: it uses node APIs (child_process), and the app
 * tsconfig compiles all of app/src without node types. The node tsconfig picks this up
 * through the vite.config.ts import instead — mirroring app/src/bridge/plugin.ts.
 *
 *   JUDGE_MODE=stub → deterministic heuristic (e2e + offline).
 *   otherwise       → spawn `claude -p … --model haiku`, 45s cap, STRICT-JSON out.
 *
 * The game must never hang on the Clerk: spawn error / timeout / unparseable output all
 * fall back to the stub's verdict with the "away from his desk" line.
 */
import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { stubJudge, AWAY_LINE, type JudgeArgs } from './src/judge/stub';
import type { JudgeVerdict } from './src/game/contracts';

const TIMEOUT_MS = 45_000;

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
    const child = spawn('claude', ['-p', prompt, '--model', 'haiku'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
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
  if (process.env.JUDGE_MODE === 'stub') return stubJudge(args);
  try {
    const parsed = parseVerdict(await runClaude(buildPrompt(args)));
    if (parsed) return parsed;
  } catch {
    // fall through to the away-from-desk fallback below
  }
  // keep a fair grade (stub verdict) but tell the player the Clerk was away
  return { ...stubJudge(args), line: AWAY_LINE };
}

export function fablewoodJudge(): Plugin {
  return {
    name: 'fablewood-judge',
    configureServer(server: ViteDevServer) {
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
