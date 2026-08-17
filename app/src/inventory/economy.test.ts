import { describe, expect, it } from 'vitest';
import { CATALOG, itemById, shopStock, RARITY_META, type Rarity } from './catalog';
import {
  BOSS_RARITY_WEIGHTS,
  RARITY_ORDER,
  RARITY_WEIGHTS,
  STARTING_GOLD,
  bossLoot,
  mulberry32,
  pickTrinket,
  rollRarity,
  rollRarityEdged,
  roomClearLoot,
  sellPrice,
} from './economy';

/** rng stub that returns a scripted sequence, cycling back to the start past the end. */
const rngOf = (vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

/** rng stub that returns a fixed sequence (repeating the last value). */
const seq = (...vals: number[]) => {
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)];
};

describe('catalog integrity — ids are state-referenced and must stay coherent', () => {
  it('has 20 unique kebab-case ids covering every rarity and type (Wave 9 Ch. IX growth: 14 -> 20)', () => {
    const ids = CATALOG.map((i) => i.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const rarities = new Set(CATALOG.map((i) => i.rarity));
    expect([...rarities].sort()).toEqual(['common', 'legendary', 'rare', 'uncommon', 'very_rare']);
    const types = new Set(CATALOG.map((i) => i.type));
    expect([...types].sort()).toEqual(['consumable', 'relic', 'tool', 'trinket']);
    for (const r of rarities) expect(RARITY_META[r as Rarity]).toBeDefined();
  });

  it('derives use/sellable from effect and type (tools trial-only, only trinkets sell)', () => {
    expect(itemById('embermend-draught')).toMatchObject({ use: 'field', sellable: false, effect: { kind: 'heal', amount: 6 } });
    expect(itemById('ward-of-focus')).toMatchObject({ use: 'trial', sellable: false });
    expect(itemById('mossbound-locket')).toMatchObject({ use: null, sellable: true });
    expect(itemById('warden-signet-of-terms')).toMatchObject({ use: null, sellable: false, type: 'relic', value: 0 });
  });

  it('the two Glow items (magic-combat-depth §11.1) derive use:"combat" and never sell', () => {
    expect(itemById('wick-tallow')).toMatchObject({ use: 'combat', sellable: false, effect: { kind: 'glow', amount: 1 } });
    expect(itemById('lantern-brand')).toMatchObject({ use: 'combat', sellable: false, effect: { kind: 'glow', amount: 2 } });
  });

  it('shopStock() = the 8 staples plus the two new Ch. IX wares leaking in pre-rotation (T4 reshapes this; catalog order)', () => {
    // shopStock() filters by type alone (consumable|tool) — untouched this task (Task 4 owns
    // rotation). superior-draught and sealed-page-geyser are both type:'consumable', so they
    // appear here unconditionally until T4 adds the staples-vs-rotating-pool distinction. This
    // is the expected, flagged consequence of Ch. IX's catalog growth, not a shopStock() change.
    expect(shopStock().map((i) => i.id)).toEqual([
      'embermend-draught',
      'lanternoil-tonic',
      'wardancers-restorative',
      'superior-draught',
      'wick-tallow',
      'lantern-brand',
      'sealed-page-geyser',
      'scriveners-hint',
      'second-wind-seal',
      'ward-of-focus',
    ]);
  });

  it('a fresh purse affords exactly one cheap draught', () => {
    expect(STARTING_GOLD).toBe(20);
    expect(itemById('embermend-draught')!.value).toBeLessThanOrEqual(STARTING_GOLD);
    expect(itemById('lanternoil-tonic')!.value).toBeGreaterThan(STARTING_GOLD);
  });
});

describe('rollRarity — weight table walked in fixed rarity order', () => {
  it('weight tables are percentages (sum 100)', () => {
    const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum(RARITY_WEIGHTS)).toBe(100);
    expect(sum(BOSS_RARITY_WEIGHTS)).toBe(100);
  });

  it('maps rng thresholds onto tiers (normal weights 55/28/12/4/1)', () => {
    expect(rollRarity(() => 0, RARITY_WEIGHTS)).toBe('common');
    expect(rollRarity(() => 0.549, RARITY_WEIGHTS)).toBe('common');
    expect(rollRarity(() => 0.55, RARITY_WEIGHTS)).toBe('uncommon');
    expect(rollRarity(() => 0.829, RARITY_WEIGHTS)).toBe('uncommon');
    expect(rollRarity(() => 0.83, RARITY_WEIGHTS)).toBe('rare');
    expect(rollRarity(() => 0.95, RARITY_WEIGHTS)).toBe('very_rare');
    expect(rollRarity(() => 0.99, RARITY_WEIGHTS)).toBe('legendary');
  });

  it('boss weights make rare the mode and legendary a real 5% chance', () => {
    expect(rollRarity(() => 0.09, BOSS_RARITY_WEIGHTS)).toBe('common');
    expect(rollRarity(() => 0.5, BOSS_RARITY_WEIGHTS)).toBe('rare');
    expect(rollRarity(() => 0.949, BOSS_RARITY_WEIGHTS)).toBe('very_rare');
    expect(rollRarity(() => 0.95, BOSS_RARITY_WEIGHTS)).toBe('legendary');
  });

  it('a seeded 10k-roll distribution lands near the weights (deterministic seed)', () => {
    const rng = mulberry32(1);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 10_000; i++) {
      const r = rollRarity(rng, RARITY_WEIGHTS);
      counts[r] = (counts[r] ?? 0) + 1;
    }
    expect(counts.common).toBeGreaterThan(5200);
    expect(counts.common).toBeLessThan(5800);
    expect(counts.legendary).toBeGreaterThan(50);
    expect(counts.legendary).toBeLessThan(200);
  });
});

describe('pickTrinket — right tier, falling DOWN a tier when empty', () => {
  it('returns the trinket of the rolled rarity from the real catalog', () => {
    expect(pickTrinket('common', () => 0)).toBe('faded-coin-cache');
    expect(pickTrinket('rare', () => 0)).toBe('clerks-silver-nib');
    expect(pickTrinket('legendary', () => 0)).toBe('gilded-ledger-bead');
  });

  it('falls down to the next occupied tier when the rolled tier is empty', () => {
    const pool = CATALOG.filter((i) => i.id !== 'gilded-ledger-bead');
    expect(pickTrinket('legendary', () => 0, pool)).toBe('amber-writ-seal');
  });

  it('never picks consumables/tools/relics, and returns null on a trinketless pool', () => {
    const noTrinkets = CATALOG.filter((i) => i.type !== 'trinket');
    expect(pickTrinket('common', () => 0, noTrinkets)).toBeNull();
  });
});

describe('roomClearLoot — ~12-18 gold in room 0, +6 per depth, 35% trinket', () => {
  it('gold jitter spans 12..18 in the first room and scales +6 per room', () => {
    expect(roomClearLoot(0, seq(0, 1)).gold).toBe(12);
    expect(roomClearLoot(0, seq(0.999, 1)).gold).toBe(18);
    expect(roomClearLoot(2, seq(0, 1)).gold).toBe(24);
  });

  it('rolls a trinket only under the 35% chance (jitter → chance → rarity → pick)', () => {
    expect(roomClearLoot(0, seq(0, 0.35)).trinketId).toBeNull();
    expect(roomClearLoot(0, seq(0, 0.34, 0, 0)).trinketId).toBe('faded-coin-cache');
    expect(roomClearLoot(0, seq(0, 0.1, 0.99, 0)).trinketId).toBe('gilded-ledger-bead');
  });
});

describe('bossLoot — 60-100 bounty, boss-weighted trinket, always the signet', () => {
  it('bounds the bounty and always returns the Warden relic', () => {
    expect(bossLoot(seq(0))).toMatchObject({ gold: 60, relicId: 'warden-signet-of-terms' });
    expect(bossLoot(seq(0.999)).gold).toBe(100);
  });

  it('draws the trinket from the boss table (gold → rarity → pick)', () => {
    expect(bossLoot(seq(0, 0.5, 0)).trinketId).toBe('clerks-silver-nib'); // 0.5 → rare mode
    expect(bossLoot(seq(0, 0.96, 0)).trinketId).toBe('gilded-ledger-bead');
  });
});

describe('sellPrice — trinkets fence at half value, floored', () => {
  it('halves and floors', () => {
    expect(sellPrice(itemById('mossbound-locket')!)).toBe(20);
    expect(sellPrice(itemById('faded-coin-cache')!)).toBe(7); // floor(7.5)
    expect(sellPrice(itemById('gilded-ledger-bead')!)).toBe(250);
  });
});

describe('mulberry32 — deterministic, in [0,1)', () => {
  it('same seed → same sequence; values stay in range', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('rollRarityEdged (Concordance Ch. IV advantage primitive)', () => {
  // RARITY_WEIGHTS sums to 100; pick rng values that land in different tiers.
  // Derive the two single-roll outcomes FIRST with rollRarity + the same values,
  // then assert the edged pick keeps the better/worse of exactly those two.
  it('advantage keeps the better of two rolls', () => {
    const a = rollRarity(rngOf([0.01]), RARITY_WEIGHTS);   // low roll → common-end tier
    const b = rollRarity(rngOf([0.99]), RARITY_WEIGHTS);   // high roll → rare-end tier
    const picked = rollRarityEdged(rngOf([0.01, 0.99]), RARITY_WEIGHTS, 'advantage');
    const better = RARITY_ORDER.indexOf(b) > RARITY_ORDER.indexOf(a) ? b : a;
    expect(picked).toBe(better);
  });
  it('disadvantage keeps the worse of two rolls', () => {
    const a = rollRarity(rngOf([0.01]), RARITY_WEIGHTS);
    const b = rollRarity(rngOf([0.99]), RARITY_WEIGHTS);
    const picked = rollRarityEdged(rngOf([0.01, 0.99]), RARITY_WEIGHTS, 'disadvantage');
    const worse = RARITY_ORDER.indexOf(b) < RARITY_ORDER.indexOf(a) ? b : a;
    expect(picked).toBe(worse);
  });
  it("'none' consumes exactly one roll and equals rollRarity", () => {
    let calls = 0;
    const rng = () => { calls += 1; return 0.5; };
    const picked = rollRarityEdged(rng, RARITY_WEIGHTS, 'none');
    expect(picked).toBe(rollRarity(() => 0.5, RARITY_WEIGHTS));
    expect(calls).toBe(1);
  });
  it('advantage consumes exactly two rolls (stream determinism)', () => {
    let calls = 0;
    const rng = () => { calls += 1; return 0.5; };
    rollRarityEdged(rng, RARITY_WEIGHTS, 'advantage');
    expect(calls).toBe(2);
  });
  it('roomClearLoot/bossLoot without edge are byte-identical to today', () => {
    // regression pin: same seed → same result with the param omitted
    expect(roomClearLoot(2, mulberry32(42))).toEqual(roomClearLoot(2, mulberry32(42), 'none'));
    expect(bossLoot(mulberry32(42))).toEqual(bossLoot(mulberry32(42), 'none'));
  });
});
