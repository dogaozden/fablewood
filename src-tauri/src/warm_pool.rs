//! Generic pre-warmed process-pool bookkeeping — pure, no I/O, no process APIs.
//! Rust port of app/src/judge/warm-pool.ts (see that file's doc comment for the
//! full rationale). Used by judge_pool.rs to keep a small number of already-
//! spawned `claude` child processes idle and ready, so a grade request can skip
//! the CLI boot cost. Kept generic and I/O-free purely so the queueing logic is
//! unit-testable with a fake `T` (see the tests below), exactly mirroring why
//! warm-pool.ts is split out from judge-worker.ts for vitest.

use std::collections::VecDeque;

pub struct PoolEntry<T> {
    pub proc: T,
    pub alive: bool,
}

/// `F` is the factory that manufactures a fresh entry. Generic (not boxed/dyn)
/// because every call site has exactly one concrete factory type — a plain fn
/// item in production (judge_pool.rs), a capturing closure in tests.
pub struct WarmPool<T, F: FnMut() -> PoolEntry<T>> {
    entries: VecDeque<PoolEntry<T>>,
    target_size: usize,
    factory: F,
}

impl<T, F: FnMut() -> PoolEntry<T>> WarmPool<T, F> {
    pub fn new(target_size: usize, factory: F) -> Self {
        Self {
            entries: VecDeque::new(),
            target_size,
            factory,
        }
    }

    /// Pop the next live entry, discarding any dead ones found along the way.
    /// Returns None if the pool is empty or every entry has died — the caller
    /// is expected to fall back to spawning fresh (see judge_pool.rs's
    /// grade_with_pool).
    pub fn take(&mut self) -> Option<PoolEntry<T>> {
        while let Some(entry) = self.entries.pop_front() {
            if entry.alive {
                return Some(entry);
            }
        }
        None
    }

    /// Top the pool back up to target_size. Safe to call after every take() —
    /// also self-heals a pool that lost entries to a crash while idle.
    pub fn replenish(&mut self) {
        while self.entries.len() < self.target_size {
            self.entries.push_back((self.factory)());
        }
    }

    /// Ad-hoc fresh spawn outside the pool's own bookkeeping — mirrors
    /// judge-worker.ts's `pool.take() ?? spawnWarmProcess()` fallback, reusing
    /// the exact same factory the pool replenishes itself with, without
    /// touching (or counting against) the pooled entries.
    pub fn spawn_fresh(&mut self) -> PoolEntry<T> {
        (self.factory)()
    }

    // size()/for_each() are part of WarmPool's public surface (mirroring
    // warm-pool.ts's class API, incl. its "used for shutdown cleanup" forEach)
    // and are exercised by the tests below. size() also has a real production
    // call site now: judge_pool::prewarm reports it back to main.rs's
    // boot-readiness log line. for_each() still has none: this port's
    // shutdown cleanup relies on kill_on_drop RAII instead of an explicit
    // iterate-and-kill sweep — see judge_pool.rs's module doc for why.
    pub fn size(&self) -> usize {
        self.entries.len()
    }

    #[allow(dead_code)]
    pub fn for_each(&mut self, mut f: impl FnMut(&mut PoolEntry<T>)) {
        for entry in self.entries.iter_mut() {
            f(entry);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    // A fake "process" is just a counter id — WarmPool never inspects T itself,
    // so a real tokio::process::Child never needs to appear in a unit test.
    // (Arc<Mutex<..>> instead of TS's plain closure-captured array/counter,
    // since the production factory type must be Send for Tauri-managed state —
    // see judge_pool.rs — and this test helper mirrors that same shape.)
    fn fake_factory(spawned: Arc<Mutex<Vec<u32>>>) -> impl FnMut() -> PoolEntry<u32> {
        let mut n = 0u32;
        move || {
            n += 1;
            spawned.lock().unwrap().push(n);
            PoolEntry { proc: n, alive: true }
        }
    }

    #[test]
    fn take_on_empty_pool_returns_none() {
        let mut pool = WarmPool::new(2, fake_factory(Arc::new(Mutex::new(Vec::new()))));
        assert!(pool.take().is_none());
    }

    #[test]
    fn replenish_tops_up_to_target_size() {
        let spawned = Arc::new(Mutex::new(Vec::new()));
        let mut pool = WarmPool::new(2, fake_factory(spawned.clone()));
        pool.replenish();
        assert_eq!(pool.size(), 2);
        assert_eq!(*spawned.lock().unwrap(), vec![1, 2]);
    }

    #[test]
    fn replenish_is_idempotent_once_at_target_size() {
        let spawned = Arc::new(Mutex::new(Vec::new()));
        let mut pool = WarmPool::new(2, fake_factory(spawned.clone()));
        pool.replenish();
        pool.replenish();
        assert_eq!(pool.size(), 2);
        assert_eq!(*spawned.lock().unwrap(), vec![1, 2]);
    }

    #[test]
    fn take_hands_back_a_live_entry_and_shrinks_the_pool_by_one() {
        let mut pool = WarmPool::new(2, fake_factory(Arc::new(Mutex::new(Vec::new()))));
        pool.replenish();
        let entry = pool.take();
        assert!(entry.unwrap().alive);
        assert_eq!(pool.size(), 1);
    }

    #[test]
    fn take_skips_and_discards_dead_entries_returning_the_next_live_one() {
        let mut pool = WarmPool::new(3, fake_factory(Arc::new(Mutex::new(Vec::new()))));
        pool.replenish();
        // kill the first two spares while they sit idle in the pool (simulates
        // a crash between replenish() and the next grade request)
        let mut killed = 0;
        pool.for_each(|e| {
            if killed < 2 {
                e.alive = false;
                killed += 1;
            }
        });
        let entry = pool.take();
        assert!(entry.unwrap().alive);
        assert_eq!(pool.size(), 0); // the two dead ones were discarded along the way
    }

    #[test]
    fn take_returns_none_not_a_dead_entry_when_every_pooled_process_has_died() {
        let mut pool = WarmPool::new(2, fake_factory(Arc::new(Mutex::new(Vec::new()))));
        pool.replenish();
        pool.for_each(|e| e.alive = false);
        assert!(pool.take().is_none());
        assert_eq!(pool.size(), 0);
    }

    #[test]
    fn auto_restarts_replenish_after_take_retops_the_pool_for_the_next_grade() {
        let spawned = Arc::new(Mutex::new(Vec::new()));
        let mut pool = WarmPool::new(2, fake_factory(spawned.clone()));
        pool.replenish();
        pool.take();
        assert_eq!(pool.size(), 1);
        pool.replenish();
        assert_eq!(pool.size(), 2);
        assert_eq!(*spawned.lock().unwrap(), vec![1, 2, 3]); // one extra spawn to replace the one taken
    }

    #[test]
    fn for_each_iterates_every_currently_pooled_entry() {
        let mut pool = WarmPool::new(3, fake_factory(Arc::new(Mutex::new(Vec::new()))));
        pool.replenish();
        let mut seen = Vec::new();
        pool.for_each(|e| seen.push(e.proc));
        assert_eq!(seen, vec![1, 2, 3]);
    }

    #[test]
    fn spawn_fresh_uses_the_same_factory_without_touching_pooled_entries() {
        let spawned = Arc::new(Mutex::new(Vec::new()));
        let mut pool = WarmPool::new(2, fake_factory(spawned.clone()));
        let entry = pool.spawn_fresh();
        assert!(entry.alive);
        assert_eq!(pool.size(), 0); // spawn_fresh never touches the pooled entries
        assert_eq!(*spawned.lock().unwrap(), vec![1]);
    }
}
