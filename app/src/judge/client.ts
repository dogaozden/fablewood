/**
 * Browser-side judge. POSTs the cast-from-memory answer to the dev bridge (/api/judge),
 * which shells out to the Laconic Clerk (`claude -p`). If the bridge is unreachable — a
 * static build, a dev-server hiccup — it falls back to the deterministic stub so combat
 * NEVER hangs on the judge.
 */
import type { Judge, JudgeVerdict } from '../game/contracts';
import { stubJudge } from './stub';

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

export const judge: Judge = async ({ prompt, answer, rubric }) => {
  try {
    const res = await fetch('/api/judge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, answer, rubric }),
    });
    if (!res.ok) throw new Error(`judge http ${res.status}`);
    const data: unknown = await res.json();
    if (isVerdict(data)) return data;
    throw new Error('malformed verdict');
  } catch {
    return stubJudge({ prompt, answer, rubric });
  }
};
