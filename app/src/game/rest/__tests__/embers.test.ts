import { describe, it, expect } from 'vitest';
import { TRIM_HEAL_CORRECT, TRIM_HEAL_MISS, embersOf, canRestTonight } from '../embers';
import { emberMaxForLevel } from '../../progression/xp';

describe('embersOf', () => {
  it('legacy save (no field) reads as a full pool at the save\'s level (L1 default)', () => {
    expect(embersOf({})).toBe(emberMaxForLevel(1));
    expect(embersOf({ embers: undefined })).toBe(emberMaxForLevel(1));
  });
  it('stored values pass through', () => {
    expect(embersOf({ embers: 0 })).toBe(0);
    expect(embersOf({ embers: 1 })).toBe(1);
  });
  it('corrupt values clamp into range at L1', () => {
    expect(embersOf({ embers: -3 })).toBe(0);
    expect(embersOf({ embers: 99 })).toBe(emberMaxForLevel(1));
    expect(embersOf({ embers: 1.7 })).toBe(1);
  });

  // Wave 4 Task 7 — the old flat 2-constant export died; the ceiling now comes from
  // progression/xp.ts's emberMaxForLevel (2 base, +1 at levels 3/5/7/9, cap 6 at L9+).
  it('the pool ceiling rises with level, at the grant thresholds (3/5/7/9)', () => {
    expect(embersOf({ level: 1 })).toBe(2);
    expect(embersOf({ level: 2 })).toBe(2);
    expect(embersOf({ level: 3 })).toBe(3);
    expect(embersOf({ level: 5 })).toBe(4);
    expect(embersOf({ level: 7 })).toBe(5);
    expect(embersOf({ level: 9 })).toBe(6);
    expect(embersOf({ level: 10 })).toBe(6); // LEVEL_CAP — no grant past 9
  });
  it('undefined embers reads as full at the HIGHER level, not the flat old default of 2', () => {
    expect(embersOf({ level: 5 })).toBe(4);
  });
  it('a stored count clamps to the LEVEL-keyed ceiling, not a flat 2', () => {
    expect(embersOf({ embers: 99, level: 5 })).toBe(4);
  });
});

describe('canRestTonight', () => {
  // unchanged by Wave 4 Task 7 — canRestTonight never referenced the Ember cap (it's pure
  // calendar-date logic), so there is nothing here to migrate.
  const at = (iso: string) => new Date(iso);
  it('never rested → true', () => {
    expect(canRestTonight(undefined, at('2026-08-06T20:00:00'))).toBe(true);
    expect(canRestTonight('', at('2026-08-06T20:00:00'))).toBe(true);
  });
  it('same local calendar day → false', () => {
    expect(canRestTonight('2026-08-06T08:00:00', at('2026-08-06T23:59:00'))).toBe(false);
  });
  it('next calendar day → true, even one minute past midnight', () => {
    expect(canRestTonight('2026-08-06T23:50:00', at('2026-08-07T00:01:00'))).toBe(true);
  });
  it('unparseable stamp → true (never brick the Hearth)', () => {
    expect(canRestTonight('not-a-date', at('2026-08-06T20:00:00'))).toBe(true);
  });
  it('heal constants pinned', () => {
    expect(TRIM_HEAL_CORRECT).toBe(4);
    expect(TRIM_HEAL_MISS).toBe(1);
  });
});
