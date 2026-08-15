/**
 * Conditions — pure, Phaser-free, mirrors damage.ts/boss.ts/ai.ts's pattern: this module
 * computes; CombatScene (wiring, out of this module's scope) applies the results to the
 * board. Spec: docs/design/magic-combat-depth.md §2-3 (the shipped eight); Ch. VIII of
 * docs/superpowers/specs/2026-08-02-concordance.md (Toppled/Daunted/Unwritten, the three
 * Bestiary newcomers).
 *
 * Lifecycle summary (§3 rule 2-3, plus Ch. VIII):
 *  - Kindled ticks damage AND decrements its own duration at the OWNER's turn START
 *    (tickTurnStart) — it never touches the generic turn-end decay.
 *  - Staggered is consumed (removed) at turn start and signals the turn should end.
 *  - Every other duration status decrements at the OWNER's turn END (decayTurnEnd).
 *  - Warded never decays by time — only by absorption (computeHit) or battle end.
 *  - Toppled/Daunted/Unwritten (Ch. VIII) are a fourth pattern: each is consumed by a
 *    discrete EVENT rather than by time (the rise; the source falling; acting or taking
 *    damage) — exempt from decayTurnEnd like Warded, but the event that actually clears
 *    each one is wired at the CombatScene seam in later Bestiary tasks, not in this pure
 *    module (this module only defines the ids, the decay exemption, and — for Unwritten —
 *    the CONSUMED_ON_OWN_ACTION membership the future hook will consult).
 */
import type { UnitState } from './types';
import { P } from './palette';

export type StatusId =
  | 'kindled' // 1 dmg at owner's turn START, then decrement
  | 'bound' // move = 0 (may still act — Bound is not Silenced)
  | 'dimmed' // move −1 (floor 1)
  | 'warded' // damage-absorb pool (magnitude); no duration — spent by absorption or battle end
  | 'inked' // takes +1 damage from every hit
  | 'emboldened' // deals +1 on every damaging hit
  | 'weakened' // deals −1 on every damaging hit (floor 0)
  | 'staggered' // skips its next turn
  | 'toppled' // knocked down; no duration — consumed entirely by the rise (Ch. VIII)
  | 'daunted' // carries sourceId; battle-long until the source falls, deals −1 while it stands
  | 'unwritten'; // enemies only; un-targetable by Strikes until it acts or takes damage

/**
 * turnsLeft counts the OWNER's turn-ends. warded: turnsLeft = -1 (battle-long), magnitude =
 * absorb pool. staggered: turnsLeft = 1 always; consumed at turn start. Every other status's
 * magnitude is a fixed constant per §3 (kindled/inked/emboldened/weakened effects are all
 * exactly "1"); bound/dimmed/staggered don't use magnitude at all (left 0 by convention).
 * Toppled/Daunted/Unwritten (Ch. VIII) are event-consumed, not turn-counted — turnsLeft is
 * unused by their lifecycle (exempt from decayTurnEnd; each clears via its own later seam).
 */
export interface StatusInstance {
  id: StatusId;
  turnsLeft: number;
  magnitude: number;
  /** Ch. VIII — additive-optional; ONLY Daunted sets this (its source unit's id, read by a
   *  later seam to lift the daunt the instant that unit falls). Every other status leaves
   *  this undefined/absent. */
  sourceId?: string;
}

export type TickOp = { op: 'damage'; amount: number } | { op: 'consume' };

export interface StatusDef {
  id: StatusId;
  label: string;
  glyph: string;
  tint: number; // HUD chip color (§12.3) — reuses the combat palette, never a new hardcoded hex
  stack: 'refresh'; // ONE rule for all: re-apply = max(turnsLeft, magnitude), never additive
  tickStart?: (u: UnitState) => TickOp[];
}

function kindledTickStart(u: UnitState): TickOp[] {
  const inst = u.statuses.find((s) => s.id === 'kindled');
  return inst ? [{ op: 'damage', amount: inst.magnitude }] : [];
}

/** The eleven status definitions — HUD chips (§12.3) and the wiring layer read this directly. */
export const STATUS_DEFS: Record<StatusId, StatusDef> = {
  kindled: { id: 'kindled', label: 'Kindled', glyph: '▲', tint: P.ember, stack: 'refresh', tickStart: kindledTickStart },
  bound: { id: 'bound', label: 'Bound', glyph: '⌗', tint: P.orchid, stack: 'refresh' },
  dimmed: { id: 'dimmed', label: 'Dimmed', glyph: '◗', tint: P.duskViolet, stack: 'refresh' },
  warded: { id: 'warded', label: 'Warded', glyph: '◈', tint: P.waterBlue, stack: 'refresh' },
  inked: { id: 'inked', label: 'Inked', glyph: '✎', tint: P.outline, stack: 'refresh' },
  emboldened: { id: 'emboldened', label: 'Emboldened', glyph: '↑', tint: P.moss, stack: 'refresh' },
  weakened: { id: 'weakened', label: 'Weakened', glyph: '↓', tint: P.stoneGrey, stack: 'refresh' },
  staggered: { id: 'staggered', label: 'Staggered', glyph: '✱', tint: P.duskPeach, stack: 'refresh' },
  // Ch. VIII newcomers — no tickStart: each is consumed by a discrete event wired at a
  // later CombatScene seam (Tasks 2/4/5), not by this module's own turn hooks.
  toppled: { id: 'toppled', label: 'Toppled', glyph: '▼', tint: P.timber, stack: 'refresh' },
  daunted: { id: 'daunted', label: 'Daunted', glyph: '↚', tint: P.duskMauve, stack: 'refresh' },
  unwritten: { id: 'unwritten', label: 'Unwritten', glyph: '◌', tint: P.parchment, stack: 'refresh' },
};

export function hasStatus(statuses: StatusInstance[], id: StatusId): boolean {
  return statuses.some((s) => s.id === id);
}

export function statusMagnitude(statuses: StatusInstance[], id: StatusId): number {
  return statuses.find((s) => s.id === id)?.magnitude ?? 0;
}

export function clearStatus(statuses: StatusInstance[], id: StatusId): StatusInstance[] {
  return statuses.filter((s) => s.id !== id);
}

/**
 * Add/refresh a status on `u` (returns the next statuses array; does not mutate `u`).
 *
 * §3 rule 1 — stacking: re-applying REFRESHES turnsLeft to max(old,new); magnitude also
 * refreshes to max(old,new), never additive. Today this only matters for Warded ("a
 * bigger ward replaces a smaller, never sums") — every other status's magnitude is a
 * fixed per-effect constant, so max is a harmless no-op for them. One instance per id.
 *
 * §8 Bond-proof: constructs reject Bound outright. This is the single seam for that
 * immunity — every future caller that grants Bound (Snare-Knot, Lattice, Injunction,
 * Warden's Crown Injunction) gets it for free instead of re-checking archetype itself.
 *
 * Ch. VIII: `sourceId` is additive-optional — only a Daunted-granting caller passes it.
 * A fresh apply sets it; a refresh that omits it keeps whatever the existing instance
 * already carried (never silently dropped); a refresh that passes a new one overwrites.
 */
export function applyStatus(u: UnitState, id: StatusId, turns: number, magnitude = 1, sourceId?: string): StatusInstance[] {
  if (id === 'bound' && u.kind === 'construct') return u.statuses;
  const existing = u.statuses.find((s) => s.id === id);
  const nextSourceId = sourceId ?? existing?.sourceId;
  const next: StatusInstance = {
    id,
    turnsLeft: existing ? Math.max(existing.turnsLeft, turns) : turns,
    magnitude: existing ? Math.max(existing.magnitude, magnitude) : magnitude,
    ...(nextSourceId !== undefined ? { sourceId: nextSourceId } : {}),
  };
  return [...u.statuses.filter((s) => s.id !== id), next];
}

/**
 * Kindled and Warded manage their own lifecycles (see file header) — exempt from turn-end
 * decay. Toppled/Daunted/Unwritten (Ch. VIII) are also event-consumed rather than
 * time-based (the rise; the source falling; the two Unwritten triggers) — all five never
 * tick or expire via decayTurnEnd; each is removed only by its own dedicated seam.
 */
const NO_TURN_END_DECAY = new Set<StatusId>(['warded', 'kindled', 'toppled', 'daunted', 'unwritten']);

/** §3 rule 3 — decay at the OWNER's turn end: decrement every duration status. Warded never decays. */
export function decayTurnEnd(statuses: StatusInstance[]): StatusInstance[] {
  return statuses
    .map((s) => (NO_TURN_END_DECAY.has(s.id) ? s : { ...s, turnsLeft: s.turnsLeft - 1 }))
    .filter((s) => NO_TURN_END_DECAY.has(s.id) || s.turnsLeft > 0);
}

/**
 * The fourth status lifecycle (Ch. VIII): consumed the moment its holder takes its OWN
 * action — distinct from turn-end decay (NO_TURN_END_DECAY above) and from turn-start
 * ticking (tickTurnStart below). Only Unwritten uses it today; Unwritten's OTHER trigger
 * (cleared on taking damage — the "revealed" moment) is a separate hook, not this set.
 * This module only defines the membership — the consuming hook lands at the CombatScene
 * seam in a later Bestiary task.
 */
export const CONSUMED_ON_OWN_ACTION = new Set<StatusId>(['unwritten']);

export interface TurnStartTick {
  /** ops in resolution order — the caller applies 'damage' via its damageUnit choke point
   *  (may kill) and treats 'consume' as "end this unit's turn now, it does not act." */
  ops: TickOp[];
  statuses: StatusInstance[];
}

/**
 * §3 rule 2 — tick order at a unit's turn start: (a) Kindled damage, then decrement/expire
 * its own duration; (b) Staggered — consumed, and signals the turn ends here (before the
 * unit can act).
 */
export function tickTurnStart(u: UnitState): TurnStartTick {
  const ops: TickOp[] = [];

  for (const s of u.statuses) {
    const def = STATUS_DEFS[s.id];
    if (def.tickStart) ops.push(...def.tickStart(u));
  }

  let statuses = u.statuses
    .map((s) => (s.id === 'kindled' ? { ...s, turnsLeft: s.turnsLeft - 1 } : s))
    .filter((s) => s.id !== 'kindled' || s.turnsLeft > 0);

  if (hasStatus(statuses, 'staggered')) {
    ops.push({ op: 'consume' });
    statuses = clearStatus(statuses, 'staggered');
  }

  return { ops, statuses };
}

/** Bound zeroes move (acting is unaffected — Bound is not Silenced); Dimmed −1, floor 1 (§3). */
export function effectiveMove(baseMove: number, statuses: StatusInstance[]): number {
  if (hasStatus(statuses, 'bound')) return 0;
  if (hasStatus(statuses, 'dimmed')) return Math.max(1, baseMove - statusMagnitude(statuses, 'dimmed'));
  return baseMove;
}

export interface ComputeHitInput {
  /** raw pre-modifier damage (Strike/spell/OA base) */
  base: number;
  attackerStatuses: StatusInstance[];
  targetStatuses: StatusInstance[];
  /** §4.1 — melee only; spells never flank (the caller gates this) */
  flank: boolean;
  /** §5.3 — Overglow upcast; 0-plumbed in Phase 1 (always false until Glow exists) */
  overglow: boolean;
  /** §5.5 — the weld edge; 0-plumbed in Phase 1 (always false until rank/weld exist) */
  weld: boolean;
  /** difficulty-rewards.md §4 — the reward rider; 0-plumbed until a pack's
   *  difficultyClassified flag flips true (a later phase, not this one). */
  rider: boolean;
  /** Ch. VIII — is the attacker's Daunted source (if it carries the status at all) still
   *  alive-on-board? This module has no board access, so the caller (CombatScene) resolves
   *  the one bit it can't derive itself and hands back the answer; irrelevant whenever
   *  attackerStatuses carries no 'daunted' entry. */
  attackerDauntedSourceAlive: boolean;
}

export interface ComputeHitResult {
  /** final amount to subtract from the target's HP */
  hpDamage: number;
  /** target's statuses after Warded absorption (pool reduced/removed); unchanged otherwise */
  targetStatuses: StatusInstance[];
  /** how much Warded soaked up, for banner/HUD purposes */
  absorbed: number;
}

/**
 * The ONE damage-modifier pipeline (§3 rule 4) — the only place modifiers stack:
 *   base + emboldened(+1) − weakened(−1) − daunted(−1, source-alive-gated) + flank(+1)
 *   + overglow(+1) + weld(+1) + rider(+1) → floor 0 → + inked(+1) if >0 → Warded absorbs → HP.
 * Inked amplifies only a real (nonzero, post-floor) hit — a 0 stays 0.
 *
 * Ch. VIII — daunted folds exactly like weakened (statusMagnitude off the attacker), gated by
 * the caller-supplied `attackerDauntedSourceAlive` since this pure module can't check the
 * board itself: the source falling flips that flag on the caller's very next read, so the
 * penalty lifts the same beat the source falls, with no separate decay/clear needed here.
 */
export function computeHit(input: ComputeHitInput): ComputeHitResult {
  const { base, attackerStatuses, targetStatuses, flank, overglow, weld, rider, attackerDauntedSourceAlive } = input;

  const dauntedPenalty = hasStatus(attackerStatuses, 'daunted') && attackerDauntedSourceAlive
    ? statusMagnitude(attackerStatuses, 'daunted')
    : 0;

  let dmg = base
    + statusMagnitude(attackerStatuses, 'emboldened')
    - statusMagnitude(attackerStatuses, 'weakened')
    - dauntedPenalty
    + (flank ? 1 : 0)
    + (overglow ? 1 : 0)
    + (weld ? 1 : 0)
    + (rider ? 1 : 0);
  dmg = Math.max(0, dmg);
  if (dmg > 0) dmg += statusMagnitude(targetStatuses, 'inked');

  const wardPool = statusMagnitude(targetStatuses, 'warded');
  const absorbed = Math.min(dmg, wardPool);
  const hpDamage = dmg - absorbed;

  let nextTargetStatuses = targetStatuses;
  if (absorbed > 0) {
    const remaining = wardPool - absorbed;
    nextTargetStatuses = remaining > 0
      ? targetStatuses.map((s) => (s.id === 'warded' ? { ...s, magnitude: remaining } : s))
      : clearStatus(targetStatuses, 'warded');
  }

  return { hpDamage, targetStatuses: nextTargetStatuses, absorbed };
}
