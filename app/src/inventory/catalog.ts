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
  | { kind: 'glow'; amount: number } // combat-only Glow grant (magic-combat-depth §11.1)
  | { kind: 'reveal_option' } // trial aid (deferred): strike one false MCQ option
  | { kind: 'retry_cast' } // trial aid (deferred): retry a failed cast (combat outcome only)
  | { kind: 'streak_shield' } // trial aid (deferred): hold the streak through one stumble
  | { kind: 'edge_loot' } // relic passive (Concordance Ch. IX): loot rolls edged while borne
  | { kind: 'fell_guard' } // relic passive (Ch. IX): once a battle, the first fall is caught at 1 HP
  | { kind: 'move_base'; amount: 1 } // relic passive (Ch. IX): party movement base +1
  | { kind: 'begin_written' } // relic passive (Ch. IX): enemies never spawn Unwritten
  | { kind: 'rest_light'; amount: 1 } // relic passive (Ch. IX): +1 Lantern-light per hearth rest
  | { kind: 'push_blast'; reach: 3; tiles: 1 } // combat consumable (Ch. IX): the Sealed Page's push
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
  /** where the item can be used; derives from effect but kept explicit for the UI.
   *  'combat' (magic-combat-depth §11.1) — usable only through the in-battle Satchel. */
  use: 'field' | 'trial' | 'combat' | null;
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

/** Where a use-effect surfaces (kept explicit on ItemDef for the UI). Combat-only effects (Glow,
 *  the Sealed Page's push) route to the battle Satchel; relic passives (Ch. IX) are never "used"
 *  via a button at all — holding/bearing IS the mechanic — so they derive null, same as 'none'. */
function deriveUse(kind: ItemEffect['kind']): ItemDef['use'] {
  switch (kind) {
    case 'heal':
      return 'field';
    case 'glow':
    case 'push_blast':
      return 'combat';
    case 'reveal_option':
    case 'retry_cast':
    case 'streak_shield':
      return 'trial';
    default:
      return null; // 'none' + the five relic passives
  }
}

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
  use: deriveUse(effect.kind),
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
  item('superior-draught', 'Superior Draught', 'rare', 'consumable', { kind: 'heal', amount: 24 }, 80,
    "A heavier cordial than the shelf usually stocks, poured only for those who've earned it."),
  // -- glow (combat-only; the Five Arts' Glow economy, magic-combat-depth §11.1) --
  item('wick-tallow', 'Wick-Tallow', 'common', 'consumable', { kind: 'glow', amount: 1 }, 25,
    'Render of old lantern-tallow — the wick drinks it greedily.'),
  item('lantern-brand', 'Lantern-Brand', 'rare', 'consumable', { kind: 'glow', amount: 2 }, 70,
    "A splint from the First Lantern's own fire, banked in wax."),
  // -- combat scroll (single-use push; Concordance Ch. IX, the Decanter's third word written down) --
  item('sealed-page-geyser', 'Sealed Page of the Geyser', 'rare', 'consumable',
    { kind: 'push_blast', reach: 3, tiles: 1 }, 80,
    'One word of an old command, copied out and sealed in wax — good for a single reading, then just paper.'),
  // -- tools (trial-only encounter aids; usable hook is deferred to combat) --
  item('scriveners-hint', "Scrivener's Hint", 'common', 'tool', { kind: 'reveal_option' }, 25,
    'A margin-note that strikes one false answer from the page.'),
  item('second-wind-seal', 'Second Wind Seal', 'uncommon', 'tool', { kind: 'retry_cast' }, 50,
    'Break the wax and try the cast again.'),
  item('ward-of-focus', 'Ward of Focus', 'rare', 'tool', { kind: 'streak_shield' }, 85,
    'Holds your Vigil unbroken through one stumble.'),
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
  // -- relics (quest keepsakes, never sellable; one borne at a time — Concordance Ch. IX) --
  item('warden-signet-of-terms', 'Warden Signet of Terms', 'legendary', 'relic', { kind: 'edge_loot' }, 0,
    "The Vault-Warden's own seal. Proof you argued the Terms and won."),
  item('unbroken-clasp', 'Unbroken Clasp', 'rare', 'relic', { kind: 'fell_guard' }, 0,
    "It caught the wearer once, when catching mattered most — a clasp like that doesn't forget."),
  item('waymark-heel', 'Waymark Heel', 'uncommon', 'relic', { kind: 'move_base', amount: 1 }, 0,
    'Cobbled from an old waymark stone; wear it, and the road gives a little more with every step.'),
  item('margin-lamp', 'Margin Lamp', 'rare', 'relic', { kind: 'begin_written' }, 0,
    'Held to the page, its small light reads what the margins tried to hide.'),
  item('second-wick', 'Second Wick', 'uncommon', 'relic', { kind: 'rest_light', amount: 1 }, 0,
    'A spare wick, kept trimmed and ready — the hearth burns a little longer for having it near.'),
];

const BY_ID = new Map(CATALOG.map((i) => [i.id, i]));

export function itemById(id: string): ItemDef | undefined {
  return BY_ID.get(id);
}

/** Mira's shop stock: the eight wares (3 draughts + 2 glow + 3 tools), catalog order. */
export function shopStock(): ItemDef[] {
  return CATALOG.filter((i) => i.type === 'consumable' || i.type === 'tool');
}
