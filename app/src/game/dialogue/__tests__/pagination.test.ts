import { describe, it, expect } from 'vitest';
import { wrapWords, paginate } from '../pagination';

describe('wrapWords', () => {
  it('wraps at the column budget', () => {
    expect(wrapWords('the quick brown fox', 9)).toEqual(['the quick', 'brown fox']);
  });

  it('hard-breaks a word longer than the budget', () => {
    expect(wrapWords('supercalifragilistic', 8)).toEqual(['supercal', 'ifragili', 'stic']);
  });

  it('returns nothing for empty input', () => {
    expect(wrapWords('   ', 10)).toEqual([]);
  });
});

describe('paginate', () => {
  it('keeps short text on a single page', () => {
    expect(paginate('hello there', 20, 3)).toEqual(['hello there']);
  });

  it('splits wrapped lines into fixed-height pages', () => {
    const pages = paginate('one two three four five six seven eight', 9, 2);
    // wraps to lines of <=9 chars, 2 lines per page
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages) expect(p.split('\n').length).toBeLessThanOrEqual(2);
  });

  it('honours explicit newlines', () => {
    const pages = paginate('a\nb', 20, 5);
    expect(pages[0]).toBe('a\nb');
  });

  it('always returns at least one page', () => {
    expect(paginate('', 10, 3)).toEqual(['']);
  });
});
