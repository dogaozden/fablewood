import type { Fact, Encounter } from '../packs/types';
import type { DrawIndex, DrawDeps, DrawOpts, InstalledPack } from './types';
export * from './types';

export function buildDrawIndex(packs: InstalledPack[]): DrawIndex {
  const factById = new Map<string, Fact>();
  const packIdByFactId = new Map<string, string>();
  const encountersByFactId = new Map<string, Encounter[]>();
  const packIds: string[] = [];
  let warned = false;
  for (const { id, pack } of packs) {
    packIds.push(id);
    for (const f of pack.facts) {
      if (factById.has(f.id)) {
        if (!warned) {
          console.warn(`[draw] duplicate fact id across packs: ${f.id} — first-installed wins`);
          warned = true;
        }
        continue;
      }
      factById.set(f.id, f);
      packIdByFactId.set(f.id, id);
    }
    for (const e of pack.encounters) {
      for (const fid of e.fact_ids ?? []) {
        if (packIdByFactId.get(fid) !== id) continue; // encounters attach only to their own pack's facts
        const arr = encountersByFactId.get(fid) ?? [];
        arr.push(e);
        encountersByFactId.set(fid, arr);
      }
    }
  }
  return { factById, packIdByFactId, encountersByFactId, packIds };
}

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic Fisher-Yates shuffle (mulberry32 idiom — same as
 * inventory/economy.ts; kept as a local copy since draw/ must not import
 * across domains). Pure: returns a new array, does not mutate `items`.
 */
export function seededShuffle(items: string[], seed: number): string[] {
  const rng = mulberry32(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const DAY_MS = 86_400_000;

/**
 * Emit one tie bucket, cycling packs in `rotation` order and skipping packs that
 * are absent from (or already exhausted in) this bucket. Each pack's own due order
 * is preserved; the first rotation entry present in the bucket leads it.
 */
function spreadBucket(bucket: string[], index: DrawIndex, rotation: string[], out: string[]): void {
  const queues = new Map<string, string[]>();
  for (const id of bucket) {
    const packId = index.packIdByFactId.get(id)!;
    const queue = queues.get(packId);
    if (queue) queue.push(id);
    else queues.set(packId, [id]);
  }
  if (queues.size <= 1) {
    out.push(...bucket);
    return;
  }
  const order = [...queues.keys()].sort((a, b) => rotation.indexOf(a) - rotation.indexOf(b));
  const cursor = new Map<string, number>(order.map(packId => [packId, 0]));
  let emitted = 0;
  while (emitted < bucket.length) {
    for (const packId of order) {
      const queue = queues.get(packId)!;
      const at = cursor.get(packId)!;
      if (at >= queue.length) continue;
      out.push(queue[at]);
      cursor.set(packId, at + 1);
      emitted++;
    }
  }
}

/**
 * Source-spread pass — DUE-FIRST, with the round-robin as a TIEBREAK only
 * (interleaving design D4). Leitner schedules in whole days, so sub-day deltas
 * between two next_due stamps are scheduling noise: facts due the same UTC day
 * are ties, and only within one such day-bucket may sources be spread. Nothing
 * ever overtakes a fact that is genuinely due earlier.
 *
 * dueOrder's ranking is authoritative (dues ascending, so equal buckets arrive
 * consecutive); we group consecutive equal buckets and spread inside each, which
 * makes cross-bucket order inviolable by construction. Which pack leads a bucket
 * comes from a seededShuffle of the installed pack ids — deterministic per seed,
 * not always install order.
 *
 * An id whose due date is unknown (dueOf undefined — a mangled record; dueQueue
 * ranks those most-overdue) buckets alone and so keeps its ranked place. One
 * installed pack is exact passthrough.
 */
function sourceSpread(ids: string[], index: DrawIndex, deps: DrawDeps, seed: number): string[] {
  if (index.packIds.length <= 1) return ids;
  const days = ids.map(id => {
    const due = deps.dueOf(id);
    return due === undefined ? undefined : Math.floor(due / DAY_MS);
  });
  const rotation = seededShuffle(index.packIds, seed);
  const out: string[] = [];
  for (let start = 0; start < ids.length; ) {
    let end = start + 1;
    // `undefined` groups with nothing, not even another undefined.
    if (days[start] !== undefined) while (end < ids.length && days[end] === days[start]) end++;
    spreadBucket(ids.slice(start, end), index, rotation, out);
    start = end;
  }
  return out;
}

/**
 * Global schedule-first draw: eligibility- and kind-filtered, most-due-first,
 * with same-DAY ties spread across sources, truncated to opts.count.
 */
export function drawDue(index: DrawIndex, deps: DrawDeps, opts: DrawOpts): string[] {
  let ids = Array.from(index.factById.keys());
  ids = ids.filter(deps.eligible);
  ids = ids.filter(deps.hasRecord);
  if (opts.kinds) {
    const kinds = opts.kinds;
    ids = ids.filter(id => (index.encountersByFactId.get(id) ?? []).some(e => kinds.includes(e.kind)));
  }
  ids = deps.dueOrder(ids, opts.now);
  ids = sourceSpread(ids, index, deps, opts.seed);
  return ids.slice(0, opts.count);
}

/**
 * Introduction-pacing draw: surfaces only eligible (not amendment-suspended),
 * unseen facts (no SRS record yet) whose prereqs are all already-recorded,
 * grouped per pack in pack-internal order, then interleaved by STRICT
 * round-robin rotation across index.packIds — NOT the seeded permutation
 * drawDue's tie-break uses. opts.seed picks only the starting pack
 * (seed % packIds.length); rotation order past that is fixed installation
 * order, skipping exhausted packs.
 */
export function drawNew(index: DrawIndex, deps: DrawDeps, opts: DrawOpts): string[] {
  const queues = new Map<string, string[]>();
  for (const packId of index.packIds) queues.set(packId, []);
  for (const id of index.factById.keys()) {
    if (!deps.eligible(id)) continue;
    if (deps.hasRecord(id)) continue;
    const prereqs = index.factById.get(id)!.prereqs ?? [];
    if (!prereqs.every(deps.hasRecord)) continue;
    queues.get(index.packIdByFactId.get(id)!)!.push(id);
  }

  const n = index.packIds.length;
  if (n === 0) return [];
  const start = ((opts.seed % n) + n) % n;
  const order = [...index.packIds.slice(start), ...index.packIds.slice(0, start)];
  const cursor = new Map<string, number>(order.map(packId => [packId, 0]));

  const out: string[] = [];
  let active = order.length;
  while (out.length < opts.count && active > 0) {
    active = 0;
    for (const packId of order) {
      if (out.length >= opts.count) break;
      const q = queues.get(packId)!;
      const i = cursor.get(packId)!;
      if (i >= q.length) continue;
      out.push(q[i]);
      cursor.set(packId, i + 1);
      active++;
    }
  }
  return out;
}
