import { describe, expect, it, vi } from 'vitest';
import {
  planRedraw,
  LANTERN_REDRAW_SALT,
  FATE_HOLDS_LINE,
  heldLanternLight,
  spendLanternLight,
  WICK_CATCH_LINE,
} from '../lantern';
import { services, type SaveData } from '../contracts';

function stubSave(get: () => SaveData): void {
  services.save = { ready: async () => {}, get, save: vi.fn(async () => {}) };
}

const BASE_SAVE: SaveData = { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };

/** Full InventoryApi stub (register.ts / DungeonScene.test.ts's own shape) — only bornRelic
 *  varies per test; the rest are inert no-ops, never exercised by spendLanternLight. */
function stubInventory(bornRelicId: string | null): void {
  services.inventory = {
    ready: async () => {},
    getGold: () => 0,
    snapshot: () => ({ gold: 0, stacks: {}, bornRelicId }),
    addGold: async () => 0,
    spendGold: async () => true,
    grantItem: async () => {},
    removeItem: async () => true,
    countOf: () => 0,
    useItem: async () => ({ ok: true, message: '' }),
    buy: async () => true,
    sell: async () => true,
    bearRelic: async () => true,
    bornRelic: () => bornRelicId,
  };
}

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

// Concordance Ch. IX (corrected 2026-08-17) — the Second Wick's catch: spendLanternLight()
// is the ONE write shared by all five spend sites. While the Wick is borne and this
// rest-cycle's catch hasn't fired yet, the spend re-banks the light instead of clearing it —
// once per rest-cycle, Ch. IV's binary law stands (never a second stockpiled light).
describe('spendLanternLight (Concordance Ch. IX — the Second Wick catches)', () => {
  it('Wick not borne: spends normally, catch does not fire', async () => {
    const saveFn = vi.fn(async () => {});
    services.save = { ready: async () => {}, get: () => ({ ...BASE_SAVE, lanternLight: true }), save: saveFn };
    stubInventory(null);
    const caught = await spendLanternLight();
    expect(caught).toBe(false);
    expect(saveFn).toHaveBeenCalledWith({ lanternLight: false });
  });

  it('a DIFFERENT borne relic (not the Wick): spends normally', async () => {
    const saveFn = vi.fn(async () => {});
    services.save = { ready: async () => {}, get: () => ({ ...BASE_SAVE, lanternLight: true }), save: saveFn };
    stubInventory('warden-signet-of-terms');
    const caught = await spendLanternLight();
    expect(caught).toBe(false);
    expect(saveFn).toHaveBeenCalledWith({ lanternLight: false });
  });

  it('Wick borne, catch not yet used this cycle: re-banks instead of clearing, marks the catch used', async () => {
    const saveFn = vi.fn(async () => {});
    services.save = {
      ready: async () => {},
      get: () => ({ ...BASE_SAVE, lanternLight: true, wickCaught: false }),
      save: saveFn,
    };
    stubInventory('second-wick');
    const caught = await spendLanternLight();
    expect(caught).toBe(true);
    expect(saveFn).toHaveBeenCalledWith({ lanternLight: true, wickCaught: true });
  });

  it('Wick borne, catch already used this cycle: spends normally (once per rest-cycle)', async () => {
    const saveFn = vi.fn(async () => {});
    services.save = {
      ready: async () => {},
      get: () => ({ ...BASE_SAVE, lanternLight: true, wickCaught: true }),
      save: saveFn,
    };
    stubInventory('second-wick');
    const caught = await spendLanternLight();
    expect(caught).toBe(false);
    expect(saveFn).toHaveBeenCalledWith({ lanternLight: false });
  });

  it('Wick borne, wickCaught absent (legacy/first-ever save): catch is available', async () => {
    const saveFn = vi.fn(async () => {});
    services.save = { ready: async () => {}, get: () => ({ ...BASE_SAVE, lanternLight: true }), save: saveFn };
    stubInventory('second-wick');
    const caught = await spendLanternLight();
    expect(caught).toBe(true);
    expect(saveFn).toHaveBeenCalledWith({ lanternLight: true, wickCaught: true });
  });

  it('a throwing save/inventory stub degrades to no-catch, never throws (spends normally)', async () => {
    const saveFn = vi.fn(async () => {});
    services.save = {
      ready: async () => {},
      get: () => { throw new Error('offline'); },
      save: saveFn,
    };
    stubInventory('second-wick');
    await expect(spendLanternLight()).resolves.toBe(false);
    expect(saveFn).toHaveBeenCalledWith({ lanternLight: false });
  });

  it('WICK_CATCH_LINE is a stable, verbatim export', () => {
    expect(WICK_CATCH_LINE).toBe('The second wick catches.');
  });
});
