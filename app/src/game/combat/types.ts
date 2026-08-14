/**
 * Core combat value types — pure data, no Phaser. Everything the logic modules
 * (grid/initiative/damage/boss/ai) and the scene agree on lives here.
 */
import type { EnemyArchetype, EncounterKind, Quality } from '../contracts';
import type { StatusInstance } from './status';

export const GRID_W = 12;
export const GRID_H = 8;
export const CELL = 48; // 16px tiles at 3× integer zoom

export type TileType = 'floor' | 'wall' | 'gold' | 'lantern' | 'brazier' | 'mist';

export type Team = 'party' | 'enemy';
export type UnitKind = 'keeper' | 'mira' | EnemyArchetype;

export type ActionKind = 'strike' | 'smite' | 'weave' | 'sequence' | 'cast' | 'parley' | 'satchel' | 'wait' | 'press_on';
export type Dir = 'up' | 'down' | 'left' | 'right';

export interface Coord {
  c: number;
  r: number;
}

export interface UnitState extends Coord {
  id: string;
  name: string;
  team: Team;
  kind: UnitKind;
  hp: number;
  maxHp: number;
  move: number;
  speed: number;
  alive: boolean;
  facing: 'left' | 'right';
  /** enemy melee/ranged damage */
  attack: number;
  /** attack reach in tiles (melee 1, wraith 3) */
  range: number;
  ranged: boolean;
  /** can be Parley'd */
  parley: boolean;
  /** §2/§3 — always [] at spawn. Phase 1 introduced this and migrated every read/write off the
   *  old `skipNextTurn` boolean and Parley's permanent attack−1 onto statuses; Phase 3 deleted
   *  the field itself (spec §2's "Delete the field in Phase 3"). "Skips its next turn" is now
   *  `hasStatus(u.statuses, 'staggered')`, applied/consumed by status.ts. Never persisted (§14
   *  — per-battle only). */
  statuses: StatusInstance[];
  /** NEW (§4.2) — one opportunity strike DEALT per unit per round; reset each new round. */
  oaSpent: boolean;
  /** NEW (§10) — companion signature free action, once per battle. */
  uniqueSpent: boolean;
  /** boss only */
  isBoss?: boolean;
  shields?: number;
  maxShields?: number;
}

/** Per-action metadata: hotkey, the encounter kind it fires, reach, tint. */
export interface ActionMeta {
  kind: ActionKind;
  label: string;
  hotkey: string;
  encounter: EncounterKind | null;
  range: number;
  /** targeting shape */
  shape: 'single' | 'cross' | 'line' | 'self';
  tint: number;
  blurb: string;
}

export const ACTIONS: Record<Exclude<ActionKind, 'wait'>, ActionMeta> & { wait: ActionMeta } = {
  strike: {
    kind: 'strike', label: 'Strike', hotkey: '1', encounter: null, range: 1,
    shape: 'single', tint: 0xf7ce6b, blurb: 'Free — a quick blow, no question.',
  },
  smite: {
    kind: 'smite', label: 'Smite', hotkey: '2', encounter: 'mcq', range: 2,
    shape: 'single', tint: 0xd2792c, blurb: 'A bolt of cited truth. (multiple choice)',
  },
  weave: {
    kind: 'weave', label: 'Binding Weave', hotkey: '3', encounter: 'match', range: 2,
    shape: 'cross', tint: 0x9a6ec8, blurb: 'A cross of binding light. (match the pairs)',
  },
  sequence: {
    kind: 'sequence', label: 'Ritual Sequence', hotkey: '4', encounter: 'order', range: 3,
    shape: 'line', tint: 0x4c6c96, blurb: 'A lance in a line. (put in order)',
  },
  cast: {
    kind: 'cast', label: 'Cast From Memory', hotkey: '5', encounter: 'free_recall', range: 3,
    shape: 'single', tint: 0xeea23f, blurb: 'The big one — the Clerk judges. (recall)',
  },
  parley: {
    kind: 'parley', label: 'Parley', hotkey: '6', encounter: 'scenario_branch', range: 1,
    shape: 'single', tint: 0xe07aae, blurb: 'Talk it down. (a branching choice)',
  },
  // Opens the in-battle item panel (inventory-handoff §10). shape:'self'/range:0 means
  // validTargets has no case for it (falls to the default `[]`) — CombatScene.onPickAction
  // special-cases 'satchel' before that gate anyway (same as 'wait'), so it's always
  // pickable. Resolves heals through combat/satchel.ts + services.inventory.useItem, not
  // the damage table; reveal_option/retry_cast/streak_shield stay catalog-only (touching
  // the encounter surface to actually consume them is out of scope — see satchel.ts).
  satchel: {
    kind: 'satchel', label: 'Satchel', hotkey: 'q', encounter: null, range: 0,
    shape: 'self', tint: 0x8c5c34, blurb: 'Reach for a carried item.',
  },
  wait: {
    kind: 'wait', label: 'End Turn', hotkey: '7', encounter: null, range: 0,
    shape: 'self', tint: 0x8a8078, blurb: 'Hold position, end turn.',
  },
  // Ch. VI action economy — forgoes the turn's action for +moveBudgetFor(u) (stance-aware:
  // halved under Careful Step, same as the turn-start grant). No tile to choose (shape:'self',
  // like Satchel/Wait) — CombatScene.onPickAction special-cases it before the targeting gate.
  // Appended last (not before 'wait') so the existing hotkeys 1-7 and their Object.keys(ACTIONS)
  // indices are untouched; press_on is purely additive at index 8.
  press_on: {
    kind: 'press_on', label: 'Press On', hotkey: '8', encounter: null, range: 0,
    shape: 'self', tint: 0xc6a476, blurb: 'Forgo the action — push further this turn.',
  },
};

export const DIRS: Record<Dir, Coord> = {
  up: { c: 0, r: -1 },
  down: { c: 0, r: 1 },
  left: { c: -1, r: 0 },
  right: { c: 1, r: 0 },
};

export const key = (c: number, r: number): string => `${c},${r}`;
export const manhattan = (a: Coord, b: Coord): number => Math.abs(a.c - b.c) + Math.abs(a.r - b.r);
export const inBounds = (c: number, r: number): boolean => c >= 0 && c < GRID_W && r >= 0 && r < GRID_H;

export type { Quality };
