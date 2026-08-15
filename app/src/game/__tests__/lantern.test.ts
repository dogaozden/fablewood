import { describe, expect, it, vi } from 'vitest';
import { planRedraw, LANTERN_REDRAW_SALT, FATE_HOLDS_LINE, heldLanternLight } from '../lantern';
import { services, type SaveData } from '../contracts';

function stubSave(get: () => SaveData): void {
  services.save = { ready: async () => {}, get, save: vi.fn(async () => {}) };
}

const BASE_SAVE: SaveData = { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };

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

// C6 — heldLanternLight() extracts the guarded read shared verbatim by five call sites
// (DungeonScene, HamletScene, CombatScene ×3): a save-service fault must degrade to "no
// lantern held," never throw into the caller's own encounter/loot flow.
describe('heldLanternLight (Ch. IV guarded read)', () => {
  it('a throwing save stub degrades to false, never throws', () => {
    stubSave(() => { throw new Error('offline'); });
    expect(heldLanternLight()).toBe(false);
  });

  it('lanternLight === true → true', () => {
    stubSave(() => ({ ...BASE_SAVE, lanternLight: true }));
    expect(heldLanternLight()).toBe(true);
  });

  it('lanternLight === false → false', () => {
    stubSave(() => ({ ...BASE_SAVE, lanternLight: false }));
    expect(heldLanternLight()).toBe(false);
  });

  it('lanternLight absent → false (not undefined, not truthy-by-accident)', () => {
    stubSave(() => ({ ...BASE_SAVE }));
    expect(heldLanternLight()).toBe(false);
  });
});
