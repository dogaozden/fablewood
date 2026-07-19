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
  /** suggested spawn tiles (guaranteed floor, non-overlapping) */
  partySpawns: Coord[];
  enemySpawns: Coord[];
}

export function tileCost(t: TileType): number {
  return t === 'gold' ? 2 : 1; // floor & lantern = 1; wall handled as blocking
}

export function isBlocking(t: TileType): boolean {
  return t === 'wall';
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

  const partySpawns: Coord[] = [];
  const enemySpawns: Coord[] = [];
  for (let i = 0; i < 3; i++) {
    const p = take(pick(interior, rng, (co) => spawnZone(co, true) && floorFree(co)));
    if (p) partySpawns.push(p);
    const e = take(pick(interior, rng, (co) => spawnZone(co, false) && floorFree(co)));
    if (e) enemySpawns.push(e);
  }

  return { tiles, lanterns, gold, partySpawns, enemySpawns };
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

/** Straight clear line-of-fire for a wraith (same row/col, within range, no walls). */
export function hasLineOfFire(from: Coord, to: Coord, range: number, tiles: TileGrid): boolean {
  if (from.c !== to.c && from.r !== to.r) return false;
  const dist = Math.abs(from.c - to.c) + Math.abs(from.r - to.r);
  if (dist === 0 || dist > range) return false;
  const stepC = Math.sign(to.c - from.c);
  const stepR = Math.sign(to.r - from.r);
  for (let i = 1; i < dist; i++) {
    if (isBlocking(tiles[from.r + stepR * i][from.c + stepC * i])) return false;
  }
  return true;
}
