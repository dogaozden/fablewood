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
    await services.save.save({ hp: next });
    await store.remove(id, 1);
    return { ok: true, message: `Restored ${next - cur} vigor.` };
  }
  if (effect.kind === 'reveal_option' || effect.kind === 'retry_cast' || effect.kind === 'streak_shield') {
    return { ok: false, message: 'Only usable in a trial.' };
  }
  return {
    ok: false,
    message: item.type === 'relic' ? 'A keepsake, not a tool.' : 'No use in the field — but Mira pays for what glitters.',
  };
}
