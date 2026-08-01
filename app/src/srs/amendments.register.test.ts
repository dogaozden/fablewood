import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "The Ledger Amended" at the CANONICAL filter site (supersession-reteach.md §4): the real
 * `services.srs.dueQueue` wrapper + `services.amendments`, wired through srs/register.ts.
 *
 * This is the one site that covers combat's dueFactIds/snapshotDueSet, the Wellspring
 * recompute and the hamlet due badge, so it is tested against the REAL provider rather than
 * the pure rules alone. Bridge access is all fetch(), so a stubbed global fetch is the whole
 * world: /api/packs serves the fixture pack and /api/state/* round-trips through a map that
 * OUTLIVES vi.resetModules() — which is how "witness persists across a reload" is proved.
 */

/** The fixture pack: one superseded pair (fx-old → fx-new) plus two ordinary facts. */
const FIXTURE_FACTS = [
  { id: 'fx-plain-a', statement: 'a' },
  { id: 'fx-old', statement: 'the old truth', superseded_by: 'fx-new' },
  { id: 'fx-new', statement: 'the new truth', supersedes: 'fx-old' },
  { id: 'fx-plain-b', statement: 'b' },
];
const ALL_IDS = FIXTURE_FACTS.map((f) => f.id);

const PACKS = {
  packs: [{ id: 'fx', dir: 'fx', pack: { meta: { id: 'fx' }, facts: FIXTURE_FACTS } }],
};

/** Survives vi.resetModules(): the on-disk state/ tree from the module graph's point of view. */
let disk = new Map<string, unknown>();

function stubFetch(packs: unknown = PACKS) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (u.includes('/api/packs')) return { ok: true, json: async () => packs };
      const name = u.replace('/api/state/', '');
      if (init?.method === 'PUT') {
        disk.set(name, JSON.parse(init.body ?? 'null'));
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (!disk.has(name)) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, json: async () => disk.get(name) };
    }),
  );
}

/** A fresh module graph over the same `disk` — i.e. a page reload. */
async function boot() {
  vi.resetModules();
  const { services } = await import('../game/contracts');
  await import('./register');
  await services.srs.ready();
  await services.amendments.ready();
  return services;
}

beforeEach(() => {
  disk = new Map();
  stubFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('§4 dueQueue — the canonical filter site', () => {
  it('retires the superseded fact and gates the superseding one FROM LOAD (no witness yet)', async () => {
    const services = await boot();
    expect(services.srs.dueQueue('fx', ALL_IDS)).toEqual(['fx-plain-a', 'fx-plain-b']);
  });

  it('after the witness, the new truth enters the queue and the old one stays retired', async () => {
    const services = await boot();
    await services.amendments.witness('fx-old');

    const queue = services.srs.dueQueue('fx', ALL_IDS);
    expect(queue).toContain('fx-new'); // a normal new fact: due immediately
    expect(queue).not.toContain('fx-old'); // retired, permanently
    expect(queue).toEqual(['fx-plain-a', 'fx-new', 'fx-plain-b']);
  });

  it('a pack with no supersession metadata is completely unaffected (vc-law)', async () => {
    vi.unstubAllGlobals();
    stubFetch({ packs: [{ id: 'p', dir: 'p', pack: { meta: { id: 'p' }, facts: [{ id: 'a' }, { id: 'b' }] } }] });
    const services = await boot();
    expect(services.srs.dueQueue('p', ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('zero packs installed: nothing is suspended and nothing throws', async () => {
    vi.unstubAllGlobals();
    stubFetch({ packs: [] });
    const services = await boot();
    expect(services.srs.dueQueue('nope', ['x', 'y'])).toEqual(['x', 'y']);
    expect(services.amendments.pending('nope')).toEqual([]);
    expect(services.amendments.isSuspended('x')).toBe(false);
  });
});

describe('§4 services.amendments.eligible — what the scene draw sites call', () => {
  it('drops both truths pre-witness, releases the new one post-witness', async () => {
    const services = await boot();
    // the Wellspring baseFactIds / CombatScene dueFactIds / DungeonScene teachingFacts filter
    expect(services.amendments.eligible(ALL_IDS)).toEqual(['fx-plain-a', 'fx-plain-b']);

    await services.amendments.witness('fx-old');
    expect(services.amendments.eligible(ALL_IDS)).toEqual(['fx-plain-a', 'fx-new', 'fx-plain-b']);
  });
});

describe('§2 pending amendments + the witness beat', () => {
  it('is pending until witnessed, and carries both truths with the new source quote', async () => {
    const services = await boot();
    const pending = services.amendments.pending('fx');
    expect(pending).toHaveLength(1);
    expect(pending[0].old.statement).toBe('the old truth');
    expect(pending[0].next.statement).toBe('the new truth');

    await services.amendments.witness('fx-old');
    expect(services.amendments.pending('fx')).toEqual([]);
  });

  it('the witness PERSISTS across a reload — a reopened batch shows only what is left', async () => {
    const first = await boot();
    expect(first.amendments.pending('fx')).toHaveLength(1);
    await first.amendments.witness('fx-old');

    // page reload: brand new module graph, same disk
    const second = await boot();
    expect(second.amendments.isWitnessed('fx-old')).toBe(true);
    expect(second.amendments.pending('fx')).toEqual([]);
    expect(second.srs.dueQueue('fx', ALL_IDS)).toContain('fx-new');
  });

  it('writes the witness to its own state file — srs.json is never touched', async () => {
    const services = await boot();
    await services.amendments.witness('fx-old');
    expect([...disk.keys()]).toEqual(['amendments.json']);
    expect(Object.keys(disk.get('amendments.json') as object)).toEqual(['fx-old']);
  });
});

describe('§5 firstAmendedAppearance through the live provider', () => {
  it('fires for the superseding fact with no history, not for its neighbours', async () => {
    const services = await boot();
    expect(services.amendments.firstAmendedAppearance(['fx-new'])).toBe('fx-new');
    expect(services.amendments.firstAmendedAppearance(['fx-plain-a'])).toBeNull();
    expect(services.amendments.firstAmendedAppearance(['fx-old'])).toBeNull();
  });

  it('stops firing once the fact has been graded once — second appearance has full teeth', async () => {
    const services = await boot();
    await services.amendments.witness('fx-old');
    expect(services.amendments.firstAmendedAppearance(['fx-new'])).toBe('fx-new');

    await services.srs.record('fx-new', 0, 'enc-1'); // the one free read-again is spent
    expect(services.amendments.firstAmendedAppearance(['fx-new'])).toBeNull();
  });

  it('the SRS record stays honest: the merciful miss still records quality 0', async () => {
    const services = await boot();
    await services.amendments.witness('fx-old');
    await services.srs.record('fx-new', 0, 'enc-1');
    expect(services.srs.historyQualities('fx-new')).toEqual([0]);
  });
});
