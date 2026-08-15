import { describe, it, expect } from 'vitest';
import { buildInitiative, nextInOrder } from '../initiative';
import {
  buildLayout, computeMoveField, reachableTiles, pathTo, crossTiles, lineTiles, hasLineOfFire,
  blocksSight, forceMove, filterDauntedField, type TileGrid, type ForceMoveBoard,
} from '../grid';
import { resolveAction, isFlanked } from '../damage';
import { SPELLBOOK, resolveSpell, type SpellId } from '../spells';
import {
  applyBranch, reduceShields, bossDefeated, wardenAbsorbs, wardenObjects, wardenMove, wardenMoveLabel,
  shieldStripDelta,
} from '../boss';
import { decideEnemy, occupancyExcept, opportunityStrikers, carefulStepMove } from '../ai';
import { makeKeeper, makeMira, makeEnemy, ENEMY_STATS, WARDEN_BOSS_HP } from '../units';
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

  it('Ch. VIII — bypasses Daunted BY CONSTRUCTION: its signature takes a raw Coord, never a UnitState/statuses, so a forced move toward a "source" cannot be gated even in principle', () => {
    // The mover here would be excluded from ending on this exact tile by filterDauntedField
    // (below) if it were a WILLING move toward the same coordinate — forceMove has no such
    // concept at all, and moves it anyway. This is the "verify, don't build a bypass" the
    // brief calls for: proof, not a new code path.
    const source = { c: 0, r: 2 };
    void source; // documents what "closer" would mean here; forceMove never consults it
    expect(forceMove({ c: 2, r: 2 }, 'left', board(tiles))).toMatchObject({ moved: true, to: { c: 1, r: 2 } }); // moves ONE STEP CLOSER to (0,2) unconditionally
  });
});

describe('filterDauntedField — Ch. VIII Daunted move-field filter (grid.ts pure variant)', () => {
  it('excludes tiles strictly closer to the source than the start tile, keeps equal/farther', () => {
    const tiles = floorGrid(11, 6);
    const start = { c: 5, r: 3 };
    const source = { c: 5, r: 0 }; // straight north of start, distance 3
    const field = computeMoveField(start, 3, tiles, new Set());
    const filtered = filterDauntedField(field, start, source, tiles);

    // (5,1) is 2 tiles closer to source (dist 1) than start (dist 3) — excluded.
    expect(field.cost.has(key(5, 1))).toBe(true); // sanity: reachable before filtering
    expect(filtered.cost.has(key(5, 1))).toBe(false);
    // (5,2) is 1 tile closer to source (dist 2 < 3) — excluded.
    expect(filtered.cost.has(key(5, 2))).toBe(false);
    // (5,4) is FARTHER from source (dist 4 >= 3) — kept.
    expect(filtered.cost.has(key(5, 4))).toBe(true);
    // (6,2) is EQUAL distance to source (|6-5|+|2-0| = 3, same as start's 3) — kept.
    expect(filtered.cost.has(key(6, 2))).toBe(true);
  });

  it('a kept tile reachable only by PASSING THROUGH an excluded tile still paths correctly — only ENDING closer is forbidden', () => {
    const tiles = floorGrid(11, 6);
    tiles[3][6] = 'wall'; // blocks the (5,3)->(6,3)->(6,2) route, forcing the (5,2) detour
    const start = { c: 5, r: 3 };
    const source = { c: 5, r: 0 };
    const field = computeMoveField(start, 3, tiles, new Set());
    const filtered = filterDauntedField(field, start, source, tiles);

    // (5,2): dist-to-source 2 < start's 3 — excluded. (6,2): dist-to-source 3 — kept. With
    // (6,3) walled, the ONLY cost-2 route from start to (6,2) passes through (5,2).
    expect(filtered.cost.has(key(5, 2))).toBe(false);
    expect(filtered.cost.has(key(6, 2))).toBe(true);

    const path = pathTo(filtered, { c: 6, r: 2 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual(start);
    expect(path![path!.length - 1]).toEqual({ c: 6, r: 2 });
    expect(path).toContainEqual({ c: 5, r: 2 }); // passes THROUGH the excluded tile en route
  });

  it('the start tile is never excluded (equal to itself)', () => {
    const tiles = floorGrid(11, 6);
    const start = { c: 5, r: 3 };
    const source = { c: 5, r: 0 };
    const field = computeMoveField(start, 3, tiles, new Set());
    const filtered = filterDauntedField(field, start, source, tiles);
    expect(filtered.cost.get(key(5, 3))).toBe(0);
  });

  it('gracefully no-ops when the start tile cannot path to the source at all (walled off)', () => {
    const tiles = floorGrid(11, 6);
    for (let c = 0; c < 11; c++) tiles[1][c] = 'wall'; // seals row 0 off from every row below it
    const start = { c: 5, r: 3 };
    const source = { c: 5, r: 0 }; // unreachable from start
    const field = computeMoveField(start, 3, tiles, new Set());
    const filtered = filterDauntedField(field, start, source, tiles);
    expect(filtered.cost.size).toBe(field.cost.size); // nothing excluded — "closer" is meaningless here
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

  it('the level Strike bonus binds to steel, not the Arts (Wave 4 — strikeBonusForLevel)', () => {
    expect(resolveAction('strike', 1, { strikeBonus: 0 }).hits).toBe(1); // today's base
    expect(resolveAction('strike', 1, { strikeBonus: 1 }).hits).toBe(2); // L5
    expect(resolveAction('strike', 1, { strikeBonus: 2 }).hits).toBe(3); // L9
    expect(resolveAction('strike', 1).hits).toBe(1); // absent = 0
    expect(resolveAction('strike', 1, { miraBonus: 1, strikeBonus: 2 }).hits).toBe(4); // stacks
    for (const a of ['smite', 'weave', 'sequence', 'cast'] as const) {
      expect(resolveAction(a, 1, { strikeBonus: 2 }).hits, `${a} unchanged`).toBe(
        resolveAction(a, 1).hits,
      );
    }
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
  it('shielded Warden absorbs every blow without a strip-shield rider (boss questions stay mandatory)', () => {
    expect(wardenAbsorbs(null, true, 3)).toBe(true); // free Strike can't brute-force the boss
    expect(wardenAbsorbs(SPELLBOOK.smite, true, 3)).toBe(true);
    expect(wardenAbsorbs(SPELLBOOK.weave, true, 1)).toBe(true);
    expect(wardenAbsorbs(SPELLBOOK.cast, true, 3)).toBe(false); // Attestation pierces the shields
    expect(wardenAbsorbs(null, true, 0)).toBe(false); // shields gone → already beaten
    expect(wardenAbsorbs(null, false, 3)).toBe(false); // a regular enemy just takes the hit
  });

  // §9.2 / trap 10 — the spec's own Phase-3 verification item: the FULL absorb matrix, every
  // one of the 15 spells against a shielded Warden. The point of moving the gate off the
  // 'cast' STRING and onto SpellDef.bossRider is that Attested Ward and Verbatim Decree must
  // pierce (they are Attestation too) while sharing the 'cast' button is NOT what earns it.
  it('absorb-flag matrix: exactly the three bossRider spells pierce a shielded Warden (§9.2)', () => {
    const pierce: SpellId[] = [];
    const bounce: SpellId[] = [];
    for (const id of Object.keys(SPELLBOOK) as SpellId[]) {
      (wardenAbsorbs(SPELLBOOK[id], true, 3) ? bounce : pierce).push(id);
    }
    expect(pierce.sort()).toEqual(['attested-ward', 'cast', 'verbatim-decree']);
    expect(bounce.sort()).toEqual([
      'cinder-rebuke', 'heartening-word', 'injunction', 'lanternfall', 'lattice',
      'parley', 'processional', 'rite-of-sealing', 'sequence', 'smite', 'snare-knot', 'weave',
    ]);
    // …and all 15 are accounted for, so a newly added spell can never silently skip this test.
    expect(pierce.length + bounce.length).toBe(15);
  });

  it('every Attestation tier pierces at every shield count; every other Art bounces (§9.2)', () => {
    for (const shields of [1, 2, 3]) {
      for (const id of Object.keys(SPELLBOOK) as SpellId[]) {
        const spell = SPELLBOOK[id];
        expect(wardenAbsorbs(spell, true, shields), `${id} @ ${shields} shields`)
          .toBe(spell.art !== 'attestation');
      }
    }
  });
});

// §9.3/§9.4 — the reforged Warden's own reducers. Pure; the scene applies them.
describe('the Warden reforged (§9)', () => {
  it('Objection! fires on the free lane and is once per round', () => {
    expect(wardenObjects(null, true, false)).toBe(true);   // first free-lane blow this round
    expect(wardenObjects(null, true, true)).toBe(false);   // already spent this round
    expect(wardenObjects(null, false, false)).toBe(false); // a regular enemy never objects
    expect(wardenObjects(null, undefined, false)).toBe(false);
  });

  // ---- THE S4 TEST ----------------------------------------------------------------------
  // Soul guarantee S4: "A correct answer always pays — no enemy mechanic may void the payoff
  // of a correctly answered question. The Warden's Objection counters only FREE actions, by
  // design — knowledge always lands." This is the guarantee the whole feature is built to
  // protect, so it is asserted exhaustively rather than by sample: every spell, every tier,
  // every Art, in both the fresh and spent states.
  it('S4 — Objection NEVER fires on an Art: all 15 spells × both Objection states', () => {
    const ids = Object.keys(SPELLBOOK) as SpellId[];
    expect(ids.length).toBe(15);
    for (const id of ids) {
      for (const spent of [false, true]) {
        expect(wardenObjects(SPELLBOOK[id], true, spent), `${id} (objectionSpent=${spent})`).toBe(false);
      }
    }
    // The same free-lane swing at the same instant DOES get lawyered — proving the assertions
    // above fail closed on the spell argument alone, not because the fixture was inert.
    expect(wardenObjects(null, true, false)).toBe(true);
  });

  it('§9.4 phase script: Writ of Seizure in phase 1, Crown Injunction every OTHER turn from phase 2', () => {
    // Phase 1 (phaseIndex 0) is his base kit on every turn, no matter the turn count.
    for (const t of [1, 2, 3, 4]) {
      expect(wardenMove({ phaseIndex: 0, wardenTurns: t, clauseAvailable: false })).toBe('seizure');
    }
    // Phase 2+ alternates: his 1st/3rd turn is a blow, his 2nd/4th is the Injunction.
    expect(wardenMove({ phaseIndex: 1, wardenTurns: 1, clauseAvailable: false })).toBe('seizure');
    expect(wardenMove({ phaseIndex: 1, wardenTurns: 2, clauseAvailable: false })).toBe('injunction');
    expect(wardenMove({ phaseIndex: 1, wardenTurns: 3, clauseAvailable: false })).toBe('seizure');
    expect(wardenMove({ phaseIndex: 1, wardenTurns: 4, clauseAvailable: false })).toBe('injunction');
  });

  it('§9.4 Call the Clause: phase 3+ only, and only while actually available', () => {
    expect(wardenMove({ phaseIndex: 1, wardenTurns: 1, clauseAvailable: true })).not.toBe('summon');
    expect(wardenMove({ phaseIndex: 2, wardenTurns: 1, clauseAvailable: true })).toBe('summon');
    // Once spent (or with a clause-wisp still alive / no free spawn tile) the script falls back.
    expect(wardenMove({ phaseIndex: 2, wardenTurns: 1, clauseAvailable: false })).toBe('seizure');
    expect(wardenMove({ phaseIndex: 2, wardenTurns: 2, clauseAvailable: false })).toBe('injunction');
  });

  it('§9.5 move labels: engine-generic by default, pack-relabelable, blank relabels ignored', () => {
    expect(wardenMoveLabel('seizure')).toBe('Writ of Seizure');
    expect(wardenMoveLabel('injunction')).toBe('Crown Injunction');
    expect(wardenMoveLabel('summon')).toBe('Call the Clause');
    expect(wardenMoveLabel('injunction', { injunction: "Injunction of the '33 Codex" }))
      .toBe("Injunction of the '33 Codex");
    // a partial map only overrides what it names
    expect(wardenMoveLabel('seizure', { injunction: 'x' })).toBe('Writ of Seizure');
    // whitespace-only is not a label
    expect(wardenMoveLabel('summon', { summon: '   ' })).toBe('Call the Clause');
  });

  it('§9.1 boss HP 12: the fallback kill still costs two apex q1 answers, and one Decree never suffices', () => {
    expect(WARDEN_BOSS_HP).toBe(12);
    // Verbatim Decree deals 6 vs a boss (§7's vsBossHits), not its usual 8.
    const decree = resolveSpell(SPELLBOOK['verbatim-decree'], 1, { primaryTargetId: 'warden', vsBoss: true })
      .find((o) => o.op === 'damage');
    expect(decree).toMatchObject({ op: 'damage', amount: 6 });
    expect(6).toBeLessThan(WARDEN_BOSS_HP);   // one Decree cannot end him — phases stay mandatory
    expect(6 * 2).toBeGreaterThanOrEqual(WARDEN_BOSS_HP); // two apex q1 answers do
    // Even upcast to the ceiling (Overglow +1, weld +1, rider +1, Mira +1) a single q1 Decree
    // leaves him standing — the negotiation can never be skipped by one perfect answer.
    const maxed = resolveSpell(SPELLBOOK['verbatim-decree'], 1, {
      primaryTargetId: 'warden', vsBoss: true, overglow: true, weld: true, rider: true, miraBonus: 1,
    }).find((o) => o.op === 'damage') as { amount: number };
    expect(maxed.amount).toBeLessThan(WARDEN_BOSS_HP);
    // The room's regular 'warden' archetype trash (the Root-Husk) is NOT reforged with him.
    expect(ENEMY_STATS.warden.hp).toBe(8);
  });
});

/**
 * §9.2 — shield STRIPPING, the arithmetic. Regression cover for a HIGH bug found by the
 * crucible sweep and closed here: castGatedSpell wrote `reduceShields(this.shields, 1)`, and
 * because reduceShields ADDS its signed delta that GRANTED the Warden a shield on every apex
 * cast — a q1 Verbatim Decree made him progressively unkillable while the float still read
 * "−shield". It shipped because nothing tested the sign; these do, at the pure layer that both
 * call sites now share (shieldStripDelta owns the sign, so no call site can get it wrong).
 */
describe('§9.2 shield stripping — the signed delta', () => {
  const shielded = 3;

  it('a q1 strip-shield cast at the boss REMOVES exactly one shield (never adds one)', () => {
    for (const id of ['cast', 'attested-ward', 'verbatim-decree'] as const) {
      const delta = shieldStripDelta(SPELLBOOK[id], 1, true);
      expect(delta, `${id} strips`).toBe(-1);
      expect(reduceShields(shielded, delta), `${id} takes 3 shields to 2`).toBe(2);
      // …and the direction is the point: it must never come out ABOVE where it started.
      expect(reduceShields(shielded, delta)).toBeLessThan(shielded);
    }
  });

  it('stripping clamps at zero — a strip against an unshielded Warden cannot go negative', () => {
    expect(reduceShields(0, shieldStripDelta(SPELLBOOK['verbatim-decree'], 1, true))).toBe(0);
    expect(reduceShields(1, shieldStripDelta(SPELLBOOK.cast, 1, true))).toBe(0);
  });

  it('a partial or failed cast strips nothing (quality must be exactly q1)', () => {
    for (const q of [0.5, 0] as const) {
      expect(shieldStripDelta(SPELLBOOK['verbatim-decree'], q, true), `q${q}`).toBe(0);
      expect(reduceShields(shielded, shieldStripDelta(SPELLBOOK['verbatim-decree'], q, true))).toBe(shielded);
    }
  });

  it('a cast at a REGULAR enemy strips nothing (vsBoss required)', () => {
    expect(shieldStripDelta(SPELLBOOK.cast, 1, false)).toBe(0);
    expect(reduceShields(shielded, shieldStripDelta(SPELLBOOK.cast, 1, false))).toBe(shielded);
  });

  it('no non-Attestation spell, and no free action, ever moves the shield count', () => {
    for (const id of Object.keys(SPELLBOOK) as SpellId[]) {
      if (SPELLBOOK[id].bossRider === 'strip-shield') continue;
      expect(shieldStripDelta(SPELLBOOK[id], 1, true), `${id} must not strip`).toBe(0);
    }
    expect(shieldStripDelta(null, 1, true), 'free steel never strips a shield').toBe(0);
  });

  it('the shield count is monotonically non-increasing under any sequence of casts', () => {
    // The property the bug violated, stated directly: nothing a player casts can RAISE it.
    let shields = 3;
    for (const q of [1, 0.5, 1, 0, 1, 1] as const) {
      for (const id of Object.keys(SPELLBOOK) as SpellId[]) {
        const next = reduceShields(shields, shieldStripDelta(SPELLBOOK[id], q, true));
        expect(next, `${id} @ q${q} raised the shields from ${shields} to ${next}`).toBeLessThanOrEqual(shields);
        shields = next;
      }
    }
    expect(shields).toBe(0);
  });
});

// §9.4 — appending a mid-battle reinforcement to the initiative order must not break the
// turn cursor. nextInOrder reads order.length fresh on every call, so a grown array is safe.
describe('spawnReinforcement initiative wrap-safety (§9.4)', () => {
  const allAlive = () => true;

  it('an id appended mid-round is reached, without disturbing the cursor', () => {
    const order = ['keeper', 'mira', 'warden'];
    // cursor sits on the Warden (index 2) — the turn on which he calls the clause
    order.push('wisp-3');
    expect(nextInOrder(order, 2, allAlive)).toEqual({ id: 'wisp-3', index: 3, newRound: false });
    // and the round still wraps correctly one slot later, with the grown length
    expect(nextInOrder(order, 3, allAlive)).toEqual({ id: 'keeper', index: 0, newRound: true });
  });

  it('appending while the cursor is on the OLD last index never runs off the end', () => {
    const order = ['keeper', 'warden'];
    const fromIndex = 1; // the old final slot
    order.push('wisp-2');
    const next = nextInOrder(order, fromIndex, allAlive);
    expect(next).not.toBeNull();
    expect(next!.index).toBeLessThan(order.length);
    expect(next!.id).toBe('wisp-2');
  });

  // The exhaustive statement of the safety property, over every cursor a spawn can actually
  // produce. `orderIndex` is only ever assigned from a previous nextInOrder result (already
  // normalized into [0, len)) or the initial -1, and `order` only ever GROWS — so after any
  // append the live cursor is always in [-1, oldLength-1], which is what this sweeps.
  //
  // NOTE (documented boundary, not a bug reachable from this feature): nextInOrder normalizes
  // with a single `idx -= order.length`, not a modulo, so a cursor MORE than one length past
  // the end would not be brought back into range. That needs the array to SHRINK, which
  // nothing in combat ever does — spawnReinforcement only appends, and units are removed by
  // dying (alive:false), never by splicing out of `order`.
  it('every cursor an append can produce stays in bounds and returns a real id', () => {
    for (let oldLength = 1; oldLength <= 5; oldLength++) {
      const order = Array.from({ length: oldLength }, (_, i) => `u${i}`);
      for (let cursor = -1; cursor < oldLength; cursor++) {
        order.push('wisp-clause');           // the mid-battle spawn
        const next = nextInOrder(order, cursor, allAlive);
        expect(next, `len ${oldLength}, cursor ${cursor}`).not.toBeNull();
        expect(next!.index).toBeGreaterThanOrEqual(0);
        expect(next!.index).toBeLessThan(order.length);
        expect(order[next!.index]).toBe(next!.id);
        order.pop();                          // reset for the next cursor
      }
    }
  });

  it('a dead spawn is skipped like any other unit, and the order never deadlocks', () => {
    const order = ['keeper', 'warden', 'wisp-2'];
    const alive = (id: string) => id !== 'wisp-2';
    expect(nextInOrder(order, 1, alive)).toEqual({ id: 'keeper', index: 0, newRound: true });
    // Reaching the lone survivor requires a full lap, so the wrap is correctly reported —
    // which is what re-arms Objection and clears oaSpent for the round it starts.
    expect(nextInOrder(order, 2, (id) => id === 'wisp-2')).toEqual({ id: 'wisp-2', index: 2, newRound: true });
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

describe('Ch. VIII Task 4 — decideEnemy respects Daunted (enemy-side extension; party-side is the requirement)', () => {
  const tiles = floorGrid(GRID_W, GRID_H);

  it('without a dauntedSourceCoord (the pre-existing 5-arg call), an enemy closes in and attacks as always', () => {
    const wisp = makeEnemy({ archetype: 'wisp' }, 0, 5, 5);
    const keeper = makeKeeper(1, 5); // 4 away, straight west
    const intent = decideEnemy(wisp, [keeper], tiles, new Set([key(1, 5)]));
    expect(intent.moveTo).toEqual({ c: 2, r: 5 });
    expect(intent.attackTargetId).toBe('keeper');
  });

  it('Daunted (source due west, same distance as the keeper): the only tiles that close on the keeper also close on the source, so the enemy holds position instead', () => {
    const wisp = makeEnemy({ archetype: 'wisp' }, 0, 5, 5);
    const keeper = makeKeeper(1, 5);
    const source = { c: 0, r: 5 }; // 5 away from (5,5) — one step further west than the keeper
    const intent = decideEnemy(wisp, [keeper], tiles, new Set([key(1, 5)]), [], source);
    expect(intent.moveTo).toBeNull(); // every closing tile is also a closer-to-source tile — excluded
    expect(intent.attackTargetId).toBeNull(); // never got into range
  });

  it('Daunted with the source BEHIND the enemy (away from the keeper): closing in is unaffected', () => {
    const wisp = makeEnemy({ archetype: 'wisp' }, 0, 5, 5);
    const keeper = makeKeeper(1, 5);
    const source = { c: 9, r: 5 }; // east — opposite the keeper, so approaching west moves AWAY from it
    const intent = decideEnemy(wisp, [keeper], tiles, new Set([key(1, 5)]), [], source);
    expect(intent.moveTo).toEqual({ c: 2, r: 5 }); // identical to the undaunted case above
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

  // Ch. VIII — mid-rise (a Toppled unit that just stood at its own turn start) disables the
  // opportunity latch until turn end, same idiom as Staggered above, but Toppled itself carries
  // no duration to check via hasStatus (it's consumed by the rise) — the scene tracks it as a
  // separate turn-scoped mark instead, threaded in as this 4th, optional, default-empty
  // parameter so every pre-existing call site (including every test above) keeps compiling and
  // behaving identically without passing it.
  it('suppressed when the striker is mid-rise (Ch. VIII), even though otherwise eligible', () => {
    const wisp = makeEnemy({ archetype: 'wisp' }, 0, 5, 5);
    expect(opportunityStrikers({ c: 5, r: 6 }, 'party', [wisp], new Set(['wisp-0']))).toEqual([]);
  });

  it('an unrelated id in midRiseIds does not suppress a striker not in the set', () => {
    const wisp = makeEnemy({ archetype: 'wisp' }, 0, 5, 5);
    expect(opportunityStrikers({ c: 5, r: 6 }, 'party', [wisp], new Set(['some-other-unit'])).map((u) => u.id)).toEqual(['wisp-0']);
  });

  it('omitting midRiseIds entirely (every pre-existing call site) is unaffected — defaults to no exclusions', () => {
    const wisp = makeEnemy({ archetype: 'wisp' }, 0, 5, 5);
    expect(opportunityStrikers({ c: 5, r: 6 }, 'party', [wisp]).map((u) => u.id)).toEqual(['wisp-0']);
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

  it('usableSatchelItems surfaces owned heal AND trial-tool items (qty > 0), catalog order', () => {
    const snap = {
      gold: 0,
      stacks: { 'embermend-draught': 2, 'scriveners-hint': 3, 'faded-coin-cache': 1, 'lanternoil-tonic': 0 },
    };
    const usable = usableSatchelItems(snap);
    // Phase 3 (Ch. VII Mira's Stall) — trial tools now surface alongside heals; trinkets
    // ('faded-coin-cache') still stay excluded even though owned, and a zero-qty heal
    // ('lanternoil-tonic') is excluded too. Both surfacing items appear in catalog order.
    expect(usable.map((u) => u.item.id)).toEqual(['embermend-draught', 'scriveners-hint']);
    expect(usable[0].qty).toBe(2);
    expect(usable[1].qty).toBe(3);
  });

  it('usableSatchelItems is empty when nothing owned is usable in combat (cannot-use-when-empty); Ward of Focus stays excluded', () => {
    expect(usableSatchelItems({ gold: 0, stacks: {} })).toEqual([]);
    // Ward of Focus (streak_shield) is passive — never armed, never in the combat Satchel,
    // even when owned (Constraint 4). It's the one tool kind that stays excluded permanently.
    expect(usableSatchelItems({ gold: 0, stacks: { 'ward-of-focus': 1 } })).toEqual([]);
  });

  it('resolveHealUse restores the item amount, clamped to the caller-supplied maxPool', () => {
    expect(resolveHealUse(draught, 6, 16)).toMatchObject({ ok: true, nextPool: 12, gained: 6 });
    expect(resolveHealUse(draught, 12, 16)).toMatchObject({ ok: true, nextPool: 16, gained: 4 }); // clamps at 16
  });

  it('a 999 ("full") heal always clamps to the caller-supplied maxPool', () => {
    expect(resolveHealUse(fullRestore, 1, 16)).toMatchObject({ ok: true, nextPool: 16, gained: 15 });
  });

  it('rejects (no consumption, no turn spent) when already at full vigor — the action-spend gate', () => {
    expect(resolveHealUse(draught, 16, 16)).toMatchObject({ ok: false, nextPool: 16, gained: 0 });
    expect(resolveHealUse(draught, 16, 16).message).toBe('Already at full vigor.');
  });

  it('rejects a non-heal item outright (tools/trinkets have no combat-resolvable effect yet)', () => {
    expect(resolveHealUse(trinket, 6, 16)).toMatchObject({ ok: false, gained: 0 });
  });

  // Wave 4 Task 7 — maxPool is now a REQUIRED param (the old fixed-16 default died): the
  // caller passes a fresh maxHpForLevel(save.level ?? 1) read, so the ceiling itself is
  // level-keyed, not just the pool value being clamped against it.
  it('the pool ceiling is whatever maxPool the caller supplies, not a hardcoded 16', () => {
    // L3 ceiling (maxHpForLevel(3) = 20): a heal that would have clamped at 16 pre-Wave-4
    // now clamps higher, and "already full" now means full at 20, not 16.
    expect(resolveHealUse(draught, 15, 20)).toMatchObject({ ok: true, nextPool: 20, gained: 5 });
    expect(resolveHealUse(draught, 20, 20)).toMatchObject({ ok: false, nextPool: 20, gained: 0 });
    expect(resolveHealUse(draught, 20, 20).message).toBe('Already at full vigor.');
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

  // crucible-2 weld-T1-unreachable — §5.5's weld edge is written for "a q1 cast", with no tier
  // restriction, but ResolveOpts carried no `weld` field at all and outcomeFromSpell never put
  // one in its ResolveSpellOpts. The T1 Arts (Smite/Weave/Sequence/Cast) were therefore
  // structurally incapable of welding: the mastery dividend the whole Leitner ladder builds
  // toward was silently unreachable for every Rank-1 player, i.e. everyone before Rank 2.
  it('a T1 cast CAN weld — the adapter carries the weld edge through (§5.5)', () => {
    expect(resolveAction('cast', 1, { weld: true }).hits).toBe(7); // 6 + 1
    expect(resolveAction('smite', 1, { weld: true }).hits).toBe(4); // 3 + 1
    expect(resolveAction('cast', 1, { weld: true }).banner)
      .toBe(`${SPELLBOOK.cast.banner.q1}\nThe welded truth strikes true.`);
  });

  it('a T1 weld obeys the same q1 gate as every other tier (§5.5)', () => {
    expect(resolveAction('cast', 0.5, { weld: true }).hits).toBe(2); // unwelded 2, not 3
    expect(resolveAction('cast', 0.5, { weld: true }).banner).not.toContain('welded truth');
  });

  it('the weld edge is primary-only through the adapter — never on a Weave arm', () => {
    const welded = resolveAction('weave', 1, { weld: true });
    expect(welded.hits).toBe(3);   // centre 2 + 1
    expect(welded.aoeHit).toBe(2); // arms untouched
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
