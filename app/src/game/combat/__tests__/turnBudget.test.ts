import { describe, it, expect } from 'vitest';
import { mkTurnBudget, spendLeg, spendAction, grantPressOn, turnExhausted } from '../turnBudget';
import { carefulStepMove } from '../ai';

describe('turnBudget (Ch. VI spendable movement: move -> act -> move the remainder)', () => {
  it('mkTurnBudget: fresh budget has left===total and nothing spent', () => {
    const b = mkTurnBudget(5);
    expect(b).toEqual({ total: 5, left: 5, legSpent: false, actionSpent: false });
  });

  it('spendLeg subtracts the exact cost and sets legSpent', () => {
    const b = spendLeg(mkTurnBudget(5), 2);
    expect(b.left).toBe(3);
    expect(b.legSpent).toBe(true);
  });

  it('spendLeg floors left at 0 when cost exceeds what remains', () => {
    const b = spendLeg(mkTurnBudget(3), 5);
    expect(b.left).toBe(0);
    expect(b.legSpent).toBe(true);
  });

  it('spendAction marks actionSpent but leaves movement intact (move-after-act law)', () => {
    const afterLeg = spendLeg(mkTurnBudget(5), 2); // left=3, legSpent=true
    const b = spendAction(afterLeg);
    expect(b.actionSpent).toBe(true);
    expect(b.left).toBe(3);
    expect(b.total).toBe(5);
    expect(b.legSpent).toBe(true);
  });

  it('grantPressOn adds the bonus to both total and left, and marks the action spent', () => {
    const b = grantPressOn(mkTurnBudget(5), 2);
    expect(b.total).toBe(7);
    expect(b.left).toBe(7);
    expect(b.actionSpent).toBe(true);
  });

  it('grantPressOn extends an already-partly-spent budget rather than refilling it', () => {
    const afterLeg = spendLeg(mkTurnBudget(5), 4); // left=1
    const b = grantPressOn(afterLeg, 2);
    expect(b.total).toBe(7);
    expect(b.left).toBe(3);
    expect(b.actionSpent).toBe(true);
  });

  it('turnExhausted is false when neither action spent nor movement depleted', () => {
    expect(turnExhausted(mkTurnBudget(5))).toBe(false);
  });

  it('turnExhausted is false when only the action is spent (movement remains)', () => {
    expect(turnExhausted(spendAction(mkTurnBudget(5)))).toBe(false);
  });

  it('turnExhausted is false when only movement is depleted (action unspent)', () => {
    expect(turnExhausted(spendLeg(mkTurnBudget(5), 5))).toBe(false);
  });

  it('turnExhausted is true once the action is spent AND left is 0', () => {
    const b = spendAction(spendLeg(mkTurnBudget(5), 5));
    expect(turnExhausted(b)).toBe(true);
  });

  it('every function returns a new object and leaves its input unchanged', () => {
    const fresh = mkTurnBudget(5);
    const snapshot = { ...fresh };
    spendLeg(fresh, 2);
    spendAction(fresh);
    grantPressOn(fresh, 1);
    expect(fresh).toEqual(snapshot);
  });
});

describe('Ch. VI compose law — Careful Step total + Press On bonus, ONE halving per grant', () => {
  // Task 3: CombatScene's Press On dispatch is `grantPressOn(this.budget, this.moveBudgetFor(u))`
  // — moveBudgetFor re-reads the CURRENT Careful Step stance and, when on, halves via
  // carefulStepMove exactly like the turn-start `mkTurnBudget(this.moveBudgetFor(u))` grant did.
  // "ONE halving" means each grant is halved independently and the two are then SUMMED — never
  // the other way around (summing the two un-halved bases first, then halving once).
  it('a Careful Step turn-start total and a same-stance Press On bonus are each halved independently, not re-normalized as a single halving of their combined base', () => {
    const base = 5; // odd — the two composition orders below only diverge for an odd base
    const turnStart = mkTurnBudget(carefulStepMove(base)); // turn start under Careful Step: floor(5/2)=2
    const withPressOn = grantPressOn(turnStart, carefulStepMove(base)); // Press On bonus: ALSO carefulStepMove(base)
    expect(turnStart.total).toBe(2);
    expect(withPressOn.total).toBe(4); // 2 + 2 — two independent single-halvings, summed
    // The anti-pattern this pins against: halving the COMBINED (doubled) base ONCE instead of
    // halving each grant on its own. For an odd base these genuinely disagree (4 vs 5) — proof
    // the composition must halve per-grant.
    expect(carefulStepMove(base + base)).toBe(5);
    expect(withPressOn.total).not.toBe(carefulStepMove(base + base));
  });

  it('Press On consumes the action and extends both total and left off whatever the budget already had (move-after-act law still holds under Careful Step)', () => {
    const base = 5;
    const afterLeg = spendLeg(mkTurnBudget(carefulStepMove(base)), 1); // total=2, left=1, legSpent=true
    const b = grantPressOn(afterLeg, carefulStepMove(base)); // +2 bonus
    expect(b.total).toBe(4);
    expect(b.left).toBe(3); // 1 remaining + 2 bonus, not refilled to the new total
    expect(b.actionSpent).toBe(true);
    expect(turnExhausted(b)).toBe(false); // action spent, but 3 tiles are still banked
  });
});
