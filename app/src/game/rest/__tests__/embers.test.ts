import { describe, it, expect } from 'vitest';
import { EMBER_MAX, TRIM_HEAL_CORRECT, TRIM_HEAL_MISS, embersOf, canRestTonight } from '../embers';

describe('embersOf', () => {
  it('legacy save (no field) reads as a full pool', () => {
    expect(embersOf({})).toBe(EMBER_MAX);
    expect(embersOf({ embers: undefined })).toBe(EMBER_MAX);
  });
  it('stored values pass through', () => {
    expect(embersOf({ embers: 0 })).toBe(0);
    expect(embersOf({ embers: 1 })).toBe(1);
  });
  it('corrupt values clamp into range', () => {
    expect(embersOf({ embers: -3 })).toBe(0);
    expect(embersOf({ embers: 99 })).toBe(EMBER_MAX);
    expect(embersOf({ embers: 1.7 })).toBe(1);
  });
});

describe('canRestTonight', () => {
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
