import { describe, it, expect } from 'vitest';
import { buildDrawIndex, drawDue } from '../index';
import { PACK_ALPHA, PACK_BETA } from '../__fixtures__/packs';
import type { DrawDeps } from '../types';

const idx = buildDrawIndex([PACK_ALPHA, PACK_BETA]);
const allDue = (ids: string[]) => ids; // dueOrder stub: given order = due order
const deps = (over: Partial<DrawDeps> = {}): DrawDeps => ({
  dueOrder: allDue, eligible: () => true, hasRecord: () => true, ...over,
});

describe('drawDue', () => {
  it('draws from BOTH packs, most-due-first, capped at count', () => {
    const out = drawDue(idx, deps(), { count: 4, seed: 7, now: 0 });
    expect(out.length).toBe(4);
    const packs = new Set(out.map(id => idx.packIdByFactId.get(id)));
    expect(packs.has('fx-alpha')).toBe(true);
    expect(packs.has('fx-beta')).toBe(true);
  });

  it('respects the amendment-suspension filter at source', () => {
    const out = drawDue(idx, deps({ eligible: id => id !== 'fx.a.one' }), { count: 8, seed: 1, now: 0 });
    expect(out).not.toContain('fx.a.one');
  });

  it('kinds filter keeps only facts with a matching encounter', () => {
    const out = drawDue(idx, deps(), { count: 8, seed: 1, now: 0, kinds: ['order'] });
    expect(out).toEqual(['fx.a.four']); // only fact with an order encounter
  });

  it('is deterministic for a given seed', () => {
    const a = drawDue(idx, deps(), { count: 8, seed: 42, now: 0 });
    const b = drawDue(idx, deps(), { count: 8, seed: 42, now: 0 });
    expect(a).toEqual(b);
  });
});
