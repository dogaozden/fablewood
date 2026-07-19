// Palette-indexed string grid (style-contract §3). Each char = a palette char
// (see art/palette.ts PAL_CHAR); '.' = transparent. 16x24, 1px outline-warm,
// warm top-left light. Reviewed and PASSED (iter 2, all axes >=4):
// docs/art-reviews/keeper-idle-down.md. Grid source: docs/art-reviews/keeper-idle-down/spec.json.
// The Keeper (player) facing down, idle frame 0. Remaining frames (idle-2, walk x4 x 4 dirs) TODO.
export const keeperIdleDown: readonly string[] = [
  '................',
  '......xxxx......',
  '.....xggggx.....',
  '....xgggggFx....',
  '...xgggggfFx....',
  '...xgpttttFx....',
  '...xgpttttfFx...',
  '...xgtxttxtfx...',
  '....xTttttx.....',
  '....xcccccx.....',
  '...xggfcffFx....',
  '..xgggfcffFFx...',
  '..xgggfcffFFx...',
  '..xgggfcffFFx...',
  '.GxgggfcffFFx...',
  'GWxgggfcffFFx...',
  'GAxgggfcffFFx...',
  '.AxgggfcffFFx...',
  '..xgggfcffFFx...',
  '..xgggfcffFFx...',
  '..xffffffffx....',
  '...xkkx.xkkx....',
  '...xKKx.xKKx....',
  '...zzzzzzzz.....',
];
