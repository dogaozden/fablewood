import { describe, expect, it } from 'vitest';
import {
  BOX_LABELS,
  boxDistribution,
  boxLabel,
  currentStreak,
  dueForecast,
  endOfDay,
  flattenHistory,
  passRate,
  weakestBindings,
  type FlatHistoryItem,
} from './metrics';
import type { SrsEntry } from '../srs/leitner';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000; // fixed fake clock (epoch ms), same idiom as leitner.test.ts

function entry(box: number, next_due: number, history: SrsEntry['history'] = []): SrsEntry {
  return { box, next_due, history };
}

describe('boxDistribution', () => {
  it('counts unseen ids (missing from the map) as box 0', () => {
    expect(boxDistribution(['a', 'b'], {})).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('tallies each fact into its own box, including the lifetime-ladder boxes 6-8', () => {
    const facts = {
      a: entry(0, 0), // never actually persisted at box 0, but tolerate it defensively
      b: entry(1, 0),
      c: entry(3, 0),
      d: entry(3, 0),
      e: entry(5, 0),
      f: entry(6, 0),
      g: entry(7, 0),
      h: entry(8, 0),
    };
    expect(boxDistribution(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], facts)).toEqual([
      1, 1, 0, 2, 0, 1, 1, 1, 1,
    ]);
  });

  it('clamps a corrupted out-of-range box rather than throwing or losing the fact', () => {
    const facts = { a: entry(99, 0), b: entry(-4, 0) };
    expect(boxDistribution(['a', 'b'], facts)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('empty factIds → all zero', () => {
    expect(boxDistribution([], {})).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('boxLabel', () => {
  it('labels every in-range box with the Ledger\'s own name, never a raw number', () => {
    expect(BOX_LABELS.map((_, i) => boxLabel(i))).toEqual([
      'new',
      'fragile',
      'learning',
      'steady',
      'strong',
      'seasoned',
      'hardened',
      'unbroken',
      'mastered',
    ]);
  });

  it('clamps a corrupted out-of-range box instead of returning undefined', () => {
    expect(boxLabel(99)).toBe('mastered');
    expect(boxLabel(-4)).toBe('new');
  });
});

describe('dueForecast', () => {
  const todayEnd = endOfDay(NOW, 0);
  const tomorrowEnd = endOfDay(NOW, 1);
  const weekEnd = endOfDay(NOW, 7);

  it('buckets an overdue fact and one due later today into "today"', () => {
    const facts = {
      overdue: entry(2, NOW - 5000),
      laterToday: entry(2, todayEnd - 1),
    };
    expect(dueForecast(['overdue', 'laterToday'], facts, NOW)).toEqual({ today: 2, tomorrow: 0, week: 0 });
  });

  it('a value exactly at the today boundary still counts as today (inclusive)', () => {
    const facts = { a: entry(2, todayEnd) };
    expect(dueForecast(['a'], facts, NOW).today).toBe(1);
  });

  it('buckets the day after today into "tomorrow"', () => {
    const facts = { a: entry(2, todayEnd + 1), b: entry(2, tomorrowEnd) };
    expect(dueForecast(['a', 'b'], facts, NOW)).toEqual({ today: 0, tomorrow: 2, week: 0 });
  });

  it('buckets the rest of the 7-day window into "week"', () => {
    const facts = { a: entry(2, tomorrowEnd + 1), b: entry(2, weekEnd) };
    expect(dueForecast(['a', 'b'], facts, NOW)).toEqual({ today: 0, tomorrow: 0, week: 2 });
  });

  it('excludes anything beyond the week window and anything unseen', () => {
    const facts = { far: entry(2, weekEnd + 1) };
    expect(dueForecast(['far', 'unseen'], facts, NOW)).toEqual({ today: 0, tomorrow: 0, week: 0 });
  });

  it('excludes a malformed/non-finite next_due rather than throwing', () => {
    const facts = { a: entry(2, NaN) };
    expect(dueForecast(['a'], facts, NOW)).toEqual({ today: 0, tomorrow: 0, week: 0 });
  });
});

describe('flattenHistory', () => {
  it('merges every fact\'s history and sorts most-recent first', () => {
    const facts = {
      a: entry(2, 0, [{ ts: new Date(NOW - 3 * DAY).toISOString(), quality: 1 as const, encounter_id: 'e1' }]),
      b: entry(2, 0, [{ ts: new Date(NOW - 1000).toISOString(), quality: 0.5 as const, encounter_id: 'e2' }]),
    };
    const flat = flattenHistory(facts);
    expect(flat.map((h) => h.quality)).toEqual([0.5, 1]);
  });

  it('an unparseable timestamp sorts last, not first', () => {
    const facts = {
      a: entry(2, 0, [{ ts: 'not-a-date', quality: 1 as const, encounter_id: 'e1' }]),
      b: entry(2, 0, [{ ts: new Date(NOW).toISOString(), quality: 0 as const, encounter_id: 'e2' }]),
    };
    const flat = flattenHistory(facts);
    expect(flat[0].quality).toBe(0);
    expect(flat[1].quality).toBe(1);
  });
});

describe('currentStreak', () => {
  const h = (quality: FlatHistoryItem['quality']): FlatHistoryItem => ({ ts: 0, quality });

  it('counts consecutive full passes from the most recent', () => {
    expect(currentStreak([h(1), h(1), h(1), h(0), h(1)])).toBe(3);
  });

  it('a partial breaks the streak just like a miss', () => {
    expect(currentStreak([h(1), h(0.5), h(1)])).toBe(1);
  });

  it('no history → 0', () => {
    expect(currentStreak([])).toBe(0);
  });

  it('a miss as the very latest answer → streak 0', () => {
    expect(currentStreak([h(0), h(1), h(1)])).toBe(0);
  });
});

describe('passRate', () => {
  const h = (quality: FlatHistoryItem['quality']): FlatHistoryItem => ({ ts: 0, quality });

  it('rate over the most recent N, ignoring older answers', () => {
    // most-recent-first: 2 passes, 1 miss in the last 3; a 4th (older) pass outside the window
    const history = [h(1), h(1), h(0), h(1)];
    expect(passRate(history, 3)).toEqual({ rate: (2 / 3) * 100, sample: 3 });
  });

  it('sample shrinks (never pads) when fewer than N answers exist', () => {
    expect(passRate([h(1), h(0)], 20)).toEqual({ rate: 50, sample: 2 });
  });

  it('empty history → 0/0, not NaN', () => {
    expect(passRate([], 20)).toEqual({ rate: 0, sample: 0 });
  });

  it('partial credit does not count as a pass', () => {
    expect(passRate([h(0.5), h(0.5)], 20)).toEqual({ rate: 0, sample: 2 });
  });
});

describe('weakestBindings', () => {
  it('includes only facts whose LATEST answer was a miss, most-recent miss first', () => {
    const facts = {
      stillWeak: entry(1, 0, [
        { ts: new Date(NOW - 2000).toISOString(), quality: 0, encounter_id: 'e1' },
      ]),
      moreRecentMiss: entry(1, 0, [
        { ts: new Date(NOW - 1000).toISOString(), quality: 0, encounter_id: 'e2' },
      ]),
      redeemed: entry(2, 0, [
        { ts: new Date(NOW - 5000).toISOString(), quality: 0, encounter_id: 'e3' },
        { ts: new Date(NOW - 500).toISOString(), quality: 1, encounter_id: 'e4' }, // fixed since
      ]),
      neverMissed: entry(3, 0, [
        { ts: new Date(NOW - 500).toISOString(), quality: 1, encounter_id: 'e5' },
      ]),
    };
    const weak = weakestBindings(facts, 5);
    expect(weak.map((w) => w.id)).toEqual(['moreRecentMiss', 'stillWeak']);
  });

  it('respects the limit', () => {
    const facts: Record<string, SrsEntry> = {};
    for (let i = 0; i < 8; i++) {
      facts[`f${i}`] = entry(1, 0, [{ ts: new Date(NOW - i * 1000).toISOString(), quality: 0, encounter_id: `e${i}` }]);
    }
    expect(weakestBindings(facts, 3)).toHaveLength(3);
  });

  it('a fact with empty history is never a candidate', () => {
    expect(weakestBindings({ a: entry(0, 0, []) })).toEqual([]);
  });
});
