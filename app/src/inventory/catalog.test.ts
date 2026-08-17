/**
 * Catalog growth for Concordance Ch. IX (the Borne and the Bought): the ItemEffect
 * union gains six kinds and the catalog grows from 14 to 20 entries. Pre-existing
 * catalog-shape coverage lives in economy.test.ts's "catalog integrity" block; this
 * file covers only what's new this wave.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG, itemById, type ItemEffect } from './catalog';

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
