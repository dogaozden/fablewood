import { describe, it, expect } from 'vitest';
import {
  XP_THRESHOLDS, LEVEL_CAP, levelForXp, awardXp,
  maxHpForLevel, emberMaxForLevel, strikeBonusForLevel, tierForLevel,
} from '../xp';

describe('XP_THRESHOLDS (Concordance Ch. III — the table is the contract)', () => {
  it('is exactly the ratified cumulative table', () => {
    expect(XP_THRESHOLDS).toEqual([100, 300, 700, 1400, 2500, 4200, 6500, 9500, 13500]);
    expect(LEVEL_CAP).toBe(10);
  });
});

describe('levelForXp', () => {
  it('maps boundaries exactly (reach-on-equal)', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(299)).toBe(2);
    expect(levelForXp(300)).toBe(3);
    expect(levelForXp(13499)).toBe(9);
    expect(levelForXp(13500)).toBe(10);
  });
  it('clamps at cap and floors garbage', () => {
    expect(levelForXp(999999)).toBe(10);
    expect(levelForXp(-50)).toBe(1);
    expect(levelForXp(NaN)).toBe(1);
  });
});

describe('awardXp', () => {
  it('accumulates and reports no level on a plain grant', () => {
    expect(awardXp(0, 5)).toEqual({ xp: 5, levelsGained: [] });
  });
  it('reports a single crossed level', () => {
    expect(awardXp(95, 5)).toEqual({ xp: 100, levelsGained: [2] });
  });
  it('reports EVERY level crossed by one grant, in order (Constraint 6)', () => {
    expect(awardXp(90, 250)).toEqual({ xp: 340, levelsGained: [2, 3] });
  });
  it('never loses XP (Constraint 5): negative and non-finite deltas are zero', () => {
    expect(awardXp(500, -100)).toEqual({ xp: 500, levelsGained: [] });
    expect(awardXp(500, NaN)).toEqual({ xp: 500, levelsGained: [] });
  });
  it('is quiet at cap', () => {
    expect(awardXp(13500, 150)).toEqual({ xp: 13650, levelsGained: [] });
  });
});

describe('per-level grants (deterministic integers)', () => {
  it('maxHpForLevel: 16 at L1 → 34 at L10, +2 per level', () => {
    expect(maxHpForLevel(1)).toBe(16);
    expect(maxHpForLevel(2)).toBe(18);
    expect(maxHpForLevel(10)).toBe(34);
    expect(maxHpForLevel(0)).toBe(16);   // clamped
    expect(maxHpForLevel(99)).toBe(34);  // clamped
  });
  it('emberMaxForLevel: 2, +1 at L3/L5/L7/L9 → 6 at cap', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(emberMaxForLevel))
      .toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  });
  it('strikeBonusForLevel: +1 at L5, +1 more at L9', () => {
    expect([1, 4, 5, 8, 9, 10].map(strikeBonusForLevel)).toEqual([0, 0, 1, 1, 2, 2]);
  });
  it('tierForLevel: T2 at L3, T3 at L6 (level half of the hybrid rule)', () => {
    expect([1, 2, 3, 5, 6, 10].map(tierForLevel)).toEqual([1, 1, 2, 2, 3, 3]);
  });
});
