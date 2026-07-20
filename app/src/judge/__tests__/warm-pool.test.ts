import { describe, it, expect } from 'vitest';
import { WarmPool, type PoolEntry } from '../warm-pool';

// A fake "process" is just a counter id — WarmPool never inspects T itself,
// so the real ChildProcessWithoutNullStreams never needs to appear in a unit test.
function fakeFactory(spawned: number[]) {
  let n = 0;
  return (): PoolEntry<number> => {
    n += 1;
    spawned.push(n);
    return { proc: n, alive: true };
  };
}

describe('WarmPool — pre-warmed queueing, health-skip, and self-heal', () => {
  it('take() on an empty pool returns null (caller falls back to spawning fresh)', () => {
    const pool = new WarmPool<number>(2, fakeFactory([]));
    expect(pool.take()).toBeNull();
  });

  it('replenish() tops the pool up to targetSize via the factory', () => {
    const spawned: number[] = [];
    const pool = new WarmPool<number>(2, fakeFactory(spawned));
    pool.replenish();
    expect(pool.size()).toBe(2);
    expect(spawned).toEqual([1, 2]);
  });

  it('replenish() is idempotent once at target size (no extra spawns)', () => {
    const spawned: number[] = [];
    const pool = new WarmPool<number>(2, fakeFactory(spawned));
    pool.replenish();
    pool.replenish();
    expect(pool.size()).toBe(2);
    expect(spawned).toEqual([1, 2]);
  });

  it('take() hands back a live entry and shrinks the pool by one', () => {
    const pool = new WarmPool<number>(2, fakeFactory([]));
    pool.replenish();
    const entry = pool.take();
    expect(entry?.alive).toBe(true);
    expect(pool.size()).toBe(1);
  });

  it('take() skips and discards dead entries, returning the next live one', () => {
    const pool = new WarmPool<number>(3, fakeFactory([]));
    pool.replenish();
    // kill the first two spares while they sit idle in the pool (simulates a
    // crash between replenish() and the next grade request)
    let killed = 0;
    pool.forEach((e) => {
      if (killed < 2) {
        e.alive = false;
        killed++;
      }
    });
    const entry = pool.take();
    expect(entry?.alive).toBe(true);
    expect(pool.size()).toBe(0); // the two dead ones were discarded along the way
  });

  it('take() returns null (not a dead entry) when every pooled process has died', () => {
    const pool = new WarmPool<number>(2, fakeFactory([]));
    pool.replenish();
    pool.forEach((e) => {
      e.alive = false;
    });
    expect(pool.take()).toBeNull();
    expect(pool.size()).toBe(0);
  });

  it('auto-restarts: replenish() after a take() re-tops the pool for the next grade', () => {
    const spawned: number[] = [];
    const pool = new WarmPool<number>(2, fakeFactory(spawned));
    pool.replenish();
    pool.take();
    expect(pool.size()).toBe(1);
    pool.replenish();
    expect(pool.size()).toBe(2);
    expect(spawned).toEqual([1, 2, 3]); // one extra spawn to replace the one taken
  });

  it('forEach() iterates every currently pooled entry (used for shutdown cleanup)', () => {
    const pool = new WarmPool<number>(3, fakeFactory([]));
    pool.replenish();
    const seen: number[] = [];
    pool.forEach((e) => seen.push(e.proc));
    expect(seen).toEqual([1, 2, 3]);
  });
});
