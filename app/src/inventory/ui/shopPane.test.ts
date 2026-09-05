/**
 * effectLabel() coverage for the six Ch. IX kinds (Concordance — the Borne and the
 * Bought). Fixtures are synthetic minimal ItemDefs, not the real catalog, so this
 * stays a pure test of effectLabel's own kind->prose mapping (catalog-shape
 * coverage lives in ../catalog.test.ts). No DOM here — vitest runs node-only.
 */
import { describe, expect, it } from 'vitest';
import type { ItemDef, ItemEffect } from '../catalog';
import { effectLabel, sellableStock } from './shopPane';

const fakeItem = (effect: ItemEffect): ItemDef => ({
  id: 'x',
  name: 'X',
  rarity: 'common',
  type: 'relic',
  effect,
  flavor: '',
  value: 0,
  icon: 'x',
  use: null,
  sellable: false,
});

describe('effectLabel — the six Ch. IX kinds (verbatim copy)', () => {
  it('edge_loot', () => {
    expect(effectLabel(fakeItem({ kind: 'edge_loot' }))).toBe('Loot rolls are edged while borne');
  });
  it('fell_guard', () => {
    expect(effectLabel(fakeItem({ kind: 'fell_guard' }))).toBe('Once a battle, the first fall is caught at 1 HP');
  });
  it('move_base', () => {
    expect(effectLabel(fakeItem({ kind: 'move_base', amount: 1 }))).toBe('Every step reaches a tile further (+1 move)');
  });
  it('begin_written', () => {
    expect(effectLabel(fakeItem({ kind: 'begin_written' }))).toBe('Enemies begin combat written');
  });
  it('rest_light', () => {
    expect(effectLabel(fakeItem({ kind: 'rest_light', amount: 1 }))).toBe('Once a rest, the first Lantern-light spent is caught');
  });
  it('push_blast', () => {
    expect(effectLabel(fakeItem({ kind: 'push_blast', reach: 3, tiles: 1 }))).toBe(
      'Push a foe one tile down a clear line, from three away',
    );
  });
  it('every new kind returns non-empty prose (no silent blank fallthrough)', () => {
    const kinds: ItemEffect[] = [
      { kind: 'edge_loot' },
      { kind: 'fell_guard' },
      { kind: 'move_base', amount: 1 },
      { kind: 'begin_written' },
      { kind: 'rest_light', amount: 1 },
      { kind: 'push_blast', reach: 3, tiles: 1 },
    ];
    for (const effect of kinds) {
      expect(effectLabel(fakeItem(effect))).not.toBe('');
    }
  });
});

// 2.8 — the Sell-tab stock used to re-derive sellability as `type === 'trinket'` instead of
// reading ItemDef.sellable, so the field was decorative for anything but trinkets. sellableStock
// is the extracted predicate render() actually calls (dom.ts has no jsdom in this project —
// vitest runs node-only per this file's header — so the DOM-rendered pane itself isn't
// unit-testable here; this is the same "extract the pure decision" idiom dom.test.ts uses for
// isGhostReopen).
describe('sellableStock — Sell tab reads .sellable, not type === "trinket" (2.8)', () => {
  it('excludes a held trinket whose sellable is explicitly false', () => {
    const catalog: ItemDef[] = [{ ...fakeItem({ kind: 'none' }), id: 'cursed-trinket', type: 'trinket', sellable: false }];
    expect(sellableStock(catalog, { 'cursed-trinket': 1 })).toEqual([]);
  });

  it('includes a held non-trinket whose sellable is explicitly true', () => {
    const catalog: ItemDef[] = [{ ...fakeItem({ kind: 'none' }), id: 'sellable-tool', type: 'tool', sellable: true }];
    expect(sellableStock(catalog, { 'sellable-tool': 1 })).toEqual(catalog);
  });

  it('still excludes a sellable item that is not held (qty 0 / absent)', () => {
    const catalog: ItemDef[] = [{ ...fakeItem({ kind: 'none' }), id: 'unheld', type: 'trinket', sellable: true }];
    expect(sellableStock(catalog, {})).toEqual([]);
    expect(sellableStock(catalog, { unheld: 0 })).toEqual([]);
  });
});
