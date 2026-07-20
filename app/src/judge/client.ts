/**
 * Browser-side judge. POSTs the cast-from-memory answer to the dev bridge (/api/judge),
 * which shells out to the Laconic Clerk (`claude -p`). If the bridge is unreachable — a
 * static build, a dev-server hiccup — it falls back to the deterministic stub so combat
 * NEVER hangs on the judge.
 */
import type { Judge, JudgeVerdict } from '../game/contracts';
import { stubJudge } from './stub';
import { isTauri } from '../bridge/native';
import { nativeJudge } from './native';

function isVerdict(v: unknown): v is JudgeVerdict {
  return (
    !!v &&
    typeof v === 'object' &&
    'verdict' in v &&
    ((v as JudgeVerdict).verdict === 'pass' ||
      (v as JudgeVerdict).verdict === 'partial' ||
      (v as JudgeVerdict).verdict === 'fail') &&
    typeof (v as JudgeVerdict).line === 'string'
  );
}

export interface LastGrade {
  verdict: JudgeVerdict['verdict'];
  line: string;
  latencyMs?: number;
  tier?: string;
  /** when this client recorded it (epoch ms) — session-only, never persisted. */
  ts: number;
}

let lastGrade: LastGrade | null = null;

/** The most recent judge verdict this session, for the Settings latency display.
 *  In-memory only (dev/debug signal, not gameplay state) — resets on reload. */
export function getLastGrade(): LastGrade | null {
  return lastGrade;
}

/** Record a verdict as the last grade, preferring the server/native-supplied
 *  latency+tier and falling back to a client-measured one when absent. Returns the
 *  verdict unchanged so call sites can keep using it as a plain passthrough. */
export function noteLastGrade(v: JudgeVerdict, fallbackLatencyMs?: number, fallbackTier?: string): JudgeVerdict {
  lastGrade = {
    verdict: v.verdict,
    line: v.line,
    latencyMs: v.latencyMs ?? fallbackLatencyMs,
    tier: v.tier ?? fallbackTier,
    ts: Date.now(),
  };
  return v;
}

export const judge: Judge = async ({ prompt, answer, rubric }) => {
  const t0 = Date.now();
  if (isTauri()) {
    const v = await nativeJudge({ prompt, answer, rubric });
    return noteLastGrade(v, Date.now() - t0, 'native');
  }
  try {
    const res = await fetch('/api/judge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, answer, rubric }),
    });
    if (!res.ok) throw new Error(`judge http ${res.status}`);
    const data: unknown = await res.json();
    if (isVerdict(data)) return noteLastGrade(data, Date.now() - t0, 'http');
    throw new Error('malformed verdict');
  } catch {
    const v = stubJudge({ prompt, answer, rubric });
    return noteLastGrade(v, Date.now() - t0, 'client-stub');
  }
};
