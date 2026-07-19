import { describe, it, expect } from 'vitest';
import {
  buildHamlet,
  boxHitsSolid,
  resolveMove,
  TILE,
  COLS,
  ROWS,
  WATER,
  type Grid,
} from '../worldmap';

describe('buildHamlet layout', () => {
  const map = buildHamlet();

  it('has the expected dimensions', () => {
    expect(map.tiles).toHaveLength(ROWS);
    expect(map.tiles[0]).toHaveLength(COLS);
    expect(map.solid).toHaveLength(ROWS);
  });

  it('spawns the Keeper on open ground', () => {
    const c = Math.floor(map.spawn.x / TILE);
    const r = Math.floor(map.spawn.y / TILE);
    expect(map.solid[r][c]).toBe(0);
  });

  it('marks the Wellspring pool as solid water', () => {
    let water = 0;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (map.tiles[r][c] === WATER) {
          water++;
          expect(map.solid[r][c]).toBe(1);
        }
    expect(water).toBe(4); // 2x2 pool
  });

  it('leaves every location approach tile walkable', () => {
    for (const loc of map.locations) {
      const c = Math.floor(loc.door.x / TILE);
      const r = Math.floor(loc.door.y / TILE);
      expect(map.solid[r][c]).toBe(0);
    }
  });

  it('rims the clearing with solid trees', () => {
    expect(map.solid[0][0]).toBe(1);
    expect(map.solid[ROWS - 1][COLS - 1]).toBe(1);
  });

  it('exposes all five locations', () => {
    expect(map.locations.map((l) => l.id).sort()).toEqual(
      ['cottage', 'gate', 'records', 'tavern', 'wellspring'].sort(),
    );
  });
});

describe('collision', () => {
  // 3x3: a wall down the middle column.
  const g: Grid = [
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
  ];
  const hw = 4;
  const hh = 4;

  it('treats out-of-bounds as solid', () => {
    expect(boxHitsSolid(g, -2, 8, hw, hh)).toBe(true);
  });

  it('detects an overlapping solid tile', () => {
    expect(boxHitsSolid(g, TILE * 1.5, TILE * 1.5, hw, hh)).toBe(true); // centre col = wall
  });

  it('passes through open space', () => {
    expect(boxHitsSolid(g, TILE * 0.5, TILE * 1.5, hw, hh)).toBe(false); // left col = open
  });

  it('blocks the blocked axis but slides along the other', () => {
    // Standing in the open left column, push right (into the wall) and down (open).
    const start = { x: TILE * 0.5, y: TILE * 0.5 };
    const out = resolveMove(g, start.x, start.y, 6, 6, hw, hh);
    expect(out.x).toBe(start.x); // x blocked by the wall column
    expect(out.y).toBe(start.y + 6); // y slides freely
  });
});
