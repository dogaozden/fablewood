/**
 * Field item use (inventory-handoff §6). Heals replicate DungeonScene.applyHp's
 * math directly (that method is private, so the clamp is reproduced here).
 * Trial effects (reveal/retry/shield) are combat-surface work — deferred, §10.
 */
import { services, type UseResult } from '../game/contracts';
import { itemById } from './catalog';
import type { InventoryStore } from './store';

/** Party max HP. Hardcoded 16 to match srs/store.ts DEFAULT_SAVE, DungeonScene
 * PARTY_MAX_HP and CombatScene — there is deliberately no shared const (§6 trap). */
const MAX_HP = 16;

export async function useItem(store: InventoryStore, id: string): Promise<UseResult> {
  const item = itemById(id);
  if (!item) return { ok: false, message: 'No such thing in any ledger.' };
  if (store.countOf(id) <= 0) return { ok: false, message: 'You have none left.' };

  const effect = item.effect;
  if (effect.kind === 'heal') {
    const cur = services.save.get().hp ?? MAX_HP;
    const next = Math.max(0, Math.min(MAX_HP, cur + effect.amount));
    if (next === cur) return { ok: false, message: 'Already at full vigor.' };
    // Remove FIRST and respect the result: store.remove() re-reads the freshest
    // stock before deciding, so it is the true arbiter of "did we actually get
    // one" under a race (two in-flight Use calls on the last item in a stack).
    // No removal, no effect — applying the heal before/without checking this
    // let a losing racer still persist a heal from an item it never got.
    const removed = await store.remove(id, 1);
    if (!removed) return { ok: false, message: 'You have none left.' };
    await services.save.save({ hp: next });
    return { ok: true, message: `Restored ${next - cur} vigor.` };
  }
  if (effect.kind === 'glow') {
    // Combat-only (magic-combat-depth §11.1): the field/hamlet Satchel has no battle to grant
    // Glow into. CombatScene's own useSatchelItem branch applies the Glow effect + removeItem
    // directly (scene-side per-battle state, never persisted) rather than routing through here.
    return { ok: false, message: 'Only usable in battle.' };
  }
  if (effect.kind === 'reveal_option' || effect.kind === 'retry_cast' || effect.kind === 'streak_shield') {
    return { ok: false, message: 'Only usable in a trial.' };
  }
  return {
    ok: false,
    message: item.type === 'relic' ? 'A keepsake, not a tool.' : 'No use in the field — but Mira pays for what glitters.',
  };
}
