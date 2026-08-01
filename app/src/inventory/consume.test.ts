/**
 * Regression test for the crucible-2 finding: useItem()'s heal branch used to
 * apply the heal (services.save.save) BEFORE checking store.remove()'s result,
 * and never looked at that result at all — so a second in-flight Use racing the
 * last stack of an item could double-heal (persisted via SaveStore) even
 * though only one item was ever actually held/removed (InventoryStore is
 * correct on its own side). Fixed behavior: no removal, no effect — the heal
 * must never be applied unless store.remove() reports it actually took one.
 *
 * Adapted from a verifier-written scratchpad repro (consume-race.test.ts): same
 * DelayedBridge/fake-save shape, but the assertions now encode the CORRECT
 * post-fix outcome (one heal, one refusal) rather than the pre-fix bug.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Bridge } from '../srs/store';
import { InventoryStore } from './store';
import { useItem } from './consume';
import { services } from '../game/contracts';

class DelayedBridge implements Bridge {
  files = new Map<string, string>();
  readDelayMs = 0;
  writeDelayMs = 0;

  seed(name: string, value: unknown): void {
    this.files.set(name, JSON.stringify(value));
  }

  async getState<T = unknown>(name: string): Promise<T | null> {
    if (this.readDelayMs) await new Promise((r) => setTimeout(r, this.readDelayMs));
    const s = this.files.get(name);
    return s === undefined ? null : (JSON.parse(s) as T);
  }

  async putState(name: string, data: unknown): Promise<boolean> {
    if (this.writeDelayMs) await new Promise((r) => setTimeout(r, this.writeDelayMs));
    this.files.set(name, JSON.stringify(data));
    return true;
  }
}

/** Mimics srs/store.ts's ObjectStore.save() shape closely enough: get() is a
 * synchronous cache read, save() performs a real async round trip (like the
 * fetch-based bridge does) before the cache is updated — same "cache lags the
 * in-flight write" property the real SaveStore has. Loosely typed (only `hp`
 * matters here) and installed via cast, same as srs/register.ts's real
 * services.save assignment does for the full SaveApi. */
function makeFakeSave(hp: number, delayMs: number) {
  let cache: { hp: number } = { hp };
  return {
    async ready() {},
    get: () => cache,
    async save(patch: Partial<{ hp: number }>) {
      await new Promise((r) => setTimeout(r, delayMs));
      cache = { ...cache, ...patch };
    },
  };
}

afterEach(() => {
  // services is a bare mutable registry ({} as Services) unless srs/register.ts's
  // side-effect import has run, which this file never does — drop our fake so it
  // can't leak into another test in this file/worker.
  delete (services as Partial<typeof services>).save;
});

describe('consume.ts useItem — cross-store race on the last stack of an item', () => {
  it('a second in-flight Use racing the last potion is refused outright — no removal, no double heal', async () => {
    const bridge = new DelayedBridge();
    bridge.seed('inventory.json', { version: 1, gold: 0, stacks: { 'embermend-draught': 1 } });
    // store.remove()'s own round trip (read then write) must clearly outlast
    // a single save(), opening a window where call B's synchronous guards
    // (countOf, then cur) run while call A's remove() is still mid-flight and
    // the shared cache hasn't been decremented yet.
    bridge.readDelayMs = 8;
    bridge.writeDelayMs = 50; // remove() total ~58ms

    const store = new InventoryStore(bridge);
    await store.ready();

    (services as unknown as { save: ReturnType<typeof makeFakeSave> }).save = makeFakeSave(4, 20); // 4/16 hp, save() ~20ms

    const callA = useItem(store, 'embermend-draught');
    // Land call B's synchronous prefix squarely inside call A's in-flight
    // store.remove() window (started at t=0, resolves ~t=58ms).
    await new Promise((r) => setTimeout(r, 35));
    const callB = useItem(store, 'embermend-draught');

    const [resA, resB] = await Promise.all([callA, callB]);
    const finalHp = (services as unknown as { save: ReturnType<typeof makeFakeSave> }).save.get().hp;
    const finalCount = store.countOf('embermend-draught');

    console.log('RACE RESULT', { resA, resB, finalHp, finalCount });

    // Call A actually holds the item when it reaches store.remove(): it wins
    // the item and the heal.
    expect(resA.ok).toBe(true);
    expect(resA.message).toBe('Restored 6 vigor.');
    // Call B's own store.remove() is serialized behind call A's in the write
    // chain, so by the time it runs the stock is already gone — refused
    // outright, and (the fix) that refusal must gate the heal too.
    expect(resB.ok).toBe(false);
    expect(resB.message).toBe('You have none left.');
    // Only one item's worth was ever held/removed...
    expect(finalCount).toBe(0);
    // ...and HP moved exactly once (4 -> 10), never twice (4 -> 10 -> 16).
    expect(finalHp).toBe(10);
  }, 5000);
});
