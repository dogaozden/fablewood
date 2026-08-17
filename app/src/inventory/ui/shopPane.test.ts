/**
 * effectLabel() coverage for the six Ch. IX kinds (Concordance — the Borne and the
 * Bought). Fixtures are synthetic minimal ItemDefs, not the real catalog, so this
 * stays a pure test of effectLabel's own kind->prose mapping (catalog-shape
 * coverage lives in ../catalog.test.ts). No DOM here — vitest runs node-only.
 */
import { describe, expect, it } from 'vitest';
import type { ItemDef, ItemEffect } from '../catalog';
import { effectLabel } from './shopPane';

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
    expect(effectLabel(fakeItem({ kind: 'rest_light', amount: 1 }))).toBe('Each hearth rest banks +1 Lantern-light');
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
