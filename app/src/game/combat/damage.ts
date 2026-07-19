/**
 * The damage table — the heart of combat↔knowledge. Maps (action, answer
 * quality) → a normalized outcome the scene applies to the board. Pure and
 * fully unit-tested. Numbers per the combat brief / slice-blueprint §3:
 *
 *  Strike (mcq, r1):      q1→2  q0.5→1  q0→0 +1 self-chip
 *  Weave  (match, r2):    cross AoE; q1→1 to every cross target, q0.5→primary only, q0→none +chip
 *  Sequence(order, r3):   line; 1 dmg per tile up to depth floor(q*3) (q1→3, q0.5→1, q0→0 +chip)
 *  Cast   (recall, r3):   q1→6 (×3 crit), q0.5→2, q0→0 + Fade counter 2 to the party
 *  Parley (branch, r1):   good→weaken target, bad→party −2, else nothing
 *
 * Mira's mastery bonus (+1) folds into the primary/first-tile hit when she acts
 * and quality > 0. Boss: a passing Cast vs the Warden strips an EXTRA shield.
 */
import type { ActionKind, Quality } from './types';

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
      const b = quality === 1 ? 2 : quality === 0.5 ? 1 : 0;
      return {
        ...EMPTY,
        hits: b > 0 ? b + mira : 0,
        selfChip: quality === 0 ? 1 : 0,
        banner: quality === 1 ? 'Full strength.' : quality === 0.5 ? 'Partial — half strength.' : 'Whiff! −1 recoil.',
      };
    }
    case 'weave': {
      const land = quality > 0;
      return {
        ...EMPTY,
        hits: land ? 1 + mira : 0,
        aoe: 'cross',
        aoeHit: quality === 1 ? 1 : 0,
        selfChip: quality === 0 ? 1 : 0,
        banner: quality === 1 ? 'Full — the weave binds all.' : quality === 0.5 ? 'Partial — primary only.' : 'Whiff! −1 recoil.',
      };
    }
    case 'sequence': {
      const depth = Math.floor(quality * 3); // q1→3, q0.5→1, q0→0
      return {
        ...EMPTY,
        hits: depth > 0 ? 1 + mira : 0,
        aoe: 'line',
        aoeHit: 1,
        lineDepth: depth,
        selfChip: quality === 0 ? 1 : 0,
        banner: quality === 1 ? 'Full — a three-deep lance.' : quality === 0.5 ? 'Partial — one-deep.' : 'Whiff! −1 recoil.',
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
  }
}

/** Short label for the turn/HUD, e.g. floating combat text context. */
export function qualityWord(q: Quality): string {
  return q === 1 ? 'FULL' : q === 0.5 ? 'PARTIAL' : 'MISS';
}
