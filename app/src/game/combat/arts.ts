/**
 * Keeper's Rank + Glow (§5-6) — pure, Phaser-free, mirrors damage.ts/status.ts's pattern.
 * One GLOBAL rank derived from Leitner box distribution (not per-Art ladders — §6's
 * rationale: per-kind history would reward whichever kind the engine happened to deal, not
 * deliberate mastery — one rank off box counts keeps the promise legible and ungrindable).
 * Glow is the party-shared, per-battle resource that gates T2/T3 spells ON TOP of their
 * questions — it never gates tier 1 (soul S2: never cap questions).
 */
import type { ArtId } from './spells';
import type { EncounterKind, Quality } from '../contracts';

export interface ArtRanks {
  rank: 1 | 2 | 3;
  /** facts at box ≥3 among the battle's factIds — the Rank-2 gate count */
  welded3: number;
  /** facts at box ≥4 — the Rank-3 gate count AND the HUD's "X/8 welded toward Rank III" line (§12.3) */
  welded4: number;
}

export const RANK2_NEED = 8;
export const RANK3_NEED = 8;

/**
 * §6 — one global rank off Leitner box distribution. `boxOf` is the caller's synchronous
 * services.srs.boxOf; whatever it returns for an id it doesn't recognize (0, per the
 * existing SRS contract) simply fails both thresholds and counts toward neither bucket.
 */
export function computeRank(boxOf: (id: string) => number, factIds: string[]): ArtRanks {
  let welded3 = 0;
  let welded4 = 0;
  for (const id of factIds) {
    const box = boxOf(id);
    if (box >= 3) welded3++;
    if (box >= 4) welded4++;
  }
  const rank: 1 | 2 | 3 = welded4 >= RANK3_NEED ? 3 : welded3 >= RANK2_NEED ? 2 : 1;
  return { rank, welded3, welded4 };
}

export interface ArtMeta {
  art: ArtId;
  label: string;
  encounter: EncounterKind;
}

/**
 * §1's Five-Arts table, as data. Not in the team lead's literal bullet list, but named
 * explicitly by the design doc's own trap digest (§16 trap 5: "spells.ts exports SPELLBOOK,
 * arts.ts exports ARTS" — avoiding a THIRD same-named-export collision alongside
 * combat/types.ts's ACTIONS and encounters/dom.ts's ACTIONS). Added on that basis; flagged
 * in the handoff report as beyond the literal ask in case it's unwanted.
 */
export const ARTS: Record<ArtId, ArtMeta> = {
  kindling: { art: 'kindling', label: 'Kindling', encounter: 'mcq' },
  binding: { art: 'binding', label: 'Binding', encounter: 'match' },
  ritecraft: { art: 'ritecraft', label: 'Ritecraft', encounter: 'order' },
  attestation: { art: 'attestation', label: 'Attestation', encounter: 'free_recall' },
  courtcraft: { art: 'courtcraft', label: 'Courtcraft', encounter: 'scenario_branch' },
};

/**
 * Does lantern grace mean anything for this Art?
 *
 * Grace (§5, the shipped mercy) softens a MISS's damage quality from 0 to 0.5 while the SRS
 * record stays honest. That only does something when the Art's outcome is actually derived
 * from quality. Courtcraft's is not: its outcome comes from the scenario's branchTag
 * (kinds.ts renderScenario; damage.ts's Parley adapter re-derives its slot from branchTag and
 * ignores the quality argument entirely). Applying grace to a Parley therefore changed
 * NOTHING while still burning the once-per-battle charge and telling the player it had
 * helped — crucible-2 lantern-grace-false-banner.
 */
export function graceAppliesTo(art: ArtId): boolean {
  return art !== 'courtcraft';
}

/**
 * §9 — is this cast a boss NEGOTIATION beat: one that must advance the phase once answered?
 * (It also had to draw from the current phase's recallTags until wave 1; tags have since left
 * the draw path — design §5 — but the phase-advance duty below is untouched by that.)
 *
 * The rule is "an Attestation aimed at the boss", at ANY tier. The T1 path expressed it as
 * `action === 'cast' && vsBoss`, which is the same statement for the only tier it could see;
 * once Rank 2/3 opened Attested Ward and Verbatim Decree, that spelling silently excluded
 * them, so a T2/T3 Attestation at the Warden drew from roomTags instead of the phase's
 * recallTags and never advanced phaseIndex — letting a high-Rank player strip shields while
 * skipping the mandatory phase branches entirely (crucible-2 attestation-phase-skip).
 */
export function isBossPhaseCast(art: ArtId | undefined, vsBoss: boolean): boolean {
  return art === 'attestation' && vsBoss;
}

export interface GlowState {
  pips: number;
}

export const GLOW_CAP = 3;

/**
 * §5.1 — every source that grants Glow mid-battle, with its amount. 'trimmed-wick' (§11.3)
 * is deliberately NOT here: the Wellspring boon sets the battle's STARTING pips directly (a
 * create()-time decision), it never flows through a gain call.
 */
export type GlowSource =
  | 'strike' | 'lantern-turn-start' | 'brazier-lit' | 'due-renewal' | 'redemption' | 'wick-tallow' | 'lantern-brand';

const GLOW_AMOUNT: Record<GlowSource, number> = {
  strike: 1,
  'lantern-turn-start': 1,
  'brazier-lit': 1,
  'due-renewal': 1,
  // §3.1 — reclaiming a fact from the Fade is a due-renewal sibling: same +1, same §5.1 family.
  redemption: 1,
  'wick-tallow': 1,
  'lantern-brand': 2,
};

/** Clamped at GLOW_CAP — gaining past the cap just caps, it never errors. */
export function glowGain(state: GlowState, source: GlowSource): GlowState {
  return { pips: Math.min(GLOW_CAP, state.pips + GLOW_AMOUNT[source]) };
}

export interface GlowSpendResult {
  ok: boolean;
  /** the next state on success; the UNCHANGED input state on rejection (satchel.ts's
   *  resolveHealUse ok/unchanged-on-failure idiom, reused here for consistency). */
  state: GlowState;
}

/** Rejects outright (no clamp, no partial spend) when cost exceeds available pips. */
export function glowSpend(state: GlowState, cost: number): GlowSpendResult {
  if (cost > state.pips) return { ok: false, state };
  return { ok: true, state: { pips: state.pips - cost } };
}

/**
 * §12.2 — the tier flyout only offers the Overglow toggle when both gates pass. Not named
 * in §2's schema, but required by the test bar ("overglow requires rank≥2 and sufficient
 * pips") — a small pure predicate so the HUD/e2e can assert the gate without a live battle.
 */
export function canOverglow(rank: 1 | 2 | 3, glow: GlowState): boolean {
  return rank >= 2 && glow.pips >= 1;
}

/**
 * §5.1 source 4 — the SRS due queue as the mana engine: +1 Glow when the resolved quality is
 * a full pass AND at least one of the encounter's factIds was due AT CAST TIME.
 *
 * Trap 14: the caller MUST snapshot `dueSetAtCastTime` BEFORE calling record() (which
 * mutates Leitner box / due-queue membership immediately, store.ts:107-126) — this function
 * only judges whichever snapshot it is handed; being pure, it cannot enforce when that
 * snapshot was taken.
 */
export function dueRenewalSurge(resolvedQuality: Quality, factIds: string[], dueSetAtCastTime: ReadonlySet<string>): boolean {
  return resolvedQuality === 1 && factIds.some((id) => dueSetAtCastTime.has(id));
}

/**
 * Disambiguates `services.srs.dueQueue`'s result for `dueRenewalSurge`'s "at cast time"
 * snapshot: dueQueue returns seen-and-due ids FIRST, then ALSO appends every unseen id
 * (prereq-gated) — seen-but-not-due ids are the only ones actually excluded
 * (leitner.ts's dueQueue: "seen & not due → excluded"). §5.1's "renewing a DUE fact" means
 * the seen-and-due subset specifically, not "any fact worth reviewing including ones never
 * seen" — and `boxOf` (0 = unseen, 1-5 = seen) is exactly the tool that tells them apart:
 * a returned id is seen-and-due iff its box is > 0 (an unseen id always reports box 0).
 * No new SrsApi surface needed; not in the literal ask, flagged same as spellsForArt/ARTS.
 */
export function seenDueIds(dueQueueResult: string[], boxOf: (id: string) => number): Set<string> {
  return new Set(dueQueueResult.filter((id) => boxOf(id) > 0));
}

/**
 * §5.5 the weld edge: +1 primary damage when EVERY involved fact's box (captured BEFORE
 * record() mutates it — trap 14, same capture-before-record duty as dueRenewalSurge) is ≥4.
 * An empty list never welds — there is nothing mastered to reward, so vacuous truth does not
 * pay out here (decided explicitly, per the test bar's "decide and document").
 */
export function weldBonus(allFactBoxes: number[]): 0 | 1 {
  return allFactBoxes.length > 0 && allFactBoxes.every((b) => b >= 4) ? 1 : 0;
}

/**
 * difficulty-rewards.md §4's reward rider: q1 on a draw harder than the caster's own spell
 * tier grants +1 primary damage. `packReady` (`PackMeta.difficultyClassified`) hard-gates the
 * mechanic before any pack is classified, so it currently returns 0 in real play by design;
 * P1 ships dormant math, with live wiring deferred. Tier 3 can never receive a rider because
 * drawnDifficulty > 3 is impossible, which is intentional rather than a bug.
 */
export function riderBonus(
  spellTier: 1 | 2 | 3,
  drawnDifficulty: 1 | 2 | 3,
  packReady: boolean,
): 0 | 1 {
  return packReady && drawnDifficulty > spellTier ? 1 : 0;
}
