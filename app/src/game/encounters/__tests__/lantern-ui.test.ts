import { describe, expect, it } from 'vitest';
import { createLanternGate, isCommitKey, redrawSentinel } from '../lantern-ui';

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
});
