import { describe, it, expect } from 'vitest';
import { pickKeepsake } from '../keepsake';

const DEFS: Record<string, { type: string }> = {
  't.fox': { type: 'trinket' }, 't.owl': { type: 'trinket' }, 't.moth': { type: 'trinket' },
  'r.crown': { type: 'relic' }, 'c.salve': { type: 'consumable' }, 'tool.pick': { type: 'tool' },
};
const defOf = (id: string) => DEFS[id];

describe('pickKeepsake', () => {
  it('picks only carried trinkets — never relics, consumables, or tools', () => {
    const stacks = { 't.fox': 1, 'r.crown': 1, 'c.salve': 3, 'tool.pick': 1 };
    for (let seed = 0; seed < 20; seed++) {
      expect(pickKeepsake(stacks, defOf, seed)).toBe('t.fox');
    }
  });

  it('excludes zero-count stacks', () => {
    const stacks = { 't.fox': 0, 't.owl': 2 };
    expect(pickKeepsake(stacks, defOf, 7)).toBe('t.owl');
  });

  it('returns null when no trinket is carried (relic-only satchel is protected)', () => {
    expect(pickKeepsake({ 'r.crown': 1 }, defOf, 7)).toBeNull();
    expect(pickKeepsake({}, defOf, 7)).toBeNull();
  });

  it('is deterministic for a given seed and independent of key insertion order', () => {
    const a = pickKeepsake({ 't.fox': 1, 't.owl': 1, 't.moth': 1 }, defOf, 42);
    const b = pickKeepsake({ 't.moth': 1, 't.fox': 1, 't.owl': 1 }, defOf, 42);
    expect(a).toBe(b);
    expect(['t.fox', 't.owl', 't.moth']).toContain(a);
  });

  it('ignores ids missing from the catalog', () => {
    expect(pickKeepsake({ 'ghost.item': 5 }, defOf, 7)).toBeNull();
  });
});
