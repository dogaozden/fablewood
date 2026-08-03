import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PACK_ALPHA, PACK_BETA } from '../__fixtures__/packs';
import type { SrsApi, AmendmentsApi } from '../../game/contracts';

const ALL_FIXTURE_IDS = [
  'fx.a.one', 'fx.a.two', 'fx.a.three', 'fx.a.four',
  'fx.b.one', 'fx.b.two', 'fx.b.three', 'fx.b.four',
];

/**
 * services.draw registration (draw/register.ts): wires the pure draw/index.ts
 * (Tasks 1-3) to real installed packs (a faked getPacks — the only bridge call
 * this module makes) and to services.srs/services.amendments — faked here at the
 * SrsApi/AmendmentsApi boundary, same idiom as inventory/consume.test.ts's
 * makeFakeSave, so this test targets the draw adapter wiring itself rather than
 * re-proving srs/amendments internals (already covered by their own suites).
 *
 * vi.resetModules() + a fresh dynamic import per test (srs/register.test.ts's
 * idiom) gives each test its own virgin `services` registry and draw/register.ts
 * module state (index/readyPromise), so no manual cleanup is needed between tests.
 */

function fakeSrs(seen: string[] = []): SrsApi {
  return {
    async ready() {},
    dueQueue: (_packId, factIds) => factIds, // passthrough: given order = due order
    record: async () => {},
    boxOf: () => 0,
    masteryAvg: () => 0,
    historyQualities: () => [],
    hasRecord: (id) => seen.includes(id),
  };
}

function fakeAmendments(ineligible: string[] = []): AmendmentsApi {
  return {
    async ready() {},
    isWitnessed: () => false,
    isSuspended: (id) => ineligible.includes(id),
    eligible: (ids) => ids.filter((id) => !ineligible.includes(id)),
    pending: () => [],
    async witness() {},
    firstAmendedAppearance: () => null,
  };
}

async function freshDraw(opts: { packs?: unknown[]; seen?: string[]; ineligible?: string[] } = {}) {
  const { packs = [PACK_ALPHA, PACK_BETA], seen = [], ineligible = [] } = opts;
  vi.doMock('../../bridge/client', () => ({ getPacks: async () => ({ packs }) }));
  const { services } = await import('../../game/contracts');
  services.srs = fakeSrs(seen);
  services.amendments = fakeAmendments(ineligible);
  await import('../register');
  return services;
}

beforeEach(() => {
  vi.resetModules();
});

describe('services.draw', () => {
  it('ready() builds the index from getPacks(); due() draws already-recorded facts across both packs', async () => {
    const services = await freshDraw({ seen: ALL_FIXTURE_IDS }); // due() only surfaces facts with a record
    await services.draw.ready();

    const due = services.draw.due({ count: 4, seed: 7, now: 0 });
    expect(due.length).toBe(4);
    const packsSeen = new Set(due.map((id) => services.draw.sourceOf(id)));
    expect(packsSeen.has('fx-alpha')).toBe(true);
    expect(packsSeen.has('fx-beta')).toBe(true);
  });

  it('fresh()/sourceOf/factOf/encountersOf/isEmpty work off the built index', async () => {
    const services = await freshDraw(); // seen: [] — every fixture fact is unseen, fresh() has full candidates
    await services.draw.ready();

    const fresh = services.draw.fresh({ count: 4, seed: 3, now: 0 });
    expect(fresh.length).toBe(4);

    expect(services.draw.sourceOf('fx.a.one')).toBe('fx-alpha');
    expect(services.draw.sourceOf('fx.b.one')).toBe('fx-beta');
    expect(services.draw.factOf('fx.a.one')?.id).toBe('fx.a.one');
    expect(services.draw.encountersOf('fx.a.four').length).toBe(2); // mcq + order
    expect(services.draw.isEmpty()).toBe(false);
  });

  it('due() gates on the amendments eligibility adapter (isSuspended)', async () => {
    const services = await freshDraw({ ineligible: ['fx.a.one'], seen: ['fx.a.one', 'fx.b.one'] });
    await services.draw.ready();
    const due = services.draw.due({ count: 8, seed: 1, now: 0 });
    expect(due).not.toContain('fx.a.one');
  });

  it('fresh() gates on the SAME eligibility adapter as due() (one adapter, both calls)', async () => {
    const services = await freshDraw({ ineligible: ['fx.a.three'] });
    await services.draw.ready();
    const fresh = services.draw.fresh({ count: 8, seed: 1, now: 0 });
    expect(fresh).not.toContain('fx.a.three');
  });

  it('fresh() respects the hasRecord adapter for prereq gating', async () => {
    const services = await freshDraw({ seen: ['fx.a.one'] });
    await services.draw.ready();
    const fresh = services.draw.fresh({ count: 8, seed: 1, now: 0 });
    expect(fresh).not.toContain('fx.a.one'); // already seen
    expect(fresh).toContain('fx.a.two'); // prereq fx.a.one now seen
  });

  it('isEmpty() is true with zero packs installed, and due/fresh return []', async () => {
    const services = await freshDraw({ packs: [] });
    await services.draw.ready();
    expect(services.draw.isEmpty()).toBe(true);
    expect(services.draw.due({ count: 4, seed: 1, now: 0 })).toEqual([]);
    expect(services.draw.fresh({ count: 4, seed: 1, now: 0 })).toEqual([]);
  });
});
