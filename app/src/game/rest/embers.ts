/**
 * Rest-currency pure module (Concordance Ch. II + controller rulings). No Phaser,
 * no services — Tasks 3-5 (Cottage/dungeon wiring) consume these exact names.
 */

// becomes level-keyed in W4 — single source, do not inline elsewhere
export const EMBER_MAX = 2;
export const TRIM_HEAL_CORRECT = 4;
export const TRIM_HEAL_MISS = 1;

/** undefined → full pool (legacy save default); corrupt values clamp into 0..EMBER_MAX (integer floor). */
export function embersOf(save: { embers?: number }): number {
  const n = save.embers;
  if (n === undefined) return EMBER_MAX;
  return Math.max(0, Math.min(EMBER_MAX, Math.floor(n)));
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
