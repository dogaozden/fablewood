import { describe, it, expect } from 'vitest';
import { stubJudge } from '../stub';

// keys after stop-word filtering: {wait, frost, bell, harvesting, whispermoss} → 5
const rubric = 'Credit if the answer says to wait for the frost-bell before harvesting whispermoss.';
const prompt = 'Recite the whispermoss harvest rule.';

describe('stubJudge — keyword-overlap thresholds', () => {
  it('pass at overlap ≥ 0.6', () => {
    expect(stubJudge({ prompt, rubric, answer: 'wait for the frost-bell before harvesting whispermoss' }).verdict).toBe('pass');
    expect(stubJudge({ prompt, rubric, answer: 'wait frost bell' }).verdict).toBe('pass'); // 3/5 = 0.6
  });

  it('partial at 0.25 ≤ overlap < 0.6', () => {
    expect(stubJudge({ prompt, rubric, answer: 'frost bell' }).verdict).toBe('partial'); // 2/5 = 0.4
  });

  it('fail below 0.25', () => {
    expect(stubJudge({ prompt, rubric, answer: 'whispermoss' }).verdict).toBe('fail'); // 1/5 = 0.2
    expect(stubJudge({ prompt, rubric, answer: '' }).verdict).toBe('fail');
    expect(stubJudge({ prompt, rubric, answer: 'the quick brown fox' }).verdict).toBe('fail');
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
