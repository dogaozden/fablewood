/**
 * Dashboard retention math — PURE, no I/O (mirrors srs/leitner.ts's discipline:
 * deterministic given an injected `now`, unit-testable without a bridge).
 * Dashboard.tsx does the fetching (getPacks/getState) and hands plain data in here.
 *
 * "Domain" = pack. A Fact carries a freeform `tags?: string[]` array (not a single
 * exclusive category), so grouping by tag would double-count facts across domains;
 * packId is the only unambiguous partition, and it's what Library.tsx's per-province
 * view already uses.
 */
import type { SrsEntry, HistoryItem } from '../srs/leitner';

const DAY_MS = 86_400_000;

/** Facts per Leitner box, indexed 0 (never seen) through 5 (mastered). */
export type BoxCounts = [number, number, number, number, number, number];

/** How many of `factIds` sit in each box. Ids missing from `facts` count as box 0. */
export function boxDistribution(
  factIds: string[],
  facts: Record<string, Pick<SrsEntry, 'box'>>,
): BoxCounts {
  const counts: BoxCounts = [0, 0, 0, 0, 0, 0];
  for (const id of factIds) {
    const raw = facts[id]?.box;
    const box = Number.isFinite(raw) ? Math.min(Math.max(Math.round(raw as number), 0), 5) : 0;
    counts[box]++;
  }
  return counts;
}

/** End-of-local-day boundary, `daysAhead` days from `now` (0 = today). Exported so
 *  tests can derive expected bucket edges without re-implementing the formula. */
export function endOfDay(now: number, daysAhead: number): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime() + daysAhead * DAY_MS;
}

export interface DueForecast {
  today: number;
  tomorrow: number;
  week: number;
}

/**
 * Bucket SEEN facts (an SrsEntry exists) by next_due into non-overlapping windows:
 *   today    — next_due <= end of today (so anything overdue counts here too)
 *   tomorrow — end of today  < next_due <= end of tomorrow
 *   week     — end of tomorrow < next_due <= end of today+7
 * Unseen facts have no next_due and are excluded — "due" only applies to a fact the
 * Ledger has already met. Anything beyond the week window is excluded too (not a
 * near-term forecast concern).
 */
export function dueForecast(
  factIds: string[],
  facts: Record<string, Pick<SrsEntry, 'next_due'>>,
  now: number,
): DueForecast {
  const todayEnd = endOfDay(now, 0);
  const tomorrowEnd = endOfDay(now, 1);
  const weekEnd = endOfDay(now, 7);
  const out: DueForecast = { today: 0, tomorrow: 0, week: 0 };
  for (const id of factIds) {
    const nd = facts[id]?.next_due;
    if (typeof nd !== 'number' || !Number.isFinite(nd)) continue;
    if (nd <= todayEnd) out.today++;
    else if (nd <= tomorrowEnd) out.tomorrow++;
    else if (nd <= weekEnd) out.week++;
  }
  return out;
}

export interface FlatHistoryItem {
  /** epoch ms, parsed from the ISO ts; unparseable timestamps sort last (never first). */
  ts: number;
  quality: HistoryItem['quality'];
}

/** Merge every fact's history into one list, sorted most-recent first. */
export function flattenHistory(facts: Record<string, Pick<SrsEntry, 'history'>>): FlatHistoryItem[] {
  const out: FlatHistoryItem[] = [];
  for (const entry of Object.values(facts)) {
    for (const h of entry.history ?? []) {
      const t = Date.parse(h.ts);
      out.push({ ts: Number.isFinite(t) ? t : -Infinity, quality: h.quality });
    }
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

/** Consecutive full-credit (quality 1) answers counting back from the most recent.
 *  A partial or a miss both break it — "current streak" means "how many in a row
 *  did you fully nail," not merely attempted. */
export function currentStreak(history: FlatHistoryItem[]): number {
  let n = 0;
  for (const h of history) {
    if (h.quality !== 1) break;
    n++;
  }
  return n;
}

/** Pass rate (quality === 1) over the most recent `n` answers (fewer if history is
 *  shorter — never padded). `sample` is how many answers the rate is actually over,
 *  so callers can show "71% (last 7)" honestly when N hasn't been reached yet. */
export function passRate(history: FlatHistoryItem[], n: number): { rate: number; sample: number } {
  const window = history.slice(0, n);
  if (window.length === 0) return { rate: 0, sample: 0 };
  const passes = window.filter((h) => h.quality === 1).length;
  return { rate: (passes / window.length) * 100, sample: window.length };
}

export interface WeakBinding {
  id: string;
  box: number;
  missedAt: number;
}

/**
 * Facts whose MOST RECENT answer was a miss (quality 0) — the ones most worth a
 * Wellspring return trip. A fact missed long ago but since corrected is NOT weak
 * (its latest entry is a pass/partial) and is excluded even though an old miss sits
 * in its history. Sorted most-recent-miss first.
 */
export function weakestBindings(
  facts: Record<string, Pick<SrsEntry, 'box' | 'history'>>,
  limit = 5,
): WeakBinding[] {
  const misses: WeakBinding[] = [];
  for (const [id, entry] of Object.entries(facts)) {
    const history = entry.history ?? [];
    const last = history[history.length - 1];
    if (!last || last.quality !== 0) continue;
    const t = Date.parse(last.ts);
    misses.push({ id, box: entry.box, missedAt: Number.isFinite(t) ? t : 0 });
  }
  misses.sort((a, b) => b.missedAt - a.missedAt);
  return misses.slice(0, limit);
}
