/**
 * The level-up ceremony's row builder (Wave 4 Task 5 — Concordance Ch. III). Pure; no Phaser,
 * no services. The only module besides xp.ts allowed to know which levels grant what — and it
 * derives that from xp.ts's own functions via a before/after crossing check, never re-hardcoding
 * the {3,5,7,9}/{5,9}/{3,6} sets, so a future change to those tables can't silently drift the
 * ceremony copy out of sync with the tables it's describing.
 *
 * FINAL Fable copy below (task-5-brief.md — transcribe verbatim, Constraint 11).
 */
import { emberMaxForLevel, strikeBonusForLevel, tierForLevel } from './xp';

export interface LevelUpCeremony {
  title: string;
  rows: string[];
  signoff: string;
}

export const LEVEL_UP_TITLE = 'The Lantern Burns Brighter';
export const LEVEL_UP_SIGNOFF = 'Walk taller, Keeper.';

const crossedEmber = (level: number): boolean => emberMaxForLevel(level) > emberMaxForLevel(level - 1);
const crossedStrike = (level: number): boolean => strikeBonusForLevel(level) > strikeBonusForLevel(level - 1);
const crossedArt = (level: number): boolean => tierForLevel(level) > tierForLevel(level - 1);

/**
 * Builds the level-up ceremony for every level in `levels` (awardXp's own levelsGained, in
 * order). Returns null for an empty list — no ceremony when nothing was gained; callers check
 * for null and skip presentLevelUp entirely.
 */
export function levelUpRows(levels: number[]): LevelUpCeremony | null {
  if (levels.length === 0) return null;

  const rows: string[] = levels.map((level) => `Level ${level} — the road remembers you.`);
  rows.push(`The party's pool deepens: +${2 * levels.length}.`);
  if (levels.some(crossedEmber)) rows.push('A new ember settles in the hearth.');
  if (levels.some(crossedStrike)) rows.push('Your Strike lands heavier.');
  if (levels.some(crossedArt)) rows.push('A higher Art opens to you.');

  return { title: LEVEL_UP_TITLE, rows, signoff: LEVEL_UP_SIGNOFF };
}
