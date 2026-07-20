import { describe, it, expect } from 'vitest';
import {
  computeRank, RANK2_NEED, RANK3_NEED, ARTS,
  GLOW_CAP, glowGain, glowSpend, canOverglow, dueRenewalSurge, weldBonus, seenDueIds,
  type GlowState, type GlowSource,
} from '../arts';

describe('computeRank (§6 — one global rank off Leitner box distribution)', () => {
  it('7 facts at box ≥3 stays Rank 1 (below the Rank-2 gate)', () => {
    const ids = Array.from({ length: 7 }, (_, i) => `f${i}`);
    expect(computeRank(() => 3, ids)).toMatchObject({ rank: 1, welded3: 7, welded4: 0 });
  });

  it('8 facts at box ≥3 reaches Rank 2', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `f${i}`);
    expect(computeRank(() => 3, ids)).toMatchObject({ rank: 2, welded3: 8, welded4: 0 });
  });

  it('8 facts at box ≥4 reaches Rank 3 (and those facts also count toward welded3)', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `f${i}`);
    expect(computeRank(() => 4, ids)).toMatchObject({ rank: 3, welded3: 8, welded4: 8 });
  });

  it('an id boxOf reports as absent (0) counts toward neither bucket', () => {
    const boxOf = (id: string) => (id === 'known' ? 5 : 0);
    expect(computeRank(boxOf, ['known', 'unknown-1', 'unknown-2'])).toMatchObject({ welded3: 1, welded4: 1 });
  });

  it('an empty factIds list is Rank 1 with zero counts', () => {
    expect(computeRank(() => 9, [])).toEqual({ rank: 1, welded3: 0, welded4: 0 });
  });

  it('ships at the documented 8/8 thresholds', () => {
    expect(RANK2_NEED).toBe(8);
    expect(RANK3_NEED).toBe(8);
  });
});

describe('ARTS (§1 table, as data)', () => {
  it('maps every Art to its shipped encounter kind', () => {
    expect(ARTS.kindling.encounter).toBe('mcq');
    expect(ARTS.binding.encounter).toBe('match');
    expect(ARTS.ritecraft.encounter).toBe('order');
    expect(ARTS.attestation.encounter).toBe('free_recall');
    expect(ARTS.courtcraft.encounter).toBe('scenario_branch');
  });
});

describe('Glow (§5)', () => {
  it('glowGain clamps at GLOW_CAP and never exceeds it', () => {
    let state: GlowState = { pips: GLOW_CAP - 1 };
    state = glowGain(state, 'strike');
    expect(state.pips).toBe(GLOW_CAP);
    state = glowGain(state, 'strike'); // already capped — stays capped, no error
    expect(state.pips).toBe(GLOW_CAP);
  });

  it('every §5.1 mid-battle source increments pips at least once (lantern-brand grants +2)', () => {
    const plusOne: GlowSource[] = ['strike', 'lantern-turn-start', 'brazier-lit', 'due-renewal', 'wick-tallow'];
    for (const s of plusOne) expect(glowGain({ pips: 0 }, s).pips).toBe(1);
    expect(glowGain({ pips: 0 }, 'lantern-brand').pips).toBe(2);
  });

  it('glowSpend REJECTS (does not clamp or go negative) when cost exceeds available pips', () => {
    expect(glowSpend({ pips: 1 }, 2)).toEqual({ ok: false, state: { pips: 1 } });
  });

  it('glowSpend succeeds and deducts exactly the cost otherwise, including spending to exactly 0', () => {
    expect(glowSpend({ pips: 3 }, 2)).toEqual({ ok: true, state: { pips: 1 } });
    expect(glowSpend({ pips: 2 }, 2)).toEqual({ ok: true, state: { pips: 0 } });
  });

  it('canOverglow requires BOTH rank ≥2 AND at least 1 pip', () => {
    expect(canOverglow(1, { pips: 3 })).toBe(false); // rank too low despite full glow
    expect(canOverglow(2, { pips: 0 })).toBe(false); // rank ok, no glow to spend
    expect(canOverglow(2, { pips: 1 })).toBe(true);
    expect(canOverglow(3, { pips: 1 })).toBe(true);
  });
});

describe('dueRenewalSurge (§5.1 source 4 — the SRS due queue as the mana engine, trap 14)', () => {
  it('grants the surge only on a FULL pass with a due fact among the encounter\'s ids', () => {
    expect(dueRenewalSurge(1, ['a', 'b'], new Set(['b']))).toBe(true);
  });
  it('a partial pass never surges, even with a due fact', () => {
    expect(dueRenewalSurge(0.5, ['a', 'b'], new Set(['b']))).toBe(false);
  });
  it('a full pass with none of its facts due never surges', () => {
    expect(dueRenewalSurge(1, ['a', 'b'], new Set(['c']))).toBe(false);
  });
});

describe('seenDueIds (trap 14 — disambiguating dueQueue\'s mixed seen-due/unseen result)', () => {
  it('keeps only ids whose box is >0 (seen) — unseen ids in the same result are dropped', () => {
    const boxOf = (id: string) => (id === 'due-1' ? 3 : id === 'due-2' ? 1 : 0); // 'new-1'/'new-2' unseen
    const queue = ['due-1', 'due-2', 'new-1', 'new-2']; // dueQueue's own ordering: due first, then unseen
    expect(seenDueIds(queue, boxOf)).toEqual(new Set(['due-1', 'due-2']));
  });

  it('an all-unseen queue (nothing seen-and-due) yields an empty set', () => {
    expect(seenDueIds(['a', 'b'], () => 0)).toEqual(new Set());
  });

  it('an empty queue yields an empty set', () => {
    expect(seenDueIds([], () => 5)).toEqual(new Set());
  });
});

describe('weldBonus (§5.5 — the weld edge)', () => {
  it('every fact at box ≥4 grants +1', () => {
    expect(weldBonus([4, 5, 9])).toBe(1);
  });
  it('one fact below 4 denies the bonus (all-or-nothing)', () => {
    expect(weldBonus([4, 4, 3])).toBe(0);
  });
  it('an empty list never welds — vacuous truth is not a reward here', () => {
    expect(weldBonus([])).toBe(0);
  });
});
