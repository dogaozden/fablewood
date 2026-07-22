import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readState, writeState } from '../bridge/plugin';
import type { Bridge } from './store';
import { SaveStore, SettingsStore, SrsStore } from './store';

/**
 * In-memory stand-in for the dev bridge. Stores JSON *strings* (like the real
 * files) so any accidental reference sharing between cache and disk surfaces.
 * `offline` mode mimics a static build with no server: reads null, writes fail.
 */
class FakeBridge implements Bridge {
  files = new Map<string, string>();
  offline = false;
  writeDelayMs = 0;
  readDelayMs = 0;
  putCount = 0;

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
    this.putCount++;
    if (this.writeDelayMs) await new Promise((r) => setTimeout(r, this.writeDelayMs));
    if (this.offline) return false;
    this.files.set(name, JSON.stringify(data));
    return true;
  }
}

afterEach(() => vi.restoreAllMocks());

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

describe('ready() race — concurrent callers share one in-flight load', () => {
  // Regression: ready() used to flip a `loaded` flag BEFORE awaiting getState,
  // so a second caller during a slow load returned early against the default
  // cache — dropping saved state (e.g. a saved hp 13 read back as the default).
  // The fix memoizes the in-flight load promise so every caller awaits the real
  // load. Each test seeds real data behind a DELAYED getState, fires ready()
  // twice concurrently (first not awaited), and asserts the SEEDED value wins.

  it('SaveStore: a second ready() during a slow load sees the saved value, not defaults', async () => {
    const b = new FakeBridge();
    b.readDelayMs = 25; // slow getState widens the race window
    b.seed('save.json', { scene: 'vaults', hp: 13 });
    const s = new SaveStore(b);
    const first = s.ready(); // fire-and-forget warm-up — deliberately not awaited
    await s.ready();         // second caller must await the SAME in-flight load
    expect(s.get().hp).toBe(13); // not the default 16
    expect(s.get().scene).toBe('vaults');
    await first;
  });

  it('SettingsStore: concurrent ready() sees the persisted mute, not the default', async () => {
    const b = new FakeBridge();
    b.readDelayMs = 25;
    b.seed('settings.json', { muted: true });
    const s = new SettingsStore(b);
    const first = s.ready();
    await s.ready();
    expect(s.get().muted).toBe(true); // not default false
    await first;
  });

  it('SrsStore: concurrent ready() sees seeded boxes, not an empty store', async () => {
    const b = new FakeBridge();
    b.readDelayMs = 25;
    b.seed('srs.json', { version: 1, facts: { a: { box: 4, next_due: NOW, history: [] } } });
    const s = new SrsStore(b);
    const first = s.ready();
    await s.ready();
    expect(s.boxOf('a')).toBe(4); // not 0
    await first;
  });

  it('runs the underlying load exactly once under many concurrent ready() calls', async () => {
    const b = new FakeBridge();
    b.readDelayMs = 15;
    b.seed('save.json', { hp: 7 });
    const getSpy = vi.spyOn(b, 'getState');
    const s = new SaveStore(b);
    await Promise.all([s.ready(), s.ready(), s.ready(), s.ready()]);
    expect(getSpy).toHaveBeenCalledTimes(1); // single shared load
    expect(s.get().hp).toBe(7);
  });
});

describe('SrsStore — load & read', () => {
  it('loads existing state so boxOf/masteryAvg read from disk', async () => {
    const b = new FakeBridge();
    b.seed('srs.json', {
      version: 1,
      facts: { a: { box: 3, next_due: NOW, history: [] }, z: { box: 5, next_due: NOW, history: [] } },
    });
    const s = new SrsStore(b);
    await s.ready();
    expect(s.boxOf('a')).toBe(3);
    expect(s.boxOf('unseen')).toBe(0);
    expect(s.masteryAvg(['a', 'z'])).toBe(4);
  });

  it('ready() is idempotent (a second call does not re-read)', async () => {
    const b = new FakeBridge();
    const getSpy = vi.spyOn(b, 'getState');
    const s = new SrsStore(b);
    await s.ready();
    await s.ready();
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});

describe('SrsStore — merge-write preserves foreign data', () => {
  it('keeps unknown top-level keys and other facts when recording', async () => {
    const b = new FakeBridge();
    b.seed('srs.json', {
      version: 1,
      facts: { foreign: { box: 4, next_due: NOW, history: [] } },
      ledgerNote: 'the Clerk remembers', // unknown key must survive
    });
    const s = new SrsStore(b);
    await s.ready();
    await s.record('mine', 1, 'enc-1', NOW);

    const disk = b.raw('srs.json') as any;
    expect(disk.facts.foreign.box).toBe(4); // untouched
    expect(disk.facts.mine.box).toBe(2); // unseen → correct → box 2
    expect(disk.ledgerNote).toBe('the Clerk remembers'); // preserved
  });

  it('merges onto a concurrent tab\'s write instead of clobbering from stale cache', async () => {
    const b = new FakeBridge();
    b.seed('srs.json', { version: 1, facts: { a: { box: 1, next_due: NOW, history: [] } } });
    const s = new SrsStore(b);
    await s.ready(); // cache knows only about 'a'

    // another tab appends fact 'b' directly to disk after we loaded
    b.seed('srs.json', {
      version: 1,
      facts: {
        a: { box: 1, next_due: NOW, history: [] },
        b: { box: 2, next_due: NOW, history: [] },
      },
    });

    await s.record('c', 1, 'enc', NOW); // our write must not drop 'b'
    const disk = b.raw('srs.json') as any;
    expect(Object.keys(disk.facts).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('SrsStore — serialized writes (no lost updates)', () => {
  it('records the same fact rapidly without losing box increments', async () => {
    const b = new FakeBridge();
    b.writeDelayMs = 5; // widen the race window
    const s = new SrsStore(b);
    await s.ready();

    // fire five correct answers WITHOUT awaiting between them
    const proms = [0, 1, 2, 3, 4].map((i) => s.record('f', 1, `enc-${i}`, NOW));
    await Promise.all(proms);

    // unseen →2→3→4→5→6 : five corrects land at box 6, all five in history
    expect(s.boxOf('f')).toBe(6);
    const disk = b.raw('srs.json') as any;
    expect(disk.facts.f.box).toBe(6);
    expect(disk.facts.f.history).toHaveLength(5);
  });

  it('records many different facts concurrently, persisting all of them', async () => {
    const b = new FakeBridge();
    b.writeDelayMs = 2;
    const s = new SrsStore(b);
    await s.ready();

    const ids = Array.from({ length: 12 }, (_, i) => `fact-${i}`);
    await Promise.all(ids.map((id) => s.record(id, 1, 'e', NOW)));

    const disk = b.raw('srs.json') as any;
    expect(Object.keys(disk.facts).sort()).toEqual(ids.slice().sort());
  });
});

describe('SrsStore — corrupt-file recovery', () => {
  it('backs up a shape-wrong file before starting fresh, never discarding it', async () => {
    const b = new FakeBridge();
    b.seed('srs.json', [1, 2, 3]); // array is not a valid srs state
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new SrsStore(b);
    await s.ready();

    // started fresh
    expect(s.boxOf('anything')).toBe(0);
    // the bad bytes were preserved under a corrupt-<ts> name
    const backup = b.keys().find((k) => /^srs\.corrupt-\d+\.json$/.test(k));
    expect(backup).toBeDefined();
    expect(b.raw(backup!)).toEqual([1, 2, 3]);
    expect(warn).toHaveBeenCalledOnce();

    // and it recovers to a working store
    await s.record('x', 1, 'e', NOW);
    expect(s.boxOf('x')).toBe(2);
  });

  it('treats a missing file as an empty fresh store (no backup, no warning)', async () => {
    const b = new FakeBridge();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new SrsStore(b);
    await s.ready();
    expect(s.boxOf('x')).toBe(0);
    expect(b.keys()).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('SrsStore — no bridge (static build)', () => {
  it('runs in-memory, warns exactly once, and never throws', async () => {
    const b = new FakeBridge();
    b.offline = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new SrsStore(b);
    await s.ready();

    await s.record('a', 1, 'e', NOW); // box 2
    await s.record('a', 1, 'e', NOW); // box 3
    await s.record('b', 0, 'e', NOW); // box 1

    expect(s.boxOf('a')).toBe(3); // in-memory progression works
    expect(s.boxOf('b')).toBe(1);
    expect(b.keys()).toHaveLength(0); // nothing persisted
    expect(warn).toHaveBeenCalledOnce(); // warned once, not per record
  });
});

describe('SaveStore', () => {
  it('merges patches over the freshest disk value and preserves foreign keys', async () => {
    const b = new FakeBridge();
    b.seed('save.json', { scene: 'vaults', hp: 3, questFlag: true });
    const s = new SaveStore(b);
    await s.ready();
    expect(s.get().scene).toBe('vaults');
    expect(s.get().hp).toBe(3);
    expect(s.get().streak).toBe(0); // default filled in

    await s.save({ streak: 2, lastPlayed: 'today' });
    const disk = b.raw('save.json') as any;
    expect(disk).toMatchObject({ scene: 'vaults', hp: 3, streak: 2, lastPlayed: 'today', questFlag: true });
  });

  it('defaults a fresh save to the hamlet with a full HP pool', async () => {
    const s = new SaveStore(new FakeBridge());
    await s.ready();
    expect(s.get()).toMatchObject({ scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' });
  });

  it('backs up a corrupt save and resets to defaults', async () => {
    const b = new FakeBridge();
    b.seed('save.json', 'not an object');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new SaveStore(b);
    await s.ready();
    expect(s.get().scene).toBe('hamlet');
    expect(b.keys().some((k) => /^save\.corrupt-\d+\.json$/.test(k))).toBe(true);
  });
});

describe('SaveStore — hp coercion (crucible V1-2)', () => {
  it('coerces a non-numeric hp on load to the full-health default', async () => {
    const b = new FakeBridge();
    b.seed('save.json', { scene: 'vaults', hp: 'banana', streak: 2 });
    const s = new SaveStore(b);
    await s.ready();
    expect(s.get().hp).toBe(16);
    expect(s.get().scene).toBe('vaults'); // untouched fields survive
  });

  it('clamps an out-of-range numeric hp on load', async () => {
    const b = new FakeBridge();
    b.seed('save.json', { hp: 999 });
    const s = new SaveStore(b);
    await s.ready();
    expect(s.get().hp).toBe(16);
  });

  it('clamps a negative numeric hp on load to 0, not below', async () => {
    const b = new FakeBridge();
    b.seed('save.json', { hp: -50 });
    const s = new SaveStore(b);
    await s.ready();
    expect(s.get().hp).toBe(0);
  });

  it('keeps a valid numeric hp unchanged on load', async () => {
    const b = new FakeBridge();
    b.seed('save.json', { hp: 9 });
    const s = new SaveStore(b);
    await s.ready();
    expect(s.get().hp).toBe(9);
  });

  it('a null hp on load coerces to 0 (matches the pre-fix "null trips the guard" control)', async () => {
    const b = new FakeBridge();
    b.seed('save.json', { hp: null });
    const s = new SaveStore(b);
    await s.ready();
    expect(s.get().hp).toBe(0);
  });

  it('coerces garbage hp on a save() merge too, not just on load', async () => {
    const b = new FakeBridge();
    const s = new SaveStore(b);
    await s.ready(); // fresh store, cache = defaults (hp:16)
    // simulate a direct PUT (or another tab) corrupting hp on disk between our load and this save
    b.seed('save.json', { hp: 'banana', scene: 'vaults' });
    await s.save({ streak: 3 });
    expect(s.get().hp).toBe(16); // coerced, not "banana" or NaN
    const disk = b.raw('save.json') as any;
    expect(disk.hp).toBe(16); // self-heals the on-disk value too
    expect(disk.streak).toBe(3);
  });

  it('never leaves NaN reachable through get().hp regardless of input shape', async () => {
    for (const bad of ['banana', NaN, undefined, {}, [], true, '12abc']) {
      const b = new FakeBridge();
      b.seed('save.json', { hp: bad });
      const s = new SaveStore(b);
      await s.ready();
      expect(Number.isFinite(s.get().hp), `hp for input ${JSON.stringify(bad)}`).toBe(true);
    }
  });
});

describe('SettingsStore', () => {
  it('persists the mute toggle and merges over disk', async () => {
    const b = new FakeBridge();
    const s = new SettingsStore(b);
    await s.ready();
    expect(s.get().muted).toBe(false);
    await s.save({ muted: true });
    expect(s.get().muted).toBe(true);
    expect((b.raw('settings.json') as any).muted).toBe(true);
  });
});

describe('interval sanity through the store', () => {
  it('a correct answer schedules the next review 3 days out for a new fact', async () => {
    const b = new FakeBridge();
    const s = new SrsStore(b);
    await s.ready();
    await s.record('f', 1, 'e', NOW);
    const disk = b.raw('srs.json') as any;
    expect(disk.facts.f.next_due).toBe(NOW + 3 * DAY); // box 2 interval
  });
});

describe('SrsStore — real JSON persistence above box 5', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-srs-store-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('round-trips boxes 6, 7, and 8 without changing the SrsState shape', async () => {
    const bridge: Bridge = {
      async getState<T = unknown>(name: string): Promise<T | null> {
        return (await readState(tmp, name)) as T | null;
      },
      async putState(name: string, data: unknown): Promise<boolean> {
        await writeState(tmp, name, data);
        return true;
      },
    };
    const s = new SrsStore(bridge);
    await s.ready();

    const targets = [
      { id: 'number-fact', factType: 'number', answers: 5, expectedBox: 6 },
      { id: 'rule-fact', factType: 'rule', answers: 6, expectedBox: 7 },
      { id: 'concept-fact', factType: 'concept', answers: 7, expectedBox: 8 },
    ] as const;
    for (const target of targets) {
      for (let i = 0; i < target.answers; i++) {
        await s.record(target.id, 1, `${target.id}-${i}`, NOW + i * DAY, target.factType);
      }
    }

    const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'srs.json'), 'utf8')) as {
      version: number;
      facts: Record<string, { box: number }>;
    };
    expect(Object.keys(raw).sort()).toEqual(['facts', 'version']);
    expect(raw.version).toBe(1);
    expect(targets.map(({ id }) => raw.facts[id].box)).toEqual([6, 7, 8]);
    for (const target of targets) {
      expect(raw.facts[target.id].box).toBe(target.expectedBox);
      expect(raw.facts[target.id].box).toBeGreaterThan(5);
    }
  });
});
