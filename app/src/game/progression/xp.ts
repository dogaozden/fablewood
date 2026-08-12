/**
 * Wave 4 progression numbers — Concordance Ch. III ("the table is the contract").
 * EVERY leveling number in the game lives here and only here (Constraint 2).
 * Pure: no Phaser, no services, no imports.
 */
export const XP_THRESHOLDS: readonly number[] = [100, 300, 700, 1400, 2500, 4200, 6500, 9500, 13500];
export const LEVEL_CAP = 10;

const cleanXp = (xp: number): number => (Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0);
const clampLevel = (level: number): number =>
  Number.isFinite(level) ? Math.max(1, Math.min(LEVEL_CAP, Math.floor(level))) : 1;

export function levelForXp(xp: number): number {
  const x = cleanXp(xp);
  let level = 1;
  for (const need of XP_THRESHOLDS) {
    if (x >= need) level++;
    else break;
  }
  return level;
}

/** XP is never lost (Constraint 5): non-positive/non-finite deltas award nothing. */
export function awardXp(currentXp: number, delta: number): { xp: number; levelsGained: number[] } {
  const before = cleanXp(currentXp);
  const gain = Number.isFinite(delta) && delta > 0 ? Math.floor(delta) : 0;
  const xp = before + gain;
  const levelsGained: number[] = [];
  for (let level = levelForXp(before) + 1; level <= levelForXp(xp); level++) levelsGained.push(level);
  return { xp, levelsGained };
}

export function maxHpForLevel(level: number): number {
  return 16 + 2 * (clampLevel(level) - 1);
}

const EMBER_GRANT_LEVELS: readonly number[] = [3, 5, 7, 9];
export function emberMaxForLevel(level: number): number {
  const l = clampLevel(level);
  return 2 + EMBER_GRANT_LEVELS.filter((g) => l >= g).length;
}

export function strikeBonusForLevel(level: number): number {
  const l = clampLevel(level);
  return (l >= 5 ? 1 : 0) + (l >= 9 ? 1 : 0);
}

export function tierForLevel(level: number): 1 | 2 | 3 {
  const l = clampLevel(level);
  return l >= 6 ? 3 : l >= 3 ? 2 : 1;
}
