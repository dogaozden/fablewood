import { describe, expect, it } from 'vitest';
import { createLanternGate, isCommitKey, isCommitTarget, redrawSentinel } from '../lantern-ui';

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
  it('isCommitKey: Enter and MCQ digit hotkeys commit (disarm); navigation/typing keys do not', () => {
    expect(isCommitKey('Enter')).toBe(true);
    expect(isCommitKey('7')).toBe(true);
    expect(isCommitKey('Escape')).toBe(false);
    expect(isCommitKey('a')).toBe(false);
    expect(isCommitKey('ArrowDown')).toBe(false);
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
