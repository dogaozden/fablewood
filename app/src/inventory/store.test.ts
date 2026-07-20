import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bridge } from '../srs/store';
import { STARTING_GOLD } from './economy';
import { InventoryStore } from './store';

/**
 * In-memory stand-in for the dev bridge (same shape as srs/store.test.ts's).
 * Stores JSON *strings* so accidental reference sharing between cache and disk
 * surfaces. `offline` mimics a static build: reads null, writes fail.
 */
class FakeBridge implements Bridge {
  files = new Map<string, string>();
  offline = false;
  writeDelayMs = 0;
  readDelayMs = 0;

  seed(name: string, value: unknown): void {
    this.files.set(name, JSON.stringify(value));
  }
  raw(name: string): unknown {
    const s = this.files.get(name);
    return s === undefined ? undefined : JSON.parse(s);
  }
  keys(): string[] {
    return [...this.files.keys()];
  }

  async getState<T = unknown>(name: string): Promise<T | null> {
    if (this.readDelayMs) await new Promise((r) => setTimeout(r, this.readDelayMs));
    if (this.offline) return null;
    const s = this.files.get(name);
    return s === undefined ? null : (JSON.parse(s) as T);
  }
  async putState(name: string, data: unknown): Promise<boolean> {
    if (this.writeDelayMs) await new Promise((r) => setTimeout(r, this.writeDelayMs));
    if (this.offline) return false;
    this.files.set(name, JSON.stringify(data));
    return true;
  }
}

afterEach(() => vi.restoreAllMocks());

describe('fresh satchel — defaults', () => {
  it('starts with the starter purse and no items when no file exists', async () => {
    const s = new InventoryStore(new FakeBridge());
    await s.ready();
    expect(s.getGold()).toBe(STARTING_GOLD);
    expect(s.snapshot()).toEqual({ gold: STARTING_GOLD, stacks: {} });
    expect(s.countOf('embermend-draught')).toBe(0);
  });

  it('loads a persisted wallet (gold + stacks) over the defaults', async () => {
    const b = new FakeBridge();
    b.seed('inventory.json', { version: 1, gold: 77, stacks: { 'mossbound-locket': 2 } });
    const s = new InventoryStore(b);
    await s.ready();
    expect(s.getGold()).toBe(77);
    expect(s.countOf('mossbound-locket')).toBe(2);
  });
});

describe('ready() race — concurrent callers share one in-flight load', () => {
  it('a second ready() during a slow load sees the persisted wallet, not defaults', async () => {
    const b = new FakeBridge();
    b.readDelayMs = 25;
    b.seed('inventory.json', { version: 1, gold: 123, stacks: { 'faded-coin-cache': 1 } });
    const s = new InventoryStore(b);
    const first = s.ready(); // fire-and-forget warm-up — deliberately not awaited
    await s.ready(); // must await the SAME in-flight load
    expect(s.getGold()).toBe(123); // not the default 20
    expect(s.countOf('faded-coin-cache')).toBe(1);
    await first;
  });

  it('runs the underlying load exactly once under many concurrent ready() calls', async () => {
    const b = new FakeBridge();
    b.readDelayMs = 15;
    b.seed('inventory.json', { version: 1, gold: 9, stacks: {} });
    const getSpy = vi.spyOn(b, 'getState');
    const s = new InventoryStore(b);
    await Promise.all([s.ready(), s.ready(), s.ready(), s.ready()]);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(s.getGold()).toBe(9);
  });
});

describe('deep-merge writes — the stacks sub-object survives gold-only patches', () => {
  it('addGold never clobbers stacks (the shallow-merge trap)', async () => {
    const b = new FakeBridge();
    b.seed('inventory.json', { version: 1, gold: 10, stacks: { 'amber-writ-seal': 3 } });
    const s = new InventoryStore(b);
    await s.ready();
    await s.addGold(5);
    const disk = b.raw('inventory.json') as { gold: number; stacks: Record<string, number> };
    expect(disk.gold).toBe(15);
    expect(disk.stacks['amber-writ-seal']).toBe(3); // still there
  });

  it('preserves unknown top-level keys across every mutation', async () => {
    const b = new FakeBridge();
    b.seed('inventory.json', { version: 1, gold: 30, stacks: {}, ledgerNote: 'the Clerk remembers' });
    const s = new InventoryStore(b);
    await s.ready();
    await s.addGold(1);
    await s.grant('embermend-draught');
    await s.spendGold(5);
    expect((b.raw('inventory.json') as { ledgerNote?: string }).ledgerNote).toBe('the Clerk remembers');
  });

  it("merges onto a concurrent tab's write instead of clobbering from stale cache", async () => {
    const b = new FakeBridge();
    b.seed('inventory.json', { version: 1, gold: 20, stacks: {} });
    const s = new InventoryStore(b);
    await s.ready(); // cache knows gold 20, no items

    // another tab banks loot directly to disk after we loaded
    b.seed('inventory.json', { version: 1, gold: 50, stacks: { 'clerks-silver-nib': 1 } });

    await s.grant('embermend-draught'); // our write must keep the other tab's nib AND its gold
    const disk = b.raw('inventory.json') as { gold: number; stacks: Record<string, number> };
    expect(disk.gold).toBe(50);
    expect(disk.stacks).toEqual({ 'clerks-silver-nib': 1, 'embermend-draught': 1 });
  });
});

describe('wallet rules — clamped, never negative, spend checks the freshest balance', () => {
  it('spendGold refuses (and writes nothing) when the purse is short', async () => {
    const b = new FakeBridge();
    const s = new InventoryStore(b);
    await s.ready(); // 20 gold
    expect(await s.spendGold(90)).toBe(false);
    expect(s.getGold()).toBe(20);
    expect(b.keys()).toHaveLength(0); // aborted mutations never touch disk
    expect(await s.spendGold(20)).toBe(true);
    expect(s.getGold()).toBe(0);
  });

  it('addGold with a negative delta clamps at zero', async () => {
    const s = new InventoryStore(new FakeBridge());
    await s.ready();
    expect(await s.addGold(-999)).toBe(0);
  });

  it('remove refuses when not enough are held, and empties stacks cleanly', async () => {
    const s = new InventoryStore(new FakeBridge());
    await s.ready();
    await s.grant('embermend-draught', 2);
    expect(await s.remove('embermend-draught', 3)).toBe(false);
    expect(s.countOf('embermend-draught')).toBe(2);
    expect(await s.remove('embermend-draught', 2)).toBe(true);
    expect(s.countOf('embermend-draught')).toBe(0);
    expect(s.snapshot().stacks).toEqual({}); // no lingering zero-count key
  });

  it('serialized rapid grants never lose increments', async () => {
    const b = new FakeBridge();
    b.writeDelayMs = 5; // widen the race window
    const s = new InventoryStore(b);
    await s.ready();
    await Promise.all([1, 2, 3, 4, 5].map(() => s.grant('faded-coin-cache')));
    expect(s.countOf('faded-coin-cache')).toBe(5);
    expect((b.raw('inventory.json') as { stacks: Record<string, number> }).stacks['faded-coin-cache']).toBe(5);
  });
});

describe('corrupt-file recovery — bytes preserved, never silently discarded', () => {
  it('backs up a shape-wrong file to inventory.corrupt-*.json and starts fresh', async () => {
    const b = new FakeBridge();
    b.seed('inventory.json', ['not', 'a', 'wallet']);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new InventoryStore(b);
    await s.ready();
    expect(s.getGold()).toBe(STARTING_GOLD);
    const backup = b.keys().find((k) => /^inventory\.corrupt-\d+\.json$/.test(k));
    expect(backup).toBeDefined();
    expect(b.raw(backup!)).toEqual(['not', 'a', 'wallet']);
    expect(warn).toHaveBeenCalledOnce();
    // and it recovers to a working store
    await s.grant('embermend-draught');
    expect(s.countOf('embermend-draught')).toBe(1);
  });

  it('treats numeric-gold-but-broken-stacks as corrupt (backed up, defaults)', async () => {
    const b = new FakeBridge();
    b.seed('inventory.json', { version: 1, gold: 10, stacks: 'oops' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new InventoryStore(b);
    await s.ready();
    expect(s.getGold()).toBe(STARTING_GOLD);
    expect(b.keys().some((k) => /^inventory\.corrupt-\d+\.json$/.test(k))).toBe(true);
  });

  it('drops insane stack values (NaN/negative/non-number) instead of poisoning math', async () => {
    const b = new FakeBridge();
    b.seed('inventory.json', {
      version: 1,
      gold: 5,
      stacks: { good: 2, zero: 0, negative: -3, wrong: 'two', frac: 1.9 },
    });
    const s = new InventoryStore(b);
    await s.ready();
    expect(s.snapshot().stacks).toEqual({ good: 2, frac: 1 });
  });
});

describe('no bridge (static build) — in-memory session, warned once', () => {
  it('keeps working in memory and warns exactly once', async () => {
    const b = new FakeBridge();
    b.offline = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new InventoryStore(b);
    await s.ready();
    await s.addGold(10);
    await s.grant('ward-of-focus');
    await s.addGold(3);
    expect(s.getGold()).toBe(33);
    expect(s.countOf('ward-of-focus')).toBe(1);
    expect(b.keys()).toHaveLength(0); // nothing persisted
    expect(warn).toHaveBeenCalledOnce();
  });
});
