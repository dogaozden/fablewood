/**
 * Lantern-light (Concordance Ch. IV) — the pure half of the re-draw spend, shared by the
 * three v1 surfaces (combat casts, Wellspring rounds, Death's Door). Scenes hold the drawn
 * pool for the round; a redraw re-presents from that SAME pool minus what was shown — no
 * fresh services.draw call (draw-census law: five sites, unchanged). Death's Door, whose
 * pool is a single fact, is the one surface that re-draws for real: ddDraw with
 * LANTERN_REDRAW_SALT and an exclusion list.
 */
import { services } from './contracts';
import { mulberry32, layoutSeed } from './combat/rng';
import { seededShuffle } from './recency';

/** The guarded read shared verbatim by all five spend sites (DungeonScene's loot offer,
 *  HamletScene's Wellspring round, CombatScene's two cast sites + Death's Door): a
 *  save-service fault must degrade to "no lantern held," never throw into the caller's own
 *  encounter/loot flow (T4 review ruling, C6 extraction). */
export function heldLanternLight(): boolean {
  try { return services.save.get()?.lanternLight === true; } catch { return false; }
}

export interface RedrawPlan {
  /** true = an alternative exists; spend the lantern and present factIds.
   *  false = fate holds; lantern NOT consumed; factIds is the original pool. */
  consume: boolean;
  factIds: string[];
}

export function planRedraw(shownFactIds: string[], drawnPool: string[]): RedrawPlan {
  const shown = new Set(shownFactIds);
  const rest = drawnPool.filter((id) => !shown.has(id));
  return rest.length ? { consume: true, factIds: rest } : { consume: false, factIds: drawnPool };
}

/** Death's-Door replacement-draw salt — added to the round seed so the re-pick is
 *  deterministic but distinct from the round's own draw. */
export const LANTERN_REDRAW_SALT = 7351;

/**
 * 2.16 — Death's Door's LAST-resort tier (CombatScene.ddDraw), reached only when the SRS
 * due/fresh services yield nothing usable: a seeded shuffle over the caller's (already
 * eligibility-filtered) candidate pool, minus excludeIds. This is the seam that makes this
 * file's own header law ("deterministic but distinct from the round's original draw")
 * checkable at all: `ddFallbackPick(roundSeed, ids)` is the round's own draw,
 * `ddFallbackPick(roundSeed + LANTERN_REDRAW_SALT, ids, [shownId])` is the redraw, and the two
 * must (a) differ over a multi-fact pool, (b) never return an excluded id, and (c) reproduce
 * identically given the same seed twice.
 *
 * Pulled out of ddDraw (a private, async, Phaser-Scene-bound CombatScene method) rather than
 * tested in place: CombatScene.ts imports Phaser at module scope, which throws
 * `window is not defined` under vitest's node environment the instant the file is imported —
 * nothing in that class, pure or not, is reachable from a test. `eligibleFactIds` (the
 * services.amendments-backed eligibility filter ddDraw applies before this tier) stays a
 * CombatScene method and is passed in already-resolved, since it's a guarded service call, not
 * part of the seed-reuse law itself.
 */
export function ddFallbackPick(seed: number, eligibleIds: readonly string[], excludeIds: readonly string[] = []): string | null {
  const exclude = new Set(excludeIds);
  const pool = eligibleIds.filter((id) => !exclude.has(id));
  return seededShuffle(pool, mulberry32(layoutSeed('deathsdoor-fallback', seed)))[0] ?? null;
}

/** Shown (via EncounterRequest.notice) when a re-draw finds no alternative memory. */
export const FATE_HOLDS_LINE = 'The lantern flickers — fate holds this memory fast. Your light is not spent.';

/** Shown (scene banner or EncounterRequest.notice, per site) when the Second Wick catches the
 *  spend — Concordance Ch. IX, corrected 2026-08-17. Verbatim, controller-ruled. */
export const WICK_CATCH_LINE = 'The second wick catches.';

/**
 * Spend the held Lantern-light — the ONE write shared by all five spend sites (DungeonScene's
 * loot offer, HamletScene's Wellspring round, CombatScene's two cast sites + Death's Door).
 *
 * Concordance Ch. IX (corrected 2026-08-17) — while the Second Wick is borne and this
 * rest-cycle's catch hasn't fired yet, the spend re-banks the light at once instead of
 * clearing it, and marks the catch used. Once per rest-cycle: Ch. IV's binary law stands
 * unbroken (never a second stockpiled light) — this is a re-bank, not a stockpile. The catch
 * flag resets at the next hearth rest (HamletScene.doCottage, beside lanternLight's own grant).
 *
 * Guarded like heldLanternLight: an inventory/save-read fault degrades to "no catch," never a
 * thrown spend — the final save() write below is unguarded, same as every site's write was
 * before this helper existed (no new failure mode).
 *
 * Returns whether the catch fired, for the caller's own banner/notice copy (WICK_CATCH_LINE).
 */
export async function spendLanternLight(): Promise<boolean> {
  let caught = false;
  try {
    caught = services.inventory.bornRelic() === 'second-wick' && services.save.get()?.wickCaught !== true;
  } catch {
    caught = false;
  }
  if (caught) {
    await services.save.save({ lanternLight: true, wickCaught: true });
  } else {
    await services.save.save({ lanternLight: false });
  }
  return caught;
}
