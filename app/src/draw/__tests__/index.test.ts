import { describe, it, expect, vi } from 'vitest';
import { buildDrawIndex } from '../index';
import { PACK_ALPHA, PACK_BETA } from '../__fixtures__/packs';

describe('buildDrawIndex', () => {
  it('indexes facts and encounters across all packs with source attribution', () => {
    const idx = buildDrawIndex([PACK_ALPHA, PACK_BETA]);
    expect(idx.packIds).toEqual(['fx-alpha', 'fx-beta']);
    expect(idx.factById.get('fx.b.one')?.id).toBe('fx.b.one');
    expect(idx.packIdByFactId.get('fx.a.one')).toBe('fx-alpha');
    expect(idx.packIdByFactId.get('fx.b.one')).toBe('fx-beta');
    expect(idx.encountersByFactId.get('fx.a.four')?.length).toBe(2); // mcq + order
  });

  it('on duplicate fact ids: warns once, first-installed wins', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dupe = { ...PACK_BETA, pack: { ...PACK_BETA.pack, facts: [ { ...PACK_ALPHA.pack.facts[0] } ], encounters: [] } };
    const idx = buildDrawIndex([PACK_ALPHA, dupe]);
    expect(idx.packIdByFactId.get('fx.a.one')).toBe('fx-alpha');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('zero packs -> empty index', () => {
    const idx = buildDrawIndex([]);
    expect(idx.factById.size).toBe(0);
    expect(idx.packIds).toEqual([]);
  });
});
