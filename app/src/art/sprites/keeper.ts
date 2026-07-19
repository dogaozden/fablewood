// The Keeper (player) — char.keeper, 16×24, 1px outline, warm top-left light.
// Reviewed + PASSED: docs/art-reviews/keeper-idle-down.md (idle) and
// docs/art-reviews/char-keeper-walk-down.md (idle-flicker + walk-down, iter2).
// Grids are palette-indexed string rows (see art/palette.ts PAL_CHAR; '.' = transparent).
// Down-facing sheet (batch 1). Walk uses a 1px body-bob + alternating foot for a
// cozy cloaked stride. up/left/right directions land in later batches.

const idle0: readonly string[] = [
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

// idle frame 2: lantern dimmed (gentle flicker), body at rest
const idle1: readonly string[] = [
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
  '.AxgggfcffFFx...',
  'AGxgggfcffFFx...',
  'AexgggfcffFFx...',
  '.exgggfcffFFx...',
  '..xgggfcffFFx...',
  '..xgggfcffFFx...',
  '..xffffffffx....',
  '...xkkx.xkkx....',
  '...xKKx.xKKx....',
  '...zzzzzzzz.....',
];

// walk step — body bobbed up 1px, LEFT foot reaching forward (toe at row 22)
const stepLeft: readonly string[] = [
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
  '...xKK..........',
  '...zzzzzzzz.....',
];

// walk step — body bobbed up 1px, RIGHT foot reaching forward
const stepRight: readonly string[] = [
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
  '........xKK.....',
  '...zzzzzzzz.....',
];

/** char.keeper down sheet: [idle0, idle1, stepLeft, pass, stepRight, pass].
 *  anims: idle = 0..1, walk.down = 2..5 (step, pass, step, pass). */
export const keeperDownSheet: readonly string[][] = [idle0, idle1, stepLeft, idle0, stepRight, idle0];

/** kept for the original idle exemplar reference */
export const keeperIdleDown = idle0;
