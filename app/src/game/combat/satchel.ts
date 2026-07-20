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
 * option — none of which this pass builds). So only 'heal' items are surfaced as
 * usable-in-combat here; tools stay catalog/shop-only (already labeled "(trial)" there)
 * until that encounter-surface work is separately scoped.
 */
import { CATALOG, type ItemDef } from '../../inventory/catalog';
import type { InventorySnapshot } from '../contracts';

/** Matches store.ts/consume.ts/DungeonScene's hardcoded party-pool ceiling (§6 trap: no shared const — deliberately not inventing one here either). */
export const POOL_MAX_HP = 16;

export interface UsableSatchelItem {
  item: ItemDef;
  qty: number;
}

/** Owned items with a combat-resolvable effect (heals — see file header), qty > 0, catalog order. */
export function usableSatchelItems(snapshot: InventorySnapshot): UsableSatchelItem[] {
  return CATALOG.filter((i) => i.effect.kind === 'heal' && (snapshot.stacks[i.id] ?? 0) > 0).map((item) => ({
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
 */
export function resolveHealUse(item: ItemDef, livePool: number, maxPool = POOL_MAX_HP): HealResolution {
  if (item.effect.kind !== 'heal') {
    return { ok: false, nextPool: livePool, gained: 0, message: 'That cannot be used here.' };
  }
  const nextPool = Math.max(0, Math.min(maxPool, livePool + item.effect.amount));
  if (nextPool === livePool) {
    return { ok: false, nextPool: livePool, gained: 0, message: 'Already at full vigor.' };
  }
  return { ok: true, nextPool, gained: nextPool - livePool, message: `Restored ${nextPool - livePool} vigor.` };
}
