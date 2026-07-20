/**
 * The damage table — the heart of combat↔knowledge. Maps (action, answer
 * quality) → a normalized outcome the scene applies to the board. Pure and
 * fully unit-tested. Numbers per the friction redesign (2026-07-19):
 *
 *  Strike (FREE, r1):     fixed 1, cannot miss, no question — the flow move.
 *  Smite  (mcq, r2):      quick bolt; q1→3  q0.5→1  q0→0. The cheapest gated spell.
 *  Weave  (match, r2):    cross AoE; q1→2 to every cross target, q0.5→primary only, q0→none
 *  Sequence(order, r3):   line; 2 dmg per tile up to depth floor(q*3) (q1→3-deep, q0.5→1-deep, q0→0)
 *  Cast   (recall, r3):   q1→6 (×3 crit), q0.5→2, q0→0 + Fade counter 2 to the party
 *  Parley (branch, r1):   good→weaken target, bad→party −2, else nothing
 *
 * The economy: every GATED spell out-damages a free Strike (1) at full quality —
 * answering a question is meant to feel like a big swing. Teeth live in the enemy
 * answering back each turn (so pure-Strike play is slow/costly) and in Cast's Fade
 * counter on a fail; a whiffed spell simply wastes the turn (no self-chip).
 * Mira's mastery bonus (+1) folds into the primary/first-tile hit when she acts and
 * a hit lands. Boss: a passing Cast vs the Warden strips an EXTRA shield.
 */
import { manhattan, type ActionKind, type Coord, type Quality, type Team, type UnitState } from './types';

export interface ActionOutcome {
  /** damage to the primary target (Strike/Cast) or the line's first tile / cross centre */
  hits: number;
  aoe: 'none' | 'cross' | 'line';
  /** damage to each ADDITIONAL aoe target (cross arms / line tiles 2..depth) */
  aoeHit: number;
  /** Ritual Sequence lance depth (tiles) */
  lineDepth: number;
  /** recoil to the acting unit (teeth on a whiff) */
  selfChip: number;
  /** Fade counter to the party pool (Cast fail) */
  fade: number;
  /** Parley good → target loses a turn / is weakened */
  weaken: boolean;
  /** Parley bad → party takes this */
  partyHit: number;
  /** boss: extra shield stripped (passing Cast vs Warden) */
  extraShield: number;
  /** one-line "why" banner shown to the player */
  banner: string;
}

const EMPTY: ActionOutcome = {
  hits: 0, aoe: 'none', aoeHit: 0, lineDepth: 0, selfChip: 0,
  fade: 0, weaken: false, partyHit: 0, extraShield: 0, banner: '',
};

export interface ResolveOpts {
  /** +1 when Mira acts and province mastery ≥ gate */
  miraBonus?: number;
  /** targeting the boss (Cast can strip a shield on a pass) */
  vsBoss?: boolean;
  /** scenario_branch outcome, for Parley / boss branches */
  branchTag?: string;
}

export function resolveAction(action: ActionKind, quality: Quality, opts: ResolveOpts = {}): ActionOutcome {
  const mira = opts.miraBonus ?? 0;
  switch (action) {
    case 'strike': {
      // Free basic attack — no encounter, cannot miss. Fixed, modest, always lands
      // (quality is irrelevant; the scene always resolves a Strike at full).
      return { ...EMPTY, hits: 1 + mira, banner: 'A quick strike.' };
    }
    case 'smite': {
      const b = quality === 1 ? 3 : quality === 0.5 ? 1 : 0;
      return {
        ...EMPTY,
        hits: b > 0 ? b + mira : 0,
        banner: quality === 1 ? 'A bolt of cited truth!' : quality === 0.5 ? 'A glancing bolt.' : 'The bolt fizzles — turn lost.',
      };
    }
    case 'weave': {
      const land = quality > 0;
      return {
        ...EMPTY,
        hits: land ? 2 + mira : 0,
        aoe: 'cross',
        aoeHit: quality === 1 ? 2 : 0,
        banner: quality === 1 ? 'Full — the weave binds all.' : quality === 0.5 ? 'Partial — primary only.' : 'The weave slips — turn lost.',
      };
    }
    case 'sequence': {
      const depth = Math.floor(quality * 3); // q1→3, q0.5→1, q0→0
      return {
        ...EMPTY,
        hits: depth > 0 ? 2 + mira : 0,
        aoe: 'line',
        aoeHit: 2,
        lineDepth: depth,
        banner: quality === 1 ? 'Full — a three-deep lance.' : quality === 0.5 ? 'Partial — one-deep.' : 'The lance breaks — turn lost.',
      };
    }
    case 'cast': {
      const b = quality === 1 ? 6 : quality === 0.5 ? 2 : 0;
      return {
        ...EMPTY,
        hits: b > 0 ? b + mira : 0,
        fade: quality === 0 ? 2 : 0,
        extraShield: opts.vsBoss && quality === 1 ? 1 : 0,
        banner: quality === 1 ? 'Cast — the Ledger blazes (×3)!' : quality === 0.5 ? 'Partial recall — a glancing cast.' : 'The Fade lashes back (−2).',
      };
    }
    case 'parley': {
      if (opts.branchTag === 'good') return { ...EMPTY, weaken: true, banner: 'They yield — weakened.' };
      if (opts.branchTag === 'bad') return { ...EMPTY, partyHit: 2, banner: 'It backfires (−2).' };
      return { ...EMPTY, banner: 'No accord — the moment passes.' };
    }
    case 'wait':
      return { ...EMPTY, banner: 'Holding position.' };
    case 'satchel':
      // Never actually reached: CombatScene.onPickAction special-cases 'satchel' before
      // the validTargets gate and resolves it via combat/satchel.ts + services.inventory,
      // never this table (inventory-handoff §10). Kept only so the switch stays exhaustive.
      return { ...EMPTY, banner: 'The satchel resolves outside this table.' };
  }
}

/** Short label for the turn/HUD, e.g. floating combat text context. */
export function qualityWord(q: Quality): string {
  return q === 1 ? 'FULL' : q === 0.5 ? 'PARTIAL' : 'MISS';
}

/**
 * §4.1 flanking (melee only): a range-1 attack from `attackerPos` on `targetPos` flanks
 * when the tile directly OPPOSITE the attacker (O = T + (T − A)) holds a living unit of
 * the ATTACKER's team. Applies to both teams. Spells never flank — callers gate this to
 * melee sources (Strike, enemy melee, opportunity strikes) only; the range-1 check here
 * is a defensive backstop, not the primary gate. Route the result through computeHit's
 * `flank` param (status.ts).
 */
export function isFlanked(attackerPos: Coord, targetPos: Coord, attackerTeam: Team, units: UnitState[]): boolean {
  if (manhattan(attackerPos, targetPos) !== 1) return false;
  const opposite: Coord = {
    c: targetPos.c + (targetPos.c - attackerPos.c),
    r: targetPos.r + (targetPos.r - attackerPos.r),
  };
  return units.some((u) => u.alive && u.team === attackerTeam && u.c === opposite.c && u.r === opposite.r);
}
