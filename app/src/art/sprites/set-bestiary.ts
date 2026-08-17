// Ch. VIII (the Bestiary) — enemy.lurker / enemy.husk / enemy.pall.
// Lane-A code-drawn pixel sprites. Authored 16-native, baked at scale 3 for combat;
// 1px outline-warm, warm top-left key; palette-indexed string grids (art/palette.ts
// PAL_CHAR, '.' = transparent). Threats read taller/colder, moody-not-grimdark
// (style-contract §1). Reviewed + PASSED: docs/art-reviews/bestiary-entries.md.
//
// SINGLE-FRAME, unlike set-enemies.ts's 2-frame idles: Ch. VIII is explicit that all
// three are "static-frame sprites" and that no animation system arrives this wave.
// CombatScene's `if (this.anims.exists(idleAnim))` guard already handles a sprite with
// no registered idle, so nothing else needs to know.
//
// Grids are the exact iteration that PASSED the gate — generated from the reviewed
// docs/art-reviews/bestiary-entries/*.spec.json, never hand-retyped.

export const bestiarySprites = [
  // The Lurker (16x16) — a margin-thing, all legs and patience.
  {
    key: 'enemy.lurker',
    scale: 3,
    frames: [
      [
        'x..............x',
        '.x............x.',
        '.x............x.',
        '..x..........x..',
        '..x.x......x.x..',
        '...x.xxxxxx.x...',
        '...xxuuuuuuxx...',
        '..x.xuuuuuux.x..',
        '..x.xuuvvvux.x..',
        '...xxvAvvAvxx...',
        '....xvvvvvvx....',
        '....xxDzzDxx....',
        '...x..xxxx..x...',
        '..x...x..x...x..',
        '..x...x..x...x..',
        '.x....x..x....x.',
      ],
    ],
  },
  // The Husk (16x24) — the shape stands, the word is gone.
  {
    key: 'enemy.husk',
    scale: 3,
    frames: [
      [
        '................',
        '................',
        '......xxxx......',
        '.....xttTkx.....',
        '.....xtTTkx.....',
        '......xTTx......',
        '...xxxtTTkxxx...',
        '..xttTTTTkkKbx..',
        '.xttTTTTTkkKKbx.',
        '.xttTTTTTkkKKbx.',
        '.xtTTxxxxxxKKbx.',
        '.xtTTxzzzzzxKbx.',
        '.xtTxzzzzzzzxKbx',
        '.xtTTxzzzzxxKbx.',
        '.xtTTTxxxxTkKbx.',
        '.xtTTTTTTkkKKbx.',
        '.xtTTTTTTkkKKbx.',
        '..xTTTTTTkkKKb..',
        '..xTTTTTTkkKKb..',
        '..xTTTxxxxKKKb..',
        '..xTTx..xKKKbx..',
        '..xTTx..xKKKbx..',
        '.xxkTx..xKbbbx..',
        '.xkkkx..xbbbbx..',
      ],
    ],
  },
  // The Pall (16x24) — a hung shade, sewn from unread evenings.
  {
    key: 'enemy.pall',
    scale: 3,
    frames: [
      [
        '................',
        'xxxxxxxxxxxxxxxx',
        'xuuuuvvvvvvvDDDx',
        'xuuuvvvvvvvvDDzx',
        'xuzzzzzzzzzzzDzx',
        'xuzzzcvvvczzzDzx',
        'xuzzzzvvvzzzzDzx',
        'xuvzzzzzzzzzvDzx',
        'xuvvvvvvvvvvDDzx',
        'xuvvvvvvvvvvDDzx',
        'xuvvvvvvvvvvDDzx',
        'xuvvcvvvvvvvDDzx',
        'xuvvvvvvvvvvDDzx',
        'xuvvvvvvvvvvDDzx',
        'xuvvvvvvvvvvDDzx',
        'xuvvvvvvvvvvDDzx',
        'xuvvvvvvvvvvDDzx',
        'xuvvvvvvvcvvDDzx',
        'xuvvvvvvvvvvDDzx',
        'xuvvxxvvvxxvDDzx',
        'xuvx..xvx..xDDzx',
        'xux....xx....xzx',
        '.xx..........xx.',
        '................',
      ],
    ],
  },
];
