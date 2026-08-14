/**
 * Pure logic for the in-battle Satchel (inventory-handoff §10 — "DEFERRED COMBAT SATCHEL
 * HOOK SPEC" was written to warn the inventory agent OFF combat/**; this module is where
 * "whoever wires combat" lands it). CombatScene is a thin driver over this, same as it
 * already is over damage/boss/ai — kept pure and Phaser-free so the rules are unit-tested
 * directly.
 *
 * SCOPE (judgment call): §10 also sketches reveal_option/retry_cast/streak_shield via a
 * `consumePendingAid` handshake "the encounter checks on open" — but actually consuming
 * those requires touching the ENCOUNTER SURFACE (encounters/**), which every inventory doc
 * (§7, §10) marks off-limits, and is a materially bigger feature (arming a pre-action flag,
 * honoring it inside an encounter renderer, and for reveal_option literally greying an MCQ
 * option — none of which this pass builds). So only 'heal' items were surfaced as
 * usable-in-combat here initially; tools stay catalog/shop-only (already labeled "(trial)"
 * there) until that encounter-surface work is separately scoped.
 *
 * Phase 2 (magic-combat-depth §11.1) widens the filter to `heal | glow`: the two new Glow
 * items (wick-tallow/lantern-brand) are combat-only by design (catalog.ts's `use:'combat'`),
 * so unlike heals they have NO field-use path at all — consume.ts's useItem always refuses
 * them outside this scene.
 *
 * Phase 3 (Ch. VII Mira's Stall, arming-model amendment) widens the filter again to
 * `heal | glow | reveal_option | retry_cast`: the trial tools (Scrivener's Hint/Second Wind
 * Seal) are now usable-in-combat — the encounter-surface work the SCOPE note above flagged as
 * separately-scoped has landed. Unlike heal/glow, a tool does NOT consume on use here: it ARMS
 * (CombatScene owns the arm state via combat/aids.ts) and deducts only when the arm fires. Ward
 * of Focus (streak_shield) stays excluded — passive, never armed, never in this list.
 */
import { CATALOG, type ItemDef } from '../../inventory/catalog';
import type { InventorySnapshot } from '../contracts';

export interface UsableSatchelItem {
  item: ItemDef;
  qty: number;
}

/** Owned items with a combat-resolvable effect (heal, glow, or trial tool — see file header), qty > 0, catalog order. */
export function usableSatchelItems(snapshot: InventorySnapshot): UsableSatchelItem[] {
  return CATALOG.filter(
    (i) =>
      (i.effect.kind === 'heal' || i.effect.kind === 'glow' || i.effect.kind === 'reveal_option' || i.effect.kind === 'retry_cast') &&
      (snapshot.stacks[i.id] ?? 0) > 0,
  ).map((item) => ({
    item,
    qty: snapshot.stacks[item.id] ?? 0,
  }));
}

export interface HealResolution {
  ok: boolean;
  /** clamped pool after the heal; equals the input `livePool` unchanged when !ok */
  nextPool: number;
  gained: number;
  message: string;
}

/**
 * The pooled-HP clamp math, mirroring consume.ts's useItem exactly — but applied to the
 * LIVE in-battle pool (sum of Keeper + Mira's current hp) rather than services.save, which
 * goes stale the moment combat damage starts (nothing else writes it mid-battle). The scene
 * calls this FIRST (pure, synchronous) to decide whether to spend the turn at all, then — only
 * when ok — syncs services.save to `livePool` and calls the real services.inventory.useItem
 * (the same choke point camp-rest/the hamlet Satchel use), so the outcome always matches.
 *
 * `maxPool` is REQUIRED (Wave 4 — the caps go level-keyed; the old fixed-16 default died):
 * the caller passes a fresh maxHpForLevel(save.level ?? 1) read, same as every other HP-cap
 * seam in the game. No default here on purpose — a stale silent 16 is exactly the bug class
 * this task retires.
 */
export function resolveHealUse(item: ItemDef, livePool: number, maxPool: number): HealResolution {
  if (item.effect.kind !== 'heal') {
    return { ok: false, nextPool: livePool, gained: 0, message: 'That cannot be used here.' };
  }
  const nextPool = Math.max(0, Math.min(maxPool, livePool + item.effect.amount));
  if (nextPool === livePool) {
    return { ok: false, nextPool: livePool, gained: 0, message: 'Already at full vigor.' };
  }
  return { ok: true, nextPool, gained: nextPool - livePool, message: `Restored ${nextPool - livePool} vigor.` };
}
