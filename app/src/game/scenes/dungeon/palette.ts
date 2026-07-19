// Local copy of the Fablewood master palette (docs/art/palette.json) as Phaser
// color ints — mirrors scenes/hamlet/palette.ts. Hardcoded here so the dungeon
// renders before the art module's generated palette.ts lands (slice-blueprint §2).
// The JSON remains the single source of truth for these hexes; do not invent new
// colors — pick from this set (style-contract §2).
export const C = {
  glowCore: 0xfff1c6,
  lanternGold: 0xf7ce6b,
  amber: 0xeea23f,
  ember: 0xd2792c,
  deepEmber: 0xa65420,

  leafHi: 0xa8c44e,
  moss: 0x7c9c46,
  leaf: 0x588234,
  forest: 0x37602a,
  deepForest: 0x21401c,

  timberLi: 0xb47e46,
  timber: 0x8c5c34,
  bark: 0x684628,
  darkBark: 0x452f1c,
  barkShadow: 0x2a1d13,

  duskDeep: 0x34265a,
  duskViolet: 0x6a4a8c,
  duskMauve: 0x9e5e96,
  duskRose: 0xce7a8c,
  duskPeach: 0xeea67e,

  waterLi: 0x9ebad4,
  water: 0x4c6c96,
  waterDeep: 0x29405e,

  parchment: 0xebd9b2,
  pathStone: 0xc6a476,
  stone: 0x8a8078,

  blossom: 0xe07aae,
  orchid: 0x9a6ec8,
  berry: 0xc4443e,

  outline: 0x241a14,
  shadowPlum: 0x1b1526,
  voidBlack: 0x100b0a,
} as const;

/** Phaser color int → '#rrggbb' (for camera bg + CSS-facing spots). */
export const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');
