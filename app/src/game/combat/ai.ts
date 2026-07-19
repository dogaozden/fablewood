/**
 * Enemy AI decision (pure). Move toward the nearest party member using the same
 * terrain-aware move field the player gets, then attack if a target is in range.
 * Melee closes to Manhattan 1; the wraith fires down a clear straight line ≤ its
 * range. Returns intent; the scene animates and applies it.
 */
import { manhattan, key, type Coord, type UnitState } from './types';
import { computeMoveField, reachableTiles, hasLineOfFire, type TileGrid } from './grid';

export interface AiIntent {
  moveTo: Coord | null;
  attackTargetId: string | null;
}

export function decideEnemy(
  self: UnitState,
  party: UnitState[],
  tiles: TileGrid,
  occupied: Set<string>, // keys of every OTHER living unit
): AiIntent {
  const foes = party.filter((p) => p.alive);
  if (!foes.length) return { moveTo: null, attackTargetId: null };

  const canHit = (from: Coord): UnitState | null => {
    const inReach = foes.filter((f) =>
      self.ranged ? hasLineOfFire(from, f, self.range, tiles) : manhattan(from, f) <= self.range,
    );
    if (!inReach.length) return null;
    // prefer the target we can kill / the softest
    return inReach.sort((a, b) => a.hp - b.hp)[0];
  };

  // Already in range from where we stand? Hit without moving.
  const here = canHit(self);
  if (here) return { moveTo: null, attackTargetId: here.id };

  const field = computeMoveField(self, self.move, tiles, occupied);
  const options = [self, ...reachableTiles(field, self)];

  // Nearest foe by Manhattan (cheap, good enough on a 12×8 board).
  const nearest = foes.reduce((best, f) =>
    distToUnit(self, f) < distToUnit(self, best) ? f : best, foes[0]);

  let bestTile: Coord = self;
  let bestScore = Infinity;
  let attackFrom: string | null = null;

  for (const tile of options) {
    const hit = canHit(tile);
    // Score: reaching an attack tile beats pure approach; then minimise distance.
    const approach = manhattan(tile, nearest);
    const score = (hit ? -1000 : 0) + approach;
    if (score < bestScore) {
      bestScore = score;
      bestTile = tile;
      attackFrom = hit ? hit.id : null;
    }
  }

  const moved = bestTile.c !== self.c || bestTile.r !== self.r;
  return { moveTo: moved ? bestTile : null, attackTargetId: attackFrom };
}

function distToUnit(a: Coord, b: Coord): number {
  return manhattan(a, b);
}

/** Helper for the scene: occupancy set excluding one unit id. */
export function occupancyExcept(units: UnitState[], exceptId: string): Set<string> {
  const s = new Set<string>();
  for (const u of units) if (u.alive && u.id !== exceptId) s.add(key(u.c, u.r));
  return s;
}
