import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLACEHOLDER, T1_BEATS, T2_BEATS, ARC1_BEATS } from './beats';
import { onwardOpenPage } from './books';

/**
 * The placeholder census (spec §6, ruling R20). T2 ships MECHANISM, not prose: every
 * player-visible string this wave introduces must be marked, so the creative block later
 * lands as a data edit and nothing unmarked can ship as if it were Fable's.
 *
 * The budget is a RATCHET: it may only ever go DOWN, as curated prose replaces a
 * placeholder. Raising it means new uncurated prose shipped — which is what this pins.
 */
const T2_STRING_BUDGET = 17; // 5 beats x (1 title + 2 pages) + margins on the Span and the Return

function beatStrings(b: { title: string; pages: string[]; margin?: string }): string[] {
  return [b.title, ...b.pages, ...(b.margin === undefined ? [] : [b.margin])];
}

describe('the T2 placeholder census', () => {
  it('every string on every T2 beat is marked', () => {
    for (const b of T2_BEATS) {
      for (const s of beatStrings(b)) expect(s, `${b.id}: "${s.slice(0, 50)}"`).toMatch(/^\[T2-PLACEHOLDER\] /);
    }
  });

  it('T1 is untouched — no placeholder crept backwards into shipped prose', () => {
    expect(T1_BEATS.flatMap(beatStrings).filter((s) => s.startsWith(PLACEHOLDER))).toEqual([]);
  });

  it('the placeholder count is at or under budget, and the budget only ratchets down', () => {
    const count = ARC1_BEATS.flatMap(beatStrings).filter((s) => s.startsWith(PLACEHOLDER)).length;
    expect(count, 'lower is better: each curated string removes one').toBeLessThanOrEqual(T2_STRING_BUDGET);
    expect(count, 'T2 as shipped carries exactly its budget').toBe(T2_STRING_BUDGET);
  });

  it("the desk's own new lines are marked too", () => {
    const allSeen = onwardOpenPage(() => true, { arcComplete: true });
    expect(allSeen.heading).toMatch(/^\[T2-PLACEHOLDER\] /);
    expect(allSeen.clerkLine).toMatch(/^\[T2-PLACEHOLDER\] /);
  });

  it('the road spec ships no unmarked prose', () => {
    const raw = JSON.parse(
      readFileSync(
        join(__dirname, '..', 'game', 'scenes', 'dungeon', '__fixtures__', 'arc01.road.json'),
        'utf8',
      ),
    ) as { name: string; region: string; rooms: { name: string; blurb?: string; boss?: { name: string } }[] };
    const prose = [
      raw.name,
      raw.region,
      ...raw.rooms.flatMap((r) => [r.name, ...(r.blurb ? [r.blurb] : []), ...(r.boss ? [r.boss.name] : [])]),
    ];
    for (const s of prose) expect(s, s).toMatch(/^\[T2-PLACEHOLDER\] /);
  });
});
