import { describe, it, expect } from 'vitest';
import { stubJudge } from '../stub';

// keys after stop-word filtering: {wait, frost, bell, harvesting, whispermoss} → 5
const rubric = 'Credit if the answer says to wait for the frost-bell before harvesting whispermoss.';
const prompt = 'Recite the whispermoss harvest rule.';

describe('stubJudge — keyword-overlap thresholds', () => {
  it('pass at overlap ≥ 0.6', () => {
    expect(stubJudge({ prompt, rubric, answer: 'wait for the frost-bell before harvesting whispermoss' }).verdict).toBe('pass');
    // denominator is max(2, min(keys.size, answerWords.size)): a terse answer whose every
    // word is a real key (3/3) reaches full overlap, not just the old keys.size-relative 3/5.
    expect(stubJudge({ prompt, rubric, answer: 'wait frost bell' }).verdict).toBe('pass'); // 3/3 = 1.0
    expect(stubJudge({ prompt, rubric, answer: 'frost bell' }).verdict).toBe('pass'); // 2/2 = 1.0
  });

  it('partial at 0.25 ≤ overlap < 0.6', () => {
    // a single fished keyword is capped at 0.5 by the denominator's floor of 2, regardless
    // of how many keys the rubric has (1/max(2, min(5,1)) = 1/2).
    expect(stubJudge({ prompt, rubric, answer: 'frost' }).verdict).toBe('partial');
  });

  it('fail below 0.25', () => {
    expect(stubJudge({ prompt, rubric, answer: '' }).verdict).toBe('fail');
    expect(stubJudge({ prompt, rubric, answer: 'the quick brown fox' }).verdict).toBe('fail');
    expect(stubJudge({ prompt, rubric, answer: 'gremlin' }).verdict).toBe('fail'); // 0 real keys hit
  });

  it('is deterministic (same input → same verdict AND line)', () => {
    const a = stubJudge({ prompt, rubric, answer: 'frost bell' });
    const b = stubJudge({ prompt, rubric, answer: 'frost bell' });
    expect(a).toEqual(b);
  });

  it('always returns a non-empty in-world line', () => {
    const v = stubJudge({ prompt, rubric, answer: 'wait for the frost-bell' });
    expect(typeof v.line).toBe('string');
    expect(v.line.length).toBeGreaterThan(0);
  });
});
