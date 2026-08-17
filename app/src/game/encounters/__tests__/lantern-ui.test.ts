import { describe, expect, it } from 'vitest';
import { createLanternGate, isCommitKey, isCommitTarget, redrawSentinel, type CommitKeySet } from '../lantern-ui';

/** Minimal Element stand-in — isCommitTarget only ever calls .closest(selector), so a stub that
 *  answers per-selector is enough (no real DOM needed; this module stays DOM-free, see file
 *  header). */
function stubTarget(matches: { commit: boolean; lantern: boolean }): { closest(sel: string): unknown } {
  return {
    closest(sel: string): unknown {
      if (sel === '[data-commit]') return matches.commit ? {} : null;
      if (sel === '.fw-lantern') return matches.lantern ? {} : null;
      throw new Error(`stubTarget: unexpected selector ${sel}`);
    },
  };
}

describe('lantern-ui (Ch. IV pure slice)', () => {
  it('redrawSentinel: factIds [] and quality 0 keep a non-branching caller inert; shownFactIds carries the presented facts', () => {
    const r = redrawSentinel({ id: 'e1', kind: 'mcq', fact_ids: ['f1', 'f2'] });
    expect(r).toEqual({ encounterId: 'e1', kind: 'mcq', factIds: [], quality: 0, redraw: { shownFactIds: ['f1', 'f2'] } });
  });
  it('settle() resolves exactly once — answer callback vs late lantern click never double-settles', () => {
    const g = createLanternGate();
    expect(g.settle()).toBe(true);
    expect(g.settle()).toBe(false);
  });
  it('disarm() kills the raise but never the answer path', () => {
    const g = createLanternGate();
    g.disarm();
    expect(g.mayRaise()).toBe(false);
    expect(g.settle()).toBe(true);
  });
  it('a settled gate cannot raise (judge resolved first)', () => {
    const g = createLanternGate();
    expect(g.settle()).toBe(true);
    expect(g.mayRaise()).toBe(false);
  });
  // W8 lantern ticket: isCommitKey no longer guesses from the key's shape (old law: "any
  // digit, or Enter" — index-blind, so a Scrivener's-Hint-struck MCQ digit disarmed the raise
  // even though it commits nothing). It now consults a `live` set the renderer publishes —
  // the renderer owns truth, isCommitKey just asks whether THIS key is in it.
  it('isCommitKey: commits exactly the keys the live set names — nothing else, regardless of shape', () => {
    const live: CommitKeySet = new Set(['1', '2', '3', 'Enter']);
    expect(isCommitKey('1', live)).toBe(true);
    expect(isCommitKey('Enter', live)).toBe(true);
    expect(isCommitKey('Escape', live)).toBe(false);
    expect(isCommitKey('a', live)).toBe(false);
    expect(isCommitKey('ArrowDown', live)).toBe(false);
  });

  it('a struck MCQ option\'s digit does not commit — a dead key, not an answer gesture', () => {
    // 3-option MCQ, option index 1 (key '2') struck: the renderer publishes digits 1..3 minus
    // the struck one, so '2' is a live digit's exact shape but absent from the live set.
    const live: CommitKeySet = new Set(['1', '3']);
    expect(isCommitKey('2', live)).toBe(false);
    expect(isCommitKey('1', live)).toBe(true);
    expect(isCommitKey('3', live)).toBe(true);
  });

  it('an out-of-range digit does not commit — the live set only ever names real options', () => {
    // a 3-option MCQ: nothing above '3' (or below '1') was ever published.
    const live: CommitKeySet = new Set(['1', '2', '3']);
    expect(isCommitKey('9', live)).toBe(false);
    expect(isCommitKey('0', live)).toBe(false);
  });

  it('Enter disarms only where the live set says Enter actually commits (match: no)', () => {
    expect(isCommitKey('Enter', new Set(['Enter']))).toBe(true); // e.g. order/free_recall's real binding
    expect(isCommitKey('Enter', new Set())).toBe(false); // match: no keyboard commit exists at all
  });

  // M2 fix: overlay disarm must fire only for a REAL commit button (MCQ/scenario option,
  // free-recall Cast, match/order's seal), never for intermediate controls (match chips,
  // order's ▲▼ nudges) — full [data-commit] × .fw-lantern truthy/falsy matrix.
  describe('isCommitTarget', () => {
    it('a commit button outside the lantern strip IS a commit target', () => {
      expect(isCommitTarget(stubTarget({ commit: true, lantern: false }))).toBe(true);
    });
    it('an intermediate control (no data-commit) outside the lantern strip is NOT a commit target', () => {
      expect(isCommitTarget(stubTarget({ commit: false, lantern: false }))).toBe(false);
    });
    it('the lantern strip itself (no data-commit) is NOT a commit target', () => {
      expect(isCommitTarget(stubTarget({ commit: false, lantern: true }))).toBe(false);
    });
    it('a commit-marked element inside the lantern strip is NOT a commit target (the raise button never disarms itself)', () => {
      expect(isCommitTarget(stubTarget({ commit: true, lantern: true }))).toBe(false);
    });
  });
});
