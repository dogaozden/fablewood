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

/**
 * Shared presentation metadata for the encounter difficulty axis (§1, §7).
 *
 * Two colours per tier, because the badge is drawn on two grounds. `tint` is the canvas
 * colour — lantern-bright, authored to glow against the dusk-dark Phaser stage. `panelInk`
 * is the same hue pulled down into ink for the cream parchment overlay, where the bright
 * tints wash out (Lantern's gold lands at ~1.1:1 on parchment — effectively invisible).
 * Harder tiers read heavier, so the ladder darkens as it climbs.
 */
export const DIFFICULTY_DEFS: Record<
  EncounterDifficulty,
  { name: string; glyph: string; tint: number; panelInk: string }
> = {
  1: { name: 'Ember', glyph: '▫', tint: 0xd2792c, panelInk: '#8f4a0c' },
  2: { name: 'Lantern', glyph: '◧', tint: 0xf7ce6b, panelInk: '#7a5610' },
  3: { name: 'Beacon', glyph: '■', tint: 0xa65420, panelInk: '#7c2e17' },
};

/** Short policy badge for the tier flyout: floors use +, T3's preference uses ?. */
export function difficultyPolicyGlyph(tier: EncounterDifficulty): string {
  return `${DIFFICULTY_DEFS[tier].glyph}${tier === 3 ? '?' : '+'}`;
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
 *
 * Deliberately carries NO supersession filter (supersession-reteach.md §4): a valid pack
 * cannot contain an encounter teaching a superseded fact (validator invariant,
 * pipeline/validate_pack.mjs), so encounter-level runtime filtering would be dead code
 * guarding an impossible state. Suspension is enforced upstream, on the factIds that reach
 * this function — see srs/amendments.ts.
 *
 * `encountersOf` (services.draw.encountersOf, wave-1 draw service) is per-fact source
 * resolution for step 2 ONLY (the due-queue loop): req.packId's own pack (`all`/
 * `candidates` below) is, and stays, the ENTIRE scope for step 1 (forced req.encounterId),
 * step 3 (any kind-match — candidates[0]) and step 4 (any encounter at all — all[0]) — none
 * of those three are touched by encountersOf, deliberately, so a cross-pack encounter can
 * never shadow (or, worse, id-collide with and silently replace) a req.packId-owned one for
 * those tiers. Only the due-queue loop additionally consults encountersOf(factId), per
 * factId, because the due queue is global now — the fact teaching it may be installed in a
 * different pack than packId. `tierNarrowed` mirrors, for that loop, the exact narrow-vs-
 * honest-fallback decision `candidates` just made over the pack-scoped pool, so a cross-pack
 * candidate is held to the identical kind+tier bar as a pack-scoped one would be. Omitted
 * (2-arg callers, e.g. engine.test.ts's single-pack fixtures): the loop falls back to
 * searching `candidates` exactly as before — byte-for-byte unchanged.
 */
export function pick(
  req: EncounterRequest,
  packs: Pack[],
  encountersOf?: (factId: string) => Encounter[],
): Encounter | null {
  const pack = packs.find((p) => p.meta.id === req.packId) ?? packs[0];
  const all = pack?.encounters ?? [];
  if (!all.length) return null;

  if (req.encounterId) {
    const forced = all.find((e) => e.id === req.encounterId);
    if (forced) return forced;
  }

  const kinds = req.kinds;
  const kindMatches = (e: Encounter) => !kinds || kinds.length === 0 || kinds.includes(e.kind);
  const kindOnly = all.filter(kindMatches);
  let candidates = kindOnly;
  let tierNarrowed = false;

  if (req.spellTier) {
    const narrowed = kindOnly.filter((e) => difficultyEligible(e, req.spellTier!));
    if (narrowed.length) {
      candidates = narrowed; // else honest fallback: keep the wider pool
      tierNarrowed = true;
    }
  }

  for (const factId of req.factIds ?? []) {
    if (encountersOf) {
      const hit = encountersOf(factId).find(
        (e) => kindMatches(e) && (!tierNarrowed || difficultyEligible(e, req.spellTier!)),
      );
      if (hit) return hit;
    } else {
      const hit = candidates.find((e) => e.fact_ids.includes(factId));
      if (hit) return hit;
    }
  }

  if (candidates.length) return candidates[0];
  return all[0];
}

/**
 * Ch. VI M3 — the re-present guard's pure core: what WOULD pick() choose for a would-be
 * re-present request, without drawing (reuses pick()'s own resolution verbatim; zero
 * draw-census impact — Global Constraint 3, "previewPick is a pure engine export, NOT a
 * draw"). Callers compare the returned id to the original result's encounterId: equal means
 * the remainder would only re-surface the SAME encounter (e.g. a single-encounter fallback
 * the narrowed factIds never touch), so the caller should take the fate-holds path instead of
 * spending the lantern on a redraw that would change nothing.
 */
export function previewPick(
  req: EncounterRequest,
  packs: Pack[],
  encountersOf?: (factId: string) => Encounter[],
): string | null {
  return pick(req, packs, encountersOf)?.id ?? null;
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
