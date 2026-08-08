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
import { boxOf as leitnerBoxOf, record as leitnerRecord, type SrsState } from './leitner';

/** The two bridge calls the stores depend on — injectable for tests. */
export interface Bridge {
  getState<T = unknown>(name: string): Promise<T | null>;
  putState(name: string, data: unknown): Promise<boolean>;
}

const realBridge: Bridge = { getState: realGetState, putState: realPutState };

const SRS_FILE = 'srs.json';
const SAVE_FILE = 'save.json';
const SETTINGS_FILE = 'settings.json';
const AMENDMENTS_FILE = 'amendments.json';

const DEFAULT_SAVE: SaveData = { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
const DEFAULT_SETTINGS = { muted: false, volume: 100 };

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

  /** Delegates to leitner's boxOf so the mangled-box coercion lives in exactly one place —
   *  masteryAvg below sums with `+`, and a non-number box concatenates instead of adding. */
  boxOf(factId: string): number {
    return leitnerBoxOf(this.cache, factId);
  }

  /** Epoch ms this fact is next due, or undefined if it has no record. A non-finite
   *  next_due (mangled state file) also reads as undefined — same defensive posture as
   *  boxOf, and it matches the entry dueQueue treats as most-overdue rather than due-at-0. */
  nextDueOf(factId: string): number | undefined {
    const due = this.cache.facts[factId]?.next_due;
    return typeof due === 'number' && Number.isFinite(due) ? due : undefined;
  }

  masteryAvg(factIds: string[]): number {
    if (factIds.length === 0) return 0;
    let sum = 0;
    for (const id of factIds) sum += this.boxOf(id);
    return sum / factIds.length;
  }

  /** Prior answer qualities for a fact, oldest first (empty if unseen). Reads the cache, so
   *  it reflects everything recorded SO FAR — call BEFORE record() to read a fact's PRIOR
   *  history (the redemption bell's capture-before-record contract, §3.1). */
  historyQualities(factId: string): Quality[] {
    return this.cache.facts[factId]?.history?.map((h) => h.quality) ?? [];
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
    factType?: string,
  ): Promise<void> {
    const task = this.writeChain.then(async () => {
      const remote = await this.bridge.getState<unknown>(SRS_FILE);
      const base: SrsState = isSrsState(remote)
        ? { ...remote, version: 1, facts: { ...remote.facts } }
        : this.cache; // null/corrupt mid-run → build on our cache, don't lose the write
      const updated = leitnerRecord(base.facts[factId], quality, now, encounterId, factType);
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
      this.cache = this.sanitize({ ...this.defaults });
      return;
    }
    if (!isPlainObject(raw)) {
      await this.bridge.putState(corruptName(this.file, Date.now()), raw);
      console.warn(`[srs] state/${this.file} had an unexpected shape; backed up and reset to defaults.`);
      this.cache = this.sanitize({ ...this.defaults });
      return;
    }
    this.cache = this.sanitize({ ...this.defaults, ...(raw as Partial<T>) });
  }

  /** Hook for subclasses to coerce/clamp individual fields after a merge — the shape
   *  check above only guards the whole object, never per-field types (crucible V1-2: a
   *  corrupt-but-still-object field, e.g. a non-numeric hp, would otherwise sail through
   *  untouched into live state). Identity by default. */
  protected sanitize(value: T): T {
    return value;
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
      const merged: T = this.sanitize({ ...base, ...patch });
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

  /** crucible V1-2 — a save.json corrupted directly on disk (e.g. hp:"banana") used to
   *  sail through as a string: `"banana" <= 0` is false, so DungeonScene's 0-HP guard
   *  never fired, and CombatScene's splitPooledHp produced NaN unit hp that resolved
   *  every fight as an instant retreat, forever (the corrupt value was never touched).
   *  Coerce/clamp hp here — the ONE place every consumer's get() funnels through —
   *  instead of hardening each call site individually. */
  protected sanitize(
    value: SaveData & Record<string, unknown>,
  ): SaveData & Record<string, unknown> {
    return { ...value, hp: coerceHp(value.hp) };
  }
}

/** Finite number, clamped to the party pool range; anything else (NaN, non-numeric
 *  strings, objects…) falls back to the full-health default rather than sailing into
 *  live state. */
function coerceHp(hp: unknown): number {
  const n = Number(hp);
  return Number.isFinite(n) ? Math.max(0, Math.min(DEFAULT_SAVE.hp, n)) : DEFAULT_SAVE.hp;
}

export class SettingsStore extends ObjectStore<{ muted: boolean; volume: number } & Record<string, unknown>> {
  constructor(bridge: Bridge = realBridge) {
    super(
      SETTINGS_FILE,
      DEFAULT_SETTINGS as { muted: boolean; volume: number } & Record<string, unknown>,
      bridge,
    );
  }
}

/**
 * "The Ledger Amended" witness store (supersession-reteach.md §4/§10.5) — its own small
 * state file, deliberately NOT a new field in srs.json: the sacred file stays untouched
 * and an old fact's SRS rows are preserved forever, never migrated, never copied (§6).
 *
 * Shape: a FLAT map of superseded factId → witnessed-at ISO date, so ObjectStore's
 * shallow merge-write is exactly right — two tabs witnessing different amendments both
 * survive, and an unknown key from a future version is preserved rather than dropped.
 * No `version` key on purpose: the file's only keys are fact ids, so nothing can be
 * mistaken for one. Non-string values (a hand-edited or half-written file) read as
 * "not witnessed" rather than silently excluding a fact from every draw path.
 */
export class AmendmentsStore extends ObjectStore<Record<string, string>> {
  constructor(bridge: Bridge = realBridge) {
    super(AMENDMENTS_FILE, {}, bridge);
  }

  /** Has the Clerk's amendment card for this superseded fact been read and witnessed? */
  isWitnessed(factId: string): boolean {
    return typeof this.get()[factId] === 'string';
  }

  /** Record the witness beat. Merge-write, so a concurrent tab's witnesses survive. */
  witness(factId: string, now: number = Date.now()): Promise<void> {
    return this.save({ [factId]: new Date(now).toISOString() });
  }
}
