import { describe, it, expect } from 'vitest';
import { mkTurnBudget, spendLeg, spendAction, grantPressOn, turnExhausted } from '../turnBudget';

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
