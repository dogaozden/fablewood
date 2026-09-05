import { describe, it, expect, vi } from 'vitest';
import { StoryStore, type StoryState } from './store';

/** In-memory fake of the two bridge calls (the srs/store.test.ts pattern). */
function fakeBridge(initial: Record<string, unknown> = {}) {
  const files = new Map<string, unknown>(Object.entries(initial));
  return {
    files,
    getState: async <T,>(name: string) => (files.has(name) ? (files.get(name) as T) : null),
    putState: async (name: string, data: unknown) => (files.set(name, data), true),
  };
}

describe('StoryStore', () => {
  it('starts fresh when the file is missing', async () => {
    const s = new StoryStore(fakeBridge());
    await s.ready();
    expect(s.isSeen('onward-01.dark-answers')).toBe(false);
    expect(s.completedArcCount()).toBe(0);
  });

  it('markSeen persists and is idempotent (first-seen date wins)', async () => {
    const b = fakeBridge();
    const s = new StoryStore(b);
    await s.ready();
    await s.markSeen('onward-01.dark-answers', 1000);
    await s.markSeen('onward-01.dark-answers', 2000);
    const file = b.files.get('story.json') as StoryState;
    expect(file.seenBeats['onward-01.dark-answers']).toBe(new Date(1000).toISOString());
    expect(s.isSeen('onward-01.dark-answers')).toBe(true);
  });

  it('merge-writes union with the freshest on-disk state (two-tab safety)', async () => {
    const b = fakeBridge();
    const s = new StoryStore(b);
    await s.ready();
    // another tab wrote a different beat after our load
    b.files.set('story.json', {
      version: 1,
      seenBeats: { 'onward-01.barred-road': new Date(500).toISOString() },
      completedArcs: {},
      threadFragments: {},
    } satisfies StoryState);
    await s.markSeen('onward-01.dark-answers', 1000);
    const file = b.files.get('story.json') as StoryState;
    expect(Object.keys(file.seenBeats).sort()).toEqual([
      'onward-01.barred-road',
      'onward-01.dark-answers',
    ]);
  });

  it('an unknown top-level key survives a markSeen round-trip (forward-compat)', async () => {
    const b = fakeBridge({
      'story.json': {
        version: 1,
        seenBeats: {},
        completedArcs: {},
        threadFragments: {},
        futureField: { x: 1 },
      },
    });
    const s = new StoryStore(b);
    await s.ready();
    await s.markSeen('onward-01.dark-answers', 1000);
    const file = b.files.get('story.json') as StoryState & { futureField?: unknown };
    expect(file.futureField).toEqual({ x: 1 });
  });

  it('concurrent ready() shares one in-flight load (no default-cache race)', async () => {
    const b = fakeBridge({
      'story.json': {
        version: 1,
        seenBeats: { 'onward-01.dark-answers': new Date(1).toISOString() },
        completedArcs: {},
        threadFragments: {},
      },
    });
    const getSpy = vi.spyOn(b, 'getState');
    const s = new StoryStore(b);
    await Promise.all([s.ready(), s.ready()]);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(s.isSeen('onward-01.dark-answers')).toBe(true);
  });

  it('backs up a wrong-shaped file and starts fresh (never silently discards)', async () => {
    const b = fakeBridge({ 'story.json': { seenBeats: 'not-a-map' } });
    const s = new StoryStore(b);
    await s.ready();
    expect(s.isSeen('anything')).toBe(false);
    const backupName = [...b.files.keys()].find((k) => k.startsWith('story.corrupt-'));
    expect(backupName).toBeDefined();
    expect(b.files.get(backupName!)).toEqual({ seenBeats: 'not-a-map' });
  });

  it('arcs and fragments persist through the same union merge', async () => {
    const b = fakeBridge();
    const s = new StoryStore(b);
    await s.ready();
    await s.completeArc('onward-01', 1000);
    await s.grantFragment('frag.name.01-span-ledger', 2000);
    expect(s.completedArcCount()).toBe(1);
    expect(s.hasFragment('frag.name.01-span-ledger')).toBe(true);
    const file = b.files.get('story.json') as StoryState;
    expect(file.completedArcs['onward-01']).toBe(new Date(1000).toISOString());
    expect(file.threadFragments['frag.name.01-span-ledger']).toBe(new Date(2000).toISOString());
  });

  describe('isArcComplete', () => {
    it('reads completedArcs without changing the state shape', async () => {
      const s = new StoryStore(
        fakeBridge({
          'story.json': {
            version: 1,
            seenBeats: {},
            completedArcs: { 'onward-01': '2026-09-04T00:00:00.000Z' },
            threadFragments: {},
          },
        }),
      );
      await s.ready();
      expect(s.isArcComplete('onward-01')).toBe(true);
      expect(s.isArcComplete('onward-02')).toBe(false);
      expect(s.completedArcCount()).toBe(1);
    });
  });

  it('a failed write warns once, and the write chain survives for the next markSeen', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const files = new Map<string, unknown>();
    let putCalls = 0;
    const b = {
      files,
      getState: async <T,>(name: string) => (files.has(name) ? (files.get(name) as T) : null),
      putState: async (name: string, data: unknown) => {
        putCalls++;
        if (putCalls === 1) return false; // simulate one failed persist
        files.set(name, data);
        return true;
      },
    };
    const s = new StoryStore(b);
    await s.ready();
    await s.markSeen('onward-01.dark-answers', 1000); // fails to persist
    expect(warn).toHaveBeenCalledOnce();
    await s.markSeen('onward-01.barred-road', 2000); // chain must still be alive
    const file = b.files.get('story.json') as StoryState;
    expect(file.seenBeats['onward-01.dark-answers']).toBe(new Date(1000).toISOString());
    expect(file.seenBeats['onward-01.barred-road']).toBe(new Date(2000).toISOString());
  });
});
