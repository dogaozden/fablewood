import { describe, it, expect } from 'vitest';
import { CANTO_MILESTONES, weldCount, cantoUnlocked, onwardOpenPage } from './books';

describe('weldCount', () => {
  it('counts facts at the shipped weld edge, box >= 4', () => {
    const boxes: Record<string, number> = { a: 5, b: 4, c: 3, d: 0 };
    expect(weldCount(['a', 'b', 'c', 'd'], (id) => boxes[id] ?? 0)).toBe(2);
  });
});

describe('cantoUnlocked', () => {
  it('cantos I and II are always readable', () => {
    expect(cantoUnlocked(0, 0, 0)).toBe(true);
    expect(cantoUnlocked(1, 0, 0)).toBe(true);
  });
  it('III–VII unlock at the weld milestones', () => {
    expect(cantoUnlocked(2, 4, 0)).toBe(false);
    expect(cantoUnlocked(2, 5, 0)).toBe(true);
    expect(cantoUnlocked(6, 24, 0)).toBe(false);
    expect(cantoUnlocked(6, 25, 0)).toBe(true);
    expect(CANTO_MILESTONES).toEqual([5, 10, 15, 20, 25]);
  });
  it('an arc completion force-unlocks the next locked canto (whichever gate first)', () => {
    expect(cantoUnlocked(2, 0, 1)).toBe(true);  // one arc done → canto III open
    expect(cantoUnlocked(3, 0, 1)).toBe(false); // but not IV
    expect(cantoUnlocked(3, 0, 2)).toBe(true);
  });
});

describe('onwardOpenPage', () => {
  it('before the hook: the page is ruled and waiting', () => {
    const p = onwardOpenPage(() => false);
    expect(p.entries).toEqual([]);
    expect(p.clerkLine).toBe('The page is ruled and waiting.');
  });
  it('lists seen beats in canon order and points at what wants doing next', () => {
    const seen = new Set(['onward-01.dark-answers']);
    const p = onwardOpenPage((id) => seen.has(id));
    expect(p.entries).toEqual(['The Dark Answers']);
    expect(p.clerkLine).toBe('Next wants doing: the south road. Ask the gatewarden.');
    seen.add('onward-01.barred-road');
    expect(onwardOpenPage((id) => seen.has(id)).clerkLine).toBe(
      'Next wants doing: a tale at the Acorn. Berry has it.',
    );
    seen.add('onward-01.fable-waywright');
    expect(onwardOpenPage((id) => seen.has(id)).clerkLine).toBe(
      'Next wants doing: the road past the fence. It waits.',
    );
  });
});
