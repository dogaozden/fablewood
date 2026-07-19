/**
 * Deterministic offline judge — PURE (no node, no DOM), so it runs identically in the vite
 * plugin (node), the browser client fallback, and vitest. Used when JUDGE_MODE=stub, when
 * `claude -p` is unreachable, or in a static build with no dev bridge. Never throws.
 *
 * Heuristic: normalized keyword overlap of the answer against the rubric's content words.
 *   overlap ≥ 0.6 → pass · ≥ 0.25 → partial · else fail.
 */
import type { JudgeVerdict } from '../game/contracts';

export interface JudgeArgs {
  prompt: string;
  answer: string;
  rubric: string;
}

// Boilerplate the rubric author uses to describe grading, not the fact itself.
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'to', 'of', 'in', 'on', 'for', 'is', 'are',
  'be', 'it', 'its', 'as', 'at', 'by', 'that', 'this', 'with', 'you', 'your', 'answer',
  'credit', 'says', 'said', 'say', 'when', 'which', 'must', 'not', 'no', 'before', 'after',
  'than', 'then', 'only', 'any', 'all', 'can', 'will', 'should', 'about', 'give', 'given',
  'mentions', 'mention', 'states', 'state', 'correct', 'they', 'their', 'them', 'has', 'have',
]);

function contentWords(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 3 && !STOP.has(t));
}

export const CLERK_LINES: Record<JudgeVerdict['verdict'], string[]> = {
  pass: [
    'The Ledger is satisfied.',
    'Recorded, and correct.',
    'The ink holds. Well cast.',
    'So the record stands.',
  ],
  partial: [
    'Half-remembered. The Ledger notes it.',
    'Nearly — the margin frays.',
    'The shape is right; the detail is not.',
    'Partial hand. Return to it.',
  ],
  fail: [
    'The Ledger finds nothing.',
    'Unwritten. Come back when it welds.',
    'The Fade keeps this one, for now.',
    'No entry. The page stays blank.',
  ],
};

/** The line shown when the live Clerk (`claude -p`) is unreachable. */
export const AWAY_LINE = 'The Clerk is momentarily away from his desk.';

/** Deterministic dry line for a verdict, chosen by a stable hash of the answer. */
export function clerkLine(verdict: JudgeVerdict['verdict'], answer: string): string {
  const pool = CLERK_LINES[verdict];
  let h = 0;
  for (let i = 0; i < answer.length; i++) h = (Math.imul(h, 31) + answer.charCodeAt(i)) | 0;
  return pool[Math.abs(h) % pool.length];
}

export function stubJudge({ answer, rubric }: JudgeArgs): JudgeVerdict {
  const keys = new Set(contentWords(rubric));
  let overlap: number;
  if (keys.size === 0) {
    overlap = answer.trim().length > 0 ? 0.5 : 0; // no gradable rubric → lean on presence
  } else {
    const words = new Set(contentWords(answer));
    let hit = 0;
    for (const k of keys) if (words.has(k)) hit++;
    overlap = hit / keys.size;
  }
  const verdict: JudgeVerdict['verdict'] = overlap >= 0.6 ? 'pass' : overlap >= 0.25 ? 'partial' : 'fail';
  return { verdict, line: clerkLine(verdict, answer) };
}
