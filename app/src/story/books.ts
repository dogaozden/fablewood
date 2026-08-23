/**
 * The desk's two books (design §5). Canto unlocks gate on GLOBAL milestones only
 * (Unsealing D1: never per-subject): welds — facts at the shipped weld edge,
 * box >= 4 (contracts.ts NightLedgerData: "crossed into box ≥ 4, the weld-edge
 * mastery level") — or arc completions, whichever comes first. Milestone numbers
 * are the author-vetoable defaults (spec §5). The Clerk's lines are Fable's, verbatim.
 */
import { T1_BEATS } from './beats';

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

const NEXT_LINES: ReadonlyArray<[afterBeatId: string, line: string]> = [
  ['onward-01.fable-waywright', 'Next wants doing: the road past the fence. It waits.'],
  ['onward-01.barred-road', 'Next wants doing: a tale at the Acorn. Berry has it.'],
  ['onward-01.dark-answers', 'Next wants doing: the south road. Ask the gatewarden.'],
];

export function onwardOpenPage(isSeen: (beatId: string) => boolean): OnwardPage {
  const entries = T1_BEATS.filter((b) => isSeen(b.id)).map((b) => b.title);
  let clerkLine = 'The page is ruled and waiting.';
  for (const [afterId, line] of NEXT_LINES) {
    if (isSeen(afterId)) {
      clerkLine = line;
      break;
    }
  }
  return { heading: 'Chapter One — The Road That Waits', entries, clerkLine };
}
