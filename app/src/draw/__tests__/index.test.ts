import { describe, it, expect, vi } from 'vitest';
import { buildDrawIndex } from '../index';
import { PACK_ALPHA, PACK_BETA } from '../__fixtures__/packs';
import type { Encounter, Fact } from '../../packs/types';

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

  it('keeps alias records and raw encounters inspectable while filtering the picker view', () => {
    const canonical: Fact = {
      id: 'fx.canonical', type: 'concept', statement: 'canonical statement',
      source_ref: { file: 'fixture.md', loc: 1, quote: 'canonical quote' },
      as_of: '2026-01-01', source_version: '1.0.0', difficulty: 1,
    };
    const alias: Fact = {
      ...canonical, id: 'fx.alias', statement: 'duplicate statement', duplicate_of: canonical.id,
    };
    const bystander: Fact = { ...canonical, id: 'fx.other', statement: 'other statement' };
    const canonicalEncounter: Encounter = {
      id: 'fx.canonical.clean', fact_ids: [canonical.id], kind: 'mcq', prompt: 'p',
    };
    const mixedEncounter: Encounter = {
      id: 'fx.canonical.mixed', fact_ids: [canonical.id, alias.id], kind: 'mcq', prompt: 'p',
    };
    const aliasEncounter: Encounter = {
      id: 'fx.alias.only', fact_ids: [alias.id], kind: 'mcq', prompt: 'p',
    };
    const pack = {
      id: 'fx-alias-pack',
      pack: {
        meta: { id: 'fx-alias-pack', title: 'Alias Fixture', version: '1.0.0', sources: [{ title: 'Fixture' }] },
        facts: [canonical, alias, bystander],
        encounters: [canonicalEncounter, mixedEncounter, aliasEncounter],
        quests: [], metaphor_map: {},
      },
    };
    const idx = buildDrawIndex([pack]);

    expect(idx.aliases).toEqual(new Set([alias.id]));
    expect(idx.factById.get(alias.id)).toBe(alias); // original fact object remains addressable
    expect(idx.rawEncountersByFactId.get(canonical.id)).toEqual([canonicalEncounter, mixedEncounter]);
    expect(idx.rawEncountersByFactId.get(alias.id)).toEqual([mixedEncounter, aliasEncounter]);
    expect(idx.rawEncountersByFactId.get(canonical.id)?.[0]).toBe(canonicalEncounter);
    expect(idx.rawEncountersByFactId.get(alias.id)?.[0]).toBe(mixedEncounter);
    expect(idx.encountersByFactId.get(canonical.id)).toEqual([canonicalEncounter]);
    expect(idx.encountersByFactId.get(canonical.id)?.[0]).toBe(canonicalEncounter);
    expect(idx.encountersByFactId.has(alias.id)).toBe(false);
    expect(idx.encountersByFactId.get(bystander.id)).toBeUndefined();
  });
});
