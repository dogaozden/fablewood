/**
 * The desk's two books (design §5). Canto unlocks gate on GLOBAL milestones only
 * (Unsealing D1: never per-subject): welds — facts at the shipped weld edge,
 * box >= 4 (contracts.ts NightLedgerData: "crossed into box ≥ 4, the weld-edge
 * mastery level") — or arc completions, whichever comes first. Milestone numbers
 * are the author-vetoable defaults (spec §5). The Clerk's lines are Fable's, verbatim.
 */
import { ARC1_BEATS } from './beats';

export const CANTO_MILESTONES = [5, 10, 15, 20, 25];

export function weldCount(allFactIds: string[], boxOf: (id: string) => number): number {
  let n = 0;
  for (const id of allFactIds) if (boxOf(id) >= 4) n++;
  return n;
}

/** index 0-based over the seven cantos; I–II free, III–VII gated. */
export function cantoUnlocked(index: number, welds: number, arcsCompleted: number): boolean {
  if (index <= 1) return true;
  const gate = index - 2; // canto III → milestone[0], … canto VII → milestone[4]
  return welds >= CANTO_MILESTONES[gate] || arcsCompleted >= gate + 1;
}

export interface OnwardPage {
  heading: string;
  entries: string[];
  clerkLine: string;
}

/** Most-advanced-first: the first row whose beat is seen wins. T2 rows carry the
 *  placeholder prefix; the curated lines replace these strings and nothing else. */
const NEXT_LINES: ReadonlyArray<[afterBeatId: string, line: string]> = [
  ['onward-01.the-return', '[T2-PLACEHOLDER] Next wants doing: the next chapter. The page turns.'],
  ['onward-01.the-span', '[T2-PLACEHOLDER] Next wants doing: the walk home.'],
  ['onward-01.hollis-promise', '[T2-PLACEHOLDER] Next wants doing: the Span, and whatever keeps its toll.'],
  ['onward-01.the-middles', '[T2-PLACEHOLDER] Next wants doing: the third stone.'],
  ['onward-01.first-waystone', '[T2-PLACEHOLDER] Next wants doing: the middles, stone by stone.'],
  ['onward-01.fable-waywright', 'Next wants doing: the road past the fence. It waits.'],
  ['onward-01.barred-road', 'Next wants doing: a tale at the Acorn. Berry has it.'],
  ['onward-01.dark-answers', 'Next wants doing: the south road. Ask the gatewarden.'],
];

const OPEN_HEADING = 'Chapter One — The Road That Waits';
const CLOSED_HEADING = '[T2-PLACEHOLDER] Chapter One — closed. The next page is open.';

/** `arcComplete` — the arc's own completion stamp (state/story.json's completedArcs), not a
 *  beat: the Return's card is what writes it (beats.ts BEAT_AFTER_EFFECTS), and the desk may
 *  be opened long afterwards on a save whose beats were all seen. The empty-state law
 *  (universe design §4) says the open page is never blank — every state above has a line. */
export function onwardOpenPage(
  isSeen: (beatId: string) => boolean,
  opts?: { arcComplete?: boolean },
): OnwardPage {
  const entries = ARC1_BEATS.filter((b) => isSeen(b.id)).map((b) => b.title);
  let clerkLine = 'The page is ruled and waiting.';
  for (const [afterId, line] of NEXT_LINES) {
    if (isSeen(afterId)) {
      clerkLine = line;
      break;
    }
  }
  return { heading: opts?.arcComplete ? CLOSED_HEADING : OPEN_HEADING, entries, clerkLine };
}
