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

  it('promotes one box per correct answer and caps at box 8 when factType is omitted', () => {
    // Legacy no-type path walks the full ladder and then holds at box 8.
    const boxesSeen: number[] = [];
    let e: SrsEntry | undefined = undefined;
    for (let i = 0; i < 9; i++) {
      e = record(e, 1, NOW, `e${i}`);
      boxesSeen.push(e.box);
    }
    expect(boxesSeen).toEqual([2, 3, 4, 5, 6, 7, 8, 8, 8]);
  });

  it.each([
    ['number', 6],
    ['rule', 7],
    ['concept', 8],
    ['unrecognized-type', 8],
  ] as const)('%s facts stop exactly at box %i and use that box interval', (factType, cap) => {
    let e: SrsEntry | undefined;
    const boxesSeen: number[] = [];
    for (let i = 0; i < 10; i++) {
      e = record(e, 1, NOW, `e${i}`, factType);
      boxesSeen.push(e.box);
    }

    expect(boxesSeen.every((box) => box <= cap)).toBe(true);
    expect(boxesSeen.at(-1)).toBe(cap);
    expect(e!.next_due).toBe(NOW + BOX_INTERVALS[cap] * DAY);
  });

  it('never demotes a box-8 fact when a correct answer is recorded with a lower type cap', () => {
    const r = record(entry(8, NOW), 1, NOW, 'e1', 'number');
    expect(r.box).toBe(8);
    expect(r.next_due).toBe(NOW + 365 * DAY);
  });

  it('resets a box-8 fact to box 1 on a miss regardless of its type cap', () => {
    const r = record(entry(8, NOW), 0, NOW, 'e1', 'number');
    expect(r.box).toBe(1);
    expect(r.next_due).toBe(NOW + 1 * DAY);
  });

  it('partial credit holds the current box but reschedules next_due', () => {
    const before = entry(3, NOW - 100 * DAY);
    const r = record(before, 0.5, NOW, 'e1');
    expect(r.box).toBe(3); // unchanged
    expect(r.next_due).toBe(NOW + BOX_INTERVALS[3] * DAY); // rescheduled forward
  });

  it('a miss resets any box to 1 with a 1-day interval', () => {
    for (const box of [2, 3, 4, 5, 6, 7, 8]) {
      const r = record(entry(box, NOW + 999 * DAY), 0, NOW, 'e1');
      expect(r.box).toBe(1);
      expect(r.next_due).toBe(NOW + 1 * DAY);
    }
  });

  it('clamps a corrupted box back into 1-8 so next_due never goes NaN', () => {
    // box 9 (or "3", or NaN) has no BOX_INTERVALS entry — without clamping,
    // next_due = now + undefined * DAY = NaN and the schedule corrupts further.
    const partial = record(entry(9, 0), 0.5, NOW, 'e'); // partial holds ground → clamp to 8
    expect(partial.box).toBe(8);
    expect(partial.next_due).toBe(NOW + BOX_INTERVALS[8] * DAY);

    const promoted = record(entry(99, 0), 1, NOW, 'e');
    expect(promoted.box).toBe(8);

    const nonNumeric = record({ box: Number.NaN, next_due: 0, history: [] }, 0.5, NOW, 'e');
    expect(nonNumeric.box).toBe(1); // unusable box → treated as box 1
    expect(Number.isFinite(nonNumeric.next_due)).toBe(true);
  });

  it('floors a fractional persisted box so next_due never goes NaN', () => {
    // A hand-edited or partially-migrated state file can persist a fractional box
    // (e.g. box: 2.5). Number.isFinite(2.5) is true, so the existing out-of-range/
    // non-numeric clamp above lets it through UNCHANGED — BOX_INTERVALS[2.5] has no
    // entry, so next_due = now + undefined * DAY = NaN.
    const partial = record(entry(2.5, 0), 0.5, NOW, 'e'); // partial holds ground → floors to 2
    expect(partial.box).toBe(2);
    expect(partial.next_due).toBe(NOW + BOX_INTERVALS[2] * DAY);
    expect(Number.isFinite(partial.next_due)).toBe(true);

    const promoted = record(entry(2.5, 0), 1, NOW, 'e'); // correct → floors to 2, then +1
    expect(promoted.box).toBe(3);
    expect(Number.isFinite(promoted.next_due)).toBe(true);

    const flooredNotRounded = record(entry(7.9, 0), 0.5, NOW, 'e'); // floor, never round up
    expect(flooredNotRounded.box).toBe(7);
  });

  it('sets next_due to the correct interval for every resulting box', () => {
    const documentedIntervals = [1, 3, 7, 14, 30, 90, 180, 365];
    for (const [index, intervalDays] of documentedIntervals.entries()) {
      const resultingBox = index + 1;
      const r = resultingBox === 1
        ? record(entry(8, 0), 0, NOW, 'e')
        : record(entry(resultingBox - 1, 0), 1, NOW, 'e');
      expect(r.box).toBe(resultingBox);
      expect(r.next_due).toBe(NOW + intervalDays * DAY);
    }
  });
});

describe('record — lifetime review load', () => {
  it('keeps 500 capped facts in a sane annual review band below the old ladder', () => {
    const START = 1_700_000_000_000;
    const WINDOW_DAYS = 365;
    const OLD_BOX_FIVE_INTERVAL_DAYS = 30;
    // Exact roughly-even split: 167 number, 167 rule, and 166 concept facts.
    const split = [
      { factType: 'number', cap: 6, count: 167 },
      { factType: 'rule', cap: 7, count: 167 },
      { factType: 'concept', cap: 8, count: 166 },
    ] as const;
    const facts = split.flatMap(({ factType, cap, count }) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${factType}-${i}`,
        factType,
        cap,
        entry: record(undefined, 1, START, `${factType}-${i}-0`, factType),
      })),
    );

    let now = START;
    let rampBatches = 0;
    while (facts.some((fact) => fact.entry.box !== fact.cap) && rampBatches < 100) {
      now = Math.min(...facts.map((fact) => fact.entry.next_due));
      for (const fact of facts) {
        if (fact.entry.next_due <= now) {
          fact.entry = record(fact.entry, 1, now, `${fact.id}-ramp-${rampBatches}`, fact.factType);
        }
      }
      rampBatches++;
    }
    expect(facts.every((fact) => fact.entry.box === fact.cap)).toBe(true);

    const steadyStateStart = now;
    const windowEnd = steadyStateStart + WINDOW_DAYS * DAY;
    let totalAnnualReviews = 0;
    while (true) {
      const nextDue = Math.min(...facts.map((fact) => fact.entry.next_due));
      if (nextDue > windowEnd) break;
      now = nextDue;
      for (const fact of facts) {
        if (fact.entry.next_due <= now) {
          fact.entry = record(fact.entry, 1, now, `${fact.id}-annual-${totalAnnualReviews}`, fact.factType);
          totalAnnualReviews++;
        }
      }
    }

    const oldLadderAnnualReviews = facts.length * (WINDOW_DAYS / OLD_BOX_FIVE_INTERVAL_DAYS);
    console.log(
      `Leitner lifetime simulation: totalAnnualReviews=${totalAnnualReviews}; ` +
        `oldLadderAnnualReviews=${oldLadderAnnualReviews}`,
    );
    expect(totalAnnualReviews).toBeLessThan(oldLadderAnnualReviews);
    expect(totalAnnualReviews).toBeGreaterThan(100);
    expect(totalAnnualReviews).toBeLessThan(5000);
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

  // `?? []` only guards null/undefined. A mangled srs.json whose history is any other
  // non-array (a number, an object — SrsStore validates the `facts` container, never the
  // entries) makes the spread throw "is not iterable", and it throws on EVERY subsequent
  // answer too: the failed write never replaces the bad shape on disk, so that fact is
  // permanently unanswerable. Heal it the way a corrupted box is healed.
  it('rebuilds history from scratch when the persisted history is not an array', () => {
    const mangled = { box: 3, next_due: NOW, history: 5 } as unknown as SrsEntry;
    const r = record(mangled, 1, NOW, 'e1');
    expect(r.box).toBe(4);
    expect(r.history).toEqual([
      { ts: new Date(NOW).toISOString(), quality: 1, encounter_id: 'e1' },
    ]);
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

  // A persisted box is only as trustworthy as the file it came from: SrsStore's shape
  // check validates that `facts` is an object, never each entry, so a hand-edited or
  // mangled srs.json can carry a non-number box straight into these two. masteryAvg
  // accumulates with `+`, so a string box concatenated instead of adding — "0"+"3"+5
  // = "035" → 17.5 — and that number is what the Dashboard and the companion mastery
  // gate read. Same tolerance record() already applies to a corrupted box.
  it('adds a numeric-string box arithmetically instead of concatenating it', () => {
    const mangled = state({
      a: { box: '3', next_due: NOW, history: [] } as unknown as SrsEntry,
      b: entry(5, NOW),
    });
    expect(boxOf(mangled, 'a')).toBe(3);
    expect(masteryAvg(mangled, ['a', 'b'])).toBe(4); // (3+5)/2, NOT "035"/2
  });

  it('treats an unparseable box as unseen instead of poisoning the average', () => {
    const mangled = state({
      a: { box: {}, next_due: NOW, history: [] } as unknown as SrsEntry,
      b: entry(4, NOW),
    });
    expect(boxOf(mangled, 'a')).toBe(0);
    expect(masteryAvg(mangled, ['a', 'b'])).toBe(2); // (0+4)/2, NOT NaN
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

  it('lets a welded canonical or alias record satisfy the other id in a prerequisite', () => {
    const meta = buildFactMeta([{
      id: 'aliases',
      pack: {
        facts: [
          { id: 'canonical' },
          { id: 'alias', duplicate_of: 'canonical' },
          { id: 'dependent', prereqs: ['alias'] },
          { id: 'canonical-dependent', prereqs: ['canonical'] },
          { id: 'free' },
        ],
      },
    }]).get('aliases')!;
    const canonicalWelded = state({ canonical: entry(2, NOW + DAY) });
    expect(dueQueue(canonicalWelded, ['dependent', 'free'], meta, NOW)).toEqual(['dependent', 'free']);

    const aliasWelded = state({ alias: entry(2, NOW + DAY) });
    expect(dueQueue(aliasWelded, ['canonical-dependent', 'free'], meta, NOW)).toEqual(['canonical-dependent', 'free']);

    const neither = state({});
    expect(dueQueue(neither, ['dependent', 'free'], meta, NOW)).toEqual(['free', 'dependent']);
  });
});
