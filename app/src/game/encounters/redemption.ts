/**
 * "Reclaimed from the Fade" — the verdict-moment redemption beat (fun-review.md §3.1).
 *
 * The peak of the game's loop is answering right a fact you once missed; this module dresses
 * that moment with a distinct chip, one deterministically-chosen Clerk line, and a modest
 * lantern-flare accent (the existing glow vocabulary, styles.ts). Dignity rule: a warm bell,
 * not confetti. The RULE itself is pure and lives in srs/redemption.ts; this is only its face.
 *
 * Called from every kind renderer at its verdict, and read BEFORE the answer is recorded, so
 * `services.srs.historyQualities` still returns the fact's PRIOR history (capture-before-record).
 */
import { services, type Quality } from '../contracts';
import { reclaimedFactId } from '../../srs/redemption';
import { el } from './dom';

/** The chip's eyebrow label. */
export const RECLAIM_LABEL = 'Reclaimed from the Fade';

/** The three Clerk lines (verbatim). One is chosen per fact by a stable hash so the same fact
 *  always bells the same line — a small, consistent voice rather than a random rotation. */
export const CLERK_LINES = [
  'The Fade held this one, once. It holds it no longer.',
  "Struck from the Fade's column. Entered in yours.",
  'Lost once. Kept now. The Ledger remembers both.',
] as const;

/** FNV-1a 32-bit — a stable, well-spread string hash (deterministic across sessions/platforms). */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The Clerk line for a fact — deterministic by factId over the three lines. */
export function lineFor(factId: string): string {
  return CLERK_LINES[hashString(factId) % CLERK_LINES.length];
}

export interface ReclaimBell {
  factId: string;
  line: string;
}

/**
 * Does answering these facts q(now) reclaim one from the Fade? Reads PRIOR history via
 * services.srs, so call it AT THE VERDICT (before the result is recorded). Returns the first
 * qualifying fact + its stable Clerk line, or null. Tolerant of an offline/stub SRS.
 */
export function reclaimBell(factIds: readonly string[], now: Quality): ReclaimBell | null {
  const id = reclaimedFactId(factIds, now, (fid) => {
    try {
      return services.srs.historyQualities(fid);
    } catch {
      return [];
    }
  });
  return id ? { factId: id, line: lineFor(id) } : null;
}

/** The bell chip: distinct label + one Clerk line + a lantern-flare glyph (glow vocabulary). */
export function reclaimChip(line: string): HTMLElement {
  return el('div', { class: 'fw-reclaim', role: 'status' }, [
    el('span', { class: 'fw-reclaim-flare', 'aria-hidden': 'true', text: '✦' }),
    el('span', { class: 'fw-reclaim-text' }, [
      el('span', { class: 'fw-reclaim-label', text: RECLAIM_LABEL }),
      el('span', { class: 'fw-reclaim-line', text: line }),
    ]),
  ]);
}
