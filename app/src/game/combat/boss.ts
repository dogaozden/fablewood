/**
 * Vault-Warden boss logic (slice-blueprint §4, reforged per magic-combat-depth.md §9).
 * Pure reducers; the scene owns presentation and the phase state machine, calling these
 * to compute effects.
 *
 * Phase rhythm: each phase OPENS with a scenario_branch (the Warden proposes a
 * term) → applyBranch. Between phases the player's Attestation vs the Warden is
 * answered and a PASS strips an extra shield (damage.resolveAction.extraShield).
 * Shields → 0 = victory; Warden HP → 0 is a fallback victory; party wipe = retreat.
 * (That Attestation drew from phase.recallTags until wave 1; tags have since left the
 * draw path — design §5 — and it now draws globally, narrowed only by encounter kind.
 * The phase rhythm itself is unchanged.)
 */
import type { SpellDef } from './spells';
import type { Quality } from './types';

export interface BranchEffect {
  shieldDelta: number;
  partyDelta: number;
  wardenHeal: number;
  stagger: boolean;
  banner: string;
}

export function applyBranch(branchTag: string | undefined): BranchEffect {
  if (branchTag === 'good') {
    return { shieldDelta: -1, partyDelta: 0, wardenHeal: 0, stagger: true, banner: 'The Warden concedes the point — a shield shatters, and he reels.' };
  }
  if (branchTag === 'bad') {
    return { shieldDelta: 0, partyDelta: -2, wardenHeal: 1, stagger: false, banner: 'The Warden presses his terms — you give ground, and he mends.' };
  }
  return { shieldDelta: 0, partyDelta: 0, wardenHeal: 0, stagger: false, banner: 'A wary stalemate — no ground won.' };
}

/** NOTE the convention: `delta` is SIGNED and is ADDED. Removing a shield is `-1`, never `1`.
 *  Prefer shieldStripDelta() below over hand-writing the sign at a call site — passing `1`
 *  here silently GRANTS the boss a shield, which is exactly how that bug shipped once. */
export function reduceShields(current: number, delta: number): number {
  return Math.max(0, current + delta);
}

/**
 * §9.2 — the signed shield delta for one cast, ready to hand straight to reduceShields.
 *
 * A q1 Attestation carrying `bossRider: 'strip-shield'` aimed at the boss strips exactly one
 * shield (`-1`); everything else is `0`. Owning the SIGN here — rather than at each call site —
 * is the point: castGatedSpell previously wrote `reduceShields(this.shields, 1)` for this same
 * rule, and since reduceShields ADDS its delta that ADDED a shield on every apex cast (the
 * float still read "−shield"), letting a Rank-3 Keeper's Verbatim Decree make the Warden
 * unkillable. There is now no call site left that has to remember the sign.
 */
export function shieldStripDelta(spell: SpellDef | null, quality: Quality, vsBoss: boolean): number {
  return spell?.bossRider === 'strip-shield' && quality === 1 && vsBoss ? -1 : 0;
}

/** Boss is beaten when its shields are gone OR (fallback) its HP is spent. */
export function bossDefeated(shields: number, hp: number): boolean {
  return shields <= 0 || hp <= 0;
}

/**
 * The Warden's preference-shields turn aside every mundane blow: while shielded, ONLY an
 * Attestation carrying `bossRider: 'strip-shield'` (citing your authority — Cast From Memory,
 * Attested Ward, Verbatim Decree) wounds it. This keeps the boss's questions mandatory now
 * that Strike is free — you cannot brute-force the Warden's HP to the fallback-victory with
 * un-gated attacks; you must engage the phase branches + the apex Art.
 *
 * §9.2 / trap 10: the gate USED to string-match `action !== 'cast'`. With tiers that breaks —
 * Attested Ward and Verbatim Decree are Attestation too and must pierce, while a hypothetical
 * future Art routed through the 'cast' BUTTON must not pierce merely by sharing a hotkey. The
 * discriminator is now the SpellDef itself, so the rule is data-driven and type-safe.
 *
 * `spell === null` means "no spell at all" — the free lane (Strike, opportunity strikes, bump
 * damage from a push). Free steel never pierces, which is the whole invariant.
 */
export function wardenAbsorbs(spell: SpellDef | null, isBoss: boolean | undefined, shields: number): boolean {
  return !!isBoss && shields > 0 && spell?.bossRider !== 'strip-shield';
}

/** §9.3 — the exact riposte damage and banner the Objection answers with. */
export const OBJECTION_RIPOSTE = 1;
export const OBJECTION_BANNER = 'Overruled.';

/**
 * §9.3 **Objection!** — a passive reaction that resets each round: the FIRST free-lane hit
 * (Strike or opportunity strike) against the Warden each round is negated, and answered with
 * a 1-damage riposte to whoever swung.
 *
 * SOUL GUARANTEE S4 (`docs/design/magic-combat-depth.md` §0/§9.3 — "knowledge always lands;
 * only free steel gets lawyered"): this NEVER triggers on an Art. A correct answer's payoff
 * can never be voided by an enemy mechanic. That guarantee is enforced structurally rather
 * than by a list: the sole trigger condition is `spell === null`, and every Art cast — all
 * fifteen, at every tier and every quality — reaches the board WITH its SpellDef in hand.
 * There is no argument an Art can pass that makes this return true.
 *
 * Deliberately independent of `shields`: the shield gate answers *spells*, the Objection
 * answers *steel*, and the spec's own note ("matters most post-shields, when the party tries
 * to brute the HP fallback") only makes sense if the reaction is armed throughout.
 */
export function wardenObjects(spell: SpellDef | null, isBoss: boolean | undefined, objectionSpent: boolean): boolean {
  return !!isBoss && !objectionSpent && spell === null;
}

/** §9.4/§13 — the Warden's three moves. These keys are also `BossSpec.moveLabels`' keys, so a
 *  pack's relabel map lines up with the engine's script one-for-one. */
export type WardenMove = 'seizure' | 'injunction' | 'summon';

/** §9.4/§9.5 engine-generic move labels (fantasy, zero domain strings). A pack may relabel
 *  each via the additive optional `BossSpec.moveLabels`. */
export const WARDEN_MOVE_LABELS: Record<WardenMove, string> = {
  seizure: 'Writ of Seizure',
  injunction: 'Crown Injunction',
  summon: 'Call the Clause',
};

export interface WardenTurnContext {
  /** how many phases the fight has already opened — phase 1 is phaseIndex 0. */
  phaseIndex: number;
  /** 1-based count of Warden turns taken THIS battle, including the one being decided. */
  wardenTurns: number;
  /** false once the once-per-battle summon is used, or while a clause-wisp is still alive,
   *  or when no free enemy-spawn tile exists — the scene owns all three checks. */
  clauseAvailable: boolean;
}

/**
 * §9.4 — the Warden's deterministic phase script, decided purely from phase + turn count:
 *  - Phase 1 (phaseIndex 0): **Writ of Seizure**, his base kit — a melee attack with push 1.
 *  - Phase 2+ (phaseIndex ≥ 1): every OTHER Warden turn, **Crown Injunction**.
 *  - Phase 3+ (phaseIndex ≥ 2): once per battle, **Call the Clause**.
 *
 * Precedence: the once-per-battle summon takes the first turn it is available (it is the
 * rarest beat and would otherwise be crowded out by the alternating Injunction), then the
 * Injunction cadence, then his base kit. "Every OTHER turn" counts his OWN turns, so his
 * 2nd/4th/6th turn of the battle carries the Injunction — his first turn in a new phase is
 * always a normal blow, which keeps the escalation readable.
 */
export function wardenMove(ctx: WardenTurnContext): WardenMove {
  if (ctx.phaseIndex >= 2 && ctx.clauseAvailable) return 'summon';
  if (ctx.phaseIndex >= 1 && ctx.wardenTurns % 2 === 0) return 'injunction';
  return 'seizure';
}

/** §9.5 — the label to SHOW for a move: the pack's relabel when present (trimmed, non-empty),
 *  else the engine-generic default. Content never reaches the engine's tables (S5). */
export function wardenMoveLabel(move: WardenMove, labels?: Partial<Record<WardenMove, string>>): string {
  const custom = labels?.[move]?.trim();
  return custom ? custom : WARDEN_MOVE_LABELS[move];
}
