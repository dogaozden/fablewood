/**
 * Persistence for the «Onward» story spine — state/story.json (design spec §9).
 * Three flat maps (id → ISO first-stamp) instead of arrays, for the same reason
 * AmendmentsStore is a flat map: ObjectStore-style shallow merges make two tabs'
 * writes a UNION, never a clobber. Append-only in spirit: nothing here ever
 * deletes or rewrites an existing key (first stamp wins).
 * `state/` is precious — same paranoia as srs/store.ts, which this mirrors.
 */
import { getState as realGetState, putState as realPutState } from '../bridge/client';

export interface Bridge {
  getState<T = unknown>(name: string): Promise<T | null>;
  putState(name: string, data: unknown): Promise<boolean>;
}
const realBridge: Bridge = { getState: realGetState, putState: realPutState };

const STORY_FILE = 'story.json';

export interface StoryState {
  version: 1;
  seenBeats: Record<string, string>;
  completedArcs: Record<string, string>;
  threadFragments: Record<string, string>;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function isStoryState(x: unknown): x is StoryState {
  return (
    isPlainObject(x) &&
    isPlainObject((x as { seenBeats?: unknown }).seenBeats) &&
    isPlainObject((x as { completedArcs?: unknown }).completedArcs) &&
    isPlainObject((x as { threadFragments?: unknown }).threadFragments)
  );
}
function fresh(): StoryState {
  return { version: 1, seenBeats: {}, completedArcs: {}, threadFragments: {} };
}
/** Union two id→date maps; the base's (older) stamp wins on collision. */
function union(base: Record<string, string>, add: Record<string, string>): Record<string, string> {
  return { ...add, ...base };
}

export class StoryStore {
  private cache: StoryState = fresh();
  private loadPromise: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private warned = false;

  constructor(private bridge: Bridge = realBridge) {}

  /** Shared in-flight load — the ready() race fix every store carries. */
  ready(): Promise<void> {
    return (this.loadPromise ??= this.load());
  }

  private async load(): Promise<void> {
    const raw = await this.bridge.getState<unknown>(STORY_FILE);
    if (raw === null) {
      this.cache = fresh();
      return;
    }
    if (!isStoryState(raw)) {
      await this.bridge.putState(`story.corrupt-${Date.now()}.json`, raw);
      console.warn(
        '[story] state/story.json had an unexpected shape; backed it up to a ' +
          'story.corrupt-*.json and started fresh (no data silently discarded).',
      );
      this.cache = fresh();
      return;
    }
    this.cache = {
      ...raw,
      version: 1,
      seenBeats: { ...raw.seenBeats },
      completedArcs: { ...raw.completedArcs },
      threadFragments: { ...raw.threadFragments },
    };
  }

  isSeen(beatId: string): boolean {
    return typeof this.cache.seenBeats[beatId] === 'string';
  }
  completedArcCount(): number {
    return Object.values(this.cache.completedArcs).filter((v) => typeof v === 'string').length;
  }
  hasFragment(fragmentId: string): boolean {
    return typeof this.cache.threadFragments[fragmentId] === 'string';
  }
  /** T2 — a read accessor only. The persisted shape is untouched (spec §6): this reads the
   *  same completedArcs map completedArcCount() already reads, by id instead of by count. */
  isArcComplete(arcId: string): boolean {
    return typeof this.cache.completedArcs[arcId] === 'string';
  }

  markSeen(beatId: string, now: number = Date.now()): Promise<void> {
    return this.write('seenBeats', beatId, now);
  }
  completeArc(arcId: string, now: number = Date.now()): Promise<void> {
    return this.write('completedArcs', arcId, now);
  }
  grantFragment(fragmentId: string, now: number = Date.now()): Promise<void> {
    return this.write('threadFragments', fragmentId, now);
  }

  /** One chained read-merge-write per stamp — the SrsStore.record() shape. */
  private write(
    field: 'seenBeats' | 'completedArcs' | 'threadFragments',
    id: string,
    now: number,
  ): Promise<void> {
    const task = this.writeChain.then(async () => {
      const remote = await this.bridge.getState<unknown>(STORY_FILE);
      const base: StoryState = isStoryState(remote)
        ? {
            ...remote,
            version: 1,
            seenBeats: { ...remote.seenBeats },
            completedArcs: { ...remote.completedArcs },
            threadFragments: { ...remote.threadFragments },
          }
        : this.cache; // null/corrupt mid-run → build on our cache, don't lose the write
      const merged: StoryState = {
        ...base,
        version: 1,
        seenBeats: union(base.seenBeats, this.cache.seenBeats),
        completedArcs: union(base.completedArcs, this.cache.completedArcs),
        threadFragments: union(base.threadFragments, this.cache.threadFragments),
      };
      merged[field] = { ...merged[field], [id]: merged[field][id] ?? new Date(now).toISOString() };
      const ok = await this.bridge.putState(STORY_FILE, merged);
      if (!ok) this.warnOnce();
      this.cache = merged;
    });
    this.writeChain = task.catch(() => {});
    return task;
  }

  private warnOnce(): void {
    if (this.warned) return;
    this.warned = true;
    console.warn('[story] no state bridge — story progress is in-memory only for this session.');
  }
}
