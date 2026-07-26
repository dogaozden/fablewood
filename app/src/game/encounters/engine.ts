/**
 * Encounter selection + reskin — PURE (no DOM), so it unit-tests in the node vitest env.
 * The overlay UI (styles.ts / overlay.ts / kinds.ts) is the only DOM-touching layer.
 *
 * pick(): the due queue DRIVES selection — req.factIds is priority order (earliest = most
 * due), and we return the first kind-matching encounter that teaches the earliest due fact.
 * reskin(): deterministic surface randomization for anti-staleness (Fable_SPEC §2 "Reskin on
 * repeat") — same (encounter, seed) always yields the same output; correctness never moves.
 */
import type { EncounterRequest, EncounterResult, Quality } from '../contracts';
import type { Encounter, EncounterDifficulty, Pack } from '../../packs/types';

// --- deterministic RNG (mulberry32, matching the boot scene's seed discipline) ---

export function makeRng(seed: number): () => number {
  let a = (seed | 0) ^ 0x9e3779b9;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- selection ---------------------------------------------------------------

export function difficultyOf(e: Encounter): EncounterDifficulty {
  return (e.difficulty as EncounterDifficulty | undefined) ?? 2;
}

/** Stamp the resolved encounter's effective difficulty at the runner choke point. */
export function stampDifficulty(result: EncounterResult, encounter: Encounter): EncounterResult {
  return { ...result, difficulty: difficultyOf(encounter) };
}

// Tier 3 is a PREFERENCE (only difficulty 3 counts eligible); tiers 1-2 are FLOORS (>= tier).
// Both fall back to the wider pool when the narrowed pool is empty (see pick() below).
function difficultyEligible(e: Encounter, tier: 1 | 2 | 3): boolean {
  return tier === 3 ? difficultyOf(e) === 3 : difficultyOf(e) >= tier;
}

/**
 * Choose an encounter for a request. Precedence:
 *  1. req.encounterId (boss phases / parley gates force a specific encounter)
 *  2. due-first: the earliest fact in req.factIds that a kind-matching encounter teaches
 *  3. any kind-matching encounter
 *  4. any encounter at all
 */
export function pick(req: EncounterRequest, packs: Pack[]): Encounter | null {
  const pack = packs.find((p) => p.meta.id === req.packId) ?? packs[0];
  const all = pack?.encounters ?? [];
  if (!all.length) return null;

  if (req.encounterId) {
    const forced = all.find((e) => e.id === req.encounterId);
    if (forced) return forced;
  }

  const kinds = req.kinds;
  const kindMatches = (e: Encounter) => !kinds || kinds.length === 0 || kinds.includes(e.kind);
  let candidates = all.filter(kindMatches);

  if (req.spellTier) {
    const narrowed = candidates.filter((e) => difficultyEligible(e, req.spellTier!));
    if (narrowed.length) candidates = narrowed; // else honest fallback: keep the wider pool
  }

  for (const factId of req.factIds ?? []) {
    const hit = candidates.find((e) => e.fact_ids.includes(factId));
    if (hit) return hit;
  }

  if (candidates.length) return candidates[0];
  return all[0];
}

// --- reskin ------------------------------------------------------------------

/** Replace {{var}} tokens in a single string. Unknown vars are left verbatim. */
function substitute(s: string, vars: Record<string, string>): string {
  return s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Recursively substitute {{var}} in any string within a JSON-like value. */
function substituteDeep(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') return substitute(value, vars);
  if (Array.isArray(value)) return value.map((v) => substituteDeep(v, vars));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = substituteDeep(v, vars);
    return out;
  }
  return value;
}

/**
 * Deterministic reskin: resolve template_vars pools, substitute {{var}} everywhere, then
 * seed-shuffle the surface order per kind. Correctness survives because it is tracked by
 * value (mcq/match/order compare against the substituted `answer`) or by flag (branches).
 */
export function reskin(encounter: Encounter, seed: number): Encounter {
  const rng = makeRng(seed);
  const e: Encounter = structuredClone(encounter);

  // 1. resolve each template var to one concrete value (arrays are pools; scalars pass through)
  const vars: Record<string, string> = {};
  const tv = (e.template_vars ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(tv)) {
    const val = tv[key];
    if (Array.isArray(val) && val.length) vars[key] = String(val[Math.floor(rng() * val.length)]);
    else if (val != null && typeof val !== 'object') vars[key] = String(val);
  }

  // 2. substitute into every player-visible field (and the answer, to keep equality holding)
  e.prompt = substitute(e.prompt, vars);
  if (e.options) e.options = substituteDeep(e.options, vars) as unknown[];
  if (e.branches) e.branches = substituteDeep(e.branches, vars) as Encounter['branches'];
  if (e.answer !== undefined) e.answer = substituteDeep(e.answer, vars) as Encounter['answer'];
  if (typeof e.rubric === 'string') e.rubric = substitute(e.rubric, vars);

  // 3. seeded surface shuffle (anti-staleness); the answer/flags are untouched
  if (e.kind === 'mcq' && Array.isArray(e.options)) {
    e.options = seededShuffle(e.options, rng);
  } else if (e.kind === 'order' && Array.isArray(e.options)) {
    e.options = seededShuffle(e.options, rng);
    // never hand the ritual over pre-solved: ~1/n! of seeds shuffle straight back
    // into the answer arrangement — rotate one step (deterministic, seed-stable)
    if (
      Array.isArray(e.answer) &&
      e.options.length > 1 &&
      JSON.stringify(e.options) === JSON.stringify(e.answer)
    ) {
      e.options = [...e.options.slice(1), e.options[0]];
    }
  } else if (e.kind === 'match' && Array.isArray(e.options)) {
    e.options = e.options.map((col) => (Array.isArray(col) ? seededShuffle(col, rng) : col));
  } else if (e.kind === 'scenario_branch' && Array.isArray(e.branches)) {
    e.branches = seededShuffle(e.branches, rng);
  }

  return e;
}

// --- scoring (used by the match/order overlays; pure so they unit-test) -------

/** all pairs correct → 1; at least half → 0.5; else 0. */
export function scoreMatch(
  userPairs: ReadonlyArray<readonly [string, string]>,
  answerPairs: ReadonlyArray<readonly [string, string]>,
): Quality {
  if (!answerPairs.length) return 0;
  const key = (p: readonly [string, string]) => `${p[0]}\x00${p[1]}`;
  const answer = new Set(answerPairs.map(key));
  let correct = 0;
  for (const p of userPairs) if (answer.has(key(p))) correct++;
  const ratio = correct / answerPairs.length;
  return ratio >= 1 ? 1 : ratio >= 0.5 ? 0.5 : 0;
}

/** longest correct prefix: full → 1; at least half → 0.5; else 0. */
export function scoreOrder(userOrder: readonly string[], answerOrder: readonly string[]): Quality {
  if (!answerOrder.length) return 0;
  let prefix = 0;
  for (let i = 0; i < answerOrder.length; i++) {
    if (userOrder[i] === answerOrder[i]) prefix++;
    else break;
  }
  const ratio = prefix / answerOrder.length;
  return ratio >= 1 ? 1 : ratio >= 0.5 ? 0.5 : 0;
}
