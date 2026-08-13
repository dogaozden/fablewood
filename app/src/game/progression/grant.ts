/**
 * grantXp — the ONE seam every XP grant in the game flows through (Concordance Ch. III /
 * Wave 4 Task 3). Reads the save, runs the numbers through progression/xp.ts, and writes ONE
 * atomic services.save.save() patch. Later tasks call ONLY this; nothing else may ever write
 * xp/level directly.
 */
import { services, type SaveData } from '../contracts';
import { awardXp, levelForXp, maxHpForLevel } from './xp';

export type XpSource =
  | 'renewal'
  | 'room-clear'
  | 'room-clear-flawless'
  | 'gate'
  | 'boss'
  | 'amendment'
  | 'hearth-streak'
  | 'quest';

/** Constraint-1 numbers. quest: 0 is a sentinel — quest amounts are pack-authored and always
 *  arrive via opts.amount. */
export const XP_AMOUNTS: Record<XpSource, number> = {
  renewal: 5,
  'room-clear': 25,
  'room-clear-flawless': 40,
  gate: 10,
  boss: 150,
  amendment: 20,
  'hearth-streak': 30,
  quest: 0,
};

/**
 * Grants XP from `source` and returns the levels gained (empty = no level-up ceremony).
 * Writes exactly one save patch: { xp, level, hp? }. hp is included only when a level was
 * gained AND opts.applyHp !== false, clamped to maxHpForLevel(newLevel) — the applyHp:false
 * escape is for mid-battle callers (CombatScene's renewal choke point), where the live HP
 * pool is authoritative and would otherwise clobber this patch on its own next sync
 * (CombatScene.ts:1902 precedent); those callers apply +2/level to the live pool themselves.
 * Embers get no patch on level-up: an absent embers field reads as "full," so an untouched
 * pool grows with its new max for free, and a spent pool keeps its count under the bigger
 * cap — that's the intended cozy behavior, not an oversight.
 * Never throws: a services.save failure is logged once and the grant is dropped ([]).
 */
export function grantXp(source: XpSource, opts?: { amount?: number; applyHp?: boolean }): number[] {
  try {
    const requested = source === 'quest' ? (opts?.amount ?? 0) : XP_AMOUNTS[source];
    const amount = Number.isFinite(requested) && requested > 0 ? requested : 0;

    const save = services.save.get();
    const { xp, levelsGained } = awardXp(save.xp ?? 0, amount);
    const level = levelForXp(xp);

    const patch: Partial<SaveData> = { xp, level };
    if (levelsGained.length > 0 && opts?.applyHp !== false) {
      patch.hp = Math.min(save.hp + 2 * levelsGained.length, maxHpForLevel(level));
    }

    void services.save.save(patch);
    return levelsGained;
  } catch (err) {
    console.warn('[progression] grantXp failed — dropping this XP grant', err);
    return [];
  }
}
