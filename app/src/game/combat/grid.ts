/**
 * Grid model + movement. Pure (no Phaser) so it is unit-testable in the node
 * vitest env. 4-connected board; terrain costs per slice-blueprint §3
 * (floor 1, gold-heap 2, wall blocks). Occupied tiles block traversal.
 */
import { GRID_W, GRID_H, DIRS, key, inBounds, type TileType, type Coord, type Dir } from './types';
import { mulberry32, layoutSeed } from './rng';

export type TileGrid = TileType[][]; // [r][c]

export interface Layout {
  tiles: TileGrid;
  lanterns: Coord[];
  gold: Coord[];
  /** §4.4 — unlit lanterns; a party unit adjacent may light one (free interact, +1 Glow) */
  braziers: Coord[];
  /** §4.4 — 0 or 2 contiguous interior tiles; blocks line-of-fire and Ritecraft lines */
  mist: Coord[];
  /** suggested spawn tiles (guaranteed floor, non-overlapping) */
  partySpawns: Coord[];
  enemySpawns: Coord[];
}

export function tileCost(t: TileType): number {
  return t === 'gold' ? 2 : 1; // floor, lantern, brazier & mist = 1; wall handled as blocking
}

export function isBlocking(t: TileType): boolean {
  return t === 'wall';
}

/** §4.4 — wall AND mist block sight (wraith LoF, hasLineOfFire below) and Ritecraft lines. */
export function blocksSight(t: TileType): boolean {
  return t === 'wall' || t === 'mist';
}

/**
 * Seeded terrain for a room. Border walls, 2–4 gold heaps (difficult), 1–2
 * lanterns (answer-grace), rest floor. Party spawns bottom-left, enemies
 * top-right, both on guaranteed floor.
 */
export function buildLayout(roomId: string, seed: number): Layout {
  const rng = mulberry32(layoutSeed(roomId, seed));
  const tiles: TileGrid = [];
  for (let r = 0; r < GRID_H; r++) {
    const row: TileType[] = [];
    for (let c = 0; c < GRID_W; c++) {
      const border = c === 0 || r === 0 || c === GRID_W - 1 || r === GRID_H - 1;
      row.push(border ? 'wall' : 'floor');
    }
    tiles.push(row);
  }

  // Interior playfield is c:1..10, r:1..6.
  const interior: Coord[] = [];
  for (let r = 1; r < GRID_H - 1; r++) for (let c = 1; c < GRID_W - 1; c++) interior.push({ c, r });

  const spawnZone = (co: Coord, party: boolean) => (party ? co.c <= 3 : co.c >= GRID_W - 4);
  const reserved = new Set<string>();

  const gold: Coord[] = [];
  const goldN = 2 + Math.floor(rng() * 3); // 2..4
  for (let i = 0; i < goldN; i++) {
    const cand = pick(interior, rng, (co) => !reserved.has(key(co.c, co.r)) && !spawnZone(co, true) && !spawnZone(co, false));
    if (cand) { tiles[cand.r][cand.c] = 'gold'; gold.push(cand); reserved.add(key(cand.c, cand.r)); }
  }

  const lanterns: Coord[] = [];
  const lanternN = 1 + Math.floor(rng() * 2); // 1..2
  for (let i = 0; i < lanternN; i++) {
    const cand = pick(interior, rng, (co) => !reserved.has(key(co.c, co.r)));
    if (cand) { tiles[cand.r][cand.c] = 'lantern'; lanterns.push(cand); reserved.add(key(cand.c, cand.r)); }
  }

  const floorFree = (co: Coord) => tiles[co.r][co.c] === 'floor' && !reserved.has(key(co.c, co.r));
  const take = (co: Coord | null) => { if (co) reserved.add(key(co.c, co.r)); return co; };

  // §4.4 — braziers 0-1, never in spawn zones, placed only on still-floor tiles (lanterns
  // above are already reserved, so they can never be displaced by this step).
  const braziers: Coord[] = [];
  const brazierN = Math.floor(rng() * 2); // 0..1
  for (let i = 0; i < brazierN; i++) {
    const cand = pick(interior, rng, (co) => floorFree(co) && !spawnZone(co, true) && !spawnZone(co, false));
    if (cand) { tiles[cand.r][cand.c] = 'brazier'; braziers.push(cand); reserved.add(key(cand.c, cand.r)); }
  }

  // §4.4 — mist: 0-1 patch of 2 contiguous interior tiles, never in spawn zones. Best-effort:
  // if no contiguous pair is free this seed, the patch is simply absent (0 is a valid count).
  const mist: Coord[] = [];
  const mistPatchN = Math.floor(rng() * 2); // 0..1
  for (let i = 0; i < mistPatchN; i++) {
    let pool = interior.filter((co) => floorFree(co) && !spawnZone(co, true) && !spawnZone(co, false));
    let placed = false;
    while (pool.length && !placed) {
      const idx = Math.floor(rng() * pool.length);
      const t0 = pool[idx];
      pool = pool.filter((_, j) => j !== idx);
      const neighbors = Object.values(DIRS)
        .map((d) => ({ c: t0.c + d.c, r: t0.r + d.r }))
        .filter((co) => floorFree(co) && !spawnZone(co, true) && !spawnZone(co, false));
      if (neighbors.length) {
        const n = neighbors[Math.floor(rng() * neighbors.length)];
        tiles[t0.r][t0.c] = 'mist';
        tiles[n.r][n.c] = 'mist';
        mist.push(t0, n);
        reserved.add(key(t0.c, t0.r));
        reserved.add(key(n.c, n.r));
        placed = true;
      }
    }
  }

  const partySpawns: Coord[] = [];
  const enemySpawns: Coord[] = [];
  for (let i = 0; i < 3; i++) {
    const p = take(pick(interior, rng, (co) => spawnZone(co, true) && floorFree(co)));
    if (p) partySpawns.push(p);
    const e = take(pick(interior, rng, (co) => spawnZone(co, false) && floorFree(co)));
    if (e) enemySpawns.push(e);
  }

  return { tiles, lanterns, gold, braziers, mist, partySpawns, enemySpawns };
}

function pick(pool: Coord[], rng: () => number, ok: (c: Coord) => boolean): Coord | null {
  const cands = pool.filter(ok);
  if (!cands.length) return null;
  return cands[Math.floor(rng() * cands.length)];
}

export interface MoveField {
  cost: Map<string, number>;
  prev: Map<string, string | null>;
}

/**
 * Dijkstra move field from `start` up to `maxMove` points. `blocked` = tiles
 * occupied by OTHER living units (cannot pass through or stop on). Terrain walls
 * block. Returns every reachable tile (incl. start at cost 0).
 */
export function computeMoveField(
  start: Coord,
  maxMove: number,
  tiles: TileGrid,
  blocked: Set<string>,
): MoveField {
  const h = tiles.length;
  const w = tiles[0]?.length ?? 0;
  const cost = new Map<string, number>([[key(start.c, start.r), 0]]);
  const prev = new Map<string, string | null>([[key(start.c, start.r), null]]);
  // Small board + integer costs → a sorted frontier is plenty.
  const frontier: Array<{ c: number; r: number; cost: number }> = [{ ...start, cost: 0 }];

  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const cur = frontier.shift()!;
    const curKey = key(cur.c, cur.r);
    if (cur.cost > (cost.get(curKey) ?? Infinity)) continue;

    for (const d of Object.values(DIRS)) {
      const nc = cur.c + d.c;
      const nr = cur.r + d.r;
      if (nc < 0 || nc >= w || nr < 0 || nr >= h) continue;
      const t = tiles[nr][nc];
      if (isBlocking(t)) continue;
      const nKey = key(nc, nr);
      if (blocked.has(nKey)) continue;
      const nCost = cur.cost + tileCost(t);
      if (nCost > maxMove) continue;
      if (nCost < (cost.get(nKey) ?? Infinity)) {
        cost.set(nKey, nCost);
        prev.set(nKey, curKey);
        frontier.push({ c: nc, r: nr, cost: nCost });
      }
    }
  }
  return { cost, prev };
}

/**
 * Ch. VIII Daunted — filters a move field down to tiles whose path distance to `source` is
 * >= `start`'s own path distance to `source` (equal/farther kept, closer excluded), per the
 * chapter's "cannot willingly END a move closer... than it began." Runs a second, budget-
 * unbounded Dijkstra from `source` (ignoring live-unit occupancy — this measures dungeon
 * geometry, not who happens to be standing where this instant) to score every tile, then
 * drops any `field` entry that scores closer than `start`.
 *
 * Only `cost` is filtered — `prev` is carried over UNTOUCHED. `pathTo` only consults `cost`
 * for its TARGET tile (the thing being validated as a legal place to stop); it walks `prev`
 * freely for everything in between. So a kept, farther tile reachable only by passing through
 * an excluded, closer one still paths correctly — the law forbids ENDING closer, not crossing
 * through a closer tile en route.
 *
 * Applying this is entirely the caller's call: skip it whenever the mover isn't actively
 * Daunted by a living source (CombatScene's dauntedSourceCoord decides that, since it needs
 * board access this pure function doesn't have). Forced movement (pushUnit/forceMove) never
 * calls this at all — it bypasses by construction, not by any check here.
 */
export function filterDauntedField(field: MoveField, start: Coord, source: Coord, tiles: TileGrid): MoveField {
  const h = tiles.length;
  const w = tiles[0]?.length ?? 0;
  const sourceField = computeMoveField(source, w * h, tiles, new Set());
  const startDist = sourceField.cost.get(key(start.c, start.r));
  if (startDist === undefined) return { cost: new Map(field.cost), prev: new Map(field.prev) };

  const cost = new Map<string, number>();
  for (const [k, c] of field.cost) {
    const dist = sourceField.cost.get(k);
    if (dist !== undefined && dist < startDist) continue; // closer to source than start — excluded
    cost.set(k, c);
  }
  return { cost, prev: new Map(field.prev) };
}

/** Reachable tiles (excludes the start tile itself). */
export function reachableTiles(field: MoveField, start: Coord): Coord[] {
  const out: Coord[] = [];
  for (const k of field.cost.keys()) {
    if (k === key(start.c, start.r)) continue;
    const [c, r] = k.split(',').map(Number);
    out.push({ c, r });
  }
  return out;
}

/** Reconstruct the path start→target (inclusive of both) or null if unreachable. */
export function pathTo(field: MoveField, target: Coord): Coord[] | null {
  const tKey = key(target.c, target.r);
  if (!field.cost.has(tKey)) return null;
  const path: Coord[] = [];
  let cur: string | null = tKey;
  while (cur) {
    const [c, r] = cur.split(',').map(Number);
    path.unshift({ c, r });
    cur = field.prev.get(cur) ?? null;
  }
  return path;
}

/** The 4 orthogonal neighbours + centre — Binding Weave's cross. */
export function crossTiles(center: Coord): Coord[] {
  const out = [center];
  for (const d of Object.values(DIRS)) out.push({ c: center.c + d.c, r: center.r + d.r });
  return out.filter((co) => inBounds(co.c, co.r));
}

/** Tiles 1..depth from `origin` along `dir` — Ritual Sequence's lance. */
export function lineTiles(origin: Coord, dir: Dir, depth: number): Coord[] {
  const d = DIRS[dir];
  const out: Coord[] = [];
  for (let i = 1; i <= depth; i++) {
    const co = { c: origin.c + d.c * i, r: origin.r + d.r * i };
    if (!inBounds(co.c, co.r)) break;
    out.push(co);
  }
  return out;
}

/** Straight clear line-of-fire for a wraith (same row/col, within range, no walls/mist). */
export function hasLineOfFire(from: Coord, to: Coord, range: number, tiles: TileGrid): boolean {
  if (from.c !== to.c && from.r !== to.r) return false;
  const dist = Math.abs(from.c - to.c) + Math.abs(from.r - to.r);
  if (dist === 0 || dist > range) return false;
  const stepC = Math.sign(to.c - from.c);
  const stepR = Math.sign(to.r - from.r);
  for (let i = 1; i < dist; i++) {
    if (blocksSight(tiles[from.r + stepR * i][from.c + stepC * i])) return false;
  }
  return true;
}

export interface ForceMoveBoard {
  tiles: TileGrid;
  /** keys of every OTHER living unit (excludes the unit being pushed/pulled) */
  occupied: Set<string>;
}

export interface ForceMoveResult {
  moved: boolean;
  /** true when the mover stayed put and should take +1 bump damage */
  bump: boolean;
  /** destination if moved, else the unchanged original position */
  to: Coord;
}

/**
 * §4.3 forced movement: one tile along `dir`. In-bounds + non-wall + unoccupied → moves
 * (terrain entered normally). Otherwise stays and bumps (+1 dmg — the caller applies it via
 * computeHit). No domino: an occupied destination is a bump, never a chain push.
 *
 * Direction-agnostic on purpose: pass the away-from-caster Dir for a push, the
 * toward-caster Dir for a (future) pull — the resolution rules are identical either way,
 * so no separate pull implementation is needed when that spell arrives.
 */
export function forceMove(pos: Coord, dir: Dir, board: ForceMoveBoard): ForceMoveResult {
  const d = DIRS[dir];
  const to: Coord = { c: pos.c + d.c, r: pos.r + d.r };
  if (!inBounds(to.c, to.r)) return { moved: false, bump: true, to: pos };
  if (isBlocking(board.tiles[to.r][to.c])) return { moved: false, bump: true, to: pos };
  if (board.occupied.has(key(to.c, to.r))) return { moved: false, bump: true, to: pos };
  return { moved: true, bump: false, to };
}
