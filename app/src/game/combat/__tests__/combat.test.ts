import { describe, it, expect } from 'vitest';
import { buildInitiative, nextInOrder } from '../initiative';
import {
  buildLayout, computeMoveField, reachableTiles, pathTo, crossTiles, lineTiles, hasLineOfFire,
  type TileGrid,
} from '../grid';
import { resolveAction } from '../damage';
import { applyBranch, reduceShields, bossDefeated, wardenAbsorbs } from '../boss';
import { decideEnemy } from '../ai';
import { makeKeeper, makeMira, makeEnemy } from '../units';
import { key, GRID_W, GRID_H, type UnitState, type TileType } from '../types';

const floorGrid = (w: number, h: number): TileGrid =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => 'floor' as TileType));

describe('initiative', () => {
  it('sorts by speed desc, party wins ties, stable by index', () => {
    const units = [
      makeEnemy({ archetype: 'wraith' }, 0, 5, 5), // speed 4
      makeKeeper(1, 1), // speed 5
      makeMira(2, 1), // speed 4 (party, ties wraith → before it)
      makeEnemy({ archetype: 'construct' }, 1, 6, 6), // speed 2
    ];
    expect(buildInitiative(units)).toEqual(['keeper', 'mira', 'wraith-0', 'construct-1']);
  });

  it('nextInOrder skips the dead and flags new rounds', () => {
    const order = ['a', 'b', 'c'];
    const dead = new Set(['b']);
    const alive = (id: string) => !dead.has(id);
    expect(nextInOrder(order, 0, alive)).toEqual({ id: 'c', index: 2, newRound: false });
    expect(nextInOrder(order, 2, alive)).toEqual({ id: 'a', index: 0, newRound: true });
    dead.add('a'); dead.add('c');
    expect(nextInOrder(order, 0, alive)).toBeNull();
  });
});

describe('move field (BFS with terrain costs)', () => {
  it('reaches the Manhattan disk on open floor', () => {
    const tiles = floorGrid(5, 5);
    const field = computeMoveField({ c: 2, r: 2 }, 2, tiles, new Set());
    expect(reachableTiles(field, { c: 2, r: 2 })).toHaveLength(12); // disk of radius 2 minus centre
  });

  it('gold heaps cost 2 to enter', () => {
    const tiles = floorGrid(5, 5);
    tiles[2][3] = 'gold';
    const field = computeMoveField({ c: 2, r: 2 }, 1, tiles, new Set());
    expect(field.cost.has(key(3, 2))).toBe(false); // cost 2 > move 1
    expect(field.cost.has(key(1, 2))).toBe(true); // floor neighbour, cost 1
    const far = computeMoveField({ c: 2, r: 2 }, 2, tiles, new Set());
    expect(far.cost.get(key(3, 2))).toBe(2);
  });

  it('walls and occupied tiles block traversal', () => {
    const tiles = floorGrid(5, 5);
    tiles[2][3] = 'wall';
    const field = computeMoveField({ c: 2, r: 2 }, 3, tiles, new Set([key(1, 2)]));
    expect(field.cost.has(key(3, 2))).toBe(false); // wall
    expect(field.cost.has(key(1, 2))).toBe(false); // occupied
  });

  it('paths route around gold when cheaper', () => {
    const tiles = floorGrid(5, 5);
    tiles[2][3] = 'gold';
    const field = computeMoveField({ c: 2, r: 2 }, 4, tiles, new Set());
    const path = pathTo(field, { c: 4, r: 2 });
    expect(path).not.toBeNull();
    // straight line through gold would cost 2+1=3; detour is 4 floor steps.
    // Dijkstra takes the cheaper straight route here (cost 3).
    expect(field.cost.get(key(4, 2))).toBe(3);
    expect(path![0]).toEqual({ c: 2, r: 2 });
    expect(path![path!.length - 1]).toEqual({ c: 4, r: 2 });
  });
});

describe('AoE geometry', () => {
  it('cross = centre + 4 arms, clipped to board', () => {
    expect(crossTiles({ c: 5, r: 5 })).toHaveLength(5);
    expect(crossTiles({ c: 0, r: 0 })).toHaveLength(3); // two arms off-board
  });
  it('line walks depth tiles in a direction', () => {
    expect(lineTiles({ c: 2, r: 2 }, 'right', 3)).toEqual([
      { c: 3, r: 2 }, { c: 4, r: 2 }, { c: 5, r: 2 },
    ]);
  });
  it('line of fire needs a clear straight shot within range', () => {
    const tiles = floorGrid(6, 6);
    expect(hasLineOfFire({ c: 1, r: 1 }, { c: 4, r: 1 }, 3, tiles)).toBe(true);
    expect(hasLineOfFire({ c: 1, r: 1 }, { c: 5, r: 1 }, 3, tiles)).toBe(false); // out of range
    expect(hasLineOfFire({ c: 1, r: 1 }, { c: 3, r: 3 }, 3, tiles)).toBe(false); // diagonal
    tiles[1][3] = 'wall';
    expect(hasLineOfFire({ c: 1, r: 1 }, { c: 4, r: 1 }, 3, tiles)).toBe(false); // blocked
  });
});

describe('damage table', () => {
  it('Strike is a fixed FREE hit — quality-independent, never misses, no self-chip', () => {
    expect(resolveAction('strike', 1)).toMatchObject({ hits: 1, selfChip: 0, fade: 0 });
    expect(resolveAction('strike', 0)).toMatchObject({ hits: 1, selfChip: 0 }); // quality irrelevant
  });

  it('Smite is a quick bolt — 3× a Strike at full, fizzles (no chip) on a whiff', () => {
    expect(resolveAction('smite', 1)).toMatchObject({ hits: 3, selfChip: 0 });
    expect(resolveAction('smite', 0.5)).toMatchObject({ hits: 1 });
    expect(resolveAction('smite', 0)).toMatchObject({ hits: 0, selfChip: 0 });
  });

  it("Mira's mastery bonus folds into a landed hit, never into a whiff", () => {
    expect(resolveAction('strike', 1, { miraBonus: 1 }).hits).toBe(2); // free strike 1 + bonus
    expect(resolveAction('smite', 1, { miraBonus: 1 }).hits).toBe(4); // smite 3 + bonus
    expect(resolveAction('smite', 0, { miraBonus: 1 }).hits).toBe(0); // no bonus on a whiff
  });

  it('Weave hits the whole cross only at full quality (2 dmg per tile)', () => {
    expect(resolveAction('weave', 1)).toMatchObject({ aoe: 'cross', hits: 2, aoeHit: 2 });
    expect(resolveAction('weave', 0.5)).toMatchObject({ hits: 2, aoeHit: 0 }); // primary only
    expect(resolveAction('weave', 0)).toMatchObject({ hits: 0, selfChip: 0 });
  });

  it('Sequence lance depth = floor(q*3), 2 dmg per tile', () => {
    expect(resolveAction('sequence', 1)).toMatchObject({ lineDepth: 3, hits: 2, aoeHit: 2 });
    expect(resolveAction('sequence', 0.5)).toMatchObject({ lineDepth: 1, hits: 2 });
    expect(resolveAction('sequence', 0)).toMatchObject({ lineDepth: 0, hits: 0 });
  });

  it('Cast is the big one, and the Fade bites back on failure', () => {
    expect(resolveAction('cast', 1)).toMatchObject({ hits: 6, fade: 0 });
    expect(resolveAction('cast', 0.5)).toMatchObject({ hits: 2 });
    expect(resolveAction('cast', 0)).toMatchObject({ hits: 0, fade: 2 });
  });

  it('every GATED spell out-damages a free Strike at full quality (the economy invariant)', () => {
    const strike = resolveAction('strike', 1).hits; // 1
    for (const a of ['smite', 'weave', 'sequence', 'cast'] as const) {
      expect(resolveAction(a, 1).hits, `${a} full ≥ strike`).toBeGreaterThan(strike);
    }
  });

  it('a passing Cast vs the Warden strips an extra shield', () => {
    expect(resolveAction('cast', 1, { vsBoss: true }).extraShield).toBe(1);
    expect(resolveAction('cast', 0.5, { vsBoss: true }).extraShield).toBe(0);
    expect(resolveAction('cast', 1, { vsBoss: false }).extraShield).toBe(0);
  });

  it('Parley branches to weaken or backfire', () => {
    expect(resolveAction('parley', 1, { branchTag: 'good' })).toMatchObject({ weaken: true, partyHit: 0 });
    expect(resolveAction('parley', 1, { branchTag: 'bad' })).toMatchObject({ weaken: false, partyHit: 2 });
    expect(resolveAction('parley', 1, { branchTag: 'neutral' })).toMatchObject({ weaken: false, partyHit: 0 });
  });

  it('every outcome carries a why-banner', () => {
    for (const a of ['strike', 'smite', 'weave', 'sequence', 'cast', 'parley', 'wait'] as const) {
      for (const q of [0, 0.5, 1] as const) {
        expect(resolveAction(a, q, { branchTag: 'good' }).banner.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('boss reducers', () => {
  it('good breaks a shield + staggers; bad costs HP + heals the Warden', () => {
    expect(applyBranch('good')).toMatchObject({ shieldDelta: -1, stagger: true, partyDelta: 0 });
    expect(applyBranch('bad')).toMatchObject({ shieldDelta: 0, partyDelta: -2, wardenHeal: 1 });
    expect(applyBranch('neutral')).toMatchObject({ shieldDelta: 0, partyDelta: 0 });
  });
  it('shields clamp at zero', () => {
    expect(reduceShields(3, -1)).toBe(2);
    expect(reduceShields(1, -2)).toBe(0);
  });
  it('defeat = no shields or no HP', () => {
    expect(bossDefeated(0, 8)).toBe(true);
    expect(bossDefeated(2, 0)).toBe(true);
    expect(bossDefeated(2, 8)).toBe(false);
  });
  it('shielded Warden absorbs every non-Cast blow (boss questions stay mandatory)', () => {
    expect(wardenAbsorbs('strike', true, 3)).toBe(true); // free Strike can't brute-force the boss
    expect(wardenAbsorbs('smite', true, 3)).toBe(true);
    expect(wardenAbsorbs('weave', true, 1)).toBe(true);
    expect(wardenAbsorbs('cast', true, 3)).toBe(false); // only Cast pierces the shields
    expect(wardenAbsorbs('strike', true, 0)).toBe(false); // shields gone → already beaten
    expect(wardenAbsorbs('strike', false, 3)).toBe(false); // a regular enemy just takes the hit
  });
});

describe('enemy AI', () => {
  const tiles = floorGrid(GRID_W, GRID_H);
  it('attacks in place when already adjacent', () => {
    const wisp = makeEnemy({ archetype: 'wisp' }, 0, 5, 5);
    const keeper = makeKeeper(5, 6); // adjacent
    const intent = decideEnemy(wisp, [keeper], tiles, new Set([key(5, 6)]));
    expect(intent.moveTo).toBeNull();
    expect(intent.attackTargetId).toBe('keeper');
  });

  it('closes the distance toward the nearest foe', () => {
    const wisp = makeEnemy({ archetype: 'wisp' }, 0, 1, 1);
    const keeper = makeKeeper(9, 1);
    const intent = decideEnemy(wisp, [keeper], tiles, new Set([key(9, 1)]));
    expect(intent.moveTo).not.toBeNull();
    expect(intent.moveTo!.c).toBeGreaterThan(1); // moved toward the keeper
  });

  it('a wraith opens fire from range down a clear line', () => {
    const wraith = makeEnemy({ archetype: 'wraith' }, 0, 2, 3);
    const mira = makeMira(5, 3); // 3 away, same row, clear
    const intent = decideEnemy(wraith, [mira], tiles, new Set([key(5, 3)]));
    expect(intent.attackTargetId).toBe('mira');
    expect(intent.moveTo).toBeNull();
  });
});

describe('seeded layout', () => {
  it('is deterministic and well-formed', () => {
    const a = buildLayout('room-1', 7);
    const b = buildLayout('room-1', 7);
    expect(a.tiles).toEqual(b.tiles);
    // border is all wall
    for (let c = 0; c < GRID_W; c++) {
      expect(a.tiles[0][c]).toBe('wall');
      expect(a.tiles[GRID_H - 1][c]).toBe('wall');
    }
    expect(a.gold.length).toBeGreaterThanOrEqual(2);
    expect(a.gold.length).toBeLessThanOrEqual(4);
    expect(a.lanterns.length).toBeGreaterThanOrEqual(1);
    expect(a.lanterns.length).toBeLessThanOrEqual(2);
    expect(a.partySpawns.length).toBeGreaterThan(0);
    expect(a.enemySpawns.length).toBeGreaterThan(0);
    // spawns land on floor
    for (const s of [...a.partySpawns, ...a.enemySpawns]) {
      expect(a.tiles[s.r][s.c]).toBe('floor');
    }
  });

  it('different seeds diverge', () => {
    expect(buildLayout('room-1', 1).tiles).not.toEqual(buildLayout('room-1', 2).tiles);
  });
});

// keep the makeEnemy shape honest for the test helper above
const _typecheck: UnitState = makeEnemy({ archetype: 'wisp' }, 0, 0, 0);
void _typecheck;
