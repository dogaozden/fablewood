// turnBudget.ts — Ch. VI spendable movement: move -> act -> move the remainder, per-tile spend.
// Pure model only: owns the TurnBudget state machine (spend/grant/lock transitions) and the
// Ch. VIII rise toll. The movement-VALUE arithmetic itself lives elsewhere — effectiveMove in
// status.ts, Careful Step's halving in ai.ts (carefulStepMove), Press On's bonus calc in
// CombatScene.ts (pressOn) — this module composes over whatever those hand it; it does not
// derive move values from unit stats on its own (Task 2 — the header used to claim broader
// ownership than the module actually has).

/** total = effectiveMove after stance/Press On math (turn start / recompute); left = remaining
 *  tiles-worth of cost. legSpent locks the Careful Step stance at the first committed leg;
 *  pressedOn ALSO locks it (fix round 1) — the grant priced the stance in ("+effectiveMove,
 *  halved under Careful Step"), so once Press On has fired, re-deriving total/left from a
 *  flipped stance would silently discard the pressed road (see stanceLocked); actionSpent + an
 *  empty budget together mean the turn is over (see turnExhausted). */
export interface TurnBudget {
  total: number;
  left: number;
  legSpent: boolean;
  actionSpent: boolean;
  pressedOn: boolean;
}

/** A fresh turn: the full move is available, nothing committed yet. */
export function mkTurnBudget(total: number): TurnBudget {
  return { total, left: total, legSpent: false, actionSpent: false, pressedOn: false };
}

/** One movement leg: spend the exact tile-cost, floor at 0 (never go into debt), lock legSpent —
 *  the Careful Step stance is fixed the instant any leg is committed. */
export function spendLeg(b: TurnBudget, cost: number): TurnBudget {
  return { ...b, left: Math.max(0, b.left - cost), legSpent: true };
}

/** The turn's one action (Strike/Cast/Satchel/Brace). Move-after-act law: acting never
 *  touches total/left — whatever movement is left remains spendable after. */
export function spendAction(b: TurnBudget): TurnBudget {
  return { ...b, actionSpent: true };
}

/** Press On ~= Dash: forgo the action for +effectiveMove. Grants the bonus to both total
 *  and left (extends the budget rather than just refilling it), spends the action slot, and
 *  locks the stance (fix round 1 — see stanceLocked/TurnBudget's own doc comment). */
export function grantPressOn(b: TurnBudget, bonus: number): TurnBudget {
  return { ...b, total: b.total + bonus, left: b.left + bonus, actionSpent: true, pressedOn: true };
}

/** The turn is over once the action is spent AND there's no movement left to spend. */
export function turnExhausted(b: TurnBudget): boolean {
  return b.actionSpent && b.left <= 0;
}

/** Fix round 1 — the Careful Step toggle's guard predicate, given a proper pure home: locked
 *  once a leg is spent (legSpent) OR once Press On has fired (pressedOn). Both callers
 *  (CombatScene's toggleCarefulStep and its keydown 'c' pre-check) call this rather than
 *  duplicating the OR — the bug this fix round closes was exactly two lock checks drifting out
 *  of sync (the old guard only knew about legSpent; Press On only ever set actionSpent). */
export function stanceLocked(b: TurnBudget): boolean {
  return b.legSpent || b.pressedOn;
}

/** Ch. VIII — the rise toll: a Toppled unit stands automatically at its own turn start, and
 *  that turn's movement base is halved (the house halving: floor, min 1 for a MOBILE unit —
 *  same shape as carefulStepMove, but a separate law) BEFORE anything else touches it. Zero-
 *  preserving (fix round, I1): the min-1 floor guards the halving of a nonzero base, it never
 *  resurrects a zero another law (e.g. Bound's effectiveMove) already made. Composition order
 *  is law: rise-toll first, stance second — CombatScene applies this to the raw effectiveMove
 *  once, at turn start, then Careful Step/Press On compose over the TOLLED result exactly as
 *  they would over any other base (Ch. VI's identity holds relative to it). */
export function tollRise(base: number): number {
  return base === 0 ? 0 : Math.max(1, Math.floor(base / 2));
}
