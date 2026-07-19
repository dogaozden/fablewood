// Combat / Preference-Vaults sprite set (Lane A, code-drawn pixel — style-contract §3/§8).
// Palette-indexed string grids: each char = a palette char (art/palette.ts PAL_CHAR),
// '.' = transparent. Rows equal length, only palette chars. Warm top-left light.
// Tiles (16×16) carry NO outline and tile seamlessly; props + icons carry a 1px
// outline-warm ('x'). Authored once at native px; `scale: 3` bakes each at combat's
// 48-native zoom (tiles 16→48, icons 12→36 — the §8 UI-icon exception).
//
// Reviewed and PASSED (all six axes ≥4, ≥2 iterations each):
// docs/art-reviews/combat-tiles-icons.md. Grid sources + contact sheets:
// docs/art-reviews/combat-tiles-icons/*.json + *-iter2.png.

// ---- Tiles (16×16, no outline, seamless) ----

const vaultFloor: string[] = [
  'zzzzzzzzzzzzzzzz',
  'zvvvDDDDzvvvDDDD',
  'zvvDDDDDzvvDDDDD',
  'zvDDDDDDzvDDDDDD',
  'zDDDDDDDzDDDDDDD',
  'zDDDDDDDzDDDDDDD',
  'zDDDDDDDzDDDDDDD',
  'zDDDDDDDzDDDDDDD',
  'zzzzzzzzzzzzzzzz',
  'DDDDzvvvDDDDzvvv',
  'DDDDzvvDDDDDzvvD',
  'DDDDzvDDDDDDzvDD',
  'DDDDzDDDDDDDzDDD',
  'DDDDzDDDDDDDzDDD',
  'DDDDzDDDDDDDzDDD',
  'DDDDzDDDDDDDzDDD',
];

const vaultWall: string[] = [
  'tttttttttttttttt',
  'TTTbTTTTTTTbTTTT',
  'TTTbTTTTTTTbTTTT',
  'KKKbKKKKKKKbKKKK',
  'KKKbKKKKKKKbKKKK',
  'KKKbKKKKKKKbKKKK',
  'kkkbkkkkkkkbkkkk',
  'bbbbbbbbbbbbbbbb',
  'tttttttttttttttt',
  'TTTTTbTTTTTTTbTT',
  'TTTTTbTTTTTTTbTT',
  'KKKKKbKKKKKKKbKK',
  'KKKKKbKKKKKKKbKK',
  'KKKKKbKKKKKKKbKK',
  'kkkkkbkkkkkkkbkk',
  'bbbbbbbbbbbbbbbb',
];

const goldHeap: string[] = [
  'DDDDDDDDDDDDDDDD',
  'DDDDDDDDDDDDDDDD',
  'DDDDDDDDDDDDDDDD',
  'DDDDDDDDDDDDDDDD',
  'DDDDDDDDDDDDDDDD',
  'DDDDDDGGDDDDDDDD',
  'DDDDDGGWGADDDDDD',
  'DDDDGGAGGAeDDDDD',
  'DDDGGAGGAGAeDDDD',
  'DDGWGGAGGAGAeDDD',
  'DDGAGGAGGAGGAeDD',
  'DeGGAGGAGGAAGAeD',
  'DeGAGGAGGAGAGAeD',
  'DEeAGAeGAeGAAeED',
  'DEeeEeeeeeeEeeED',
  'DDEeDDEeeeDDeEDD',
];

const lantern: string[] = [
  'DDDDDDDDDDDDDDDD',
  'DDDDDDDkkDDDDDDD',
  'DDDDDDkAAkDDDDDD',
  'DDDDDkKAAKkDDDDD',
  'DDDDDKGWWGKDDDDD',
  'DDDDeKWWGGKeDDDD',
  'DDDDeKGWGGKeDDDD',
  'DDDeeKGGAGKeeDDD',
  'DDDeeKGAAGKeeDDD',
  'DDDDDkKKKKkDDDDD',
  'DDDDekAAAAkeDDDD',
  'DDDeeAAAAAAeeDDD',
  'DDEeeeeeeeeeeEDD',
  'DDDEeeeeeeeeEDDD',
  'DDDDEeeeeeeEDDDD',
  'DDDDDDEeeEDDDDDD',
];

// ---- Props (1px outline-warm, bottom-origin) ----

const vaultDoor: string[] = [
  '.........xxxxxx.........',
  '.......xnnnnnnnnx.......',
  '.....xnnnGnnnnGnnnx.....',
  '....xKKKeKKKKKKeKKKx....',
  '...xttttKtttttKtttttx...',
  '..xtTTTkKtTTTkKtTTTTkx..',
  '..xtTTTkKtTTTkKtTTTTkx..',
  '..xtTTTkKtTTTkKtTTTTkx..',
  '..xtTTTkKtTTTkKtTTTTkx..',
  '..xtTTTkKKKKKKKtTTTTkx..',
  '..xtTTTkKKGWWGKtTTTTkx..',
  '..xtTTTkKKGWWGKtTTTTkx..',
  '..xtTTTkKKGAAGKtTTTTkx..',
  '..xtTTTkKKGAAGKtTTTTkx..',
  '..xtTTTkKKKKKKKtTTTTkx..',
  '..xnnnGnnnnGnnnnGnnnnx..',
  '..xKKKeKKKKeKKKKeKKKKx..',
  '..xtTTTkKtTTTkKtTTTTkx..',
  '..xtTTTkKtTnnTKtTTTTkx..',
  '..xtTTTkKtnTTnKtTTTTkx..',
  '..xtTTTkKtnTTnKtTTTTkx..',
  '..xtTTTkKtTnnTKtTTTTkx..',
  '..xtTTTkKtTTTkKtTTTTkx..',
  '..xtTTTkKtTTTkKtTTTTkx..',
  '..xtTTTkKtTTTkKtTTTTkx..',
  '..xtTTTkKtTTTkKtTTTTkx..',
  '..xtTTTkKtTTTkKtTTTTkx..',
  '..xnnnGnnnnGnnnnGnnnnx..',
  '..xKKKeKKKKeKKKKeKKKKx..',
  '..xtTTTkKtTTTkKtTTTTkx..',
  '..xxxxxxxxxxxxxxxxxxxx..',
  '..zzzzzzzzzzzzzzzzzzzz..',
];

const camp: string[] = [
  '........................',
  '........................',
  '........................',
  '.....k.k................',
  '......k.................',
  '.....xcx................',
  '.....xcx................',
  '....xccsx...............',
  '....xccsx.....GG........',
  '...xcccssx..GAAG........',
  '...xcccssx.eGAAGe.......',
  '..xcccKsssx.eGAWAGe.....',
  '..xcccKsssx.eGAWWAGe....',
  '..xccKbKssx.eeGAWWAGee..',
  '.xcccKbKsssxeGAAWWAAGe..',
  '.xcccKbKsssxeGAAWAAAGe..',
  '.xccKKbKKssxenkEAAEkn...',
  '..zzzzzzzzz.eEEEEEEe....',
  '............eEEEEe......',
  '.............eEEe.......',
];

// ---- Action / HUD icons (12×12 → 36px at scale 3, 1px outline-warm) ----

const iconStrike: string[] = [
  '.....x......',
  '....xWx.....',
  '....xWGx....',
  '....xWGx....',
  '....xWGx....',
  '....xWGx....',
  '....xWGx....',
  '..xGGGGGGx..',
  '....xTTx....',
  '....xTTx....',
  '....xkkx....',
  '....xGGx....',
];

const iconWeave: string[] = [
  '.....xx.....',
  '....xoox....',
  '....oooo....',
  '..xoooooox..',
  '.xoooWWooox.',
  'xooiWWWWioox',
  'xooiWWWWioox',
  '.xoooWWooox.',
  '..xoooooox..',
  '....oooo....',
  '....xoox....',
  '.....xx.....',
];

const iconSequence: string[] = [
  '............',
  '........xxxx',
  '........xwwx',
  '........xwax',
  '....xxxxxwax',
  '....xwwxxwax',
  '....xwaxxwax',
  'xxxxxwaxxwax',
  'xwwxxwaxxwax',
  'xwaxxwaxxwax',
  'xwaxxwaxxwax',
  'xxxxxxxxxxxx',
];

const iconCast: string[] = [
  '......G.....',
  '.....GWG....',
  '....GWWWG...',
  '.....GWG....',
  '......G.....',
  '..xxx..xxx..',
  '.xcccxxcccx.',
  '.xcccxxcccx.',
  '.xcscxxcscx.',
  '.xTTTxxTTTx.',
  '.xkkkkkkkkx.',
  '..xxxxxxxx..',
];

const iconParley: string[] = [
  '..xxxxxxxx..',
  '.xrriiiiiix.',
  '.xiiiiiiiix.',
  '.xiikikikix.',
  '.xiiiiiiiix.',
  '.xiiiiiiuux.',
  '..xxxxxxxx..',
  '...xxx......',
  '...xx.......',
  '...x........',
  '............',
  '............',
];

const iconWait: string[] = [
  '.xnnnnnnnnx.',
  '.xGGGGGGGGx.',
  '..xGGGGGGx..',
  '...xGGGGx...',
  '....xGGx....',
  '....xGGx....',
  '...x.GG.x...',
  '..x..GG..x..',
  '.x..GGGG..x.',
  '.xnnnnnnnnx.',
  '..xxxxxxxx..',
  '............',
];

const iconHp: string[] = [
  '............',
  '............',
  '..xxx.xxx...',
  '.xRRRxRRRx..',
  '.xRWRRRRRRx.',
  '.xRRRRRRRRx.',
  '..xRRRRRRx..',
  '...xRRRRx...',
  '....xRRx....',
  '.....xx.....',
  '............',
  '............',
];

const iconStreak: string[] = [
  '.....x......',
  '....xGx.....',
  '....xGAx....',
  '...xGWAx....',
  '...xGWWAx...',
  '..xGWWWAx...',
  '..xGAWWAAx..',
  '..xGAWWWAx..',
  '.xeGAWWWAx..',
  '.xeeAWWAex..',
  '..xeEEEEex..',
  '...xxxxx....',
];

/**
 * Combat/vault sprite defs. `frames` is a list of frame-grids (one for these
 * statics); `scale: 3` bakes at combat's 48-native zoom. No anims in this set.
 * Register these in app/src/art/sprites/index.ts (the art director wires it) so
 * buildTextures() replaces the combat scene's placeholders under the same keys.
 */
export const combatSprites = [
  // Tiles — 16×16, no outline, seamless (→ 48×48).
  { key: 'tile.vault-floor', frames: [vaultFloor], scale: 3 },
  { key: 'tile.vault-wall', frames: [vaultWall], scale: 3 },
  { key: 'tile.gold-heap', frames: [goldHeap], scale: 3 },
  { key: 'tile.lantern', frames: [lantern], scale: 3 },
  // Props — 1px outline, bottom-origin.
  { key: 'prop.vault-door', frames: [vaultDoor], scale: 3 }, // 24×32 → 72×96
  { key: 'prop.camp', frames: [camp], scale: 3 }, //             24×20 → 72×60
  // Action / HUD icons — 12×12 → 36×36 (the §8 UI-icon exception).
  { key: 'icon.strike', frames: [iconStrike], scale: 3 },
  { key: 'icon.weave', frames: [iconWeave], scale: 3 },
  { key: 'icon.sequence', frames: [iconSequence], scale: 3 },
  { key: 'icon.cast', frames: [iconCast], scale: 3 },
  { key: 'icon.parley', frames: [iconParley], scale: 3 },
  { key: 'icon.wait', frames: [iconWait], scale: 3 },
  { key: 'icon.hp', frames: [iconHp], scale: 3 },
  { key: 'icon.streak', frames: [iconStreak], scale: 3 },
];
