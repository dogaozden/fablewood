/**
 * The item catalog — every thing a Keeper can carry (inventory-handoff §1/§3).
 * Pure data, no DOM/Phaser, so economy math unit-tests in node.
 *
 * IDs are STATE-REFERENCED (they key stacks in state/inventory.json): once an id
 * ships it is never renamed or renumbered (state/ is precious — project hard rule).
 */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'very_rare' | 'legendary';
export type ItemType = 'consumable' | 'tool' | 'trinket' | 'relic';

export type ItemEffect =
  | { kind: 'heal'; amount: number } // amount HP; 999 = "restore to full"
  | { kind: 'reveal_option' } // trial aid (deferred): strike one false MCQ option
  | { kind: 'retry_cast' } // trial aid (deferred): retry a failed cast (combat outcome only)
  | { kind: 'streak_shield' } // trial aid (deferred): hold the streak through one stumble
  | { kind: 'none' };

export interface ItemDef {
  id: string;
  name: string;
  rarity: Rarity;
  type: ItemType;
  effect: ItemEffect;
  flavor: string;
  /** base worth in gold: buy price for shop stock; sell = floor(value * SELL_RATE) */
  value: number;
  /** key into ICONS (inventory/icons.ts) — same as id by convention */
  icon: string;
  /** where the item can be used; derives from effect but kept explicit for the UI */
  use: 'field' | 'trial' | null;
  sellable: boolean;
}

/**
 * Rarity presentation (inventory-handoff §2): D&D color semantics mapped onto the
 * Fablewood palette, zero neon. `chip` is the true rarity hex (used as the pill
 * background + icon accent); `name` is a same-family palette tone one step deeper
 * for item-name TEXT on the parchment panel — lantern-gold and moss text vanish
 * on parchment, and §2 says to verify text contrast by eye, so text takes the
 * legible neighbor while the chip keeps the canonical color.
 */
export const RARITY_META: Record<
  Rarity,
  { label: string; chip: string; chipInk: string; name: string }
> = {
  common: { label: 'Common', chip: '#8a8078', chipInk: '#241a14', name: '#8a8078' }, // stone-grey
  uncommon: { label: 'Uncommon', chip: '#7c9c46', chipInk: '#ebd9b2', name: '#588234' }, // moss → leaf-green text
  rare: { label: 'Rare', chip: '#4c6c96', chipInk: '#ebd9b2', name: '#4c6c96' }, // water-blue
  very_rare: { label: 'Very Rare', chip: '#9a6ec8', chipInk: '#241a14', name: '#6a4a8c' }, // orchid → dusk-violet text
  legendary: { label: 'Legendary', chip: '#f7ce6b', chipInk: '#241a14', name: '#a65420' }, // lantern-gold → deep-ember text
};

const item = (
  id: string,
  name: string,
  rarity: Rarity,
  type: ItemType,
  effect: ItemEffect,
  value: number,
  flavor: string,
): ItemDef => ({
  id,
  name,
  rarity,
  type,
  effect,
  flavor,
  value,
  icon: id,
  use: effect.kind === 'heal' ? 'field' : effect.kind === 'none' ? null : 'trial',
  sellable: type === 'trinket',
});

/** The starting catalog (inventory-handoff §3): every rarity and type covered. */
export const CATALOG: readonly ItemDef[] = [
  // -- consumables (field-usable heals; Mira stocks these) --
  item('embermend-draught', 'Embermend Draught', 'common', 'consumable', { kind: 'heal', amount: 6 }, 20,
    "A warm cordial that knits small hurts by the fire's memory."),
  item('lanternoil-tonic', 'Lantern-Oil Tonic', 'uncommon', 'consumable', { kind: 'heal', amount: 12 }, 45,
    'Bottled hearthlight — drink deep and the ache recedes.'),
  item('wardancers-restorative', "Wardancer's Restorative", 'rare', 'consumable', { kind: 'heal', amount: 999 }, 90,
    "Full vigor, distilled from a Warden's mercy."),
  // -- tools (trial-only encounter aids; usable hook is deferred to combat) --
  item('scriveners-hint', "Scrivener's Hint", 'common', 'tool', { kind: 'reveal_option' }, 25,
    'A margin-note that strikes one false answer from the page.'),
  item('second-wind-seal', 'Second Wind Seal', 'uncommon', 'tool', { kind: 'retry_cast' }, 50,
    'Break the wax and try the cast again.'),
  item('ward-of-focus', 'Ward of Focus', 'rare', 'tool', { kind: 'streak_shield' }, 85,
    'Holds your streak unbroken through one stumble.'),
  // -- trinkets (loot; their only purpose is selling to Mira) --
  item('faded-coin-cache', 'Faded Coin-Cache', 'common', 'trinket', { kind: 'none' }, 15,
    'A knot of tarnished coppers from a forgotten till.'),
  item('mossbound-locket', 'Mossbound Locket', 'uncommon', 'trinket', { kind: 'none' }, 40,
    'Whatever face it once held has gone soft and green with moss.'),
  item('clerks-silver-nib', "Clerk's Silver Nib", 'rare', 'trinket', { kind: 'none' }, 95,
    'A retired nib that has signed more verdicts than any sword has settled.'),
  item('amber-writ-seal', 'Amber Writ-Seal', 'very_rare', 'trinket', { kind: 'none' }, 200,
    'A writ sealed in true amber — the Terms inside still legible after an age.'),
  item('gilded-ledger-bead', 'Gilded Ledger-Bead', 'legendary', 'trinket', { kind: 'none' }, 500,
    "One bead from the First Ledger's abacus. It counts, quietly, on its own."),
  // -- relic (quest keepsake, never sellable) --
  item('warden-signet-of-terms', 'Warden Signet of Terms', 'legendary', 'relic', { kind: 'none' }, 0,
    "The Vault-Warden's own seal. Proof you argued the Terms and won."),
];

const BY_ID = new Map(CATALOG.map((i) => [i.id, i]));

export function itemById(id: string): ItemDef | undefined {
  return BY_ID.get(id);
}

/** Mira's shop stock: the six buyable items (3 draughts + 3 tools), catalog order. */
export function shopStock(): ItemDef[] {
  return CATALOG.filter((i) => i.type === 'consumable' || i.type === 'tool');
}
