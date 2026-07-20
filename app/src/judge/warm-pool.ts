/**
 * Generic pre-warmed process pool bookkeeping — pure, no I/O, no node APIs.
 * Used by ../../judge-worker.ts (which lives outside app/src because it
 * needs node's child_process — see vite-judge-plugin.ts's file doc comment
 * for why) to keep a small number of already-spawned `claude` processes idle
 * and ready, so a grade request can skip the CLI boot cost. Split out here
 * purely so the queueing logic is unit-testable under vitest, which only
 * picks up app/src/**\/*.test.ts.
 */

export interface PoolEntry<T> {
  proc: T;
  alive: boolean;
}

export class WarmPool<T> {
  private entries: PoolEntry<T>[] = [];

  constructor(
    private readonly targetSize: number,
    private readonly factory: () => PoolEntry<T>,
  ) {}

  /** Pop the next live entry, discarding any dead ones found along the way.
   *  Returns null if the pool is empty or every entry has died — the caller
   *  is expected to fall back to spawning fresh (see gradeWithWarmWorker). */
  take(): PoolEntry<T> | null {
    while (this.entries.length > 0) {
      const entry = this.entries.shift()!;
      if (entry.alive) return entry;
    }
    return null;
  }

  /** Top the pool back up to targetSize. Safe to call after every take() —
   *  also self-heals a pool that lost entries to a crash while idle. */
  replenish(): void {
    while (this.entries.length < this.targetSize) {
      this.entries.push(this.factory());
    }
  }

  size(): number {
    return this.entries.length;
  }

  /** Iterate every currently pooled entry (used for shutdown cleanup). */
  forEach(fn: (entry: PoolEntry<T>) => void): void {
    for (const entry of this.entries) fn(entry);
  }
}
