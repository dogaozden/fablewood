import { describe, expect, it } from 'vitest';
import { planRedraw, LANTERN_REDRAW_SALT, FATE_HOLDS_LINE } from '../lantern';

describe('planRedraw (Ch. IV re-draw spend)', () => {
  it('consumes and returns the pool minus the shown facts, order preserved', () => {
    expect(planRedraw(['b'], ['a', 'b', 'c'])).toEqual({ consume: true, factIds: ['a', 'c'] });
  });
  it('multi-fact encounters exclude every shown id', () => {
    expect(planRedraw(['a', 'c'], ['a', 'b', 'c', 'd'])).toEqual({ consume: true, factIds: ['b', 'd'] });
  });
  it('fate holds: nothing left → consume false, original pool back', () => {
    expect(planRedraw(['a', 'b'], ['a', 'b'])).toEqual({ consume: false, factIds: ['a', 'b'] });
  });
  it('empty pool → fate holds with the empty pool', () => {
    expect(planRedraw(['a'], [])).toEqual({ consume: false, factIds: [] });
  });
  it('salt and copy are stable exports', () => {
    expect(LANTERN_REDRAW_SALT).toBe(7351);
    expect(FATE_HOLDS_LINE).toContain('fate holds');
  });
});
