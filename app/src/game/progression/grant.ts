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
 * The values THIS module last computed, held only while its own save write is still in flight.
 *
 * Why it exists (Wave 4 final review, C1): services.save.get() is a synchronous cache read and
 * ObjectStore.save() (srs/store.ts) assigns that cache only at the END of its awaited
 * getState→putState round trip, while grantXp fires its write WITHOUT awaiting. So two grants in
 * one synchronous block both read the pre-first-grant cache, both build an ABSOLUTE xp patch, and
 * the serialized write chain lets the second silently overwrite the first — the first grant's XP
 * destroyed, and its level re-announced by the second. Two shipped sequences do exactly that
 * (DungeonScene.runGate's renewal-then-gate pass branch; bossVictory's boss-then-quest pair), and
 * HamletScene's doWellspring/doAmendments loops are the same shape, safe today only because a
 * human click outlasts a save round trip. Reading this baseline instead of the lagging cache
 * makes a SEQUENCE of grants safe at the seam, so no call site has to know about the hazard.
 *
 * SINGLE-WRITER ASSUMPTION (xp/level): sound only because grant.ts is the sole writer of xp and
 * level — the module contract stated at the top of this file, verified by grepping every
 * services.save.save() call site in app/src (they patch hp/scene/dungeon/streak/embers/lastPlayed,
 * never xp or level). If that ever stops being true, this baseline goes stale and must be dropped.
 *
 * hp is NOT single-writer (CombatScene's three sync sites, DungeonScene.applyHp, consume.ts all
 * write it), so it is carried only as far as it must be: the level-up bump of a LATER grant in the
 * same tick, which would otherwise re-bump from the same stale pool. That is also why the baseline
 * is released the moment the last grant write settles — from then on the store's cache is freshest
 * again, and a foreign hp write must win.
 */
let pending: { xp: number; hp?: number } | null = null;
let pendingWrites = 0;

/**
 * Grants XP from `source` and returns the levels gained (empty = no level-up ceremony).
 * Writes exactly one save patch: { xp, level, hp? }. hp is included only when a level was
 * gained AND opts.applyHp !== false, clamped to maxHpForLevel(newLevel) — the applyHp:false
 * escape is for mid-battle callers, where a scene-side live HP pool is authoritative and this
 * patch's hp would otherwise be clobbered by the scene's own next sync. CombatScene has three
 * such sync sites today (grep for "save.save({ hp" rather than trusting a line number — lines
 * shift): the satchel-heal sync (patches `{ hp: livePool }`), the death's-door revival sync
 * (patches `{ hp: pool }`), and Task 6's own renewal bump (patches `{ hp: raised }`), all
 * wrapped in a try/catch that silently swallows offline failures. Those callers apply +2/level to their own live pool themselves (Task 6 owns that
 * seam). Embers get no patch on level-up: an absent embers field reads as "full," so an
 * untouched pool grows with its new max for free, and a spent pool keeps its count under the
 * bigger cap — that's the intended cozy behavior, not an oversight.
 * Never throws synchronously: a services.save.get() failure (or any synchronous throw while
 * computing the patch) is caught, logged once, and the grant is dropped ([]). A
 * services.save.save() failure happens after levelsGained has already been computed and
 * returned to the caller — the synchronous try/catch can't reach it — so it's logged once via
 * a .catch() on the fire-and-forget call instead; the caller still gets the (optimistic)
 * levelsGained even though the patch silently failed to persist.
 */
export function grantXp(source: XpSource, opts?: { amount?: number; applyHp?: boolean }): number[] {
  try {
    const requested = source === 'quest' ? (opts?.amount ?? 0) : XP_AMOUNTS[source];
    const amount = Number.isFinite(requested) && requested > 0 ? requested : 0;

    // `pending` (see above) is the freshest value whenever an earlier grant's write from this
    // same tick has not landed in the cache yet; the cache is authoritative the rest of the time.
    const save = services.save.get();
    const { xp, levelsGained } = awardXp(pending?.xp ?? save.xp ?? 0, amount);
    const level = levelForXp(xp);

    const patch: Partial<SaveData> = { xp, level };
    if (levelsGained.length > 0 && opts?.applyHp !== false) {
      patch.hp = Math.min((pending?.hp ?? save.hp) + 2 * levelsGained.length, maxHpForLevel(level));
    }

    // A grant that patches no hp (no level gained, or applyHp:false) leaves an earlier grant's
    // in-flight hp standing as the baseline rather than reverting to the cache behind it.
    const carriedHp = patch.hp ?? pending?.hp;
    const write = services.save.save(patch);
    pending = { xp, hp: carriedHp };
    pendingWrites += 1;
    void write
      .catch((err) => {
        console.warn('[progression] grantXp failed — dropping this XP grant', err);
      })
      .finally(() => {
        // Last write settled → the store's cache now holds it; stop shadowing it.
        if ((pendingWrites -= 1) === 0) pending = null;
      });
    return levelsGained;
  } catch (err) {
    console.warn('[progression] grantXp failed — dropping this XP grant', err);
    return [];
  }
}
