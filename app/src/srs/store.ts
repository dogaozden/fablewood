/**
 * Persistence for the SRS spine. Wraps the dev bridge (state/*.json files) with:
 *   - load-once caching (sync reads after ready());
 *   - serialized MERGE-writes: every write re-reads the current file and merges
 *     its own delta, so a second browser tab never clobbers the other's data and
 *     unknown/foreign keys are always preserved;
 *   - corrupt-file recovery: a state file whose shape is wrong is backed up to
 *     <name>.corrupt-<ts>.json before we start fresh (never silently discarded);
 *   - graceful degradation: with no bridge (static build) everything runs
 *     in-memory and warns exactly once.
 *
 * `state/` is precious — this module is written to be paranoid about it.
 */
import type { Quality, SaveData } from '../game/contracts';
import { getState as realGetState, putState as realPutState } from '../bridge/client';
import { record as leitnerRecord, type SrsState } from './leitner';

/** The two bridge calls the stores depend on — injectable for tests. */
export interface Bridge {
  getState<T = unknown>(name: string): Promise<T | null>;
  putState(name: string, data: unknown): Promise<boolean>;
}

const realBridge: Bridge = { getState: realGetState, putState: realPutState };

const SRS_FILE = 'srs.json';
const SAVE_FILE = 'save.json';
const SETTINGS_FILE = 'settings.json';

const DEFAULT_SAVE: SaveData = { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
const DEFAULT_SETTINGS = { muted: false };

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isSrsState(x: unknown): x is SrsState {
  return isPlainObject(x) && isPlainObject((x as { facts?: unknown }).facts);
}

/** A corrupt-backup filename that satisfies the bridge's ^[A-Za-z0-9._-]+$ rule. */
function corruptName(file: string, now: number): string {
  return `${file.replace(/\.json$/, '')}.corrupt-${now}.json`;
}

// ---------------------------------------------------------------- SRS store

export class SrsStore {
  private cache: SrsState = { version: 1, facts: {} };
  private loadPromise: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private warned = false;

  constructor(private bridge: Bridge = realBridge) {}

  /**
   * Load persisted state once. Concurrent callers share the SAME in-flight
   * promise, so a second ready() cannot resolve early against the default cache
   * before the first load finishes — the race that silently dropped saved state
   * on the fire-and-forget boot warm-up.
   */
  ready(): Promise<void> {
    return (this.loadPromise ??= this.load());
  }

  private async load(): Promise<void> {
    const raw = await this.bridge.getState<unknown>(SRS_FILE);
    if (raw === null) {
      // missing file (or no bridge, or opaque byte-corruption) → start fresh
      this.cache = { version: 1, facts: {} };
      return;
    }
    if (!isSrsState(raw)) {
      // parseable but wrong shape → preserve the bytes, then start fresh
      await this.bridge.putState(corruptName(SRS_FILE, Date.now()), raw);
      console.warn(
        '[srs] state/srs.json had an unexpected shape; backed it up to a ' +
          'srs.corrupt-*.json and started fresh (no data silently discarded).',
      );
      this.cache = { version: 1, facts: {} };
      return;
    }
    this.cache = { ...raw, version: 1, facts: { ...raw.facts } };
  }

  boxOf(factId: string): number {
    return this.cache.facts[factId]?.box ?? 0;
  }

  masteryAvg(factIds: string[]): number {
    if (factIds.length === 0) return 0;
    let sum = 0;
    for (const id of factIds) sum += this.boxOf(id);
    return sum / factIds.length;
  }

  /** Read-only snapshot of the cached state (for dueQueue). */
  snapshot(): SrsState {
    return this.cache;
  }

  /**
   * Record one answer. Serialized on a write chain so rapid records never race;
   * each write re-reads the file so it merges onto the freshest on-disk state
   * (two-tab safety + correct box math when the same fact is hit twice fast).
   */
  record(
    factId: string,
    quality: Quality,
    encounterId: string,
    now: number = Date.now(),
  ): Promise<void> {
    const task = this.writeChain.then(async () => {
      const remote = await this.bridge.getState<unknown>(SRS_FILE);
      const base: SrsState = isSrsState(remote)
        ? { ...remote, version: 1, facts: { ...remote.facts } }
        : this.cache; // null/corrupt mid-run → build on our cache, don't lose the write
      const updated = leitnerRecord(base.facts[factId], quality, now, encounterId);
      const merged: SrsState = { ...base, version: 1, facts: { ...base.facts, [factId]: updated } };
      const ok = await this.bridge.putState(SRS_FILE, merged);
      if (!ok) this.warnOnce();
      this.cache = merged; // cache reflects the latest, persisted or not
    });
    this.writeChain = task.catch(() => {}); // keep the chain alive past a failure
    return task;
  }

  private warnOnce(): void {
    if (this.warned) return;
    this.warned = true;
    console.warn('[srs] no state bridge — SRS history is in-memory only for this session.');
  }
}

// ---------------------------------------------------------------- object stores

/**
 * A single-object state file (save / settings) with the same merge-write and
 * corrupt-recovery guarantees as the SRS store. Patches merge over the freshest
 * on-disk value so a concurrent tab's untouched keys survive.
 */
class ObjectStore<T extends Record<string, unknown>> {
  private cache: T;
  private loadPromise: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private warned = false;

  constructor(
    private file: string,
    private defaults: T,
    private bridge: Bridge = realBridge,
  ) {
    this.cache = { ...defaults };
  }

  /** Same shared-in-flight-promise guarantee as SrsStore.ready() (no ready() race). */
  ready(): Promise<void> {
    return (this.loadPromise ??= this.load());
  }

  private async load(): Promise<void> {
    const raw = await this.bridge.getState<unknown>(this.file);
    if (raw === null) {
      this.cache = { ...this.defaults };
      return;
    }
    if (!isPlainObject(raw)) {
      await this.bridge.putState(corruptName(this.file, Date.now()), raw);
      console.warn(`[srs] state/${this.file} had an unexpected shape; backed up and reset to defaults.`);
      this.cache = { ...this.defaults };
      return;
    }
    this.cache = { ...this.defaults, ...(raw as Partial<T>) };
  }

  get(): T {
    return this.cache;
  }

  save(patch: Partial<T>): Promise<void> {
    const task = this.writeChain.then(async () => {
      const remote = await this.bridge.getState<unknown>(this.file);
      const base: T = isPlainObject(remote)
        ? { ...this.defaults, ...(remote as Partial<T>) }
        : this.cache;
      const merged: T = { ...base, ...patch };
      const ok = await this.bridge.putState(this.file, merged);
      if (!ok) this.warnOnce();
      this.cache = merged;
    });
    this.writeChain = task.catch(() => {});
    return task;
  }

  private warnOnce(): void {
    if (this.warned) return;
    this.warned = true;
    console.warn(`[srs] no state bridge — state/${this.file} is in-memory only for this session.`);
  }
}

export class SaveStore extends ObjectStore<SaveData & Record<string, unknown>> {
  constructor(bridge: Bridge = realBridge) {
    super(SAVE_FILE, DEFAULT_SAVE as SaveData & Record<string, unknown>, bridge);
  }
}

export class SettingsStore extends ObjectStore<{ muted: boolean } & Record<string, unknown>> {
  constructor(bridge: Bridge = realBridge) {
    super(SETTINGS_FILE, DEFAULT_SETTINGS as { muted: boolean } & Record<string, unknown>, bridge);
  }
}
