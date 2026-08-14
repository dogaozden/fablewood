/**
 * Lantern-light (Concordance Ch. IV) — the pure half of the re-draw spend, shared by the
 * three v1 surfaces (combat casts, Wellspring rounds, Death's Door). Scenes hold the drawn
 * pool for the round; a redraw re-presents from that SAME pool minus what was shown — no
 * fresh services.draw call (draw-census law: five sites, unchanged). Death's Door, whose
 * pool is a single fact, is the one surface that re-draws for real: ddDraw with
 * LANTERN_REDRAW_SALT and an exclusion list.
 */
import { services } from './contracts';

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

/** Shown (via EncounterRequest.notice) when a re-draw finds no alternative memory. */
export const FATE_HOLDS_LINE = 'The lantern flickers — fate holds this memory fast. Your light is not spent.';
