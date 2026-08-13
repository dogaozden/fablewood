import { describe, it, expect } from 'vitest';
import { levelUpRows } from '../ceremony';

// Wave 4 Task 5 — the level-up ceremony's row builder. Exact-string pins against the FINAL
// Fable copy (task-5-brief.md, Constraint 11 — transcribe verbatim). ceremony.ts derives the
// ember/strike/art rows from xp.ts's own emberMaxForLevel/strikeBonusForLevel/tierForLevel
// (a before/after crossing check), never re-hardcoding the {3,5,7,9}/{5,9}/{3,6} sets — these
// pins exercise every crossing combination those sets produce, not just the brief's three.

describe('levelUpRows', () => {
  it('a single level crossing nothing: title + one level row + HP row + signoff, no bonus rows', () => {
    expect(levelUpRows([2])).toEqual({
      title: 'The Lantern Burns Brighter',
      rows: ['Level 2 — the road remembers you.', "The party's pool deepens: +2."],
      signoff: 'Walk taller, Keeper.',
    });
  });

  it('two levels crossing an ember AND an art boundary but not strike', () => {
    expect(levelUpRows([2, 3])).toEqual({
      title: 'The Lantern Burns Brighter',
      rows: [
        'Level 2 — the road remembers you.',
        'Level 3 — the road remembers you.',
        "The party's pool deepens: +4.",
        'A new ember settles in the hearth.',
        'A higher Art opens to you.',
      ],
      signoff: 'Walk taller, Keeper.',
    });
  });

  it('a single level crossing ember AND strike but not art', () => {
    expect(levelUpRows([5])).toEqual({
      title: 'The Lantern Burns Brighter',
      rows: [
        'Level 5 — the road remembers you.',
        "The party's pool deepens: +2.",
        'A new ember settles in the hearth.',
        'Your Strike lands heavier.',
      ],
      signoff: 'Walk taller, Keeper.',
    });
  });

  it('a single level crossing ONLY the art (tier) boundary — level 6, not covered by the other pins', () => {
    expect(levelUpRows([6])).toEqual({
      title: 'The Lantern Burns Brighter',
      rows: [
        'Level 6 — the road remembers you.',
        "The party's pool deepens: +2.",
        'A higher Art opens to you.',
      ],
      signoff: 'Walk taller, Keeper.',
    });
  });

  it('no levels gained → no ceremony', () => {
    expect(levelUpRows([])).toBeNull();
  });
});
