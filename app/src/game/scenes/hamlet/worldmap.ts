/**
 * The Fablewood clearing — pure geometry, no Phaser, so the layout and collision
 * grid unit-test in node. `buildHamlet()` returns the terrain, a solid grid, the
 * prop list to render, lantern glow points, the five interactable locations, and
 * the spawn point. The scene turns this data into sprites.
 */

export const TILE = 16;
export const COLS = 22;
export const ROWS = 14;
export const WORLD_W = COLS * TILE; // 352
export const WORLD_H = ROWS * TILE; // 224

export const GRASS = 0;
export const PATH = 1;
export const WATER = 2;

export type Grid = number[][];
export type LocationId = 'cottage' | 'tavern' | 'records' | 'wellspring' | 'gate' | 'factor';

export interface PropSpec {
  key: string;
  /** draw position, world px */
  x: number;
  y: number;
  /** draw origin (default bottom-centre) */
  ox: number;
  oy: number;
}

export interface LocationSpec {
  id: LocationId;
  name: string;
  /** verb shown in the prompt, e.g. "talk to Berry" */
  prompt: string;
  /** approach point the player walks to (world px) */
  door: { x: number; y: number };
  /** building centre, for the facing check (world px) */
  center: { x: number; y: number };
  /** where the floating name label sits (world px, above the building) */
  label: { x: number; y: number };
}

export interface HamletMap {
  tiles: Grid;
  solid: Grid;
  props: PropSpec[];
  lanterns: { x: number; y: number }[];
  locations: LocationSpec[];
  spawn: { x: number; y: number };
}

const tc = (col: number, row: number) => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });

function makeGrid(fill: number): Grid {
  return Array.from({ length: ROWS }, () => Array<number>(COLS).fill(fill));
}

function carveH(t: Grid, row: number, c0: number, c1: number, code = PATH): void {
  for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) {
    if (t[row]?.[c] !== undefined && t[row][c] !== WATER) t[row][c] = code;
  }
}
function carveV(t: Grid, col: number, r0: number, r1: number, code = PATH): void {
  for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
    if (t[r]?.[col] !== undefined && t[r][col] !== WATER) t[r][col] = code;
  }
}
function fillRect(t: Grid, c0: number, r0: number, c1: number, r1: number, code: number): void {
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (t[r]?.[c] !== undefined) t[r][c] = code;
}

interface Building {
  id: LocationId;
  name: string;
  prompt: string;
  key: string;
  c0: number;
  r0: number;
  w: number;
  h: number;
  /** approach tile (col,row) the player stands on to interact */
  door: [number, number];
}

const BUILDINGS: Building[] = [
  { id: 'cottage', name: "Keeper's Cottage", prompt: 'rest & save', key: 'prop.cottage', c0: 3, r0: 2, w: 3, h: 2, door: [4, 4] },
  { id: 'tavern', name: 'The Gilded Acorn', prompt: 'talk to Berry', key: 'prop.tavern', c0: 15, r0: 2, w: 3, h: 2, door: [16, 4] },
  { id: 'records', name: 'The Records Office', prompt: 'consult the Clerk', key: 'prop.records-office', c0: 2, r0: 9, w: 3, h: 2, door: [3, 11] },
  { id: 'gate', name: 'The South Gate', prompt: 'set out', key: 'prop.south-gate', c0: 14, r0: 10, w: 3, h: 2, door: [15, 12] },
];

/** Build the whole clearing. Deterministic — same layout every call. */
export function buildHamlet(): HamletMap {
  const tiles = makeGrid(GRASS);

  // Plaza around the Wellspring: a 4x4 path pad with a 2x2 pool in the middle.
  fillRect(tiles, 9, 5, 12, 8, PATH);
  fillRect(tiles, 10, 6, 11, 7, WATER);

  // "Main street" across the top fronting the cottage and tavern, dropping into the plaza.
  carveH(tiles, 4, 4, 16);
  carveV(tiles, 10, 4, 5);
  carveV(tiles, 11, 4, 5);

  // Records Office spur (routed clear of its own footprint).
  carveH(tiles, 11, 3, 9);
  carveV(tiles, 9, 8, 11);

  // South Gate road (the way out of the clearing).
  carveH(tiles, 12, 11, 15);
  carveV(tiles, 11, 8, 12);

  const props: PropSpec[] = [];
  const solid = makeGrid(0);

  // Water is solid.
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (tiles[r][c] === WATER) solid[r][c] = 1;

  // Buildings: footprint solid, drawn from bottom-centre so roofs overhang upward.
  const locations: LocationSpec[] = [];
  for (const b of BUILDINGS) {
    fillRect(solid, b.c0, b.r0, b.c0 + b.w - 1, b.r0 + b.h - 1, 1);
    const bx = (b.c0 + b.w / 2) * TILE;
    const bottom = (b.r0 + b.h) * TILE;
    props.push({ key: b.key, x: bx, y: bottom, ox: 0.5, oy: 1 });
    locations.push({
      id: b.id,
      name: b.name,
      prompt: b.prompt,
      door: tc(b.door[0], b.door[1]),
      center: { x: bx, y: (b.r0 + b.h / 2) * TILE },
      label: { x: bx, y: b.r0 * TILE - 4 },
    });
  }

  // The Wellspring pool sits in the plaza centre (drawn centred, over the water tiles).
  const wellX = 11 * TILE;
  const wellY = 7 * TILE;
  props.push({ key: 'prop.wellspring', x: wellX, y: wellY, ox: 0.5, oy: 0.5 });
  locations.push({
    id: 'wellspring',
    name: 'The Wellspring',
    prompt: 'draw a bounty',
    door: tc(10, 8),
    center: { x: wellX, y: wellY },
    label: { x: wellX, y: 5 * TILE - 4 },
  });

  // Trees: a solid ring around the clearing, plus a few inner clusters. Only ever
  // placed on open grass, so paths/buildings/water are never blocked.
  const tree = (c: number, r: number) => {
    if (tiles[r]?.[c] !== GRASS || solid[r][c]) return;
    solid[r][c] = 1;
    props.push({ key: 'prop.tree', x: c * TILE + TILE / 2, y: (r + 1) * TILE, ox: 0.5, oy: 1 });
  };
  for (let c = 0; c < COLS; c++) {
    tree(c, 0);
    tree(c, ROWS - 1);
  }
  for (let r = 1; r < ROWS - 1; r++) {
    tree(0, r);
    tree(COLS - 1, r);
  }
  for (const [c, r] of [
    [7, 2], [8, 2], [7, 6], [13, 2], [19, 3], [18, 7], [19, 7], [6, 6], [6, 7], [13, 10], [7, 10], [19, 11],
  ] as const)
    tree(c, r);

  // Mira the Factor (inventory-handoff §9): no building of her own — she is her
  // existing char.mira NPC sprite (placed via HamletScene.buildNpcs), standing in
  // open grass east of the plaza. This location entry is just her interaction
  // zone (door/center/label), appended the same way the Wellspring is above:
  // no BUILDINGS entry, no prop art, no solid footprint.
  locations.push({
    id: 'factor',
    name: 'Mira the Factor',
    prompt: 'Browse wares',
    door: tc(18, 9),
    center: { x: 18 * TILE + TILE / 2, y: 8 * TILE + TILE / 2 },
    label: { x: 18 * TILE + TILE / 2, y: 8 * TILE - 12 },
  });

  // Lantern posts (decorative, non-solid): warm pools of light along the paths.
  const lanternTiles: [number, number][] = [
    [8, 5], [13, 5], [8, 8], [13, 8], [5, 11], [12, 11], [16, 12],
  ];
  const lanterns: { x: number; y: number }[] = [];
  for (const [c, r] of lanternTiles) {
    const x = c * TILE + TILE / 2;
    const y = (r + 1) * TILE;
    props.push({ key: 'prop.lantern-post', x, y, ox: 0.5, oy: 1 });
    lanterns.push({ x, y: y - 14 }); // glow at the lamp, near the top of the post
  }
  // Warm glow spilling from the tavern windows + the wellspring shimmer.
  lanterns.push({ x: 16 * TILE + 8, y: 2.4 * TILE }, { x: wellX, y: wellY });

  return { tiles, solid, props, lanterns, locations, spawn: { x: 176, y: 152 } };
}

// ------------------------------------------------------------- collision helpers

/** Does the AABB centred at (cx,cy) with half-extents (hw,hh) touch any solid tile? */
export function boxHitsSolid(solid: Grid, cx: number, cy: number, hw: number, hh: number): boolean {
  const xs = [cx - hw, cx + hw];
  const ys = [cy - hh, cy + hh];
  for (const x of xs)
    for (const y of ys) {
      const c = Math.floor(x / TILE);
      const r = Math.floor(y / TILE);
      if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return true;
      if (solid[r][c]) return true;
    }
  return false;
}

/**
 * Move (x,y) by (dx,dy) against the solid grid, resolving each axis separately so
 * the player slides along walls instead of snagging on corners.
 */
export function resolveMove(
  solid: Grid,
  x: number,
  y: number,
  dx: number,
  dy: number,
  hw: number,
  hh: number,
): { x: number; y: number } {
  let nx = x;
  let ny = y;
  if (dx !== 0 && !boxHitsSolid(solid, x + dx, y, hw, hh)) nx = x + dx;
  if (dy !== 0 && !boxHitsSolid(solid, nx, y + dy, hw, hh)) ny = y + dy;
  return { x: nx, y: ny };
}
