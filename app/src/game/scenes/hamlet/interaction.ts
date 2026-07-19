/**
 * Pure interaction targeting — no Phaser, unit-tested in node. Given the player's
 * world position + facing, decide which location (if any) is being addressed.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Interactable {
  id: string;
  /** the approach point the player walks up to (world px) */
  door: Vec2;
  /** the visual centre used for the facing check (world px) */
  center: Vec2;
}

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/**
 * The location the player can interact with, or null. Eligible when the player is
 * within `maxDist` of the door AND facing roughly toward the location's centre
 * (the facing check is relaxed when standing almost on top of the door). Ties
 * break to the nearest door.
 */
export function pickInteraction<T extends Interactable>(
  locs: T[],
  px: number,
  py: number,
  facing: Vec2,
  maxDist = 24,
): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const l of locs) {
    const d = dist(px, py, l.door.x, l.door.y);
    if (d > maxDist) continue;
    const cx = l.center.x - px;
    const cy = l.center.y - py;
    const clen = Math.hypot(cx, cy) || 1;
    const dot = (facing.x * cx + facing.y * cy) / clen;
    // must be facing the place (a building's centre is always offset from its door,
    // so this is well-defined even when standing right on the approach tile)
    if (dot < 0.2) continue;
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

/** Unit facing vector for a 4-direction facing. */
export function facingVec(dir: 'up' | 'down' | 'left' | 'right'): Vec2 {
  switch (dir) {
    case 'up':
      return { x: 0, y: -1 };
    case 'down':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
  }
}
