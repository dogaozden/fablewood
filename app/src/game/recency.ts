/**
 * Recency-aware ordering for spaced-repetition fact candidates (director-reported:
 * "do we have a system for making sure i am not over-asked the same things in a
 * row?"). Pure — no Phaser, no SRS — so it unit-tests in the node vitest env like
 * grid.ts/engine.ts.
 *
 * Shared by CombatScene.dueFactIds() and HamletScene.doWellspring(): each owns its
 * OWN recency Set (what counts as "recent" is scene-scoped) and its OWN seeded RNG
 * (combat/rng.ts's mulberry32+layoutSeed vs HamletScene's local mulberry32) — this
 * module only reorders a given candidate list, it never decides what is due or which
 * seed to use.
 *
 * SRS priority is sacred: partitionByRecency never excludes a candidate, only
 * reorders it. A due fact that was just asked still appears in the result — merely
 * behind other due facts that weren't just asked.
 */

/**
 * Stable partition: every id from `ordered` NOT in `recent`, in original relative
 * order, followed by every id that IS in `recent`, also in original relative order.
 * Nothing is dropped — the output is always a permutation of the input, same length.
 */
export function partitionByRecency(ordered: readonly string[], recent: ReadonlySet<string>): string[] {
  const fresh: string[] = [];
  const stale: string[] = [];
  for (const id of ordered) (recent.has(id) ? stale : fresh).push(id);
  return [...fresh, ...stale];
}

/**
 * Fisher-Yates shuffle driven by a caller-supplied seeded RNG. Same rng stream +
 * same input array (same elements, same order) → same output, every time — the
 * determinism lives in the caller's rng, this just consumes it.
 */
export function seededShuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
