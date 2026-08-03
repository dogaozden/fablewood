import type { DrawIndex, DrawDeps, DrawOpts, InstalledPack } from './types';
export * from './types';

export function buildDrawIndex(packs: InstalledPack[]): DrawIndex {
  const factById = new Map(); const packIdByFactId = new Map();
  const encountersByFactId = new Map(); const packIds: string[] = [];
  let warned = false;
  for (const { id, pack } of packs) {
    packIds.push(id);
    for (const f of pack.facts) {
      if (factById.has(f.id)) {
        if (!warned) { console.warn(`[draw] duplicate fact id across packs: ${f.id} — first-installed wins`); warned = true; }
        continue;
      }
      factById.set(f.id, f); packIdByFactId.set(f.id, id);
    }
    for (const e of pack.encounters) {
      for (const fid of e.fact_ids ?? []) {
        if (packIdByFactId.get(fid) !== id) continue; // encounters attach only to their own pack's facts
        const arr = encountersByFactId.get(fid) ?? [];
        arr.push(e); encountersByFactId.set(fid, arr);
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

/**
 * Source-spread pass. deps.dueOrder returns no numeric score, so the only
 * signal we have that ids are "tied" is a contiguous run of same-pack ids
 * in its output — contract: equal rank == contiguous run returned by
 * dueOrder. When 2+ packs' runs are adjacent like this, interleave them
 * round-robin instead of exhausting one pack's run before the next; which
 * pack goes first is decided by a seededShuffle of the installed pack ids,
 * so the rotation is deterministic per seed but not always install-order.
 */
function sourceSpread(ids: string[], index: DrawIndex, seed: number): string[] {
  const runs: { packId: string; ids: string[] }[] = [];
  for (const id of ids) {
    const packId = index.packIdByFactId.get(id)!;
    const last = runs[runs.length - 1];
    if (last?.packId === packId) last.ids.push(id);
    else runs.push({ packId, ids: [id] });
  }
  if (runs.length <= 1) return ids;
  const priority = seededShuffle(index.packIds, seed);
  const ordered = runs.slice().sort((a, b) => priority.indexOf(a.packId) - priority.indexOf(b.packId));
  const out: string[] = [];
  for (let col = 0; out.length < ids.length; col++) {
    for (const run of ordered) if (col < run.ids.length) out.push(run.ids[col]);
  }
  return out;
}

/**
 * Global schedule-first draw: eligibility- and kind-filtered, most-due-first,
 * with same-pack ties spread across sources, truncated to opts.count.
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
  ids = sourceSpread(ids, index, opts.seed);
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
