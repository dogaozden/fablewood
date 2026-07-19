import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for the services.srs.ready() ready-race: boot warms the
 * services fire-and-forget, then a scene awaits ready() itself (the exact
 * double-call the store was hardened for). pullPacks() must give the second
 * caller the SAME in-flight pull — a synchronous "already pulled" flag lets the
 * second ready() resolve while /api/packs is still in flight, so dueQueue runs
 * with an EMPTY prereq index and blocked facts surface in the wrong order.
 *
 * Bridge access is all fetch(), so a stubbed global fetch fully controls timing:
 * state files resolve instantly (missing → null), /api/packs is gated on us.
 */

const PACKS = {
  packs: [
    {
      id: 'p1',
      dir: 'p1',
      pack: { meta: { id: 'p1' }, facts: [{ id: 'a' }, { id: 'b', prereqs: ['a'] }] },
    },
  ],
};

function stubFetch(packsGate: Promise<unknown>) {
  const calls = { packs: 0, state: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/api/packs')) {
        calls.packs += 1;
        await packsGate;
        return { ok: true, json: async () => PACKS };
      }
      calls.state += 1;
      return { ok: false, status: 404, json: async () => ({}) }; // no state files yet
    }),
  );
  return calls;
}

async function freshServices() {
  const { services } = await import('../game/contracts');
  await import('./register');
  return services;
}

beforeEach(() => {
  vi.resetModules(); // fresh module-level stores/flags in register.ts per test
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('services.srs.ready — concurrent callers', () => {
  it('a second concurrent ready() waits for the pack prereq index (no early resolve)', async () => {
    let releasePacks!: () => void;
    stubFetch(new Promise<void>((res) => (releasePacks = res)));
    const services = await freshServices();

    const ready1 = services.srs.ready(); // boot warm-up (kicks the packs fetch)
    const ready2 = services.srs.ready(); // scene's own await
    let ready2Done = false;
    void ready2.then(() => {
      ready2Done = true;
    });

    // state fetches settle well within this; /api/packs is still gated on us
    await new Promise((r) => setTimeout(r, 20));
    expect(ready2Done).toBe(false); // the race: ready2 must NOT have resolved yet

    releasePacks();
    await Promise.all([ready1, ready2]);

    // with the index built, 'b' (prereq 'a' unwelded) sorts AFTER 'a' despite
    // declaration order — exactly what an empty index gets wrong
    expect(services.srs.dueQueue('p1', ['b', 'a'])).toEqual(['a', 'b']);
  });

  it('ready() stays idempotent: /api/packs is fetched exactly once', async () => {
    const calls = stubFetch(Promise.resolve());
    const services = await freshServices();

    await Promise.all([services.srs.ready(), services.srs.ready()]);
    await services.srs.ready(); // late caller after completion
    expect(calls.packs).toBe(1);
  });
});
