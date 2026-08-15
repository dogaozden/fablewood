/**
 * Unit stat blocks and factories. Base numbers per slice-blueprint §3 and the
 * combat brief; enemy `move` chosen to keep the 12×8 board tactical (fast/weak
 * wisps, slow/tanky constructs). Pure data — no Phaser.
 */
import type { EnemyArchetype, EnemySpec, BossSpec } from '../contracts';
import type { UnitState, Team, UnitKind } from './types';

interface StatBlock {
  hp: number;
  speed: number;
  move: number;
  attack: number;
  range: number;
  ranged: boolean;
  /** Ch. VIII — can a landed Shove knock this archetype Toppled? Per-entry bestiary data. */
  toppleable: boolean;
}

export const ENEMY_STATS: Record<EnemyArchetype, StatBlock> = {
  wisp: { hp: 2, speed: 3, move: 3, attack: 1, range: 1, ranged: false, toppleable: false },
  wraith: { hp: 3, speed: 4, move: 3, attack: 1, range: 3, ranged: true, toppleable: false },
  construct: { hp: 5, speed: 2, move: 2, attack: 2, range: 1, ranged: false, toppleable: false }, // §8: bruiser must survive one full Weave
  warden: { hp: 8, speed: 3, move: 2, attack: 2, range: 1, ranged: false, toppleable: false },
};

/**
 * §9.1 — the BOSS Warden's own pool, 8 → 12. Verbatim Decree deals 6 against a boss (§7), so
 * the fallback HP kill still costs TWO apex q1 answers — exactly the shipped bar — and the
 * phase branches stay the primary path rather than something an apex spell can out-race.
 *
 * Deliberately its own const rather than an edit to ENEMY_STATS.warden: that stat block is
 * ALSO the room-trash `archetype: 'warden'` mob (the Root-Husk — see ENEMY_LABEL, which was
 * renamed precisely because it is NOT the boss), and §9 reforges the boss, not the trash.
 * A tuning knob per §18.
 */
export const WARDEN_BOSS_HP = 12;

export const KEEPER = { hp: 10, move: 4, speed: 5 };
export const MIRA = { hp: 6, move: 4, speed: 4 };

/** Mira's ATK bonus is on when province mastery ≥ this (avg Leitner box). */
export const MIRA_MASTERY_GATE = 2.5;

const ENEMY_LABEL: Record<EnemyArchetype, string> = {
  wisp: 'Fade-Wisp',
  wraith: 'Anti-Wraith',
  construct: 'Vault-Construct',
  // Regular (non-boss) label only — makeBoss() below always uses spec.name instead, so this
  // never renames an actual boss. Was 'The Vault-Warden' (boss-kill-lens finding): a room's
  // regular archetype:'warden' trash enemy (app/src/game/scenes/dungeon/__fixtures__/dev.dungeon.json's
  // "under-boss" room, an 8hp mob distinct from the boss unit) rendered under the SAME name the
  // real boss carries elsewhere, reading in every turn/strike banner as if the boss itself were
  // a second, lesser copy of itself. Stats (ENEMY_STATS.warden) are unchanged — cosmetic only.
  warden: 'Root-Husk',
};

function base(partial: Partial<UnitState> & Pick<UnitState, 'id' | 'name' | 'team' | 'kind' | 'c' | 'r' | 'hp' | 'maxHp' | 'move' | 'speed'>): UnitState {
  return {
    alive: true,
    facing: partial.team === 'enemy' ? 'left' : 'right',
    attack: 0,
    range: 1,
    ranged: false,
    parley: false,
    statuses: [],
    oaSpent: false,
    uniqueSpent: false,
    ...partial,
  };
}

export function makeKeeper(c: number, r: number): UnitState {
  return base({
    id: 'keeper', name: 'The Keeper', team: 'party', kind: 'keeper',
    c, r, hp: KEEPER.hp, maxHp: KEEPER.hp, move: KEEPER.move, speed: KEEPER.speed,
  });
}

export function makeMira(c: number, r: number): UnitState {
  return base({
    id: 'mira', name: 'Mira the Factor', team: 'party', kind: 'mira',
    c, r, hp: MIRA.hp, maxHp: MIRA.hp, move: MIRA.move, speed: MIRA.speed,
  });
}

export function makeEnemy(spec: EnemySpec, index: number, c: number, r: number): UnitState {
  const s = ENEMY_STATS[spec.archetype];
  return base({
    id: `${spec.archetype}-${index}`,
    name: ENEMY_LABEL[spec.archetype],
    team: 'enemy' as Team,
    kind: spec.archetype as UnitKind,
    c, r, hp: s.hp, maxHp: s.hp, move: s.move, speed: s.speed,
    attack: s.attack, range: s.range, ranged: s.ranged,
    parley: spec.parley ?? false,
  });
}

export function makeBoss(spec: BossSpec, c: number, r: number): UnitState {
  const s = ENEMY_STATS.warden;
  return base({
    id: 'warden', name: spec.name, team: 'enemy', kind: 'warden',
    c, r, hp: WARDEN_BOSS_HP, maxHp: WARDEN_BOSS_HP, move: s.move, speed: s.speed,
    attack: s.attack, range: s.range, ranged: false,
    isBoss: true, shields: spec.shields, maxShields: spec.shields,
  });
}
