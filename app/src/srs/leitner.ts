/**
 * Leitner spaced-repetition core — PURE, no I/O. Ported from the Bar repo per
 * Fable_SPEC.md §2 and slice-blueprint §2, with the wave-2 partial-credit rule.
 *
 * Boxes 1-8. Correct promotes up to the fact type's ceiling; partial holds
 * ground; miss resets to 1. An unseen fact is treated as sitting in box 1, so
 * its first answer lands at box 2 (correct) or box 1 (partial / miss). `boxOf`
 * still reports 0 for unseen facts — that is a display concern (contracts:
 * "0 = unseen"), separate from the transition math here.
 *
 * All functions are deterministic given `now`; time is always injected.
 */
import type { Quality } from '../game/contracts';

const DAY_MS = 86_400_000;

/** Review interval (days) for each box. Longer box = longer until next due. */
export const BOX_INTERVALS: Record<number, number> = {
  1: 1,
  2: 3,
  3: 7,
  4: 14,
  5: 30,
  6: 90,
  7: 180,
  8: 365,
};

export const MIN_BOX = 1;
export const MAX_BOX = 8;

/**
 * V1 tuning knob for promotion ceilings. Perishable knowledge (statute numbers,
 * current-law rules) must resurface more often than durable concepts, so a
 * fact's type ceilings how far up the ladder it can climb. Everything not
 * explicitly listed defaults to the full ladder.
 */
export const FACT_TYPE_PROMOTION_CAPS: Readonly<Record<string, number>> = {
  number: 6,
  rule: 7,
};

/** Return a safe promotion cap for any fact type, including malformed input. */
export function capFor(factType?: string): number {
  const configured = factType !== undefined &&
    Object.prototype.hasOwnProperty.call(FACT_TYPE_PROMOTION_CAPS, factType)
    ? FACT_TYPE_PROMOTION_CAPS[factType]
    : MAX_BOX;
  if (!Number.isFinite(configured)) return MAX_BOX;
  return Math.min(Math.max(Math.trunc(configured), MIN_BOX), MAX_BOX);
}

export interface HistoryItem {
  /** ISO-8601 timestamp of the answer. */
  ts: string;
  quality: Quality;
  encounter_id: string;
}

export interface SrsEntry {
  /** Leitner box 1-8. A persisted entry always has box >= 1 (it has been seen). */
  box: number;
  /** Epoch ms when this fact is next due for review. */
  next_due: number;
  history: HistoryItem[];
}

export interface SrsState {
  version: 1;
  facts: Record<string, SrsEntry>;
  /** Foreign/unknown top-level keys are preserved on merge, never dropped. */
  [key: string]: unknown;
}

/** Minimal per-fact metadata dueQueue needs for prereq gating. */
export interface FactMeta {
  prereqs: string[];
}

/** Box a fact currently occupies. 0 = never seen (contracts: "0 = unseen"). */
export function boxOf(state: SrsState, factId: string): number {
  return state.facts[factId]?.box ?? 0;
}

/** Average box across facts (unseen counts as 0), 0-8. Empty set → 0. */
export function masteryAvg(state: SrsState, factIds: string[]): number {
  if (factIds.length === 0) return 0;
  let sum = 0;
  for (const id of factIds) sum += boxOf(state, id);
  return sum / factIds.length;
}

/**
 * Apply one answer to a fact's entry and return the NEW entry (pure — the input
 * is not mutated). `entry === undefined` means the fact has never been seen; it
 * is treated as box 1 before the transition.
 *
 *   quality 1   (correct) → box + 1, capped by fact type (never demotes)
 *   quality 0.5 (partial) → box unchanged (holds ground, but reschedules)
 *   quality 0   (miss)    → box 1
 *
 * next_due is always recomputed from the new box's interval, so even a partial
 * pushes the fact forward in time.
 */
export function record(
  entry: SrsEntry | undefined,
  quality: Quality,
  now: number,
  encounterId: string,
  factType?: string,
): SrsEntry {
  // unseen == box 1 for transition purposes; a corrupted box (out of range /
  // non-numeric / fractional from a mangled or hand-edited state file) is
  // clamped AND floored so BOX_INTERVALS[newBox] can never be undefined — an
  // in-range fractional box (e.g. 2.5) is Number.isFinite, so the range clamp
  // alone would let it sail through unchanged, and BOX_INTERVALS has no
  // fractional keys: that would poison next_due with NaN just the same.
  const rawBox = entry?.box;
  const curBox = Number.isFinite(rawBox)
    ? Math.floor(Math.min(Math.max(rawBox as number, MIN_BOX), MAX_BOX))
    : MIN_BOX;
  let newBox: number;
  if (quality === 1) newBox = Math.max(curBox, Math.min(curBox + 1, capFor(factType)));
  else if (quality === 0.5) newBox = curBox;
  else newBox = MIN_BOX;

  const next_due = now + BOX_INTERVALS[newBox] * DAY_MS;
  const history: HistoryItem[] = [
    ...(entry?.history ?? []),
    { ts: new Date(now).toISOString(), quality, encounter_id: encounterId },
  ];
  return { box: newBox, next_due, history };
}

/**
 * Order facts for review (contracts.dueQueue). Given the pack-declared order of
 * `factIds`:
 *   1. seen & due (next_due <= now) — most overdue first, then lowest box;
 *   2. seen & not due — EXCLUDED (they are not due);
 *   3. unseen — appended in the given order, but prereq-gated: unseen facts
 *      whose prereqs are ALL welded (box >= 2) come before unseen facts with an
 *      unmet prereq. A fact with no prereqs is vacuously ready.
 *
 * `factMeta` maps factId → { prereqs }. Missing entries are treated as no
 * prereqs (tolerant of packs that omit metadata).
 */
export function dueQueue(
  state: SrsState,
  factIds: string[],
  factMeta: Map<string, FactMeta>,
  now: number,
): string[] {
  const seenDue: { id: string; box: number; due: number }[] = [];
  const unseen: string[] = [];

  for (const id of factIds) {
    const entry = state.facts[id];
    if (!entry) {
      unseen.push(id);
    } else if (!Number.isFinite(entry.next_due)) {
      // Malformed entry (missing/NaN next_due from a mangled state file): the
      // comparison below would be false forever, silently hiding the fact from
      // review. Surface it as most-overdue instead — the next record() heals it.
      seenDue.push({ id, box: entry.box, due: -Infinity });
    } else if (entry.next_due <= now) {
      seenDue.push({ id, box: entry.box, due: entry.next_due });
    }
    // seen & not due → excluded
  }

  // most overdue first (earliest next_due), tie-break lowest box first
  seenDue.sort((a, b) => a.due - b.due || a.box - b.box);

  // unseen: prereqs-welded first, preserve declaration order within each group
  const ready: string[] = [];
  const blocked: string[] = [];
  for (const id of unseen) {
    const prereqs = factMeta.get(id)?.prereqs ?? [];
    const welded = prereqs.every((p) => boxOf(state, p) >= 2);
    (welded ? ready : blocked).push(id);
  }

  return [...seenDue.map((x) => x.id), ...ready, ...blocked];
}

/**
 * Build the packId → (factId → FactMeta) index from raw pack entries (the shape
 * GET /api/packs returns). Tolerant of malformed packs: anything that does not
 * look like a fact list is skipped rather than throwing.
 */
export function buildFactMeta(
  packs: Array<{ id: string; pack: unknown }>,
): Map<string, Map<string, FactMeta>> {
  const byPack = new Map<string, Map<string, FactMeta>>();
  for (const entry of packs) {
    const facts = (entry.pack as { facts?: unknown })?.facts;
    if (!Array.isArray(facts)) continue;
    const meta = new Map<string, FactMeta>();
    for (const f of facts) {
      const id = (f as { id?: unknown })?.id;
      if (typeof id !== 'string') continue;
      const rawPrereqs = (f as { prereqs?: unknown }).prereqs;
      const prereqs = Array.isArray(rawPrereqs)
        ? rawPrereqs.filter((p): p is string => typeof p === 'string')
        : [];
      meta.set(id, { prereqs });
    }
    byPack.set(entry.id, meta);
  }
  return byPack;
}
