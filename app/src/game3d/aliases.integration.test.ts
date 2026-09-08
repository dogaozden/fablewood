import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fact, Pack } from '../packs/types';
import type { SrsEntry, SrsState } from '../srs/leitner';

const NOW = Date.UTC(2026, 8, 7);
const fact = (id: string, duplicate_of?: string): Fact => ({
  id, type: 'concept', statement: 'The lantern marks the path.', difficulty: 1,
  source_ref: { file: 'neutral.md', loc: 1, quote: 'The lantern marks the path.' },
  as_of: '2026-09-07', source_version: '1',
  ...(duplicate_of ? { duplicate_of } : {}),
});
const pack: Pack = {
  meta: { id: 'neutral', title: 'Field Notes', version: '1', sources: [{ title: 'Field Notes' }] },
  facts: [fact('canonical'), fact('alias', 'canonical'), fact('support')],
  encounters: [
    { id: 'canonical-check', kind: 'mcq', fact_ids: ['canonical'], prompt: 'What marks the path?', options: ['Lantern', 'Cloud'], answer: 'Lantern' },
    { id: 'alias-check', kind: 'mcq', fact_ids: ['alias'], prompt: 'What marks the path?', options: ['Lantern', 'Cloud'], answer: 'Lantern' },
    { id: 'mixed-check', kind: 'mcq', fact_ids: ['canonical', 'support', 'alias'], prompt: 'What marks the path?', options: ['Lantern', 'Cloud'], answer: 'Lantern' },
  ],
  quests: [], metaphor_map: {},
};

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('3D lessons consume reviewed duplicate links through the registered services', () => {
  for (const phase of ['due', 'fresh', 'revisit'] as const) {
    it(`excludes aliases and mixed encounters from ${phase}, preserving historical records`, async () => {
      const alias: SrsEntry = {
        box: 4, next_due: NOW - 1000,
        history: [{ ts: new Date(NOW - 9000).toISOString(), quality: 0.5, encounter_id: 'historic-alias' }],
      };
      const canonical: SrsEntry | undefined = phase === 'fresh' ? undefined : {
        box: 2, next_due: phase === 'due' ? NOW - 1 : NOW + 86_400_000,
        history: [{ ts: new Date(NOW - 8000).toISOString(), quality: 1, encounter_id: 'historic-canonical' }],
      };
      const original: SrsState = {
        version: 1,
        facts: { alias, ...(canonical ? { canonical } : {}) },
      };
      const disk = new Map<string, unknown>([['srs.json', structuredClone(original)]]);
      const writes: string[] = [];
      vi.spyOn(Date, 'now').mockReturnValue(NOW);
      vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
        const target = String(url);
        if (target === '/api/packs') return Response.json({ packs: [{ id: 'neutral', dir: 'neutral', pack }] });
        if (!target.startsWith('/api/state/')) throw new Error(`Unexpected request ${target}`);
        const name = decodeURIComponent(target.slice('/api/state/'.length));
        if (init?.method === 'PUT') {
          writes.push(name);
          disk.set(name, JSON.parse(String(init.body)));
          return Response.json({ ok: true });
        }
        return disk.has(name) ? Response.json(disk.get(name)) : new Response('', { status: 404 });
      }));

      vi.resetModules();
      const { services } = await import('../game/contracts');
      await import('../srs/register');
      await import('../draw/register');
      const { openArchive, chooseLesson, recallLesson } = await import('./knowledge');
      const archive = await openArchive();
      expect(services.draw.factOf('alias')?.duplicate_of).toBe('canonical');
      expect(services.draw.encountersOf('support')).toEqual([]);
      expect(services.draw.due({ count: 10, seed: 7, now: NOW })).toEqual(phase === 'due' ? ['canonical'] : []);
      // Raw fresh facts can include a support fact with no eligible encounter;
      // the 3D picker must skip it when selecting the playable lesson below.
      expect(services.draw.fresh({ count: 10, seed: 7, now: NOW })).toEqual(phase === 'fresh' ? ['canonical', 'support'] : ['support']);
      for (const seed of [0, 1, 7, 19]) {
        const lesson = await chooseLesson(archive, seed);
        expect(lesson?.encounter.id).toBe('canonical-check');
        expect(lesson?.facts.map(entry => entry.id)).toEqual(['canonical']);
      }
      expect(writes).toEqual([]);
      expect(disk.get('srs.json')).toEqual(original);

      const lesson = await chooseLesson(archive, 7);
      // Only the presentation result is supplied; recording uses the real SRS
      // provider, with its usual serialization through the isolated bridge map.
      services.runEncounter = vi.fn(async () => ({
        encounterId: 'canonical-check', factIds: ['canonical'], kind: 'mcq' as const, quality: 1 as const,
      }));
      await recallLesson(lesson!, 7, 'drill');
      const recorded = disk.get('srs.json') as SrsState;
      expect(recorded.facts.alias).toEqual(alias);
      expect(recorded.facts.canonical.history.slice(0, -1)).toEqual(canonical?.history ?? []);
      expect(recorded.facts.canonical.history.at(-1)?.encounter_id).toBe('canonical-check');
      expect(recorded.facts.canonical.next_due).not.toBe(alias.next_due);
      expect(writes).toEqual(['srs.json']);
    });
  }
});
