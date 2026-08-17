/**
 * Enemy AI decision (pure). Move toward the nearest party member using the same
 * terrain-aware move field the player gets, then attack if a target is in range.
 * Melee closes to Manhattan 1; the wraith fires down a clear straight line ≤ its
 * range. v2 (§8) layers archetype directives onto the same scoring loop: wisps seek
 * flank-completing tiles, wraiths keep range and retreat via Careful Step when
 * adjacent, constructs lean toward guarding a wraith ally. Returns intent; the scene
 * animates and applies it.
 *
 * Ch. VIII adds the Bestiary's three: the lurker holds still while Unwritten and, once
 * written, takes the attack tile least exposed to the rest of the retinue; the husk hits
 * the NEAREST foe rather than the softest; the pall drifts to 2-3 tiles and stops touching
 * once one of its own daunts holds a living foe. All three read only from inputs this
 * function already receives — no new parameters, no board access.
 */
import { manhattan, key, type Coord, type Team, type UnitState } from './types';
import { computeMoveField, reachableTiles, hasLineOfFire, filterDauntedField, type TileGrid } from './grid';
import { isFlanked } from './damage';
import { hasStatus } from './status';

export interface AiIntent {
  moveTo: Coord | null;
  attackTargetId: string | null;
  /** §4.2 — this move resolves as a Careful Step: half move, provokes no opportunity strike */
  carefulStep: boolean;
}

/** §4.2 Careful Step math: half move, floor, minimum 1 for a MOBILE unit. Zero-preserving
 *  (fix round, I1 — tollRise's pre-existing sibling): the min-1 floor guards the halving of
 *  a nonzero base, it never resurrects a zero another law (e.g. Bound's effectiveMove)
 *  already made. */
export function carefulStepMove(baseMove: number): number {
  return baseMove === 0 ? 0 : Math.max(1, Math.floor(baseMove / 2));
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
  // Ch. VIII Task 4 — non-null only when `self` is actively Daunted by a still-living source
  // (the scene resolves that; this pure function just gets a coordinate or nothing). Filters
  // the move field BEFORE `options` is built, so no scoring branch below needs to know Daunted
  // exists at all — it only ever sees an already-legal candidate set. Optional with a null
  // default, same "every pre-existing call site keeps compiling" idiom as `allies` above.
  dauntedSourceCoord: Coord | null = null,
): AiIntent {
  const foes = party.filter((p) => p.alive);
  if (!foes.length) return { moveTo: null, attackTargetId: null, carefulStep: false };

  const canHit = (from: Coord): UnitState | null => {
    const inReach = foes.filter((f) =>
      self.ranged ? hasLineOfFire(from, f, self.range, tiles) : manhattan(from, f) <= self.range,
    );
    if (!inReach.length) return null;
    // Ch. VIII husk directive — "straight advance on the nearest": the Husk is a shape whose
    // name has been gnawed out, so it does not pick a victim, it hits whatever is closest.
    // Every other archetype prefers the target it can kill / the softest.
    if (self.kind === 'husk') return inReach.sort((a, b) => manhattan(from, a) - manhattan(from, b))[0];
    return inReach.sort((a, b) => a.hp - b.hp)[0];
  };

  // Ch. VIII lurker directive, part 1 — it holds while Unwritten. Not "stands and waits for a
  // better tile": no move AT ALL, because moving neither reveals it (only acting or taking
  // damage does) nor serves it — the whole entry is patience, and the ambush is the retinue's
  // own mistake. It opens exactly when a foe has closed into its reach from where it already
  // sits. Returning early also keeps it out of the scoring loop below, whose every branch
  // assumes a unit that wants to reposition.
  if (self.kind === 'lurker' && hasStatus(self.statuses, 'unwritten')) {
    const prey = canHit(self);
    return { moveTo: null, attackTargetId: prey ? prey.id : null, carefulStep: false };
  }

  // §8 wraith directive: already adjacent to a foe → Careful Step away rather than trade
  // blows — "keep range ≥2" is the headline; retreating takes priority over an in-place hit.
  const adjacentToFoe = foes.some((f) => manhattan(self, f) === 1);
  const wantsCarefulStep = self.kind === 'wraith' && adjacentToFoe;
  const moveBudget = wantsCarefulStep ? carefulStepMove(self.move) : self.move;

  // Ch. VIII pall directive — "keeps 2-3 tiles of distance once its daunt has landed, closing
  // only to renew it." Its own daunt is readable straight off the party it was already handed:
  // the status carries sourceId, so "my fear still holds someone" needs no new plumbing. While
  // that is true the Pall drifts and does NOT touch (the chapter's distance IS the behavior;
  // at range 1 it could not touch anyway, so suppressing the hit is what makes the band real —
  // the same shape as the wraith's retreat above, whose -1000 attack score would otherwise
  // swamp any positional penalty). When the daunted foe FALLS, no living foe carries its mark,
  // this flips false, and the Pall closes again — that is the whole of "closing only to renew".
  //
  // Unlike the wraith it withdraws at FULL move, not a Careful Step: at move 3 a Careful Step
  // is max(1, floor(3/2)) = 1, which a move-4 retinue re-closes trivially — the Pall would
  // never actually reach its band and would just stand there not attacking. Taking the
  // opportunity strike on the way out is the honest price of a shade disengaging.
  const dauntStands = self.kind === 'pall'
    && foes.some((f) => f.statuses.some((s) => s.id === 'daunted' && s.sourceId === self.id));

  // Already in range from where we stand? Hit without moving (skipped while retreating/drifting).
  const here = wantsCarefulStep || dauntStands ? null : canHit(self);
  if (here) return { moveTo: null, attackTargetId: here.id, carefulStep: false };

  const field = computeMoveField(self, moveBudget, tiles, occupied);
  const dauntedField = dauntedSourceCoord ? filterDauntedField(field, self, dauntedSourceCoord, tiles) : field;
  const options = [self, ...reachableTiles(dauntedField, self)];

  // Nearest foe by Manhattan (cheap, good enough on a 12×8 board).
  const nearest = foes.reduce((best, f) =>
    distToUnit(self, f) < distToUnit(self, best) ? f : best, foes[0]);

  let bestTile: Coord = self;
  let bestScore = Infinity;
  let attackFrom: string | null = null;

  for (const tile of options) {
    const hit = wantsCarefulStep || dauntStands ? null : canHit(tile); // careful-step/drift never attacks
    const approach = manhattan(tile, nearest);
    let score = (hit ? -1000 : 0) + approach;

    if (self.kind === 'wisp' && hit && isFlanked(tile, hit, self.team, allies)) {
      score -= 2; // §8: wisps seek flank tiles among attack-reachable tiles
    }
    // Ch. VIII lurker directive, part 2 — once written, it "prefers flank-adjacent positions".
    // Read as a POSITION preference, and deliberately NOT via isFlanked/`allies` the way the
    // wisp's is: `allies` is empty at the real call site (CombatScene passes []), so that branch
    // is dead code in actual play and copying it would buy nothing. The live meaning for a
    // 2-HP skirmisher that "strikes and relocates" is to come in at the EDGE of the retinue
    // rather than its middle — among the tiles it can strike from, take the one that puts it in
    // reach of as few OTHER party members as possible. That is flanking as the board can
    // actually express it, and it is the difference between a Lurker that trades itself for one
    // hit and one that keeps stabbing.
    if (self.kind === 'lurker' && hit) {
      const exposure = foes.filter((f) => f.id !== hit.id && manhattan(tile, f) <= 1).length;
      score += exposure * 3;
    }
    if (dauntStands) {
      // 2-3 tiles, per the chapter. Hugging is the thing it must not do (a heavy penalty, the
      // wraith's own idiom); drifting too far only costs it the chance to renew, so it eases
      // back gently rather than fleeing the board.
      const d = manhattan(tile, nearest);
      if (d < 2) score += 40;
      else if (d > 3) score += (d - 3) * 2;
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
