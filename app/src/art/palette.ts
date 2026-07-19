// AUTO-GENERATED from docs/art/palette.json by docs/art-reviews/_tools/gen_palette_ts.py.
// DO NOT EDIT BY HAND. Regenerate after changing palette.json. The JSON is the
// single source of truth (style-contract §2). 32 colors.
//
// Canonical Phaser color ints for the whole engine. combat/palette.ts and
// hamlet/palette.ts were temporary local mirrors — swap them to import from here.

/** name -> Phaser color int */
export const PAL = {
  glowCore:        0xfff1c6,  // glow-core (W)
  lanternGold:     0xf7ce6b,  // lantern-gold (G)
  amber:           0xeea23f,  // amber (A)
  ember:           0xd2792c,  // ember (e)
  deepEmber:       0xa65420,  // deep-ember (E)
  leafHighlight:   0xa8c44e,  // leaf-highlight (l)
  moss:            0x7c9c46,  // moss (m)
  leafGreen:       0x588234,  // leaf-green (g)
  forestGreen:     0x37602a,  // forest-green (f)
  deepForest:      0x21401c,  // deep-forest (F)
  timberLight:     0xb47e46,  // timber-light (t)
  timber:          0x8c5c34,  // timber (T)
  bark:            0x684628,  // bark (k)
  darkBark:        0x452f1c,  // dark-bark (K)
  barkShadow:      0x2a1d13,  // bark-shadow (b)
  duskDeep:        0x34265a,  // dusk-deep (D)
  duskViolet:      0x6a4a8c,  // dusk-violet (v)
  duskMauve:       0x9e5e96,  // dusk-mauve (u)
  duskRose:        0xce7a8c,  // dusk-rose (r)
  duskPeach:       0xeea67e,  // dusk-peach (p)
  waterLight:      0x9ebad4,  // water-light (w)
  waterBlue:       0x4c6c96,  // water-blue (a)
  waterDeep:       0x29405e,  // water-deep (y)
  parchment:       0xebd9b2,  // parchment (c)
  pathStone:       0xc6a476,  // path-stone (s)
  stoneGrey:       0x8a8078,  // stone-grey (n)
  blossomPink:     0xe07aae,  // blossom-pink (i)
  orchid:          0x9a6ec8,  // orchid (o)
  berryRed:        0xc4443e,  // berry-red (R)
  outlineWarm:     0x241a14,  // outline-warm (x)
  shadowPlum:      0x1b1526,  // shadow-plum (z)
  voidBlack:       0x100b0a,  // void-black (X)
} as const;

export type PaletteName = keyof typeof PAL;

/** sprite-grid char -> color int (for art/buildTextures.ts). '.' = transparent, not listed. */
export const PAL_CHAR: Readonly<Record<string, number>> = {
  'W': 0xfff1c6,  // glowCore
  'G': 0xf7ce6b,  // lanternGold
  'A': 0xeea23f,  // amber
  'e': 0xd2792c,  // ember
  'E': 0xa65420,  // deepEmber
  'l': 0xa8c44e,  // leafHighlight
  'm': 0x7c9c46,  // moss
  'g': 0x588234,  // leafGreen
  'f': 0x37602a,  // forestGreen
  'F': 0x21401c,  // deepForest
  't': 0xb47e46,  // timberLight
  'T': 0x8c5c34,  // timber
  'k': 0x684628,  // bark
  'K': 0x452f1c,  // darkBark
  'b': 0x2a1d13,  // barkShadow
  'D': 0x34265a,  // duskDeep
  'v': 0x6a4a8c,  // duskViolet
  'u': 0x9e5e96,  // duskMauve
  'r': 0xce7a8c,  // duskRose
  'p': 0xeea67e,  // duskPeach
  'w': 0x9ebad4,  // waterLight
  'a': 0x4c6c96,  // waterBlue
  'y': 0x29405e,  // waterDeep
  'c': 0xebd9b2,  // parchment
  's': 0xc6a476,  // pathStone
  'n': 0x8a8078,  // stoneGrey
  'i': 0xe07aae,  // blossomPink
  'o': 0x9a6ec8,  // orchid
  'R': 0xc4443e,  // berryRed
  'x': 0x241a14,  // outlineWarm
  'z': 0x1b1526,  // shadowPlum
  'X': 0x100b0a,  // voidBlack
};

/** name -> '#rrggbb' (React/CSS-facing spots: camera bg, DOM overlays) */
export const PAL_HEX = {
  glowCore:        '#fff1c6',
  lanternGold:     '#f7ce6b',
  amber:           '#eea23f',
  ember:           '#d2792c',
  deepEmber:       '#a65420',
  leafHighlight:   '#a8c44e',
  moss:            '#7c9c46',
  leafGreen:       '#588234',
  forestGreen:     '#37602a',
  deepForest:      '#21401c',
  timberLight:     '#b47e46',
  timber:          '#8c5c34',
  bark:            '#684628',
  darkBark:        '#452f1c',
  barkShadow:      '#2a1d13',
  duskDeep:        '#34265a',
  duskViolet:      '#6a4a8c',
  duskMauve:       '#9e5e96',
  duskRose:        '#ce7a8c',
  duskPeach:       '#eea67e',
  waterLight:      '#9ebad4',
  waterBlue:       '#4c6c96',
  waterDeep:       '#29405e',
  parchment:       '#ebd9b2',
  pathStone:       '#c6a476',
  stoneGrey:       '#8a8078',
  blossomPink:     '#e07aae',
  orchid:          '#9a6ec8',
  berryRed:        '#c4443e',
  outlineWarm:     '#241a14',
  shadowPlum:      '#1b1526',
  voidBlack:       '#100b0a',
} as const;

/** Phaser color int -> '#rrggbb' */
export const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');
