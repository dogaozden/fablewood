import { describe, it, expect } from 'vitest';
import { partitionByRecency, seededShuffle } from '../recency';
import { mulberry32, layoutSeed } from '../combat/rng';

describe('partitionByRecency — stable, never excludes (director: "not over-asked the same things in a row")', () => {
  it('due-not-recent leads: nothing recent → order is untouched', () => {
    expect(partitionByRecency(['a', 'b', 'c'], new Set())).toEqual(['a', 'b', 'c']);
  });

  it('recent ids move behind fresh ones, each group keeping its original relative order', () => {
    const ordered = ['a', 'b', 'c', 'd'];
    const recent = new Set(['b', 'd']);
    expect(partitionByRecency(ordered, recent)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('a just-asked due fact yields to other due facts but never disappears', () => {
    const ordered = ['overdue-1', 'just-asked', 'overdue-2'];
    const recent = new Set(['just-asked']);
    const result = partitionByRecency(ordered, recent);
    expect(result).toEqual(['overdue-1', 'overdue-2', 'just-asked']);
    expect(result).toContain('just-asked'); // sacred: SRS due-ness is deprioritized, never hidden
  });

  it('empty-due fallback rotates: asked facts go behind unasked ones on the next query', () => {
    const shuffled = ['f1', 'f2', 'f3']; // stand-in for a seeded-shuffle fallback list
    const recent = new Set<string>();
    const turn1 = partitionByRecency(shuffled, recent);
    expect(turn1).toEqual(shuffled); // nothing recent yet — untouched

    recent.add(turn1[0]); // simulate record() firing after turn1's pick was asked
    const turn2 = partitionByRecency(shuffled, recent);
    expect(turn2[0]).not.toBe(turn1[0]); // doesn't repeat while alternatives exist
    expect(turn2).toContain(turn1[0]); // still present
    expect(turn2.indexOf(turn1[0])).toBe(shuffled.length - 1); // the only recent id sinks to the back
  });

  it('every candidate becomes recent → degrades gracefully to the original order (no crash, nothing lost)', () => {
    const ordered = ['a', 'b', 'c'];
    expect(partitionByRecency(ordered, new Set(ordered))).toEqual(ordered);
  });

  it('is a permutation of the input for a random mix of recent/fresh ids', () => {
    const ordered = ['a', 'b', 'c', 'd', 'e'];
    const recent = new Set(['a', 'c', 'e']);
    const result = partitionByRecency(ordered, recent);
    expect(result).toHaveLength(ordered.length);
    expect([...result].sort()).toEqual([...ordered].sort());
  });

  it('empty candidate list → empty result', () => {
    expect(partitionByRecency([], new Set(['x']))).toEqual([]);
  });
});

describe('seededShuffle — deterministic given the caller\'s rng, agnostic to which PRNG is used', () => {
  it('same rng stream (same seed) → identical output', () => {
    const arr = ['a', 'b', 'c', 'd', 'e'];
    expect(seededShuffle(arr, mulberry32(42))).toEqual(seededShuffle(arr, mulberry32(42)));
  });

  it('different seeds vary the order', () => {
    const arr = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    expect(seededShuffle(arr, mulberry32(1))).not.toEqual(seededShuffle(arr, mulberry32(2)));
  });

  it('does not mutate the input array', () => {
    const arr = ['a', 'b', 'c'];
    const before = [...arr];
    seededShuffle(arr, mulberry32(3));
    expect(arr).toEqual(before);
  });

  it('is a permutation: same elements, same length, none lost or duplicated', () => {
    const arr = ['a', 'b', 'c', 'd'];
    const out = seededShuffle(arr, mulberry32(7));
    expect(out).toHaveLength(arr.length);
    expect([...out].sort()).toEqual([...arr].sort());
  });

  it('battle-seed discipline (layoutSeed salt, matching combat/grid.ts): same battle seed reproduces the same fallback order every time, different battle seeds vary it', () => {
    const arr = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'];
    const rngFor = (battleSeed: number) => mulberry32(layoutSeed('recency-fallback', battleSeed));
    expect(seededShuffle(arr, rngFor(101))).toEqual(seededShuffle(arr, rngFor(101)));
    expect(seededShuffle(arr, rngFor(101))).not.toEqual(seededShuffle(arr, rngFor(202)));
  });
});
