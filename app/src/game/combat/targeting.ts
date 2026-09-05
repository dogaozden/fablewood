/**
 * Spell targeting geometry: given a spell's shape and the tile the player picked, which
 * unit(s) it hits and (for shapes that carry one) which orthogonal direction a push effect
 * resolves in. Pure/Phaser-free, same discipline as grid.ts/damage.ts/spells.ts — extracted
 * out of CombatScene.spellGeometry (which now just forwards here) so this can be unit-tested
 * directly: CombatScene.ts pulls in Phaser at module scope (`import Phaser from 'phaser'`),
 * which throws `window is not defined` the instant it's imported under vitest's node
 * environment, so nothing inside that file can ever be reached from a test.
 *
 * This is the "caller resolves ids, board-aware" half of resolveSpell's contract (spells.ts's
 * own doc: "this module computes a battle-agnostic sequence of board primitives; the scene
 * ... resolves target ids/direction and applies the ops") — CombatScene.spellGeometry's own
 * doc comment names it the same way. Pulling it out of the Scene class doesn't change which
 * side of that contract it's on; it just makes that side reachable from a test.
 */
import { crossTiles, lineTiles, blocksSight, type TileGrid } from './grid';
import { qualitySlot, type SpellDef } from './spells';
import type { Coord, Dir, Quality, UnitState } from './types';

export interface SpellGeometry {
  primaryId?: string;
  aoeIds: string[];
  dir?: Dir;
}

function enemyAt(units: UnitState[], co: Coord): UnitState | undefined {
  return units.find((u) => u.alive && u.team === 'enemy' && u.c === co.c && u.r === co.r);
}

function unitAt(units: UnitState[], co: Coord): UnitState | undefined {
  return units.find((u) => u.alive && u.c === co.c && u.r === co.r);
}

/** 4-connected only, same as CombatScene's own dirTo — off-axis (diagonal) pairs return
 *  undefined, which is why a diagonal cast never carries a push direction. */
function dirTo(a: Coord, b: Coord): Dir | undefined {
  if (a.c === b.c) return b.r < a.r ? 'up' : 'down';
  if (a.r === b.r) return b.c < a.c ? 'left' : 'right';
  return undefined;
}

export function resolveSpellGeometry(
  unit: UnitState, spell: SpellDef, tile: Coord, quality: Quality, units: UnitState[], tiles: TileGrid,
): SpellGeometry {
  switch (spell.shape) {
    case 'single': {
      const t = enemyAt(units, tile);
      // 2.2 fix — 'single' never computed a push direction (only 'line' did, for its own
      // aiming), which is why Cinder-Rebuke's q1 push (spells.ts's only 'single'-shape spell
      // with push:1) was dead: resolveSpell's `effect.push === 1 && opts.dir` gate never saw
      // a dir to act on. Same 4-way-only dirTo as 'line' uses — off-axis targets still get no
      // push, since there's no orthogonal direction to shove along.
      return { primaryId: t?.id, aoeIds: [], dir: dirTo(unit, tile) };
    }
    case 'ally': {
      const t = unitAt(units, tile);
      return { primaryId: t && t.team === 'party' ? t.id : undefined, aoeIds: [] };
    }
    case 'cross': {
      const primary = enemyAt(units, tile);
      const aoeIds: string[] = [];
      for (const co of crossTiles(tile)) {
        if (co.c === tile.c && co.r === tile.r) continue;
        const e = enemyAt(units, co);
        if (e) aoeIds.push(e.id);
      }
      return { primaryId: primary?.id, aoeIds };
    }
    case 'line': {
      const dir = dirTo(unit, tile);
      if (!dir) return { aoeIds: [] };
      const depth = spell.effects[qualitySlot(quality)].lineDepth;
      let primaryId: string | undefined;
      const aoeIds: string[] = [];
      for (const [i, co] of lineTiles(unit, dir, depth).entries()) {
        const e = enemyAt(units, co);
        if (e) { if (i === 0) primaryId = e.id; else aoeIds.push(e.id); }
        // §4.4 — mist (and walls) block Ritecraft lines, same as sequence's own handling.
        if (blocksSight(tiles[co.r]?.[co.c])) break;
      }
      return { primaryId, aoeIds, dir };
    }
    case 'burst1': {
      const aoeIds: string[] = [];
      for (const co of crossTiles(unit)) {
        if (co.c === unit.c && co.r === unit.r) continue;
        const e = enemyAt(units, co);
        if (e) aoeIds.push(e.id);
      }
      return { aoeIds };
    }
    case 'self':
      return { aoeIds: [] };
    default: {
      const exhaustive: never = spell.shape;
      return exhaustive;
    }
  }
}
