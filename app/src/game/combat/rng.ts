/**
 * Deterministic PRNG shared by combat's seeded systems (terrain layout, spawn
 * jitter, AI tie-breaks). Mirrors BootScene's mulberry32 so a given seed renders
 * identically for screenshots and e2e.
 */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable string hash → int, so a room id folds into a numeric seed. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Combine a room id and a run seed into one deterministic layout seed. */
export function layoutSeed(roomId: string, seed: number): number {
  return (hashString(roomId) ^ (seed | 0)) >>> 0;
}
