import { describe, it, expect } from 'vitest';
import { resolveSpellGeometry } from '../targeting';
import { SPELLBOOK, resolveSpell } from '../spells';
import { makeKeeper, makeEnemy } from '../units';
import type { TileGrid } from '../grid';
import type { TileType } from '../types';

const floorGrid = (w: number, h: number): TileGrid =>
  Array.from({ length: h }, () => Array.from({ length: w }, () => 'floor' as TileType));

// 2.2 — Cinder-Rebuke's dead push. resolveSpellGeometry is CombatScene.spellGeometry's own
// logic, pulled out so it's reachable from a test (CombatScene.ts imports Phaser at module
// scope, which throws `window is not defined` under vitest's node environment — nothing in
// that file can be imported from a test at all, extraction is the only way in).
describe('resolveSpellGeometry — single shape (Smite/Cinder-Rebuke/Snare-Knot)', () => {
  it('resolves the primary id from whatever enemy stands on the picked tile', () => {
    const units = [makeKeeper(2, 2), makeEnemy({ archetype: 'wisp' }, 0, 3, 2)];
    const geo = resolveSpellGeometry(units[0], SPELLBOOK.smite, { c: 3, r: 2 }, 1, units, floorGrid(6, 6));
    expect(geo.primaryId).toBe('wisp-0');
    expect(geo.aoeIds).toEqual([]);
  });

  it('an orthogonally-adjacent target yields the push direction FROM the caster (the actual 2.2 bug: this used to come back undefined)', () => {
    const units = [makeKeeper(2, 2), makeEnemy({ archetype: 'wisp' }, 0, 3, 2)]; // enemy directly right
    const geo = resolveSpellGeometry(units[0], SPELLBOOK['cinder-rebuke'], { c: 3, r: 2 }, 1, units, floorGrid(6, 6));
    expect(geo.dir).toBe('right');
  });

  it('a diagonal target has no orthogonal direction — no push, same 4-way-only rule as every other forced move', () => {
    const units = [makeKeeper(2, 2), makeEnemy({ archetype: 'wisp' }, 0, 3, 3)]; // diagonal
    const geo = resolveSpellGeometry(units[0], SPELLBOOK['cinder-rebuke'], { c: 3, r: 3 }, 1, units, floorGrid(6, 6));
    expect(geo.dir).toBeUndefined();
  });

  it('no enemy on the tile — no primary (dir is still geometry-only, same as the line shape: harmless with no primaryId to push)', () => {
    const units = [makeKeeper(2, 2)];
    const geo = resolveSpellGeometry(units[0], SPELLBOOK['cinder-rebuke'], { c: 3, r: 2 }, 1, units, floorGrid(6, 6));
    expect(geo.primaryId).toBeUndefined();
    const ops = resolveSpell(SPELLBOOK['cinder-rebuke'], 1, { primaryTargetId: geo.primaryId, dir: geo.dir });
    expect(ops.find((o) => o.op === 'push')).toBeUndefined(); // no primaryId → resolveSpell's pushIds is empty regardless of dir
  });
});

describe('resolveSpellGeometry composed with resolveSpell — the actual cast, end to end', () => {
  it('BUG (pre-fix): Cinder-Rebuke q1 against an adjacent enemy emits no push op, despite spells.ts declaring push:1', () => {
    const units = [makeKeeper(2, 2), makeEnemy({ archetype: 'wisp' }, 0, 3, 2)];
    const geo = resolveSpellGeometry(units[0], SPELLBOOK['cinder-rebuke'], { c: 3, r: 2 }, 1, units, floorGrid(6, 6));
    const ops = resolveSpell(SPELLBOOK['cinder-rebuke'], 1, { primaryTargetId: geo.primaryId, dir: geo.dir });
    const pushOp = ops.find((o) => o.op === 'push');
    // This is the fixed/expected behavior. Before the fix this assertion fails because geo.dir
    // is undefined (see the RED paste in task-2C-report.md), so resolveSpell's own
    // `effect.push === 1 && opts.dir` gate never opens and no push op is produced at all.
    expect(pushOp).toMatchObject({ op: 'push', targetId: 'wisp-0', dir: 'right' });
  });

  it('Processional (line shape) already had a direction, and keeps pushing every hit unit along the line after the refactor (regression guard)', () => {
    const units = [
      makeKeeper(1, 2),
      makeEnemy({ archetype: 'wisp' }, 0, 2, 2),
      makeEnemy({ archetype: 'wisp' }, 1, 3, 2),
    ];
    const geo = resolveSpellGeometry(units[0], SPELLBOOK.processional, { c: 2, r: 2 }, 1, units, floorGrid(6, 6));
    expect(geo.dir).toBe('right');
    expect(geo.primaryId).toBe('wisp-0');
    expect(geo.aoeIds).toEqual(['wisp-1']);
    const ops = resolveSpell(SPELLBOOK.processional, 1, {
      primaryTargetId: geo.primaryId, aoeTargetIds: geo.aoeIds, dir: geo.dir,
    });
    const pushTargets = ops.filter((o) => o.op === 'push').map((o) => (o as { targetId: string }).targetId);
    expect(pushTargets.sort()).toEqual(['wisp-0', 'wisp-1']);
  });
});

describe('resolveSpellGeometry — the other shapes (regression guard for the extraction)', () => {
  it('ally shape only ever resolves a party-team primary', () => {
    const units = [makeKeeper(2, 2), makeEnemy({ archetype: 'wisp' }, 0, 3, 2)];
    const onAlly = resolveSpellGeometry(units[0], SPELLBOOK['attested-ward'], { c: 2, r: 2 }, 1, units, floorGrid(6, 6));
    expect(onAlly.primaryId).toBe('keeper');
    const onEnemy = resolveSpellGeometry(units[0], SPELLBOOK['attested-ward'], { c: 3, r: 2 }, 1, units, floorGrid(6, 6));
    expect(onEnemy.primaryId).toBeUndefined();
  });

  it('cross shape hits the picked tile plus its 4 neighbours', () => {
    const units = [
      makeKeeper(2, 2),
      makeEnemy({ archetype: 'wisp' }, 0, 3, 2), // primary (picked tile)
      makeEnemy({ archetype: 'wisp' }, 1, 3, 1), // arm
    ];
    const geo = resolveSpellGeometry(units[0], SPELLBOOK.weave, { c: 3, r: 2 }, 1, units, floorGrid(6, 6));
    expect(geo.primaryId).toBe('wisp-0');
    expect(geo.aoeIds).toEqual(['wisp-1']);
  });

  it('burst1 shape hits every enemy adjacent to the CASTER, not the picked tile, and carries no dir', () => {
    const units = [makeKeeper(2, 2), makeEnemy({ archetype: 'wisp' }, 0, 3, 2)];
    const geo = resolveSpellGeometry(units[0], SPELLBOOK.lanternfall, { c: 2, r: 2 }, 1, units, floorGrid(6, 6));
    expect(geo.aoeIds).toEqual(['wisp-0']);
    expect(geo.dir).toBeUndefined();
  });
});
