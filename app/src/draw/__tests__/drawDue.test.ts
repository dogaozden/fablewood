import { describe, it, expect } from 'vitest';
import { buildDrawIndex, drawDue } from '../index';
import { PACK_ALPHA, PACK_BETA } from '../__fixtures__/packs';
import type { Fact } from '../../packs/types';
import type { DrawDeps, InstalledPack } from '../types';

const DAY = 86_400_000;
const SEEDS = [0, 1, 2, 3, 7, 42, 99];

const idx = buildDrawIndex([PACK_ALPHA, PACK_BETA]);
const allDue = (ids: string[]) => ids; // dueOrder stub: given order = due order
const deps = (over: Partial<DrawDeps> = {}): DrawDeps => ({
  dueOrder: allDue, eligible: () => true, hasRecord: () => true, dueOf: () => 0, ...over,
});
/** dueOrder stub returning a fixed ranking — the reviewer's probes are ranking-shaped. */
const ranked = (ids: string[]) => () => ids;
const packsOf = (ids: string[], index = idx) => ids.map(id => index.packIdByFactId.get(id));
const only = (ids: string[], prefix: string) => ids.filter(id => id.startsWith(prefix));

// A third synthetic pack, inline (the __fixtures__ pair covers N=2; N=3 proves the
// rotation cycles rather than alternates).
const gammaFacts: Fact[] = ['fx.g.one', 'fx.g.two'].map(id => ({
  id,
  type: 'concept',
  statement: `Fixture statement for ${id}`,
  source_ref: { file: 'fixture.md', loc: 1, quote: `Fixture quote for ${id}` },
  as_of: '2026-01-01',
  source_version: '1.0.0',
  difficulty: 1,
}));
const PACK_GAMMA: InstalledPack = {
  id: 'fx-gamma',
  pack: {
    meta: { id: 'fx-gamma', title: 'Fixture Pack Gamma', version: '1.0.0', sources: [{ title: 'Fixture Source Gamma' }] },
    facts: gammaFacts,
    encounters: [],
    quests: [],
    metaphor_map: {},
  },
};

describe('drawDue', () => {
  it('draws from BOTH packs, most-due-first, capped at count', () => {
    // fx.a.three is due a full day before everything else — it leads on every seed.
    const dueOf = (id: string) => (id === 'fx.a.three' ? -DAY : 0);
    const dueOrder = (ids: string[]) => [...ids].sort((a, b) => dueOf(a)! - dueOf(b)!);
    for (const seed of SEEDS) {
      const out = drawDue(idx, deps({ dueOf, dueOrder }), { count: 4, seed, now: 0 });
      expect(out.length).toBe(4);
      expect(out[0], `most-due head, seed ${seed}`).toBe('fx.a.three');
      const packs = new Set(packsOf(out));
      expect(packs.has('fx-alpha'), `seed ${seed}`).toBe(true);
      expect(packs.has('fx-beta'), `seed ${seed}`).toBe(true);
    }
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

  // ---- source spread: due-first, round-robin WITHIN a calendar-day tie bucket ----

  it('probe A: an already-mixed one-day queue never comes back pack-grouped', () => {
    const ranking = ['fx.a.one', 'fx.b.one', 'fx.a.two', 'fx.b.two', 'fx.a.three', 'fx.b.three', 'fx.a.four', 'fx.b.four'];
    for (const seed of SEEDS) {
      const out = drawDue(idx, deps({ dueOrder: ranked(ranking) }), { count: 8, seed, now: 0 });
      const [p0, p1] = packsOf(out);
      expect(p0, `seed ${seed}`).not.toBe(p1);
      expect(only(out, 'fx.a.'), `alpha order, seed ${seed}`).toEqual(only(ranking, 'fx.a.'));
      expect(only(out, 'fx.b.'), `beta order, seed ${seed}`).toEqual(only(ranking, 'fx.b.'));
    }
  });

  it('probe B: a one-day queue with a long second-pack burst mixes from the head', () => {
    const ranking = ['fx.a.one', 'fx.b.one', 'fx.b.two', 'fx.b.three', 'fx.b.four', 'fx.a.two', 'fx.a.three', 'fx.a.four'];
    for (const seed of SEEDS) {
      const out = drawDue(idx, deps({ dueOrder: ranked(ranking) }), { count: 8, seed, now: 0 });
      expect(new Set(packsOf(out.slice(0, 2))).size, `seed ${seed}`).toBe(2);
      expect(only(out, 'fx.a.'), `alpha order, seed ${seed}`).toEqual(only(ranking, 'fx.a.'));
      expect(only(out, 'fx.b.'), `beta order, seed ${seed}`).toEqual(only(ranking, 'fx.b.'));
    }
  });

  it('never promotes a fact across a genuine day gap', () => {
    const dueOf = (id: string) => (id === 'fx.b.one' ? 3 * DAY : 5 * DAY);
    const ranking = ['fx.b.one', 'fx.a.one'];
    for (const seed of SEEDS) {
      const out = drawDue(idx, deps({ dueOf, dueOrder: ranked(ranking) }), { count: 2, seed, now: 0 });
      expect(out, `seed ${seed}`).toEqual(ranking);
    }
  });

  it('leaves a pack-grouped ranking grouped when the packs sit on different days', () => {
    const dueOf = (id: string) => (id.startsWith('fx.a.') ? 0 : DAY);
    const ranking = ['fx.a.one', 'fx.a.two', 'fx.a.three', 'fx.a.four', 'fx.b.one', 'fx.b.two', 'fx.b.three', 'fx.b.four'];
    for (const seed of SEEDS) {
      const out = drawDue(idx, deps({ dueOf, dueOrder: ranked(ranking) }), { count: 8, seed, now: 0 });
      expect(out, `seed ${seed}`).toEqual(ranking);
    }
  });

  it('mixes a same-day burst even when count truncates inside one pack run', () => {
    // The e2e shape: one pack's facts introduced, then the other's, all due the same day.
    const ranking = ['fx.a.one', 'fx.a.two', 'fx.a.three', 'fx.a.four', 'fx.b.one', 'fx.b.two', 'fx.b.three', 'fx.b.four'];
    for (const seed of SEEDS) {
      const out = drawDue(idx, deps({ dueOrder: ranked(ranking) }), { count: 3, seed, now: 0 });
      expect(out.length).toBe(3);
      expect(new Set(packsOf(out)).size, `seed ${seed}`).toBe(2);
    }
  });

  it('is exact passthrough with a single installed pack', () => {
    const soloIdx = buildDrawIndex([PACK_ALPHA]);
    const ranking = ['fx.a.four', 'fx.a.one', 'fx.a.three', 'fx.a.two'];
    for (const seed of SEEDS) {
      const out = drawDue(soloIdx, deps({ dueOrder: ranked(ranking) }), { count: 4, seed, now: 0 });
      expect(out, `seed ${seed}`).toEqual(ranking);
    }
  });

  it('cycles all three packs inside one tie bucket', () => {
    const triIdx = buildDrawIndex([PACK_ALPHA, PACK_BETA, PACK_GAMMA]);
    const ranking = ['fx.a.one', 'fx.a.two', 'fx.b.one', 'fx.b.two', 'fx.g.one', 'fx.g.two'];
    for (const seed of SEEDS) {
      const out = drawDue(triIdx, deps({ dueOrder: ranked(ranking) }), { count: 3, seed, now: 0 });
      expect(new Set(packsOf(out, triIdx)).size, `seed ${seed}`).toBe(3);
    }
  });

  it('buckets an id with no due date alone, so it holds its ranked place', () => {
    // One unknown among same-day ids: it joins neither neighbouring bucket, and the buckets
    // on either side of it still spread.
    const ranking = ['fx.a.one', 'fx.b.one', 'fx.a.two', 'fx.b.two', 'fx.a.three'];
    const dueOf = (id: string) => (id === 'fx.a.two' ? undefined : 0);
    for (const seed of SEEDS) {
      const out = drawDue(idx, deps({ dueOf, dueOrder: ranked(ranking) }), { count: 5, seed, now: 0 });
      expect(out[2], `the unknown holds rank 3, seed ${seed}`).toBe('fx.a.two');
      expect(new Set(packsOf(out.slice(0, 2))).size, `the bucket before it still spreads, seed ${seed}`).toBe(2);
      expect(new Set(packsOf(out.slice(3))).size, `the bucket after it still spreads, seed ${seed}`).toBe(2);
    }

    // All unknown: an undefined bucket groups with NOTHING, not even another undefined, so a
    // pack-grouped ranking comes back untouched instead of being spread.
    const unknown = ['fx.b.three', 'fx.b.four', 'fx.a.four', 'fx.a.one'];
    for (const seed of SEEDS) {
      const out = drawDue(idx, deps({ dueOf: () => undefined, dueOrder: ranked(unknown) }), { count: 4, seed, now: 0 });
      expect(out, `all-unknown is identity, seed ${seed}`).toEqual(unknown);
    }
  });

  it('draws nothing from an empty index, or at count 0', () => {
    expect(drawDue(buildDrawIndex([]), deps(), { count: 8, seed: 1, now: 0 })).toEqual([]);
    expect(drawDue(idx, deps(), { count: 0, seed: 1, now: 0 })).toEqual([]);
  });
});
