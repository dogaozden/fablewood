import { describe, expect, it } from 'vitest';
import { AMENDED_MERCY_LINE, applyAmendedMercy, resolveAction, stripPartyHarmOps } from '../damage';
import type { BoardOp } from '../spells';

/**
 * §5 the one mercy rule (docs/design/supersession-reteach.md): on the superseding fact's
 * FIRST graded appearance a miss deals 0 HP and shows the Clerk's line. Second appearance
 * onward: full teeth. These cover the pure damage seam; whether the rule FIRES is
 * srs/amendments.ts's firstAmendedAppearance (tested there and in amendments.register).
 */

describe('§5 applyAmendedMercy — the T1 damage seam', () => {
  it("zeroes Cast's Fade counter on a miss (the party takes 0 HP)", () => {
    const base = resolveAction('cast', 0);
    expect(base.fade).toBe(2); // guard: the rule has something to forgive

    const merciful = applyAmendedMercy(base);
    expect(merciful.fade).toBe(0);
  });

  it("zeroes Parley's backfire on a bad branch", () => {
    const base = resolveAction('parley', 0, { branchTag: 'bad' });
    expect(base.partyHit).toBe(2);
    expect(applyAmendedMercy(base).partyHit).toBe(0);
  });

  it('composes the Clerk line AFTER the base copy, verbatim', () => {
    const merciful = applyAmendedMercy(resolveAction('cast', 0));
    expect(merciful.banner).toBe('The Fade lashes back (−2).\n' + AMENDED_MERCY_LINE);
    expect(AMENDED_MERCY_LINE).toBe('The Realm moved, not you. Read it again.');
  });

  it('stands alone when the base outcome has no banner of its own', () => {
    expect(applyAmendedMercy({ ...resolveAction('cast', 0), banner: '' }).banner).toBe(AMENDED_MERCY_LINE);
  });

  it('a whiff still buys nothing — damage dealt is untouched', () => {
    const merciful = applyAmendedMercy(resolveAction('smite', 0));
    expect(merciful.hits).toBe(0);
    expect(merciful.aoeHit).toBe(0);
    expect(merciful.selfChip).toBe(0);
  });

  it('leaves a NON-merciful outcome exactly as the table resolved it (second appearance)', () => {
    const base = resolveAction('cast', 0);
    expect(base.fade).toBe(2);
    expect(base.banner).toBe('The Fade lashes back (−2).');
    expect(base.banner).not.toContain(AMENDED_MERCY_LINE);
  });
});

describe('§5 stripPartyHarmOps — the T2/T3 spell seam', () => {
  const ops: BoardOp[] = [
    { op: 'damage', targetId: 'enemy-1', amount: 3 },
    { op: 'damage', targetId: 'mira', amount: 2 },
    { op: 'fade', amount: 2 },
    { op: 'status', targetId: 'enemy-1', id: 'bound', turns: 2, magnitude: 1 },
    { op: 'banner', text: 'The words scatter.' },
  ];

  it('drops the Fade counter and any damage aimed at the party', () => {
    const out = stripPartyHarmOps(ops, ['keeper', 'mira']);
    expect(out.some((o) => o.op === 'fade')).toBe(false);
    expect(out.some((o) => o.op === 'damage' && o.targetId === 'mira')).toBe(false);
  });

  it('keeps enemy damage, statuses and the banner', () => {
    const out = stripPartyHarmOps(ops, ['keeper', 'mira']);
    expect(out).toEqual([
      { op: 'damage', targetId: 'enemy-1', amount: 3 },
      { op: 'status', targetId: 'enemy-1', id: 'bound', turns: 2, magnitude: 1 },
      { op: 'banner', text: 'The words scatter.' },
    ]);
  });

  it('is a no-op when nothing in the op list harms the party', () => {
    const harmless: BoardOp[] = [{ op: 'damage', targetId: 'enemy-1', amount: 3 }];
    expect(stripPartyHarmOps(harmless, ['keeper'])).toEqual(harmless);
  });

  it('an empty party list still strips the Fade counter (it hits the pool, not a unit)', () => {
    expect(stripPartyHarmOps([{ op: 'fade', amount: 2 }], [])).toEqual([]);
  });
});
