import { describe, it, expect } from 'vitest';
import { buildInitiative, nextInOrder } from '../initiative';
import {
  buildLayout, computeMoveField, reachableTiles, pathTo, crossTiles, lineTiles, hasLineOfFire,
  blocksSight, forceMove, type TileGrid, type ForceMoveBoard,
} from '../grid';
import { resolveAction, isFlanked } from '../damage';
import { SPELLBOOK, resolveSpell } from '../spells';
import { applyBranch, reduceShields, bossDefeated, wardenAbsorbs } from '../boss';
import { decideEnemy, occupancyExcept, opportunityStrikers, carefulStepMove } from '../ai';
import { makeKeeper, makeMira, makeEnemy, ENEMY_STATS } from '../units';
import { key, manhattan, GRID_W, GRID_H, type UnitState, type TileType } from '../types';
import { usableSatchelItems, resolveHealUse } from '../satchel';
import { itemById } from '../../../inventory/catalog';

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

describe('blocksSight & mist LoF (§4.4)', () => {
  it('wall and mist block sight; floor/gold/lantern/brazier do not', () => {
    expect(blocksSight('wall')).toBe(true);
    expect(blocksSight('mist')).toBe(true);
    expect(blocksSight('floor')).toBe(false);
    expect(blocksSight('gold')).toBe(false);
    expect(blocksSight('lantern')).toBe(false);
    expect(blocksSight('brazier')).toBe(false);
  });

  it("a mist tile blocks a wraith's line of fire the same as a wall", () => {
    const tiles = floorGrid(6, 6);
    tiles[1][3] = 'mist';
    expect(hasLineOfFire({ c: 1, r: 1 }, { c: 4, r: 1 }, 3, tiles)).toBe(false);
  });

  it('a brazier does NOT block line of fire (passable, unlike wall/mist)', () => {
    const tiles = floorGrid(6, 6);
    tiles[1][3] = 'brazier';
    expect(hasLineOfFire({ c: 1, r: 1 }, { c: 4, r: 1 }, 3, tiles)).toBe(true);
  });
});

describe('forceMove — forced movement (§4.3)', () => {
  const tiles = floorGrid(6, 6);
  const board = (t: TileGrid, occupied = new Set<string>()): ForceMoveBoard => ({ tiles: t, occupied });

  it('moves one tile in-bounds onto an unoccupied non-wall tile', () => {
    expect(forceMove({ c: 2, r: 2 }, 'right', board(tiles))).toMatchObject({ moved: true, bump: false, to: { c: 3, r: 2 } });
  });

  it('bumps off a wall — stays, +1 bump, no move', () => {
    const walled = floorGrid(6, 6);
    walled[2][3] = 'wall';
    expect(forceMove({ c: 2, r: 2 }, 'right', board(walled))).toMatchObject({ moved: false, bump: true, to: { c: 2, r: 2 } });
  });

  it('bumps out of bounds — stays, +1 bump, no move', () => {
    expect(forceMove({ c: 0, r: 2 }, 'left', board(tiles))).toMatchObject({ moved: false, bump: true, to: { c: 0, r: 2 } });
  });

  it('bumps off an occupied tile — no domino (the occupant never moves, mover just bumps)', () => {
    expect(forceMove({ c: 2, r: 2 }, 'right', board(tiles, new Set([key(3, 2)])))).toMatchObject({ moved: false, bump: true, to: { c: 2, r: 2 } });
  });

  it('is direction-agnostic — a pull (toward-caster Dir) resolves under the same rules as a push', () => {
    expect(forceMove({ c: 2, r: 2 }, 'left', board(tiles))).toMatchObject({ moved: true, bump: false, to: { c: 1, r: 2 } });
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

describe('flanking geometry — isFlanked (§4.1)', () => {
  it('a living same-team unit at the opposite tile flanks — all 4 directions', () => {
    const cases: Array<[{ c: number; r: number }, { c: number; r: number }, { c: number; r: number }]> = [
      [{ c: 5, r: 5 }, { c: 5, r: 4 }, { c: 5, r: 3 }], // attacker south, target north, ally further north
      [{ c: 5, r: 5 }, { c: 5, r: 6 }, { c: 5, r: 7 }], // attacker north, target south, ally further south
      [{ c: 5, r: 5 }, { c: 4, r: 5 }, { c: 3, r: 5 }], // attacker east, target west, ally further west
      [{ c: 5, r: 5 }, { c: 6, r: 5 }, { c: 7, r: 5 }], // attacker west, target east, ally further east
    ];
    for (const [attacker, target, opposite] of cases) {
      const ally = makeKeeper(opposite.c, opposite.r);
      expect(isFlanked(attacker, target, 'party', [ally])).toBe(true);
    }
  });

  it('no unit at the opposite tile → no flank', () => {
    expect(isFlanked({ c: 5, r: 5 }, { c: 5, r: 4 }, 'party', [])).toBe(false);
  });

  it('a DEAD unit at the opposite tile does not flank', () => {
    const ally = makeKeeper(5, 3);
    ally.alive = false;
    expect(isFlanked({ c: 5, r: 5 }, { c: 5, r: 4 }, 'party', [ally])).toBe(false);
  });

  it("an enemy-team unit at the opposite tile does not flank (must be the attacker's own team)", () => {
    const foe = makeEnemy({ archetype: 'wisp' }, 0, 5, 3);
    expect(isFlanked({ c: 5, r: 5 }, { c: 5, r: 4 }, 'party', [foe])).toBe(false);
  });

  it('non-adjacent (range > 1) attacks never flank — spells never flank by the same gate', () => {
    const ally = makeKeeper(5, 2);
    expect(isFlanked({ c: 5, r: 5 }, { c: 5, r: 3 }, 'party', [ally])).toBe(false); // distance 2
  });

  it("regression (crucible v1 #6): flank must be evaluated against the VACATED tile, not a mover's later landing tile", () => {
    // Pincer: attacker at (5,4), ally at (5,2) — flanks a target AT the vacated tile (5,3)
    // (opposite = (5,3)+((5,3)-(5,4)) = (5,2), where the ally stands). The same attacker/ally
    // pair does NOT flank a target that has already moved on to (6,3) (opposite becomes
    // (7,2), empty) — proving the two positions are not interchangeable: CombatScene's
    // opportunity-strike resolution used to pass the mover's already-mutated (landing)
    // position instead of the vacated one it should evaluate against.
    const ally = makeKeeper(5, 2);
    expect(isFlanked({ c: 5, r: 4 }, { c: 5, r: 3 }, 'party', [ally]), 'flanked when checked against the vacated tile').toBe(true);
    expect(isFlanked({ c: 5, r: 4 }, { c: 6, r: 3 }, 'party', [ally]), 'NOT flanked when (wrongly) checked against the landing tile').toBe(false);
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

describe('AI v2 archetype directives (§8)', () => {
  const tiles = floorGrid(GRID_W, GRID_H);

  it('wisp prefers the flank-completing tile over an equidistant non-flanking one', () => {
    const keeper = makeKeeper(5, 5);
    const allyWisp = makeEnemy({ archetype: 'wisp' }, 1, 5, 4); // north of the keeper
    const self = makeEnemy({ archetype: 'wisp' }, 0, 8, 6); // equidistant from (6,5) and (5,6)
    const occ = occupancyExcept([self, keeper, allyWisp], self.id);
    const intent = decideEnemy(self, [keeper], tiles, occ, [allyWisp]);
    expect(intent.attackTargetId).toBe('keeper');
    expect(intent.moveTo).toEqual({ c: 5, r: 6 }); // flanks: opposite tile (5,4) holds the ally
  });

  it('wraith already adjacent retreats via Careful Step instead of trading blows', () => {
    const wraith = makeEnemy({ archetype: 'wraith' }, 0, 5, 5);
    const keeper = makeKeeper(5, 6); // adjacent
    const occ = occupancyExcept([wraith, keeper], wraith.id);
    const intent = decideEnemy(wraith, [keeper], tiles, occ);
    expect(intent.carefulStep).toBe(true);
    expect(intent.attackTargetId).toBeNull();
  });

  it('construct falls back to normal approach-and-attack when no wraith ally is present', () => {
    const construct = makeEnemy({ archetype: 'construct' }, 0, 1, 1);
    const keeper = makeKeeper(1, 2); // adjacent
    const intent = decideEnemy(construct, [keeper], tiles, new Set([key(1, 2)]));
    expect(intent.attackTargetId).toBe('keeper');
    expect(intent.moveTo).toBeNull();
  });

  it('decideEnemy without an allies argument keeps working (backward-compatible default [])', () => {
    const wisp = makeEnemy({ archetype: 'wisp' }, 0, 5, 5);
    const keeper = makeKeeper(5, 6);
    const intent = decideEnemy(wisp, [keeper], tiles, new Set([key(5, 6)]));
    expect(intent.attackTargetId).toBe('keeper');
  });
});

describe('opportunity strikes — eligibility (§4.2)', () => {
  it('eligible: alive, opposing team, orthogonally adjacent to the vacated tile, unspent, unstaggered', () => {
    const wisp = makeEnemy({ archetype: 'wisp' }, 0, 5, 5);
    expect(opportunityStrikers({ c: 5, r: 6 }, 'party', [wisp]).map((u) => u.id)).toEqual(['wisp-0']);
  });

  it('suppressed when the striker is Staggered', () => {
    const wisp = makeEnemy({ archetype: 'wisp' }, 0, 5, 5);
    wisp.statuses = [{ id: 'staggered', turnsLeft: 1, magnitude: 0 }];
    expect(opportunityStrikers({ c: 5, r: 6 }, 'party', [wisp])).toEqual([]);
  });

  it('suppressed once oaSpent is true (max one dealt per unit per round)', () => {
    const wisp = makeEnemy({ archetype: 'wisp' }, 0, 5, 5);
    wisp.oaSpent = true;
    expect(opportunityStrikers({ c: 5, r: 6 }, 'party', [wisp])).toEqual([]);
  });

  it('excludes dead units, same-team units, and non-adjacent units', () => {
    const deadWisp = makeEnemy({ archetype: 'wisp' }, 0, 5, 5);
    deadWisp.alive = false;
    const sameTeam = makeKeeper(5, 5);
    const farWisp = makeEnemy({ archetype: 'wisp' }, 1, 9, 9);
    expect(opportunityStrikers({ c: 5, r: 6 }, 'party', [deadWisp])).toEqual([]);
    expect(opportunityStrikers({ c: 5, r: 6 }, 'party', [sameTeam])).toEqual([]);
    expect(opportunityStrikers({ c: 5, r: 6 }, 'party', [farWisp])).toEqual([]);
  });
});

describe('Careful Step movement math (§4.2)', () => {
  it('halves move, floors, minimum 1', () => {
    expect(carefulStepMove(4)).toBe(2);
    expect(carefulStepMove(5)).toBe(2);
    expect(carefulStepMove(3)).toBe(1);
    expect(carefulStepMove(1)).toBe(1);
    expect(carefulStepMove(0)).toBe(1);
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

describe('brazier & mist generation (§4.4)', () => {
  it('braziers 0-1, mist 0 or 2 contiguous tiles, never in spawn zones, lanterns preserved — across many seeds', () => {
    for (let seed = 0; seed < 40; seed++) {
      const layout = buildLayout('room-terrain', seed);
      expect(layout.braziers.length).toBeLessThanOrEqual(1);
      expect([0, 2]).toContain(layout.mist.length);
      expect(layout.lanterns.length).toBeGreaterThanOrEqual(1); // never displaced

      for (const co of [...layout.braziers, ...layout.mist]) {
        expect(co.c).toBeGreaterThan(3); // outside the party spawn zone (c<=3)
        expect(co.c).toBeLessThan(GRID_W - 4); // outside the enemy spawn zone (c>=8)
        expect(layout.tiles[co.r][co.c]).toBe(layout.braziers.includes(co) ? 'brazier' : 'mist');
      }
      if (layout.mist.length === 2) {
        expect(manhattan(layout.mist[0], layout.mist[1])).toBe(1); // contiguous patch
      }
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = buildLayout('room-terrain', 11);
    const b = buildLayout('room-terrain', 11);
    expect(a.braziers).toEqual(b.braziers);
    expect(a.mist).toEqual(b.mist);
  });
});

describe('in-battle satchel (pure logic, inventory-handoff §10)', () => {
  const draught = itemById('embermend-draught')!; // heal +6
  const fullRestore = itemById('wardancers-restorative')!; // heal 999 ("to full")
  const trinket = itemById('faded-coin-cache')!; // effect kind 'none' — no combat effect

  it('usableSatchelItems surfaces only owned heal items (qty > 0), catalog order', () => {
    const snap = {
      gold: 0,
      stacks: { 'embermend-draught': 2, 'scriveners-hint': 3, 'faded-coin-cache': 1, 'lanternoil-tonic': 0 },
    };
    const usable = usableSatchelItems(snap);
    // tools ('scriveners-hint') and trinkets ('faded-coin-cache') are excluded even though
    // owned; a zero-qty heal ('lanternoil-tonic') is excluded too — only a real, owned heal remains.
    expect(usable.map((u) => u.item.id)).toEqual(['embermend-draught']);
    expect(usable[0].qty).toBe(2);
  });

  it('usableSatchelItems is empty when nothing in the satchel is usable in combat (cannot-use-when-empty)', () => {
    expect(usableSatchelItems({ gold: 0, stacks: {} })).toEqual([]);
    expect(usableSatchelItems({ gold: 0, stacks: { 'scriveners-hint': 5, 'ward-of-focus': 1 } })).toEqual([]);
  });

  it('resolveHealUse restores the item amount, clamped to the pool ceiling', () => {
    expect(resolveHealUse(draught, 6)).toMatchObject({ ok: true, nextPool: 12, gained: 6 });
    expect(resolveHealUse(draught, 12)).toMatchObject({ ok: true, nextPool: 16, gained: 4 }); // clamps at 16
  });

  it('a 999 ("full") heal always clamps to the pool ceiling', () => {
    expect(resolveHealUse(fullRestore, 1)).toMatchObject({ ok: true, nextPool: 16, gained: 15 });
  });

  it('rejects (no consumption, no turn spent) when already at full vigor — the action-spend gate', () => {
    expect(resolveHealUse(draught, 16)).toMatchObject({ ok: false, nextPool: 16, gained: 0 });
    expect(resolveHealUse(draught, 16).message).toBe('Already at full vigor.');
  });

  it('rejects a non-heal item outright (tools/trinkets have no combat-resolvable effect yet)', () => {
    expect(resolveHealUse(trinket, 6)).toMatchObject({ ok: false, gained: 0 });
  });
});

describe('unit factories — Phase 1 stat/field changes', () => {
  it('construct hp is 5 (the bruiser must survive one full Weave)', () => {
    expect(ENEMY_STATS.construct.hp).toBe(5);
    const construct = makeEnemy({ archetype: 'construct' }, 0, 0, 0);
    expect(construct.hp).toBe(5);
    expect(construct.maxHp).toBe(5);
  });

  it('every factory spawns with empty statuses and unspent OA/unique flags', () => {
    for (const u of [makeKeeper(0, 0), makeMira(0, 0), makeEnemy({ archetype: 'wisp' }, 0, 0, 0)]) {
      expect(u.statuses).toEqual([]);
      expect(u.oaSpent).toBe(false);
      expect(u.uniqueSpent).toBe(false);
    }
  });
});

describe('adapter equivalence — resolveAction over resolveSpell (Phase 2 §2)', () => {
  const T1 = [
    ['smite', 'smite'],
    ['weave', 'weave'],
    ['sequence', 'sequence'],
    ['cast', 'cast'],
  ] as const;

  it('resolveAction reproduces the SPELLBOOK numbers exactly for the four damage-bearing T1 spells × 3 qualities', () => {
    for (const [action, id] of T1) {
      for (const quality of [1, 0.5, 0] as const) {
        const slot = quality === 1 ? 'q1' : quality === 0.5 ? 'q05' : 'q0';
        const effect = SPELLBOOK[id].effects[slot];
        const outcome = resolveAction(action, quality);
        expect(outcome.hits, `${action} q${quality} hits`).toBe(effect.hits);
        expect(outcome.lineDepth, `${action} q${quality} lineDepth`).toBe(effect.lineDepth);
        expect(outcome.fade, `${action} q${quality} fade`).toBe(effect.fade);
      }
    }
  });

  it('resolveAction and a direct resolveSpell call agree on the primary-hit AMOUNT (same computeHit pipeline, no live statuses)', () => {
    for (const [action, id] of T1) {
      for (const quality of [1, 0.5, 0] as const) {
        const outcome = resolveAction(action, quality);
        const ops = resolveSpell(SPELLBOOK[id], quality, { primaryTargetId: 't' });
        const dmg = ops.find((o) => o.op === 'damage' && o.targetId === 't');
        expect(outcome.hits).toBe(dmg ? (dmg as { amount: number }).amount : 0);
      }
    }
  });

  it('the rider increases the primary hit through the legacy T1 adapter', () => {
    for (const [action] of T1) {
      const withoutRider = resolveAction(action, 1).hits;
      const withRider = resolveAction(action, 1, { rider: true }).hits;
      expect(withRider, `${action} q1 rider`).toBeGreaterThan(withoutRider);
    }
  });

  it('the legacy T1 adapter joins every banner op instead of dropping rider copy', () => {
    expect(resolveAction('smite', 1, { rider: true }).banner).toBe(
      `${SPELLBOOK.smite.banner.q1}\nThe truth burns brighter. (+1)`,
    );
  });

  it("Mira's bonus folds identically through the adapter as it did before (landed hit only, never a whiff)", () => {
    expect(resolveAction('smite', 1, { miraBonus: 1 }).hits).toBe(4);
    expect(resolveAction('smite', 0, { miraBonus: 1 }).hits).toBe(0);
    expect(resolveAction('sequence', 1, { miraBonus: 1 }).hits).toBe(3);
  });

  it("Cast's extraShield still derives from vsBoss+quality (now via SpellDef.bossRider, same shipped result)", () => {
    expect(resolveAction('cast', 1, { vsBoss: true }).extraShield).toBe(1);
    expect(resolveAction('cast', 0.5, { vsBoss: true }).extraShield).toBe(0);
    expect(resolveAction('cast', 1, { vsBoss: false }).extraShield).toBe(0);
  });

  it('Parley: branchTag still drives the outcome regardless of the passed quality argument (legacy quirk preserved)', () => {
    for (const [branchTag, slot] of [['good', 'q1'], ['bad', 'q0'], ['neutral', 'q05']] as const) {
      const effect = SPELLBOOK.parley.effects[slot];
      const outcome = resolveAction('parley', 1, { branchTag });
      expect(outcome.weaken).toBe(effect.weaken === true);
      expect(outcome.partyHit).toBe(effect.partyHit);
    }
  });
});

// keep the makeEnemy shape honest for the test helper above
const _typecheck: UnitState = makeEnemy({ archetype: 'wisp' }, 0, 0, 0);
void _typecheck;
