/**
 * Catalog growth for Concordance Ch. IX (the Borne and the Bought): the ItemEffect
 * union gains six kinds and the catalog grows from 14 to 20 entries. Pre-existing
 * catalog-shape coverage lives in economy.test.ts's "catalog integrity" block; this
 * file covers only what's new this wave.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG, dateKeyOf, itemById, pickRotatingWares, type ItemEffect } from './catalog';

describe('ItemEffect union — the six Ch. IX kinds construct with their exact literal shape', () => {
  it('each new kind is constructible as an ItemEffect', () => {
    const effects: ItemEffect[] = [
      { kind: 'edge_loot' },
      { kind: 'fell_guard' },
      { kind: 'move_base', amount: 1 },
      { kind: 'begin_written' },
      { kind: 'rest_light', amount: 1 },
      { kind: 'push_blast', reach: 3, tiles: 1 },
    ];
    expect(effects.map((e) => e.kind)).toEqual([
      'edge_loot',
      'fell_guard',
      'move_base',
      'begin_written',
      'rest_light',
      'push_blast',
    ]);
  });
});

describe('catalog — Ch. IX growth to twenty (six new ids + the Signet awakening)', () => {
  it('grows to exactly 20 entries, all unique, six new ids present', () => {
    expect(CATALOG).toHaveLength(20);
    const ids = CATALOG.map((i) => i.id);
    expect(new Set(ids).size).toBe(20);
    for (const id of [
      'unbroken-clasp',
      'waymark-heel',
      'margin-lamp',
      'second-wick',
      'superior-draught',
      'sealed-page-geyser',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('the Signet keeps its id and gains the edge_loot effect (chapter-ratified awakening) — nothing else changes', () => {
    // Wave 9 plan Global Constraint #5 + the task brief both scope this to the effect ONLY:
    // id, name, rarity, and value are untouched (the chapter's roster prose reads "AWAKENED —
    // rare" but two independent binding docs say "only gains its effect" — treated as prose,
    // not a rarity retag; flagged to the controller in the report).
    expect(itemById('warden-signet-of-terms')).toMatchObject({
      id: 'warden-signet-of-terms',
      name: 'Warden Signet of Terms',
      rarity: 'legendary',
      type: 'relic',
      value: 0,
      effect: { kind: 'edge_loot' },
    });
  });

  it('the four new relics: type relic, sellable:false, use:null, rarity per the chapter', () => {
    expect(itemById('unbroken-clasp')).toMatchObject({
      type: 'relic',
      sellable: false,
      use: null,
      rarity: 'rare',
      effect: { kind: 'fell_guard' },
    });
    expect(itemById('waymark-heel')).toMatchObject({
      type: 'relic',
      sellable: false,
      use: null,
      rarity: 'uncommon',
      effect: { kind: 'move_base', amount: 1 },
    });
    expect(itemById('margin-lamp')).toMatchObject({
      type: 'relic',
      sellable: false,
      use: null,
      rarity: 'rare',
      effect: { kind: 'begin_written' },
    });
    expect(itemById('second-wick')).toMatchObject({
      type: 'relic',
      sellable: false,
      use: null,
      rarity: 'uncommon',
      effect: { kind: 'rest_light', amount: 1 },
    });
  });

  it('the Sealed Page of the Geyser: consumable, combat-use, sellable:false, rare, reach 3 / tiles 1', () => {
    expect(itemById('sealed-page-geyser')).toMatchObject({
      type: 'consumable',
      use: 'combat',
      sellable: false,
      rarity: 'rare',
      effect: { kind: 'push_blast', reach: 3, tiles: 1 },
    });
  });

  it('the Superior Draught: consumable, field-use, sellable:false, rare, heals one rung above the shipped largest', () => {
    // The shipped draught line is dice-wrung 2d4+2 / 4d4+4 / full (6 / 12 / full), each d4
    // wrung to its floor-average of 2: 2*2+2=6, 4*2+4=12. The Superior Draught fills the SRD
    // table's next rung under the same rule — Potion of Superior Healing, 8d4+8 — deterministic:
    // 8*2+8 = 24. One rung above the largest shipped NUMERIC amount (12); "full" (999) opted out
    // of the numeric ladder entirely as Wardancer's Restorative's own design choice.
    expect(itemById('superior-draught')).toMatchObject({
      type: 'consumable',
      use: 'field',
      sellable: false,
      rarity: 'rare',
      effect: { kind: 'heal', amount: 24 },
    });
  });
});

describe('pickRotatingWares — Ch. IX rotation law, seeded pick generalized for a future bigger pool', () => {
  it('pool.length <= slots returns the whole pool, in pool order, regardless of dateKey', () => {
    expect(pickRotatingWares(['a', 'b'], 2, 1)).toEqual(['a', 'b']);
    expect(pickRotatingWares(['a', 'b'], 2, 999)).toEqual(['a', 'b']);
    expect(pickRotatingWares(['solo'], 2, 42)).toEqual(['solo']);
  });

  it('a bigger pool picks exactly `slots` distinct ids, always drawn from the pool', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    const picked = pickRotatingWares(pool, 2, 777);
    expect(picked).toHaveLength(2);
    expect(new Set(picked).size).toBe(2);
    for (const id of picked) expect(pool).toContain(id);
  });

  it('same dateKey -> same pick (deterministic — same day, same shelf)', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    expect(pickRotatingWares(pool, 2, 777)).toEqual(pickRotatingWares(pool, 2, 777));
  });

  it('different dateKeys can select different subsets from a bigger pool', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'];
    const seen = new Set<string>();
    for (let k = 0; k < 30; k++) seen.add([...pickRotatingWares(pool, 2, k)].sort().join(','));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('dateKeyOf — local calendar date (mirrors canRestTonight\'s day-boundary math: local Y/M/D, never UTC/epoch)', () => {
  it('same local calendar day -> same key, any time of day', () => {
    expect(dateKeyOf(new Date(2026, 7, 17, 0, 1))).toBe(dateKeyOf(new Date(2026, 7, 17, 23, 59)));
  });
  it('different calendar days -> different keys', () => {
    expect(dateKeyOf(new Date(2026, 7, 17))).not.toBe(dateKeyOf(new Date(2026, 7, 18)));
  });
});
