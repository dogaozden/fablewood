/**
 * Deterministic offline judge — PURE (no node, no DOM), so it runs identically in the vite
 * plugin (node), the browser client fallback, and vitest. Used when JUDGE_MODE=stub, when
 * `claude -p` is unreachable, or in a static build with no dev bridge. Never throws.
 *
 * Heuristic: normalized keyword overlap of the answer against the rubric's content words.
 * Rubrics are written in a tiered house style ("Full credit for X… Partial credit for Y…
 * No credit for Z (the classic trap)"): "No credit" sentences describe a WRONG answer, so
 * their words are stripped from the key set before scoring — else a trap word (e.g. a wrong
 * number the rubric calls out by name) would count FOR the very answer that names it.
 * Plain, untiered rubrics (no "Full credit" prose) are unaffected — nothing to strip.
 *
 * The overlap denominator is `max(2, min(|keys|, |answer words|))`: terse-but-correct answers
 * ("Economics and control.", "25%") must be able to reach pass/partial even though they don't
 * repeat the rubric's whole prose (the `min` side), while a single fished keyword is capped at
 * 0.5 by the floor of 2 (so it lands partial, never pass), and a verbose answer still has to
 * cover the full key set (`min` never exceeds `|keys|`).
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

/** A token with a digit only needs length ≥2 ("25", "8m", "2m" stay gradable); a pure-alpha
 *  token keeps the ≥3 floor (kills "the", "is", ... noise the STOP list doesn't already catch). */
function contentWords(s: string): string[] {
  const tokens = s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return tokens.filter((t) => {
    if (STOP.has(t)) return false;
    return /[0-9]/.test(t) ? t.length >= 2 : t.length >= 3;
  });
}

/** Split a rubric into rough sentences and drop any that grade a WRONG answer ("No credit…",
 *  case-insensitive) before extracting keywords — the tiered house style's trap sentences
 *  describe what the answer should NOT say, so their words must never become keys. Falls back
 *  to the whole rubric if stripping leaves nothing gradable (backward compat with plain
 *  rubrics, e.g. the dev fixture pack's, that carry no "Full credit"/"No credit" tiers at all). */
function keyWords(rubric: string): string[] {
  const sentences = rubric.split(/(?<=[.!?])\s+/).filter(Boolean);
  const kept = sentences.filter((s) => !/^\s*no credit/i.test(s));
  const stripped = contentWords(kept.join(' '));
  return stripped.length ? stripped : contentWords(rubric);
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
  const keys = new Set(keyWords(rubric));
  let overlap: number;
  if (keys.size === 0) {
    overlap = answer.trim().length > 0 ? 0.5 : 0; // no gradable rubric → lean on presence
  } else {
    const answerWords = new Set(contentWords(answer));
    let hit = 0;
    for (const k of keys) if (answerWords.has(k)) hit++;
    const denom = Math.max(2, Math.min(keys.size, answerWords.size));
    overlap = hit / denom;
  }
  const verdict: JudgeVerdict['verdict'] = overlap >= 0.6 ? 'pass' : overlap >= 0.25 ? 'partial' : 'fail';
  return { verdict, line: clerkLine(verdict, answer) };
}
