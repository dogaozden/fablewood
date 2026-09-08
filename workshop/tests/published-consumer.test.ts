import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { assertPack } from '../../app/src/packs/validatePack';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('draws and grades the actual published pack without altering existing history or references', async () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const packPath = process.env.WORKSHOP_PUBLISHED_PACK ?? path.join(root, 'secreg/workshop/published/pack.json');
  const pack = assertPack(JSON.parse(fs.readFileSync(packPath, 'utf8')));
  const base = assertPack(JSON.parse(fs.readFileSync(path.join(root, 'packs/secreg/pack.json'), 'utf8')));
  const additions = pack.facts.filter(fact => fact.id.startsWith('workshop.'));
  expect(additions.length).toBeGreaterThan(0);
  for (const original of base.facts) expect(pack.facts.find(fact => fact.id === original.id)).toEqual(original);
  for (const original of base.encounters) expect(pack.encounters.find(item => item.id === original.id)).toEqual(original);
  const target = additions.find(fact => !fact.supersedes && !fact.superseded_by && !fact.duplicate_of)!;
  const aliases = additions.filter(fact => fact.duplicate_of);
  expect(target).toBeDefined();
  const now = Date.UTC(2026, 8, 7);
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const old = { box: 5, next_due: now - 1, history: [
    { quality: 1, at: now - 20000, encounter_id: 'prior-one' },
    { quality: 0.5, at: now - 10000, encounter_id: 'prior-two' },
  ], reference: { original: true } };
  const facts: Record<string, typeof old> = { [base.facts[0].id]: old };
  for (const alias of aliases) {
    facts[alias.id] = structuredClone(old);
    facts[alias.duplicate_of!] = { ...structuredClone(old), box: 2, next_due: now + 86400000 };
  }
  const initial = { version: 1, facts, reference: { preserve: 'metadata' } };
  const disk = new Map<string, unknown>([['srs.json', structuredClone(initial)]]);
  const writes: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
    const route = String(url);
    if (route.includes('/api/packs')) return { ok: true, json: async () => ({ packs: [{ id: pack.meta.id, dir: 'publication', pack }] }) };
    const name = route.replace('/api/state/', '');
    if (init?.method === 'PUT') {
      writes.push(name);
      disk.set(name, JSON.parse(init.body ?? 'null'));
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return disk.has(name)
      ? { ok: true, json: async () => structuredClone(disk.get(name)) }
      : { ok: false, status: 404, json: async () => ({}) };
  }));
  vi.resetModules();
  const { services } = await import('../../app/src/game/contracts');
  await import('../../app/src/srs/register');
  await import('../../app/src/draw/register');
  await services.draw.ready();
  expect(services.draw.allFactIds()).toHaveLength(pack.facts.length);
  expect(services.draw.sourceOf(target.id)).toBe(pack.meta.id);
  expect(services.draw.fresh({ count: pack.facts.length, seed: 7, now })).toContain(target.id);
  for (const alias of aliases) {
    expect(services.draw.allFactIds()).toContain(alias.id);
    expect(services.amendments.isSuspended(alias.id)).toBe(true);
    expect(services.draw.fresh({ count: pack.facts.length, seed: 7, now })).not.toContain(alias.id);
    expect(services.draw.due({ count: pack.facts.length, seed: 7, now })).not.toContain(alias.id);
    expect(services.draw.encountersOf(alias.id)).toEqual([]);
    expect(services.srs.boxOf(alias.id)).toBe(5);
    expect(services.srs.boxOf(alias.duplicate_of!)).toBe(2);
    expect(services.srs.nextDueOf(alias.duplicate_of!)).toBe(now + 86400000);
  }
  const encounter = services.draw.encountersOf(target.id).find(item => item.kind === 'free_recall')!;
  expect(encounter.fact_ids).toContain(target.id);
  expect(writes).toEqual([]);
  expect(disk.get('srs.json')).toEqual(initial);
  await services.srs.record(target.id, 1, encounter.id, target.type);
  expect(writes).toEqual(['srs.json']);
  const saved = disk.get('srs.json') as typeof initial;
  expect(saved.facts[base.facts[0].id]).toEqual(initial.facts[base.facts[0].id]);
  expect(saved.reference).toEqual(initial.reference);
  for (const alias of aliases) {
    expect(saved.facts[alias.id]).toEqual(initial.facts[alias.id]);
    expect(saved.facts[alias.duplicate_of!]).toEqual(initial.facts[alias.duplicate_of!]);
  }
  expect(services.srs.boxOf(target.id)).toBe(2);
  expect(services.srs.nextDueOf(target.id)).toBe(now + 3 * 86400000);
  expect(services.srs.historyQualities(target.id)).toEqual([1]);
  expect(services.draw.due({ count: pack.facts.length, seed: 7, now: now + 3 * 86400000 })).toContain(target.id);
});
