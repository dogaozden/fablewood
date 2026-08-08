import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PACK_ALPHA, PACK_BETA } from '../../../draw/__fixtures__/packs';
import type { SrsApi, AmendmentsApi, DrawServiceApi } from '../../contracts';
import type { Encounter } from '../../../packs/types';
import type { FactLite } from '../../contracts';

/**
 * runEncounter's per-fact source resolution (register.ts's runEncounter/factsFor,
 * engine.ts's pick()): the highest-risk site of the `?? packs[0]` single-pack habit.
 * Before this fix, resolving a due fact whose encounter lives in a DIFFERENT pack
 * than req.packId silently mis-resolved inside the wrong pack (or hydrated zero
 * facts) instead of drawing across the installed set. Same vi.doMock/fake-services
 * idiom as draw/__tests__/register.test.ts (Task 4): fake getPacks + a faked
 * services.srs/services.amendments so services.draw.ready() can build its index,
 * and a faked ../overlay so presentEncounter never opens a real DOM overlay —
 * it just captures what runEncounter resolved and hands back a canned result.
 */

function fakeSrs(): SrsApi {
  return {
    async ready() {},
    dueQueue: (_packId, factIds) => factIds, // passthrough: given order = due order
    record: async () => {},
    boxOf: () => 0,
    masteryAvg: () => 0,
    historyQualities: () => [],
    hasRecord: () => true,
    nextDueOf: () => 0, // every fact recorded and due the same day
  };
}

function fakeAmendments(): AmendmentsApi {
  return {
    async ready() {},
    isWitnessed: () => false,
    isSuspended: () => false,
    eligible: (ids) => [...ids],
    pending: () => [],
    async witness() {},
    firstAmendedAppearance: () => null,
  };
}

interface Captured {
  encounter: Encounter;
  facts: FactLite[];
}

async function setup(packs: unknown[] = [PACK_ALPHA, PACK_BETA]) {
  vi.doMock('../../../bridge/client', () => ({ getPacks: async () => ({ packs }) }));

  let captured: Captured | null = null;
  vi.doMock('../overlay', () => ({
    presentEncounter: async (encounter: Encounter, facts: FactLite[]) => {
      captured = { encounter, facts };
      return { encounterId: encounter.id, kind: encounter.kind, factIds: encounter.fact_ids, quality: 1 as const };
    },
    presentTeaching: async () => {},
    presentNightLedger: async () => {},
    presentAmendment: async () => {},
  }));

  const { services } = await import('../../contracts');
  services.srs = fakeSrs();
  services.amendments = fakeAmendments();
  await import('../../../draw/register'); // installs services.draw (Task 4)
  await import('../register'); // installs services.runEncounter (this task)

  return { services, getCaptured: (): Captured | null => captured };
}

beforeEach(() => {
  vi.resetModules();
});

describe('runEncounter — per-fact source resolution (cross-pack)', () => {
  it('draws fx-beta\'s encounter for fx.b.one even when req.packId names fx-alpha', async () => {
    const { services, getCaptured } = await setup();

    const result = await services.runEncounter({
      context: 'combat',
      kinds: ['mcq'],
      factIds: ['fx.b.one'],
      packId: 'fx-alpha', // deliberately the OTHER pack — the mis-resolution trap
      seed: 1,
    });

    expect(result.factIds).toContain('fx.b.one');

    const captured = getCaptured();
    expect(captured).not.toBeNull();
    expect(captured!.encounter.fact_ids).toContain('fx.b.one');
    // factsFor must hydrate cross-pack — not silently return [] because the
    // resolved pack (by packId) doesn't own this fact.
    expect(captured!.facts.length).toBeGreaterThan(0);
    expect(captured!.facts.some((f) => f.id === 'fx.b.one')).toBe(true);
  });

  it('still resolves the earliest due fact when it DOES live in the named pack', async () => {
    const { services, getCaptured } = await setup();

    await services.runEncounter({
      context: 'combat',
      kinds: ['mcq'],
      factIds: ['fx.a.two', 'fx.a.one'],
      packId: 'fx-alpha',
      seed: 1,
    });

    const captured = getCaptured();
    expect(captured!.encounter.fact_ids).toContain('fx.a.two'); // due-order still honored
    expect(captured!.facts.some((f) => f.id === 'fx.a.two')).toBe(true);
  });
});

describe('runEncounter — services.draw index-load failure falls back safely', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never throws, warns once (not per-call), and resolves via the legacy single-pack path when indexReady() rejects', async () => {
    vi.doMock('../../../bridge/client', () => ({ getPacks: async () => ({ packs: [PACK_ALPHA, PACK_BETA] }) }));

    let captured: Captured | null = null;
    vi.doMock('../overlay', () => ({
      presentEncounter: async (encounter: Encounter, facts: FactLite[]) => {
        captured = { encounter, facts };
        return { encounterId: encounter.id, kind: encounter.kind, factIds: encounter.fact_ids, quality: 1 as const };
      },
      presentTeaching: async () => {},
      presentNightLedger: async () => {},
      presentAmendment: async () => {},
    }));

    const { services } = await import('../../contracts');
    services.srs = fakeSrs();
    services.amendments = fakeAmendments();
    // A hand-built services.draw (bypassing the real draw/register.ts) whose
    // indexReady() always rejects — isEmpty() deliberately answers `false` (as if
    // packs WERE loaded) so the test only passes if the gate actually awaits
    // indexReady() and short-circuits on its rejection, rather than racing ahead
    // to read isEmpty() against a half-initialized index (Finding 2).
    const draw: DrawServiceApi = {
      async ready() {},
      indexReady: () => Promise.reject(new Error('index load boom')),
      due: () => [],
      fresh: () => [],
      allFactIds: () => [],
      sourceOf: () => undefined,
      factOf: () => undefined,
      encountersOf: () => [],
      isEmpty: () => false,
    };
    services.draw = draw;
    await import('../register'); // installs services.runEncounter (this task)

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result1 = await services.runEncounter({
      context: 'combat', kinds: ['mcq'], factIds: ['fx.a.one'], packId: 'fx-alpha', seed: 1,
    });
    const result2 = await services.runEncounter({
      context: 'combat', kinds: ['mcq'], factIds: ['fx.a.two'], packId: 'fx-alpha', seed: 1,
    });

    // Resolved via the legacy single-pack path (never threw) — both facts live in
    // the req.packId-named pack, so this succeeds regardless of cross-pack wiring.
    expect(result1.factIds).toContain('fx.a.one');
    expect(result2.factIds).toContain('fx.a.two');
    expect(captured).not.toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1); // warned once, not per runEncounter() call
  });

  it('is unaffected by a concurrent services.draw.ready() rejecting on an unrelated srs leg while the index is still loading (the exact race)', async () => {
    // draw/register.ts's loadIndex() and encounters/register.ts's OWN loadPacks()
    // each keep an independent getPacks() cache — in production these are two
    // separate fetch('/api/packs') calls that can settle at different times. Give
    // them genuinely different timing here: the FIRST caller (loadIndex(), kicked
    // off synchronously by services.draw.ready() below, which runs strictly before
    // runEncounter's own loadPacks() call in program order) stays slow/pending;
    // every later call (runEncounter's own loadPacks()) resolves immediately — so
    // runEncounter reaches its crossPack decision fast while the index itself is
    // still mid-build, the exact race Finding 2 named.
    let callCount = 0;
    let resolveSlowGetPacks!: (value: { packs: unknown[] }) => void;
    const slowPromise = new Promise<{ packs: unknown[] }>((resolve) => {
      resolveSlowGetPacks = resolve;
    });
    vi.doMock('../../../bridge/client', () => ({
      getPacks: () => {
        callCount += 1;
        return callCount === 1 ? slowPromise : Promise.resolve({ packs: [PACK_ALPHA, PACK_BETA] });
      },
    }));

    let captured: Captured | null = null;
    vi.doMock('../overlay', () => ({
      presentEncounter: async (encounter: Encounter, facts: FactLite[]) => {
        captured = { encounter, facts };
        return { encounterId: encounter.id, kind: encounter.kind, factIds: encounter.fact_ids, quality: 1 as const };
      },
      presentTeaching: async () => {},
      presentNightLedger: async () => {},
      presentAmendment: async () => {},
    }));

    const { services } = await import('../../contracts');
    services.srs = { ...fakeSrs(), ready: () => Promise.reject(new Error('srs boom — unrelated to the draw index')) };
    services.amendments = fakeAmendments();
    await import('../../../draw/register'); // REAL draw/register.ts — services.draw.ready() really does reject early
    await import('../register');

    // A concurrent caller (e.g. a scene boot) awaiting the FULLER ready() — its
    // srs leg rejects immediately, well before loadIndex()'s OWN getPacks() (the
    // slow one, call #1) resolves.
    const readyRejection = services.draw.ready().catch(() => 'rejected-as-expected' as const);

    const resultPromise = services.runEncounter({
      context: 'combat', kinds: ['mcq'], factIds: ['fx.b.one'], packId: 'fx-alpha', seed: 1,
    });

    await expect(readyRejection).resolves.toBe('rejected-as-expected'); // race precondition confirmed
    resolveSlowGetPacks({ packs: [PACK_ALPHA, PACK_BETA] }); // NOW let the real index finish building

    const result = await resultPromise;
    // Cross-pack resolution still engaged correctly — proves runEncounter's gate
    // awaited the INDEX itself (indexReady()), never the rejecting srs leg of ready().
    expect(result.factIds).toContain('fx.b.one');
    expect(captured).not.toBeNull();
    expect(captured!.facts.some((f) => f.id === 'fx.b.one')).toBe(true);
  });
});
