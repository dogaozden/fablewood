/**
 * Enemy AI decision (pure). Move toward the nearest party member using the same
 * terrain-aware move field the player gets, then attack if a target is in range.
 * Melee closes to Manhattan 1; the wraith fires down a clear straight line ≤ its
 * range. v2 (§8) layers archetype directives onto the same scoring loop: wisps seek
 * flank-completing tiles, wraiths keep range and retreat via Careful Step when
 * adjacent, constructs lean toward guarding a wraith ally. Returns intent; the scene
 * animates and applies it.
 */
import { manhattan, key, type Coord, type Team, type UnitState } from './types';
import { computeMoveField, reachableTiles, hasLineOfFire, type TileGrid } from './grid';
import { isFlanked } from './damage';
import { hasStatus } from './status';

export interface AiIntent {
  moveTo: Coord | null;
  attackTargetId: string | null;
  /** §4.2 — this move resolves as a Careful Step: half move, provokes no opportunity strike */
  carefulStep: boolean;
}

/** §4.2 Careful Step math: half move, floor, minimum 1. */
export function carefulStepMove(baseMove: number): number {
  return Math.max(1, Math.floor(baseMove / 2));
}

/**
 * §4.2 opportunity-strike eligibility: units on the OTHER team, alive, orthogonally
 * adjacent to the tile a mover just vacated, not Staggered, and haven't dealt one yet
 * this round (oaSpent). The scene calls this once per tile a mover's path vacates and
 * applies 1 flat (flank-eligible, via computeHit) damage from each returned unit,
 * marking oaSpent afterward. Pushes never call this (the mover didn't choose to move).
 *
 * Ch. VIII — `midRiseIds` extends the same "latch disabled" idiom to a unit mid-rise from
 * Toppled: unlike Staggered, Toppled carries no duration to check via hasStatus (it's
 * consumed by the rise), so the scene tracks it as a separate turn-scoped id set instead and
 * threads it in here. Optional with an empty default so every pre-existing call site (every
 * caller before Ch. VIII) keeps compiling and behaving identically without passing it.
 */
export function opportunityStrikers(
  vacatedTile: Coord,
  moverTeam: Team,
  units: UnitState[],
  midRiseIds: ReadonlySet<string> = new Set(),
): UnitState[] {
  return units.filter((u) =>
    u.alive && u.team !== moverTeam && !u.oaSpent &&
    !hasStatus(u.statuses, 'staggered') && !midRiseIds.has(u.id) &&
    manhattan(vacatedTile, u) === 1,
  );
}

export function decideEnemy(
  self: UnitState,
  party: UnitState[],
  tiles: TileGrid,
  occupied: Set<string>, // keys of every OTHER living unit
  allies: UnitState[] = [], // other living units on self's team — flank/interpose directives (§8)
): AiIntent {
  const foes = party.filter((p) => p.alive);
  if (!foes.length) return { moveTo: null, attackTargetId: null, carefulStep: false };

  const canHit = (from: Coord): UnitState | null => {
    const inReach = foes.filter((f) =>
      self.ranged ? hasLineOfFire(from, f, self.range, tiles) : manhattan(from, f) <= self.range,
    );
    if (!inReach.length) return null;
    // prefer the target we can kill / the softest
    return inReach.sort((a, b) => a.hp - b.hp)[0];
  };

  // §8 wraith directive: already adjacent to a foe → Careful Step away rather than trade
  // blows — "keep range ≥2" is the headline; retreating takes priority over an in-place hit.
  const adjacentToFoe = foes.some((f) => manhattan(self, f) === 1);
  const wantsCarefulStep = self.kind === 'wraith' && adjacentToFoe;
  const moveBudget = wantsCarefulStep ? carefulStepMove(self.move) : self.move;

  // Already in range from where we stand? Hit without moving (skipped while retreating).
  const here = wantsCarefulStep ? null : canHit(self);
  if (here) return { moveTo: null, attackTargetId: here.id, carefulStep: false };

  const field = computeMoveField(self, moveBudget, tiles, occupied);
  const options = [self, ...reachableTiles(field, self)];

  // Nearest foe by Manhattan (cheap, good enough on a 12×8 board).
  const nearest = foes.reduce((best, f) =>
    distToUnit(self, f) < distToUnit(self, best) ? f : best, foes[0]);

  let bestTile: Coord = self;
  let bestScore = Infinity;
  let attackFrom: string | null = null;

  for (const tile of options) {
    const hit = wantsCarefulStep ? null : canHit(tile); // careful-step never attacks
    const approach = manhattan(tile, nearest);
    let score = (hit ? -1000 : 0) + approach;

    if (self.kind === 'wisp' && hit && isFlanked(tile, hit, self.team, allies)) {
      score -= 2; // §8: wisps seek flank tiles among attack-reachable tiles
    }
    if (self.kind === 'wraith') {
      const staysAdjacent = foes.some((f) => manhattan(tile, f) === 1);
      if (staysAdjacent) score += 50; // never end adjacent if avoidable
      const keepsLoF = foes.some((f) => hasLineOfFire(tile, f, self.range, tiles));
      if (keepsLoF) score -= 3; // prefer tiles with clear (mist-aware) LoF
    }
    if (self.kind === 'construct') {
      const wraithAlly = allies.find((a) => a.alive && a.kind === 'wraith');
      if (wraithAlly && manhattan(tile, wraithAlly) <= 1) score -= 2; // guard/interpose
    }

    if (score < bestScore) {
      bestScore = score;
      bestTile = tile;
      attackFrom = hit ? hit.id : null;
    }
  }

  const moved = bestTile.c !== self.c || bestTile.r !== self.r;
  return {
    moveTo: moved ? bestTile : null,
    attackTargetId: attackFrom,
    carefulStep: wantsCarefulStep && moved,
  };
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
