import { describe, expect, it } from 'vitest';
import type { Quality } from '../game/contracts';
import { isRedemption, reclaimedFactId } from './redemption';

// The exact spec table (fun-review.md §3.1 / build brief): prior history → q1 now → bell?
const SPEC_TABLE: ReadonlyArray<readonly [Quality[], boolean]> = [
  [[], false],
  [[1], false],
  [[0], true],
  [[0, 0.5], true],
  [[0, 1], false],
  [[1, 0], true],
  [[1, 0, 0.5], true],
  [[0, 1, 0.5], false],
];

describe('isRedemption — the redemption-bell rule', () => {
  it.each(SPEC_TABLE)('prior %j then q1 → bell %s', (prior, expected) => {
    expect(isRedemption(prior, 1)).toBe(expected);
  });

  // "a 0.5 result now NEVER bells regardless of history" — sweep every prior in the table.
  it.each(SPEC_TABLE.map(([prior]) => [prior] as const))(
    'a 0.5 result never bells, prior %j',
    (prior) => {
      expect(isRedemption(prior, 0.5)).toBe(false);
    },
  );

  // A miss now can never be a redemption either (only a full pass reclaims).
  it.each(SPEC_TABLE.map(([prior]) => [prior] as const))(
    'a 0 result never bells, prior %j',
    (prior) => {
      expect(isRedemption(prior, 0)).toBe(false);
    },
  );

  it('re-arms on a later miss after self-retiring (watermark walk)', () => {
    // miss → redeemed (bell) → the q1 is the new watermark → later miss re-arms → q1 bells again
    expect(isRedemption([0], 1)).toBe(true); // first redemption
    expect(isRedemption([0, 1], 1)).toBe(false); // self-retired: no pending miss
    expect(isRedemption([0, 1, 0], 1)).toBe(true); // re-armed by the later miss
    expect(isRedemption([0, 1, 0, 0.5], 1)).toBe(true); // partial doesn't clear the new miss
  });
});

describe('reclaimedFactId — first qualifying fact (capture-before-record)', () => {
  const hist: Record<string, Quality[]> = {
    clean: [1], // never missed → no bell
    fragile: [0], // pending miss → bells
    cleared: [0, 1], // miss already cleared → no bell
    fresh: [], // unseen → no bell
  };
  const priorOf = (id: string): Quality[] => hist[id] ?? [];

  it('returns null when no fact in the set redeems', () => {
    expect(reclaimedFactId(['clean', 'cleared', 'fresh'], 1, priorOf)).toBeNull();
  });

  it('returns the first qualifying fact in order', () => {
    expect(reclaimedFactId(['clean', 'fragile', 'fresh'], 1, priorOf)).toBe('fragile');
  });

  it('is deterministic on order (earliest qualifying id wins)', () => {
    // two qualifiers; the earlier one in the list is returned so the Clerk-line hash is stable
    const two = { a: [0] as Quality[], b: [1, 0] as Quality[] };
    const p = (id: string): Quality[] => two[id as 'a' | 'b'] ?? [];
    expect(reclaimedFactId(['a', 'b'], 1, p)).toBe('a');
    expect(reclaimedFactId(['b', 'a'], 1, p)).toBe('b');
  });

  it('returns null on a non-q1 answer even with a pending miss', () => {
    expect(reclaimedFactId(['fragile'], 0.5, priorOf)).toBeNull();
    expect(reclaimedFactId(['fragile'], 0, priorOf)).toBeNull();
  });

  it('handles the empty fact set', () => {
    expect(reclaimedFactId([], 1, priorOf)).toBeNull();
  });
});
