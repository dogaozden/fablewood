import { describe, expect, it, vi } from 'vitest';
import {
  planRedraw,
  LANTERN_REDRAW_SALT,
  FATE_HOLDS_LINE,
  heldLanternLight,
  spendLanternLight,
  WICK_CATCH_LINE,
  ddFallbackPick,
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

// 2.16 — the seed-reuse law itself (app/src/game/lantern.ts:6-7's file header): Death's Door's
// redraw must be deterministic but DISTINCT from the round's own draw. Until now only the salt
// VALUE was pinned (the test above) — nothing asserted that reusing the bare roundSeed for both
// calls would actually be caught. ddFallbackPick is CombatScene.ddDraw's own last-resort tier,
// extracted so this is checkable at all (see lantern.ts's doc comment on why).
describe('ddFallbackPick (Ch. IV Death\'s Door — the seed-reuse law, 2.16)', () => {
  const POOL = Array.from({ length: 20 }, (_, i) => `fact.${i}`);

  it('is a pure function of (seed, ids, exclude): the same seed twice gives the same pick', () => {
    for (const seed of [0, 1, 7, 42, 1000]) {
      const a = ddFallbackPick(seed, POOL);
      const b = ddFallbackPick(seed, POOL);
      expect(b).toBe(a);
    }
    // the salted seed is just another seed — reproducible the same way
    const salted = LANTERN_REDRAW_SALT + 42;
    expect(ddFallbackPick(salted, POOL)).toBe(ddFallbackPick(salted, POOL));
  });

  it('over a multi-fact pool, roundSeed and roundSeed+LANTERN_REDRAW_SALT differ on (at least) a strong majority of seeds — proof the salt actually moves the pick, not a same-seed accident', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i * 97 + 3);
    const differing = seeds.filter((seed) => ddFallbackPick(seed, POOL) !== ddFallbackPick(seed + LANTERN_REDRAW_SALT, POOL));
    // With a 20-id pool, two independent seeded picks collide by chance ~5% of the time; a
    // regression that reused the bare seed for the redraw (this ticket's own named failure
    // mode) would make EVERY pair collide (0 differing), so this threshold has a wide margin
    // on both sides without hard-coding today's exact PRNG output for one arbitrary seed.
    expect(differing.length).toBeGreaterThanOrEqual(Math.floor(seeds.length * 0.8));
  });

  it('never returns an excluded id, across both the bare draw and the salted redraw', () => {
    const excludeIds = ['fact.3', 'fact.11'];
    for (const seed of [0, 1, 7, 42, 1000]) {
      expect(excludeIds).not.toContain(ddFallbackPick(seed, POOL, excludeIds));
      expect(excludeIds).not.toContain(ddFallbackPick(seed + LANTERN_REDRAW_SALT, POOL, excludeIds));
    }
  });

  it('an empty pool (everything excluded) returns null, never throws', () => {
    expect(ddFallbackPick(42, ['fact.0', 'fact.1'], ['fact.0', 'fact.1'])).toBeNull();
    expect(ddFallbackPick(42, [])).toBeNull();
  });

  it('a single-fact pool always returns that fact (Death\'s Door\'s own doc: "whose pool is a single fact") when not excluded, null when it is', () => {
    expect(ddFallbackPick(42, ['fact.only'])).toBe('fact.only');
    expect(ddFallbackPick(42, ['fact.only'], ['fact.only'])).toBeNull();
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
