/**
 * Rest-currency pure module (Concordance Ch. II + controller rulings). No Phaser,
 * no services — Tasks 3-5 (Cottage/dungeon wiring) consume these exact names.
 */
import { emberMaxForLevel } from '../progression/xp';

export const TRIM_HEAL_CORRECT = 4;
export const TRIM_HEAL_MISS = 1;

/** undefined → full pool AT THE SAVE'S LEVEL (Wave 4 — the old flat 2-constant export died;
 *  the ceiling is now progression/xp.ts's emberMaxForLevel, the single seam every Ember cap
 *  reads); corrupt values clamp into 0..emberMaxForLevel(level) (integer floor). */
export function embersOf(save: { embers?: number; level?: number }): number {
  const max = emberMaxForLevel(save.level ?? 1);
  const n = save.embers;
  if (n === undefined) return max;
  return Math.max(0, Math.min(max, Math.floor(n)));
}

/**
 * True if never rested, or if lastHearthAt's LOCAL calendar date (year-month-day)
 * differs from now's — cross-midnight play re-arms the Hearth (RK-2, ruled).
 * Unparseable stamps never brick the Hearth: treated as never-rested.
 */
export function canRestTonight(lastHearthAt: string | undefined, now: Date): boolean {
  if (!lastHearthAt) return true;
  const last = new Date(lastHearthAt);
  if (isNaN(last.getTime())) return true;
  return (
    last.getFullYear() !== now.getFullYear() ||
    last.getMonth() !== now.getMonth() ||
    last.getDate() !== now.getDate()
  );
}
