import { describe, it, expect } from 'vitest';
import { enterDoor, recordAnswer, SUCCESS_NEED, FAIL_LIMIT, REVIVE_BOX } from '../deathsdoor';

const ok = (box = 1) => ({ quality: 1, box });
const miss = (box = 1) => ({ quality: 0, box });

function drive(s: ReturnType<typeof enterDoor>, answers: { quality: number; box: number }[]) {
  let cur = s, last: ReturnType<typeof recordAnswer> | null = null;
  for (const a of answers) { last = recordAnswer(cur, a); cur = last.next; }
  return last!;
}

describe('deathsdoor state machine', () => {
  it('three successes stabilize on the third', () => {
    const r = drive(enterDoor(false), [ok(), ok(), ok()]);
    expect(r.event).toBe('stabilized');
    expect(r.next.successes).toBe(SUCCESS_NEED);
  });

  it('three failures wipe on the third', () => {
    const r = drive(enterDoor(false), [miss(), miss(), miss()]);
    expect(r.event).toBe('wiped');
    expect(r.next.failures).toBe(FAIL_LIMIT);
  });

  it('interleaved 2-2 then a success holds, then stabilizes', () => {
    const first = drive(enterDoor(false), [ok(), miss(), ok(), miss()]);
    expect(first.event).toBe('hold');
    const done = recordAnswer(first.next, ok());
    expect(done.event).toBe('stabilized');
  });

  it('perfect recall (quality 1, box >= REVIVE_BOX) revives when unused', () => {
    const r = recordAnswer(enterDoor(false), ok(REVIVE_BOX));
    expect(r.event).toBe('revived');
    expect(r.next.revivedUsed).toBe(true);
  });

  it('revive already used: welded correct counts as a plain success', () => {
    const r = recordAnswer(enterDoor(true), ok(8));
    expect(r.event).toBe('hold');
    expect(r.next.successes).toBe(1);
    expect(r.next.revivedUsed).toBe(true);
  });

  it('box below threshold never revives', () => {
    const r = recordAnswer(enterDoor(false), ok(REVIVE_BOX - 1));
    expect(r.event).toBe('hold');
    expect(r.next.revivedUsed).toBe(false);
  });

  it('DD-KNOB-1 pin: partial credit (0.5) is a failure at the door', () => {
    const r = recordAnswer(enterDoor(false), { quality: 0.5, box: 8 });
    expect(r.event).toBe('hold');
    expect(r.next.failures).toBe(1);
    expect(r.next.successes).toBe(0);
  });

  it('a miss on a welded fact is still just a failure (box irrelevant on miss)', () => {
    const r = recordAnswer(enterDoor(false), miss(8));
    expect(r.event).toBe('hold');
    expect(r.next.failures).toBe(1);
  });

  it('revive takes precedence over the would-be third success', () => {
    const first = drive(enterDoor(false), [ok(1), ok(1)]);
    const r = recordAnswer(first.next, ok(REVIVE_BOX));
    expect(r.event).toBe('revived');
  });

  it('enterDoor resets counters but carries the battle revive flag', () => {
    const s = enterDoor(true);
    expect(s).toEqual({ successes: 0, failures: 0, revivedUsed: true });
  });
});
