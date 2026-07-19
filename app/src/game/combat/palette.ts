/**
 * Local mirror of the Fablewood master palette (docs/art/palette.json) — the
 * subset combat needs for on-register PLACEHOLDER art. This exists only until
 * the art agent ships the shared `app/src/art/palette.ts`; combat auto-upgrades
 * to real textures whenever a texture key already exists (see textures.ts), so
 * these hexes are never used once real art lands. Kept on-palette so the
 * placeholder board still reads as "warm light in cool dusk", not garish.
 */
export const P = {
  glowCore: 0xfff1c6,
  lanternGold: 0xf7ce6b,
  amber: 0xeea23f,
  ember: 0xd2792c,
  deepEmber: 0xa65420,
  leafHi: 0xa8c44e,
  moss: 0x7c9c46,
  leaf: 0x588234,
  forest: 0x37602a,
  timberLight: 0xb47e46,
  timber: 0x8c5c34,
  bark: 0x684628,
  darkBark: 0x452f1c,
  barkShadow: 0x2a1d13,
  duskDeep: 0x34265a,
  duskViolet: 0x6a4a8c,
  duskMauve: 0x9e5e96,
  duskRose: 0xce7a8c,
  duskPeach: 0xeea67e,
  waterLight: 0x9ebad4,
  waterBlue: 0x4c6c96,
  waterDeep: 0x29405e,
  parchment: 0xebd9b2,
  pathStone: 0xc6a476,
  stoneGrey: 0x8a8078,
  blossom: 0xe07aae,
  orchid: 0x9a6ec8,
  berry: 0xc4443e,
  outline: 0x241a14,
  shadowPlum: 0x1b1526,
  voidBlack: 0x100b0a,
} as const;

/** hex string form for Phaser text colors */
export const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');
