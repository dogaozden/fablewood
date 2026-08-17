import { describe, it, expect } from 'vitest';
import { mkTurnBudget, spendLeg, spendAction, grantPressOn, turnExhausted, stanceLocked, tollRise } from '../turnBudget';
import { carefulStepMove } from '../ai';
import { effectiveMove } from '../status';

describe('turnBudget (Ch. VI spendable movement: move -> act -> move the remainder)', () => {
  it('mkTurnBudget: fresh budget has left===total and nothing spent', () => {
    const b = mkTurnBudget(5);
    expect(b).toEqual({ total: 5, left: 5, legSpent: false, actionSpent: false, pressedOn: false });
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

  it('grantPressOn adds the bonus to both total and left, marks the action spent, and locks the stance (pressedOn)', () => {
    const b = grantPressOn(mkTurnBudget(5), 2);
    expect(b.total).toBe(7);
    expect(b.left).toBe(7);
    expect(b.actionSpent).toBe(true);
    expect(b.pressedOn).toBe(true);
  });

  it('grantPressOn extends an already-partly-spent budget rather than refilling it', () => {
    const afterLeg = spendLeg(mkTurnBudget(5), 4); // left=1
    const b = grantPressOn(afterLeg, 2);
    expect(b.total).toBe(7);
    expect(b.left).toBe(3);
    expect(b.actionSpent).toBe(true);
  });

  it('spendLeg and spendAction preserve an existing pressedOn flag (fix round 1: the stance lock must survive whichever spend runs afterward)', () => {
    const pressed = grantPressOn(mkTurnBudget(5), 2); // pressedOn=true
    expect(spendLeg(pressed, 1).pressedOn, 'spendLeg must not clear pressedOn').toBe(true);
    expect(spendAction(pressed).pressedOn, 'spendAction must not clear pressedOn').toBe(true);
  });

  describe('stanceLocked — fix round 1: the toggle guard predicate, given a proper pure home', () => {
    it('unlocked only when NEITHER legSpent nor pressedOn is set', () => {
      expect(stanceLocked(mkTurnBudget(5))).toBe(false);
    });

    it('locked once a leg is spent', () => {
      expect(stanceLocked(spendLeg(mkTurnBudget(5), 1))).toBe(true);
    });

    it('locked once Press On fires, even with no leg spent yet — this is the fix-round bug: the old ' +
      'guard only checked legSpent, so pressing Press On before ever moving left the toggle live, and ' +
      'toggling re-anchored total/left from raw unit stats with no memory of the granted bonus, silently ' +
      'discarding it', () => {
      const pressed = grantPressOn(mkTurnBudget(5), 2);
      expect(pressed.legSpent, 'sanity: Press On alone does not spend a leg').toBe(false);
      expect(stanceLocked(pressed)).toBe(true);
    });

    it('locked when both are set', () => {
      const both = spendLeg(grantPressOn(mkTurnBudget(5), 2), 1);
      expect(stanceLocked(both)).toBe(true);
    });
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

describe('Ch. VI compose law — Careful Step + Press On, ONE halving over the COMBINED total (final review C2)', () => {
  // Final-review C2 (controller-adjudicated; plan amended on master c1df4c9) OVERTURNS Task 3's
  // original reading, pinned just above this describe block's old form (see git history — that
  // test asserted "each grant halved independently, then summed" and explicitly guarded AGAINST
  // this exact formula). The ratified chapter names an identity: "Careful Step + Press On =
  // normal distance." That identity only holds if the COMBINED raw (un-halved) base is halved
  // ONCE — halving each grant independently and summing loses a tile whenever effectiveMove is
  // odd (both formulas agree when it's even, which is why the bug shipped unnoticed: Keeper's
  // un-Dimmed move is 4). Live case (final-review C1's own example): a wraith's Dimmed(1) drops
  // effectiveMove from 4 to 3.
  it('a Careful Step turn-start total and a same-stance Press On bonus compose as ONE halving over their combined raw effectiveMove', () => {
    const eff = 3; // odd, and the exact live Dimmed value the review named
    const turnStart = mkTurnBudget(carefulStepMove(eff)); // turn start under Careful Step: floor(3/2)=1
    const combined = carefulStepMove(eff + eff); // the LAW: one halving over the combined base: floor(6/2)=3
    expect(turnStart.total).toBe(1);
    expect(combined, "the chapter's identity — Careful Step + Press On lands back on normal (un-halved) distance").toBe(eff);

    // This is the exact bonus CombatScene.pressOn() must grant: the gap between the combined
    // (correct) total and whatever the budget already carries.
    const bonus = combined - turnStart.total; // 3 - 1 = 2
    const withPressOn = grantPressOn(turnStart, bonus);
    expect(withPressOn.total).toBe(3);

    // The anti-pattern this now guards against: Task 3's original formula — two INDEPENDENT
    // single-halvings, summed (`grantPressOn(turnStart, carefulStepMove(eff))`). For this odd
    // base the two readings genuinely disagree (3 vs 2) — proof the composition must halve the
    // combined base, not each grant on its own.
    const overturnedAntiPattern = grantPressOn(turnStart, carefulStepMove(eff));
    expect(overturnedAntiPattern.total).toBe(2);
    expect(withPressOn.total).not.toBe(overturnedAntiPattern.total);
  });

  it('an even effectiveMove: both composition orders happen to agree — why C2 shipped unnoticed', () => {
    const eff = 4; // Keeper's un-Dimmed base move
    const combined = carefulStepMove(eff + eff); // floor(8/2) = 4
    const independentHalvingsSummed = carefulStepMove(eff) + carefulStepMove(eff); // 2 + 2 = 4
    expect(combined).toBe(4);
    expect(independentHalvingsSummed).toBe(4);
    expect(combined).toBe(independentHalvingsSummed); // no divergence when eff is even
  });

  it('Press On still consumes the action and extends both total and left off whatever the budget already had (move-after-act law still holds under Careful Step)', () => {
    const eff = 3;
    const turnStart = mkTurnBudget(carefulStepMove(eff)); // total=1
    const afterLeg = spendLeg(turnStart, 1); // left floors to 0 (only 1 tile was ever there), legSpent=true
    const combined = carefulStepMove(eff + eff); // 3
    const bonus = combined - afterLeg.total; // total is untouched by spendLeg: 3 - 1 = 2
    const b = grantPressOn(afterLeg, bonus);
    expect(b.total).toBe(3);
    expect(b.left).toBe(2); // 0 remaining + 2 bonus, not refilled to the new total
    expect(b.actionSpent).toBe(true);
    expect(turnExhausted(b)).toBe(false); // action spent, but 2 tiles are still banked
  });
});

describe('Ch. VIII — the rise toll (tollRise): a Toppled unit\'s turn-start movement base is halved, house floor, BEFORE stance', () => {
  it('halves and floors: an even base halves cleanly', () => {
    expect(tollRise(4)).toBe(2);
  });

  it('halves and floors: an odd base floors down', () => {
    expect(tollRise(3)).toBe(1);
  });

  it('the house floor: base 1 tolls to 1, NOT 0 — rising never zeroes a unit\'s movement', () => {
    expect(tollRise(1)).toBe(1);
  });

  it('zero-preserving (fix round, I1): base 0 tolls to 0, NOT 1 — the house floor guards a ' +
    'MOBILE unit\'s halving; it never overrides a zero another law already made', () => {
    expect(tollRise(0)).toBe(0);
  });

  it('the I1 composition, exactly as CombatScene:983 calls it — a Bound unit\'s effectiveMove ' +
    'is 0 before the toll ever runs, and the toll must not resurrect that zero', () => {
    expect(tollRise(effectiveMove(4, [{ id: 'bound', turnsLeft: 1, magnitude: 0 }]))).toBe(0);
  });
});

describe('Ch. VIII compose law — rise-toll first, stance second: Ch. VI\'s Careful Step + Press On ' +
  'identity holds RELATIVE TO THE TOLLED BASE on a rising turn (not the raw effectiveMove)', () => {
  // Mirrors the Ch. VI describe block above exactly, substituting tollRise(eff) for eff
  // everywhere the chapter's identity is checked — proving composition order (toll, THEN
  // stance) rather than re-deriving stance math the Ch. VI block already owns.
  it('tolled-normal identity at eff=3 (odd, the exact live Dimmed value the Ch. VI review named)', () => {
    const eff = 3;
    const tolled = tollRise(eff); // floor(3/2) = 1
    const turnStart = mkTurnBudget(carefulStepMove(tolled)); // Careful Step over the TOLLED base
    const combined = carefulStepMove(tolled + tolled); // one halving over the combined TOLLED base
    expect(tolled).toBe(1);
    expect(combined, 'Careful Step + Press On lands back on the TOLLED distance, not the raw one').toBe(tolled);
    const bonus = combined - turnStart.total;
    expect(bonus, 'Press On grant is never negative').toBeGreaterThanOrEqual(0);
    expect(grantPressOn(turnStart, bonus).total).toBe(tolled);
  });

  it("tolled-normal identity at eff=4 (Keeper's own un-Dimmed base move — measured-turn.spec.ts's live fact)", () => {
    const eff = 4;
    const tolled = tollRise(eff); // floor(4/2) = 2
    const turnStart = mkTurnBudget(carefulStepMove(tolled));
    const combined = carefulStepMove(tolled + tolled);
    expect(tolled).toBe(2);
    expect(combined).toBe(tolled);
    const bonus = combined - turnStart.total;
    expect(bonus, 'Press On grant is never negative').toBeGreaterThanOrEqual(0);
    expect(grantPressOn(turnStart, bonus).total).toBe(tolled);
  });

  it('the O1 case, eff=1: toll+the house floor already collapse the base to its minimum — the Press ' +
    'On grant this composes to must be exactly +0, never negative (the invariant a broken composition ' +
    'order could violate)', () => {
    const eff = 1;
    const tolled = tollRise(eff); // house floor: max(1, floor(1/2)) = 1, not 0
    expect(tolled).toBe(1);
    const turnStart = mkTurnBudget(carefulStepMove(tolled)); // carefulStepMove(1) = 1 (its own floor)
    const combined = carefulStepMove(tolled + tolled); // carefulStepMove(2) = 1
    expect(turnStart.total).toBe(1);
    expect(combined).toBe(1);
    const bonus = combined - turnStart.total;
    expect(bonus, 'the degenerate all-floors case grants exactly +0').toBe(0);
    expect(bonus, 'never negative — the invariant').toBeGreaterThanOrEqual(0);
  });
});
