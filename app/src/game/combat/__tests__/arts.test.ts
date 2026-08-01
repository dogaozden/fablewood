import { describe, it, expect } from 'vitest';
import {
  computeRank, RANK2_NEED, RANK3_NEED, ARTS,
  GLOW_CAP, glowGain, glowSpend, canOverglow, dueRenewalSurge, weldBonus, riderBonus, seenDueIds,
  graceAppliesTo, isBossPhaseCast,
  type GlowState, type GlowSource,
} from '../arts';
import { SPELLBOOK } from '../spells';

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

  it("regression (crucible v1 #9): canOverglow must be checked against a tier's POST-COST remainder, not the wholesale total", () => {
    // Glow pips == exactly a tier's own cost (e.g. 1 pip for a 1-cost T2 spell): the
    // WHOLESALE total alone still reads as "enough" (canOverglow only ever checked pips>=1),
    // but paying the tier's own cost first leaves a remainder of 0 — Overglow must gate off
    // against THAT, matching castGatedSpell's own post-glowSpend recheck (the two disagreeing
    // exactly at this boundary is what let Overglow arm in the flyout and then silently fail
    // to apply on cast).
    const totalGlow: GlowState = { pips: 1 };
    const tierCost = 1;
    expect(canOverglow(2, totalGlow), 'the wholesale total alone misreads this as enough').toBe(true);
    const remainder: GlowState = { pips: totalGlow.pips - tierCost };
    expect(canOverglow(2, remainder), "the tier's own cost exhausts Glow — remainder is 0, must gate off").toBe(false);

    // Control: one pip BANKED ABOVE the tier's cost survives the same remainder check.
    const bankedExtra: GlowState = { pips: 2 };
    const remainderWithExtra: GlowState = { pips: bankedExtra.pips - tierCost };
    expect(canOverglow(2, remainderWithExtra), 'a genuine spare pip still offers Overglow').toBe(true);
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

describe('riderBonus (§4 difficulty-rewards.md — full truth table)', () => {
  it.each([
    [1, 1, false, 0], [1, 2, false, 0], [1, 3, false, 0],
    [2, 1, false, 0], [2, 2, false, 0], [2, 3, false, 0],
    [3, 1, false, 0], [3, 2, false, 0], [3, 3, false, 0],
    [1, 1, true, 0], [1, 2, true, 1], [1, 3, true, 1],
    [2, 1, true, 0], [2, 2, true, 0], [2, 3, true, 1],
    [3, 1, true, 0], [3, 2, true, 0], [3, 3, true, 0],
  ] as const)(
    'tier %i, drawn difficulty %i, packReady %s → %i',
    (spellTier, drawnDifficulty, packReady, expected) => {
      expect(riderBonus(spellTier, drawnDifficulty, packReady)).toBe(expected);
    },
  );

  it('tier 3 intentionally never earns a rider at any possible drawn difficulty or pack state', () => {
    // Drawn difficulty tops out at 3, so it can never be greater than spell tier 3.
    for (const packReady of [false, true]) {
      for (const drawnDifficulty of [1, 2, 3] as const) {
        expect(riderBonus(3, drawnDifficulty, packReady)).toBe(0);
      }
    }
  });
});

// crucible-2 lantern-grace-false-banner — grace softens a MISS's damage quality (0 → 0.5)
// while the SRS record stays honest. Courtcraft's outcome comes from branchTag, never from
// quality, so grace applied to a Parley did nothing at all — yet it still consumed the
// once-per-battle charge AND showed "the miss becomes a graze". A mercy that lies and
// charges for it.
describe('graceAppliesTo (§5 — the lantern grace only where quality drives the outcome)', () => {
  it('applies to the four quality-driven Arts', () => {
    for (const art of ['kindling', 'binding', 'ritecraft', 'attestation'] as const) {
      expect(graceAppliesTo(art), art).toBe(true);
    }
  });

  it('does NOT apply to Courtcraft — its outcome is the branchTag, not the quality', () => {
    expect(graceAppliesTo('courtcraft')).toBe(false);
  });

  it('covers every Art in ARTS, so a new Art cannot silently default into a false mercy', () => {
    const arts = Object.keys(ARTS) as Array<keyof typeof ARTS>;
    expect(arts).toHaveLength(5);
    expect(arts.filter((a) => graceAppliesTo(a))).toHaveLength(4);
  });
});

// crucible-2 attestation-phase-skip [HIGH] — the boss phase machinery was keyed to the T1
// 'cast' ActionKind. At Rank 2/3 an Attestation cast through the flyout (Verbatim Decree) is
// the same negotiation beat but was not recognised as one: it drew roomTags instead of the
// phase's recallTags and never advanced phaseIndex, so phases 2 and 3 never re-armed while
// its q1 strip-shield rider still took shields down. A high-Rank player could win having
// answered ONE of the three mandatory branches.
describe('isBossPhaseCast (§9 — a boss negotiation beat, at any tier)', () => {
  it('is true for Attestation at the boss, at every tier', () => {
    expect(isBossPhaseCast(SPELLBOOK.cast.art, true)).toBe(true);              // T1 Cast From Memory
    expect(isBossPhaseCast(SPELLBOOK['attested-ward'].art, true)).toBe(true);  // T2
    expect(isBossPhaseCast(SPELLBOOK['verbatim-decree'].art, true)).toBe(true); // T3
  });

  it('is false for every non-Attestation Art, even at the boss', () => {
    for (const id of Object.keys(SPELLBOOK) as Array<keyof typeof SPELLBOOK>) {
      const art = SPELLBOOK[id].art;
      expect(isBossPhaseCast(art, true), id).toBe(art === 'attestation');
    }
  });

  it('is false away from the boss, and for a free action with no Art at all', () => {
    expect(isBossPhaseCast(SPELLBOOK['verbatim-decree'].art, false)).toBe(false);
    expect(isBossPhaseCast(undefined, true)).toBe(false); // Strike / Satchel / Wait
  });

  it('agrees with the T1 path it generalises: Cast at the boss, and nothing else T1', () => {
    // the old spelling was `action === 'cast' && vsBoss` — identical on the T1 five
    for (const id of ['smite', 'weave', 'sequence', 'parley'] as const) {
      expect(isBossPhaseCast(SPELLBOOK[id].art, true), id).toBe(false);
    }
    expect(isBossPhaseCast(SPELLBOOK.cast.art, true)).toBe(true);
  });
});
