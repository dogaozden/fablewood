// turnBudget.ts — Ch. VI spendable movement: move -> act -> move the remainder, per-tile spend.
// Pure model only: CombatScene (Tasks 2-3) drives it, this module owns the arithmetic and the two flags.

/** total = effectiveMove after stance/Press On math (turn start / recompute); left = remaining
 *  tiles-worth of cost. legSpent locks the Careful Step stance at the first committed leg;
 *  actionSpent + an empty budget together mean the turn is over (see turnExhausted). */
export interface TurnBudget {
  total: number;
  left: number;
  legSpent: boolean;
  actionSpent: boolean;
}

/** A fresh turn: the full move is available, nothing committed yet. */
export function mkTurnBudget(total: number): TurnBudget {
  return { total, left: total, legSpent: false, actionSpent: false };
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
 *  and left (extends the budget rather than just refilling it) and spends the action slot. */
export function grantPressOn(b: TurnBudget, bonus: number): TurnBudget {
  return { ...b, total: b.total + bonus, left: b.left + bonus, actionSpent: true };
}

/** The turn is over once the action is spent AND there's no movement left to spend. */
export function turnExhausted(b: TurnBudget): boolean {
  return b.actionSpent && b.left <= 0;
}
