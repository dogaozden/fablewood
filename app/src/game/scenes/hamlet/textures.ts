/**
 * Placeholder art for the hamlet. For every texture key the scene uses, if the key
 * doesn't already exist we generate a tasteful palette-drawn stand-in — so the
 * clearing looks cozy TODAY and upgrades automatically the moment the art module
 * registers real textures under the same keys (slice-blueprint §5, art note 2).
 *
 * registerArt is expected to provide, under these exact keys:
 *   tile.grass tile.path tile.water                                    (16x16)
 *   prop.cottage prop.tavern prop.records-office prop.south-gate
 *   prop.wellspring prop.tree prop.lantern-post                        (bottom-origin, wellspring centred)
 *   char.keeper char.clerk char.berry char.alder                      (bottom-centre origin)
 * and, when available, walk anims named `char.<who>.walk.<down|up|left|right>`
 * (the scene plays them if they exist, else falls back to a squash-bob).
 */
import Phaser from 'phaser';
import { C } from './palette';

type G = Phaser.GameObjects.Graphics;

export function ensurePlaceholders(scene: Phaser.Scene): void {
  tex(scene, 'tile.grass', 16, 16, grass);
  tex(scene, 'tile.path', 16, 16, path);
  tex(scene, 'tile.water', 16, 16, water);

  tex(scene, 'prop.tree', 20, 28, tree);
  tex(scene, 'prop.cottage', 48, 50, cottage);
  tex(scene, 'prop.tavern', 48, 54, tavern);
  tex(scene, 'prop.records-office', 48, 50, records);
  tex(scene, 'prop.south-gate', 48, 52, southGate);
  tex(scene, 'prop.wellspring', 46, 38, wellspring);
  tex(scene, 'prop.lantern-post', 12, 28, lanternPost);

  tex(scene, 'char.keeper', 16, 22, (g) =>
    person(g, { robe: C.duskViolet, shade: C.duskDeep, skin: C.duskPeach, hair: C.bark, accent: C.lanternGold, extra: 'keeper' }),
  );
  tex(scene, 'char.clerk', 16, 22, (g) =>
    person(g, { robe: C.stone, shade: C.waterDeep, skin: C.parchment, hair: C.stone, accent: C.parchment, extra: 'clerk' }),
  );
  tex(scene, 'char.berry', 16, 22, (g) =>
    person(g, { robe: C.berry, shade: C.deepEmber, skin: C.duskPeach, hair: C.bark, accent: C.amber, extra: 'berry' }),
  );
  tex(scene, 'char.alder', 16, 22, (g) =>
    person(g, { robe: C.forest, shade: C.deepForest, skin: C.timberLi, hair: C.stone, accent: C.lanternGold, extra: 'alder' }),
  );

  tex(scene, 'fx.glow', 64, 64, glow);
  tex(scene, 'fx.spark', 8, 8, spark);
}

function tex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: G) => void): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

// ---------------------------------------------------------------------- tiles

function grass(g: G): void {
  g.fillStyle(C.moss, 1).fillRect(0, 0, 16, 16);
  g.fillStyle(C.leaf, 1).fillRect(0, 11, 16, 5);
  g.fillStyle(C.leafHi, 0.9);
  for (const [x, y] of [[3, 3], [10, 5], [6, 9], [13, 12]] as const) g.fillRect(x, y, 2, 1);
  g.fillStyle(C.forest, 0.7);
  for (const [x, y] of [[12, 2], [2, 8], [8, 13]] as const) g.fillRect(x, y, 1, 2);
}

function path(g: G): void {
  g.fillStyle(C.pathStone, 1).fillRect(0, 0, 16, 16);
  g.fillStyle(C.timberLi, 0.35).fillRect(0, 0, 16, 3);
  g.fillStyle(C.bark, 0.18).fillRect(0, 13, 16, 3);
  g.fillStyle(C.stone, 0.5);
  for (const [x, y] of [[3, 5], [9, 3], [11, 10], [5, 11]] as const) g.fillRect(x, y, 2, 2);
}

function water(g: G): void {
  g.fillStyle(C.water, 1).fillRect(0, 0, 16, 16);
  g.fillStyle(C.waterDeep, 1).fillRect(0, 9, 16, 7);
  g.fillStyle(C.waterLi, 0.55).fillRect(1, 2, 9, 1).fillRect(6, 6, 8, 1);
}

// ---------------------------------------------------------------------- props

function tree(g: G): void {
  g.fillStyle(C.bark, 1).fillRect(8, 18, 4, 10);
  g.fillStyle(C.darkBark, 1).fillRect(10, 18, 2, 10);
  g.fillStyle(C.forest, 1).fillEllipse(10, 11, 20, 20);
  g.fillStyle(C.leaf, 1).fillEllipse(10, 10, 16, 15);
  g.fillStyle(C.leafHi, 1).fillEllipse(7, 7, 8, 7);
  g.lineStyle(1, C.outline, 0.5).strokeEllipse(10, 11, 20, 20);
}

function wallHouse(g: G, roof: number, roofHi: number, wall: number, wallHi: number): void {
  // shared body for the cozy cottages: walls + gabled roof, sitting on the ground.
  g.fillStyle(C.shadowPlum, 0.3).fillEllipse(24, 48, 40, 6);
  g.fillStyle(wall, 1).fillRect(6, 22, 36, 26);
  g.fillStyle(wallHi, 0.5).fillRect(6, 22, 4, 26);
  g.fillStyle(C.barkShadow, 0.5).fillRect(6, 45, 36, 3);
  g.fillStyle(roof, 1).fillPoints(
    [{ x: 2, y: 24 }, { x: 24, y: 4 }, { x: 46, y: 24 }],
    true,
  );
  g.fillStyle(roofHi, 0.7).fillPoints(
    [{ x: 24, y: 4 }, { x: 46, y: 24 }, { x: 38, y: 24 }],
    true,
  );
  g.lineStyle(1, C.outline, 0.6).strokeRect(6, 22, 36, 26);
}

function warmWindow(g: G, x: number, y: number): void {
  g.fillStyle(C.amber, 1).fillRect(x, y, 8, 8);
  g.fillStyle(C.glowCore, 0.9).fillRect(x + 2, y + 2, 4, 4);
  g.lineStyle(1, C.bark, 1).strokeRect(x, y, 8, 8);
}

function door(g: G): void {
  g.fillStyle(C.darkBark, 1).fillRoundedRect(20, 33, 9, 15, 3);
  g.fillStyle(C.lanternGold, 1).fillCircle(26, 41, 1);
}

function cottage(g: G): void {
  wallHouse(g, C.moss, C.leafHi, C.timber, C.timberLi);
  g.fillStyle(C.bark, 1).fillRect(33, 6, 5, 9); // chimney
  warmWindow(g, 10, 28);
  warmWindow(g, 30, 28);
  door(g);
}

function tavern(g: G): void {
  wallHouse(g, C.ember, C.amber, C.timber, C.timberLi);
  g.fillStyle(C.bark, 1).fillRect(33, 4, 5, 11); // taller chimney
  g.fillStyle(C.ember, 0.8).fillCircle(35, 5, 2);
  warmWindow(g, 9, 27);
  warmWindow(g, 31, 27);
  door(g);
  // hanging acorn sign on a bracket
  g.lineStyle(2, C.bark, 1).lineBetween(42, 24, 47, 24).lineBetween(46, 24, 46, 30);
  g.fillStyle(C.timber, 1).fillEllipse(46, 33, 8, 7);
  g.fillStyle(C.moss, 1).fillEllipse(46, 30, 8, 4);
  g.fillStyle(C.glowCore, 0.5).fillCircle(46, 33, 2);
}

function records(g: G): void {
  wallHouse(g, C.waterDeep, C.waterLi, C.stone, C.parchment);
  // cool narrow windows
  g.fillStyle(C.waterLi, 0.9).fillRect(12, 28, 4, 10);
  g.fillStyle(C.waterLi, 0.9).fillRect(32, 28, 4, 10);
  g.lineStyle(1, C.water, 1).strokeRect(12, 28, 4, 10).strokeRect(32, 28, 4, 10);
  // little portico columns + parchment notice board
  g.fillStyle(C.parchment, 1).fillRect(19, 30, 11, 9);
  g.lineStyle(1, C.bark, 0.8).strokeRect(19, 30, 11, 9);
  g.fillStyle(C.bark, 0.5).fillRect(21, 33, 7, 1).fillRect(21, 36, 5, 1);
  g.fillStyle(C.stone, 1).fillRect(17, 39, 3, 9).fillRect(29, 39, 3, 9);
}

function southGate(g: G): void {
  g.fillStyle(C.shadowPlum, 0.3).fillEllipse(24, 50, 44, 6);
  // pillars
  g.fillStyle(C.stone, 1).fillRect(5, 12, 9, 38).fillRect(34, 12, 9, 38);
  g.fillStyle(C.parchment, 0.25).fillRect(5, 12, 3, 38).fillRect(34, 12, 3, 38);
  // lintel + arch
  g.fillStyle(C.stone, 1).fillRect(3, 6, 42, 9);
  g.fillStyle(C.voidBlack, 1).fillRect(14, 15, 20, 35); // the road out, into the dark
  g.fillStyle(C.duskDeep, 0.8).fillRect(14, 15, 20, 12);
  // banners
  g.fillStyle(C.berry, 1).fillRect(10, 16, 4, 10).fillRect(34, 16, 4, 10);
  g.fillTriangle(10, 26, 14, 26, 12, 30).fillTriangle(34, 26, 38, 26, 36, 30);
  // crowning lantern
  g.fillStyle(C.lanternGold, 1).fillRect(22, 1, 4, 6);
  g.fillStyle(C.glowCore, 0.9).fillCircle(24, 4, 1.5);
  g.lineStyle(1, C.outline, 0.6).strokeRect(5, 12, 9, 38).strokeRect(34, 12, 9, 38);
}

function wellspring(g: G): void {
  g.fillStyle(C.stone, 1).fillEllipse(23, 20, 44, 30);
  g.fillStyle(C.parchment, 0.3).fillEllipse(23, 18, 44, 26);
  g.fillStyle(C.water, 1).fillEllipse(23, 20, 34, 22);
  g.fillStyle(C.waterDeep, 1).fillEllipse(23, 21, 24, 15);
  g.fillStyle(C.waterLi, 0.7).fillEllipse(17, 15, 12, 5);
  g.fillStyle(C.glowCore, 0.9);
  for (const [x, y] of [[16, 16], [28, 22], [23, 14]] as const) g.fillCircle(x, y, 1);
  g.lineStyle(1, C.outline, 0.5).strokeEllipse(23, 20, 44, 30);
}

function lanternPost(g: G): void {
  g.fillStyle(C.stone, 1).fillRect(3, 25, 6, 3); // base
  g.fillStyle(C.bark, 1).fillRect(5, 8, 2, 18); // post
  g.fillStyle(C.darkBark, 1).fillRect(4, 6, 4, 3); // cap
  g.fillStyle(C.amber, 1).fillRoundedRect(2, 1, 8, 8, 2); // lantern housing
  g.fillStyle(C.glowCore, 1).fillRect(4, 3, 4, 4);
  g.lineStyle(1, C.bark, 1).strokeRoundedRect(2, 1, 8, 8, 2);
}

// ------------------------------------------------------------------ characters

interface PersonOpts {
  robe: number;
  shade: number;
  skin: number;
  hair: number;
  accent: number;
  extra: 'keeper' | 'clerk' | 'berry' | 'alder';
}

function person(g: G, o: PersonOpts): void {
  // 16x22, feet at (8,22)
  g.fillStyle(C.shadowPlum, 0.35).fillEllipse(8, 21, 12, 4);
  g.fillStyle(C.darkBark, 1).fillRect(5, 18, 2, 3).fillRect(9, 18, 2, 3); // feet
  const top = o.extra === 'alder' ? 8 : 9;
  g.fillStyle(o.robe, 1).fillRoundedRect(2, top, 12, 20 - top, 3);
  g.fillStyle(o.shade, 1).fillRect(2, 15, 12, 3);
  g.fillStyle(o.accent, 1).fillRect(2, 12, 12, 1);
  // head
  g.fillStyle(o.skin, 1).fillCircle(8, 6, 4);
  g.fillStyle(o.hair, 1).fillEllipse(8, 4, 9, 5);
  g.fillStyle(C.outline, 1).fillRect(6, 6, 1, 1).fillRect(10, 6, 1, 1);

  if (o.extra === 'keeper') {
    // hooded traveler with a Keeper's lantern
    g.fillStyle(o.robe, 1).fillEllipse(8, 3, 11, 6);
    g.fillStyle(o.skin, 1).fillCircle(8, 6, 3.4);
    g.fillStyle(C.outline, 1).fillRect(6, 6, 1, 1).fillRect(10, 6, 1, 1);
    g.fillStyle(C.bark, 1).fillRect(12, 12, 2, 6); // lantern pole
    g.fillStyle(C.amber, 1).fillRoundedRect(11, 10, 4, 4, 1);
    g.fillStyle(C.glowCore, 1).fillRect(12, 11, 2, 2);
  } else if (o.extra === 'berry') {
    g.fillStyle(C.blossom, 0.7).fillCircle(5, 7, 1).fillCircle(11, 7, 1); // rosy cheeks
    g.fillStyle(o.accent, 1).fillRect(4, 12, 8, 7); // apron
  } else if (o.extra === 'clerk') {
    g.fillStyle(C.parchment, 1).fillRect(3, 12, 4, 5); // ledger
    g.fillStyle(C.bark, 1).fillRect(11, 9, 1, 6); // quill
    g.fillStyle(C.glowCore, 1).fillRect(11, 8, 1, 2);
  } else if (o.extra === 'alder') {
    g.fillStyle(C.stone, 1).fillRect(2, 9, 12, 2); // pauldrons
    g.fillStyle(C.stone, 1).fillRect(13, 1, 1, 20); // spear shaft
    g.fillStyle(C.parchment, 1).fillTriangle(13, 1, 15, 1, 14, 4); // spearhead
  }

  g.lineStyle(1, C.outline, 0.6).strokeRoundedRect(2, top, 12, 20 - top, 3).strokeCircle(8, 6, 4);
}

// ------------------------------------------------------------------------- fx

function glow(g: G): void {
  for (let r = 32; r > 0; r--) g.fillStyle(C.lanternGold, 0.03).fillCircle(32, 32, r);
  g.fillStyle(C.glowCore, 0.15).fillCircle(32, 32, 10);
}

function spark(g: G): void {
  g.fillStyle(C.lanternGold, 0.5).fillCircle(4, 4, 3.5);
  g.fillStyle(C.glowCore, 1).fillCircle(4, 4, 1.5);
}
