import { describe, expect, it } from 'vitest';
import {
  BOX_INTERVALS,
  boxOf,
  buildFactMeta,
  dueQueue,
  masteryAvg,
  record,
  type SrsEntry,
  type SrsState,
} from './leitner';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000; // fixed fake clock (epoch ms)

function entry(box: number, next_due: number, history: SrsEntry['history'] = []): SrsEntry {
  return { box, next_due, history };
}

function state(facts: Record<string, SrsEntry>): SrsState {
  return { version: 1, facts };
}

describe('record — box transitions', () => {
  it('promotes an unseen fact to box 2 on a correct answer (treats unseen as box 1)', () => {
    const r = record(undefined, 1, NOW, 'e1');
    expect(r.box).toBe(2);
    expect(r.next_due).toBe(NOW + BOX_INTERVALS[2] * DAY);
  });

  it('holds an unseen fact at box 1 on a partial answer', () => {
    const r = record(undefined, 0.5, NOW, 'e1');
    expect(r.box).toBe(1);
    expect(r.next_due).toBe(NOW + BOX_INTERVALS[1] * DAY);
  });

  it('keeps an unseen fact at box 1 on a miss', () => {
    const r = record(undefined, 0, NOW, 'e1');
    expect(r.box).toBe(1);
    expect(r.next_due).toBe(NOW + 1 * DAY);
  });

  it('promotes one box per correct answer and caps at box 5', () => {
    // walk 1→2→3→4→5→5 with successive correct answers
    const boxesSeen: number[] = [];
    let e: SrsEntry | undefined = undefined;
    for (let i = 0; i < 6; i++) {
      e = record(e, 1, NOW, `e${i}`);
      boxesSeen.push(e.box);
    }
    expect(boxesSeen).toEqual([2, 3, 4, 5, 5, 5]); // cap holds at 5
  });

  it('partial credit holds the current box but reschedules next_due', () => {
    const before = entry(3, NOW - 100 * DAY);
    const r = record(before, 0.5, NOW, 'e1');
    expect(r.box).toBe(3); // unchanged
    expect(r.next_due).toBe(NOW + BOX_INTERVALS[3] * DAY); // rescheduled forward
  });

  it('a miss resets any box to 1 with a 1-day interval', () => {
    for (const box of [2, 3, 4, 5]) {
      const r = record(entry(box, NOW + 999 * DAY), 0, NOW, 'e1');
      expect(r.box).toBe(1);
      expect(r.next_due).toBe(NOW + 1 * DAY);
    }
  });

  it('clamps a corrupted box back into 1-5 so next_due never goes NaN', () => {
    // box 9 (or "3", or NaN) has no BOX_INTERVALS entry — without clamping,
    // next_due = now + undefined * DAY = NaN and the schedule corrupts further.
    const partial = record(entry(9, 0), 0.5, NOW, 'e'); // partial holds ground → clamp to 5
    expect(partial.box).toBe(5);
    expect(partial.next_due).toBe(NOW + BOX_INTERVALS[5] * DAY);

    const promoted = record(entry(99, 0), 1, NOW, 'e');
    expect(promoted.box).toBe(5);

    const nonNumeric = record({ box: Number.NaN, next_due: 0, history: [] }, 0.5, NOW, 'e');
    expect(nonNumeric.box).toBe(1); // unusable box → treated as box 1
    expect(Number.isFinite(nonNumeric.next_due)).toBe(true);
  });

  it('sets next_due to the correct interval for every resulting box', () => {
    // box result → the interval that produced it
    expect(record(entry(1, 0), 1, NOW, 'e').next_due).toBe(NOW + 3 * DAY); // →2
    expect(record(entry(2, 0), 1, NOW, 'e').next_due).toBe(NOW + 7 * DAY); // →3
    expect(record(entry(3, 0), 1, NOW, 'e').next_due).toBe(NOW + 14 * DAY); // →4
    expect(record(entry(4, 0), 1, NOW, 'e').next_due).toBe(NOW + 30 * DAY); // →5
    expect(record(entry(5, 0), 1, NOW, 'e').next_due).toBe(NOW + 30 * DAY); // stays 5
  });
});

describe('record — history & purity', () => {
  it('appends an ISO-timestamped history item without mutating the input', () => {
    const before = entry(2, NOW, [{ ts: 'old', quality: 1, encounter_id: 'e0' }]);
    const frozenLen = before.history.length;
    const r = record(before, 0.5, NOW, 'e1');
    expect(r.history).toHaveLength(2);
    expect(r.history[1]).toEqual({
      ts: new Date(NOW).toISOString(),
      quality: 0.5,
      encounter_id: 'e1',
    });
    expect(r.history[1].ts).toBe('2023-11-14T22:13:20.000Z');
    // input untouched (pure)
    expect(before.history).toHaveLength(frozenLen);
    expect(before.box).toBe(2);
  });
});

describe('boxOf & masteryAvg', () => {
  const s = state({ a: entry(3, NOW), b: entry(5, NOW) });

  it('reports 0 for unseen facts', () => {
    expect(boxOf(s, 'missing')).toBe(0);
    expect(boxOf(s, 'a')).toBe(3);
  });

  it('averages boxes, counting unseen as 0, and returns 0 for an empty set', () => {
    expect(masteryAvg(s, [])).toBe(0);
    expect(masteryAvg(s, ['a', 'b'])).toBe(4); // (3+5)/2
    expect(masteryAvg(s, ['a', 'b', 'unseen'])).toBeCloseTo(8 / 3); // (3+5+0)/3
  });
});

describe('dueQueue', () => {
  const noMeta = new Map();

  it('returns due facts most-overdue-first, then lowest box on ties', () => {
    const s = state({
      a: entry(2, NOW - 1 * DAY), // due, mildly overdue
      b: entry(1, NOW - 5 * DAY), // due, very overdue
      c: entry(3, NOW - 5 * DAY), // due, same overdue as b → tie broken by lower box (b first)
    });
    expect(dueQueue(s, ['a', 'b', 'c'], noMeta, NOW)).toEqual(['b', 'c', 'a']);
  });

  it('excludes seen-but-not-due facts', () => {
    const s = state({
      due: entry(1, NOW - DAY),
      future: entry(2, NOW + 10 * DAY), // not due → excluded
    });
    expect(dueQueue(s, ['due', 'future'], noMeta, NOW)).toEqual(['due']);
  });

  it('appends unseen facts after due facts, preserving declaration order', () => {
    const s = state({ seen: entry(1, NOW - DAY) });
    expect(dueQueue(s, ['seen', 'u1', 'u2', 'u3'], noMeta, NOW)).toEqual(['seen', 'u1', 'u2', 'u3']);
  });

  it('a fact due exactly now counts as due (<= now)', () => {
    const s = state({ x: entry(1, NOW) });
    expect(dueQueue(s, ['x'], noMeta, NOW)).toEqual(['x']);
  });

  it('gates unseen facts by prereqs: welded (box>=2) prereqs come before unmet ones', () => {
    const s = state({
      p: entry(2, NOW + 99 * DAY), // prereq welded (box 2), not itself due
      q: entry(1, NOW + 99 * DAY), // prereq NOT welded (box 1)
    });
    const meta = new Map([
      ['ready', { prereqs: ['p'] }], // prereq welded → ready
      ['blocked', { prereqs: ['q'] }], // prereq at box 1 → blocked
      ['free', { prereqs: [] }], // no prereqs → vacuously ready
    ]);
    // declaration order puts 'blocked' first, but gating floats ready ones up
    const q = dueQueue(s, ['blocked', 'ready', 'free'], meta, NOW);
    expect(q).toEqual(['ready', 'free', 'blocked']);
  });

  it('treats a fact with an unseen prereq (box 0) as blocked', () => {
    const s = state({});
    const meta = new Map([['needs', { prereqs: ['nope'] }]]);
    expect(dueQueue(s, ['needs', 'open'], meta, NOW)).toEqual(['open', 'needs']);
  });

  it('treats facts missing from factMeta as having no prereqs', () => {
    const s = state({});
    expect(dueQueue(s, ['x', 'y'], noMeta, NOW)).toEqual(['x', 'y']);
  });

  it('surfaces a seen entry with a malformed next_due as most-overdue (never silently unschedulable)', () => {
    // A hand-edited or partially-written srs.json can leave next_due missing or
    // NaN. `undefined <= now` is false, so such a fact would otherwise fall into
    // the "seen & not due" bucket FOREVER — invisible to review with no error.
    const missing = { box: 2, history: [] } as unknown as SrsEntry; // no next_due
    const s = state({
      ghost: missing,
      due: entry(1, NOW - DAY),
      future: entry(2, NOW + 10 * DAY),
    });
    const q = dueQueue(s, ['due', 'ghost', 'future'], noMeta, NOW);
    expect(q).toContain('ghost'); // the regression: ghost vanished entirely
    expect(q).toEqual(['ghost', 'due']); // surfaced first so record() heals it
  });

  it('surfaces a NaN next_due too', () => {
    const s = state({ nan: entry(3, Number.NaN) });
    expect(dueQueue(s, ['nan'], noMeta, NOW)).toEqual(['nan']);
  });
});

describe('buildFactMeta', () => {
  it('indexes prereqs per pack', () => {
    const meta = buildFactMeta([
      {
        id: 'vc-law',
        pack: {
          facts: [
            { id: 'f1', prereqs: [] },
            { id: 'f2', prereqs: ['f1'] },
            { id: 'f3' }, // no prereqs field → []
          ],
        },
      },
    ]);
    const vc = meta.get('vc-law')!;
    expect(vc.get('f2')).toEqual({ prereqs: ['f1'] });
    expect(vc.get('f3')).toEqual({ prereqs: [] });
  });

  it('tolerates malformed packs without throwing', () => {
    const meta = buildFactMeta([
      { id: 'no-facts', pack: {} },
      { id: 'facts-not-array', pack: { facts: 'nope' } },
      { id: 'null-pack', pack: null },
      {
        id: 'partly-bad',
        pack: { facts: [{ id: 'ok', prereqs: ['a', 123, null] }, { noId: true }, 42] },
      },
    ]);
    expect(meta.get('no-facts')?.size ?? 0).toBe(0); // skipped: no facts array
    expect(meta.has('facts-not-array')).toBe(false);
    expect(meta.has('null-pack')).toBe(false);
    // bad prereq entries filtered to strings; entries without a string id skipped
    expect(meta.get('partly-bad')!.get('ok')).toEqual({ prereqs: ['a'] });
    expect(meta.get('partly-bad')!.size).toBe(1);
  });
});
