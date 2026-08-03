import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PACK_ALPHA, PACK_BETA } from '../../../draw/__fixtures__/packs';
import type { SrsApi, AmendmentsApi } from '../../contracts';
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
