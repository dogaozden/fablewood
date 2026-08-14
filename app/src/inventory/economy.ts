/**
 * Gold economy + loot rolls (inventory-handoff §4). Pure functions over an
 * injected rng so every roll unit-tests deterministically. The wipe rule
 * ("lose the loot roll, never story progress") needs no escrow machinery here:
 * rewards are rolled AND banked at the moment of a clear — a wipe simply means
 * that clear (and its roll) never happened.
 */
import { CATALOG, type ItemDef, type Rarity } from './catalog';

/** Friendly starter purse — enough for one cheap draught before a first run. */
export const STARTING_GOLD = 20;
/** Trinkets sell to Mira at half value (floored). */
export const SELL_RATE = 0.5;

export type Rng = () => number;

/** Rarity odds for a normal room-clear trinket roll (sums to 100). */
export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 55,
  uncommon: 28,
  rare: 12,
  very_rare: 4,
  legendary: 1,
};

/** Boss loot skews rich: rare is the mode, legendary a real chance (sums to 100). */
export const BOSS_RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 10,
  uncommon: 30,
  rare: 35,
  very_rare: 20,
  legendary: 5,
};

export const RARITY_ORDER: readonly Rarity[] = ['common', 'uncommon', 'rare', 'very_rare', 'legendary'];

/** Walk the weight table in fixed rarity order; rng() in [0,1). */
export function rollRarity(rng: Rng, weights: Record<Rarity, number>): Rarity {
  const total = RARITY_ORDER.reduce((s, r) => s + weights[r], 0);
  let roll = rng() * total;
  for (const r of RARITY_ORDER) {
    roll -= weights[r];
    if (roll < 0) return r;
  }
  return 'common'; // float-edge fallback
}

/**
 * Concordance Ch. IV — the advantage primitive, instantiated for loot rarity (its one v1
 * consumer): roll twice, keep the better (worse for disadvantage) by RARITY_ORDER.
 * 'none' = exactly one roll, byte-identical to rollRarity (stream discipline: callers'
 * downstream picks shift only when an edge is actually in play). Disadvantage has ZERO
 * v1 sources (chapter text) — the function exists, nothing calls it with 'disadvantage'.
 * Future domains needing the primitive copy this pattern domain-locally (house RNG rule).
 */
export type Edge = 'advantage' | 'disadvantage' | 'none';

export function rollRarityEdged(rng: Rng, weights: Record<Rarity, number>, edge: Edge): Rarity {
  const first = rollRarity(rng, weights);
  if (edge === 'none') return first;
  const second = rollRarity(rng, weights);
  const firstIdx = RARITY_ORDER.indexOf(first);
  const secondIdx = RARITY_ORDER.indexOf(second);
  if (edge === 'advantage') return secondIdx > firstIdx ? second : first;
  return secondIdx < firstIdx ? second : first;
}

/**
 * Pick a trinket of the rolled rarity; if the pool has none at that tier, fall
 * down a tier until one exists (never up). Null only if the pool has no trinkets.
 */
export function pickTrinket(rarity: Rarity, rng: Rng, pool: readonly ItemDef[] = CATALOG): string | null {
  for (let t = RARITY_ORDER.indexOf(rarity); t >= 0; t--) {
    const tier = pool.filter((i) => i.type === 'trinket' && i.rarity === RARITY_ORDER[t]);
    if (tier.length) return tier[Math.floor(rng() * tier.length) % tier.length].id;
  }
  return null;
}

export interface LootRoll {
  gold: number;
  trinketId: string | null;
}

/**
 * Normal room clear: ~12-18 gold in the first room, +6 per room deeper, and a
 * 35% chance of a trinket. rng consumption order (tests depend on it):
 * gold jitter → trinket chance → rarity → tier pick.
 */
export function roomClearLoot(roomIndex: number, rng: Rng, edge: Edge = 'none'): LootRoll {
  const gold = 12 + roomIndex * 6 + Math.floor(rng() * 7);
  if (rng() >= 0.35) return { gold, trinketId: null };
  return { gold, trinketId: pickTrinket(rollRarityEdged(rng, RARITY_WEIGHTS, edge), rng) };
}

export interface BossLoot {
  gold: number;
  trinketId: string | null;
  relicId: string;
}

/** Boss bounty: 60-100 gold, a boss-weighted trinket, and always the Warden's signet. */
export function bossLoot(rng: Rng, edge: Edge = 'none'): BossLoot {
  const gold = 60 + Math.floor(rng() * 41);
  return {
    gold,
    trinketId: pickTrinket(rollRarityEdged(rng, BOSS_RARITY_WEIGHTS, edge), rng),
    relicId: 'warden-signet-of-terms',
  };
}

export function sellPrice(item: ItemDef): number {
  return Math.floor(item.value * SELL_RATE);
}

/** Same tiny deterministic PRNG the scenes use (module-private there, so local). */
export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
