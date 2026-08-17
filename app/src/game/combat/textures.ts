/**
 * Placeholder texture generation for combat. Draws on-palette colored shapes for
 * every texture key the scene needs, BUT only if the key doesn't already exist —
 * so the moment the art agent (or BootScene) registers a real `tile.*`/`enemy.*`/
 * `char.*`/`icon.*` texture, combat uses it instead. Warm-light-in-cool-dusk
 * register per docs/style-contract.md, so the greybox still reads cozy.
 */
import Phaser from 'phaser';
import { P } from './palette';
import { CELL } from './types';

const ICON = 36;
const CHIP = 18; // 6px-native status-chip glyphs at 3× (docs/design/magic-combat-depth.md §3/§12.3)

export const TILE_KEYS = {
  floor: 'tile.vault-floor',
  wall: 'tile.vault-wall',
  gold: 'tile.gold-heap',
  lantern: 'tile.lantern',
  brazier: 'tile.brazier',
  mist: 'tile.mist',
} as const;

export const UNIT_KEYS: Record<string, string> = {
  keeper: 'char.keeper',
  mira: 'char.mira',
  wisp: 'enemy.wisp',
  wraith: 'enemy.wraith',
  construct: 'enemy.construct',
  warden: 'enemy.warden',
  lurker: 'enemy.lurker',
  husk: 'enemy.husk',
  pall: 'enemy.pall',
};

export const ICON_KEYS: Record<string, string> = {
  strike: 'icon.strike',
  smite: 'icon.smite',
  weave: 'icon.weave',
  sequence: 'icon.sequence',
  cast: 'icon.cast',
  parley: 'icon.parley',
  satchel: 'icon.satchel',
  wait: 'icon.wait',
  press_on: 'icon.press-on',
  brace: 'icon.brace',
  shove: 'icon.shove',
};

/**
 * The 11 condition ids (combat/status.ts §3 + Ch. VIII's three). Kept as a LOCAL
 * literal union here, not imported, so this placeholder-bake module carries zero
 * build dependency on the sibling-owned status.ts — the two are structurally
 * identical string unions, so a real `StatusId` value indexes straight into
 * CHIP_KEYS with no cast needed.
 */
export type StatusGlyphId =
  | 'kindled'
  | 'bound'
  | 'dimmed'
  | 'warded'
  | 'inked'
  | 'emboldened'
  | 'weakened'
  | 'staggered'
  | 'toppled'
  | 'daunted'
  | 'unwritten';

/**
 * Status→texture-key manifest (docs/design/magic-combat-depth.md §3 chip column,
 * §12.3 chips UX). The wiring agent binds each StatusInstance.id straight to
 * `CHIP_KEYS[id]` for the HUD chip row under a unit's HP bar — no key-guessing.
 * Keys follow the same `<category>.<name>` convention as TILE_KEYS/UNIT_KEYS/
 * ICON_KEYS above.
 */
export const CHIP_KEYS: Record<StatusGlyphId, string> = {
  kindled: 'status.kindled',
  bound: 'status.bound',
  dimmed: 'status.dimmed',
  warded: 'status.warded',
  inked: 'status.inked',
  emboldened: 'status.emboldened',
  weakened: 'status.weakened',
  staggered: 'status.staggered',
  toppled: 'status.toppled',
  daunted: 'status.daunted',
  unwritten: 'status.unwritten',
};

export function ensureTextures(scene: Phaser.Scene): void {
  bake(scene, TILE_KEYS.floor, CELL, CELL, drawFloor);
  bake(scene, TILE_KEYS.wall, CELL, CELL, drawWall);
  bake(scene, TILE_KEYS.gold, CELL, CELL, drawGold);
  bake(scene, TILE_KEYS.lantern, CELL, CELL, drawLantern);
  bake(scene, TILE_KEYS.brazier, CELL, CELL, drawBrazier);
  bake(scene, TILE_KEYS.mist, CELL, CELL, drawMist);

  bake(scene, UNIT_KEYS.keeper, CELL, CELL, (g) => drawKeeper(g));
  bake(scene, UNIT_KEYS.mira, CELL, CELL, (g) => drawMira(g));
  bake(scene, UNIT_KEYS.wisp, CELL, CELL, (g) => drawWisp(g));
  bake(scene, UNIT_KEYS.wraith, CELL, CELL, (g) => drawWraith(g));
  bake(scene, UNIT_KEYS.construct, CELL, CELL, (g) => drawConstruct(g));
  bake(scene, UNIT_KEYS.warden, CELL, CELL, (g) => drawWarden(g));
  bake(scene, UNIT_KEYS.lurker, CELL, CELL, (g) => drawLurker(g));
  bake(scene, UNIT_KEYS.husk, CELL, CELL, (g) => drawHusk(g));
  bake(scene, UNIT_KEYS.pall, CELL, CELL, (g) => drawPall(g));

  bake(scene, ICON_KEYS.strike, ICON, ICON, drawIconStrike);
  bake(scene, ICON_KEYS.smite, ICON, ICON, drawIconSmite);
  bake(scene, ICON_KEYS.weave, ICON, ICON, drawIconWeave);
  bake(scene, ICON_KEYS.sequence, ICON, ICON, drawIconSequence);
  bake(scene, ICON_KEYS.cast, ICON, ICON, drawIconCast);
  bake(scene, ICON_KEYS.parley, ICON, ICON, drawIconParley);
  bake(scene, ICON_KEYS.satchel, ICON, ICON, drawIconSatchel);
  bake(scene, ICON_KEYS.wait, ICON, ICON, drawIconWait);
  bake(scene, ICON_KEYS.press_on, ICON, ICON, drawIconPressOn);
  bake(scene, ICON_KEYS.brace, ICON, ICON, drawIconBrace);
  bake(scene, ICON_KEYS.shove, ICON, ICON, drawIconShove);

  bake(scene, CHIP_KEYS.kindled, CHIP, CHIP, drawChipKindled);
  bake(scene, CHIP_KEYS.bound, CHIP, CHIP, drawChipBound);
  bake(scene, CHIP_KEYS.dimmed, CHIP, CHIP, drawChipDimmed);
  bake(scene, CHIP_KEYS.warded, CHIP, CHIP, drawChipWarded);
  bake(scene, CHIP_KEYS.inked, CHIP, CHIP, drawChipInked);
  bake(scene, CHIP_KEYS.emboldened, CHIP, CHIP, drawChipEmboldened);
  bake(scene, CHIP_KEYS.weakened, CHIP, CHIP, drawChipWeakened);
  bake(scene, CHIP_KEYS.staggered, CHIP, CHIP, drawChipStaggered);
  bake(scene, CHIP_KEYS.toppled, CHIP, CHIP, drawChipToppled);
  bake(scene, CHIP_KEYS.daunted, CHIP, CHIP, drawChipDaunted);
  bake(scene, CHIP_KEYS.unwritten, CHIP, CHIP, drawChipUnwritten);
}

function bake(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (g: Phaser.GameObjects.Graphics) => void,
): void {
  if (scene.textures.exists(key)) return; // real art already present → leave it
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g);
  g.generateTexture(key, w, h);
  g.destroy();
}

// ---- tiles --------------------------------------------------------------

function drawFloor(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(P.duskDeep, 1).fillRect(0, 0, CELL, CELL);
  g.fillStyle(P.shadowPlum, 0.5).fillRect(0, 0, CELL, 2).fillRect(0, 0, 2, CELL);
  g.lineStyle(1, P.shadowPlum, 0.8).strokeRect(0.5, 0.5, CELL - 1, CELL - 1);
  g.fillStyle(P.duskViolet, 0.18).fillRect(CELL / 2 - 6, CELL / 2 - 6, 12, 12);
}

function drawWall(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(P.darkBark, 1).fillRect(0, 0, CELL, CELL);
  g.fillStyle(P.timber, 1).fillRect(0, 0, CELL, 10); // lit top edge
  g.fillStyle(P.timberLight, 1).fillRect(0, 0, CELL, 4);
  g.fillStyle(P.barkShadow, 1).fillRect(0, CELL - 8, CELL, 8); // cool base shadow
  g.lineStyle(2, P.shadowPlum, 1).strokeRect(1, 1, CELL - 2, CELL - 2);
}

function drawGold(g: Phaser.GameObjects.Graphics): void {
  drawFloor(g);
  g.fillStyle(P.deepEmber, 1).fillEllipse(CELL / 2, CELL - 12, 34, 14); // shadow base
  for (const [x, y, rad] of [[16, 30, 9], [30, 28, 10], [24, 22, 9]] as const) {
    g.fillStyle(P.amber, 1).fillCircle(x, y, rad);
    g.fillStyle(P.lanternGold, 1).fillCircle(x - 1, y - 2, rad - 3);
  }
  g.fillStyle(P.glowCore, 1).fillCircle(21, 20, 2).fillCircle(30, 26, 2);
}

function drawLantern(g: Phaser.GameObjects.Graphics): void {
  drawFloor(g);
  g.fillStyle(P.amber, 0.16).fillCircle(CELL / 2, CELL / 2, 22); // soft glow
  g.fillStyle(P.amber, 0.24).fillCircle(CELL / 2, CELL / 2, 14);
  g.fillStyle(P.bark, 1).fillRect(CELL / 2 - 2, 8, 4, 4); // hook
  g.lineStyle(2, P.outline, 1).fillStyle(P.amber, 1);
  g.fillRoundedRect(CELL / 2 - 7, 12, 14, 20, 4).strokeRoundedRect(CELL / 2 - 7, 12, 14, 20, 4);
  g.fillStyle(P.glowCore, 1).fillRoundedRect(CELL / 2 - 4, 16, 8, 12, 3);
  g.fillStyle(P.ember, 1).fillRect(CELL / 2 - 5, 31, 10, 3);
}

/** Brazier (§4.4): the cold/waiting counterpart to the lantern above — same
 *  vertical placement (so lighting it into `tile.lantern` mid-battle doesn't
 *  jump), but a shallow WIDE open bowl on a stand (iter1 fix: a tall enclosed
 *  housing read as a sealed box/gadget, not a fire basin — wider-than-tall
 *  with a visible open coal bed is the silhouette that actually reads
 *  "brazier"), cold iron instead of amber, and dark coals instead of a glowing
 *  core. A few dim ember flecks (low alpha, never a glow halo) hint "this can
 *  be lit" without it reading as already-lit. */
function drawBrazier(g: Phaser.GameObjects.Graphics): void {
  drawFloor(g);
  const cx = CELL / 2;
  // short iron stem + foot — grounded, not hanging (a basin, not the lantern's hook)
  g.lineStyle(1, P.outline, 1).fillStyle(P.darkBark, 1);
  g.fillRect(cx - 2, 30, 4, 8).strokeRect(cx - 2, 30, 4, 8);
  g.fillStyle(P.stoneGrey, 1).fillRect(cx - 8, 37, 16, 3);
  g.lineStyle(1, P.outline, 1).strokeRect(cx - 8, 37, 16, 3);
  // wide shallow bowl (open top, wider than tall — the brazier's own silhouette,
  // not the lantern's tall enclosed housing)
  g.lineStyle(2, P.outline, 1).fillStyle(P.stoneGrey, 1);
  g.fillEllipse(cx, 26, 26, 13).strokeEllipse(cx, 26, 26, 13);
  // open coal bed (seen from above), dark and cold
  g.fillStyle(P.darkBark, 1).fillEllipse(cx, 22, 20, 8);
  g.lineStyle(1, P.outline, 1).strokeEllipse(cx, 22, 20, 8);
  g.fillStyle(P.barkShadow, 1).fillEllipse(cx, 22, 14, 5); // coal mound
  // dim ember flecks — cold and dull, but hint it can catch
  g.fillStyle(P.deepEmber, 0.5).fillCircle(cx - 3, 21, 1.8);
  g.fillStyle(P.deepEmber, 0.4).fillCircle(cx + 3, 23, 1.5);
  g.fillStyle(P.ember, 0.3).fillCircle(cx, 20, 1.3);
}

/** Mist (§4.4): soft veiling over the floor language — must read "vision
 *  blocked here", not "wall here", so it's low-alpha dusk/water washes (never a
 *  flat opaque fill) layered over the SAME floor base every other passable tile
 *  uses, letting the flagstone show through like something you could still
 *  walk into. */
function drawMist(g: Phaser.GameObjects.Graphics): void {
  drawFloor(g);
  const cx = CELL / 2;
  const cy = CELL / 2;
  // whole-tile wash first (iter1 fix: 3 isolated blobs left visible floor gaps
  // and hard seams between them — this unifies the veil without going opaque)
  g.fillStyle(P.duskMauve, 0.1).fillRoundedRect(1, 1, CELL - 2, CELL - 2, 6);
  g.fillStyle(P.duskMauve, 0.22).fillEllipse(cx - 8, cy + 4, 30, 18);
  g.fillStyle(P.waterLight, 0.2).fillEllipse(cx + 9, cy - 5, 26, 16);
  g.fillStyle(P.parchment, 0.14).fillEllipse(cx, cy, 34, 14);
  g.fillStyle(P.glowCore, 0.12).fillEllipse(cx - 3, cy - 2, 14, 5); // a faint wisp catching light
}

// ---- units (friendly = rounded/bottom-heavy; threats = taller/colder) -----

/** A friendly, bottom-heavy figure: narrow torso + a flaring rounded robe hem. */
function figure(g: Phaser.GameObjects.Graphics, robe: number, hi: number, headCol: number, headY: number, headR: number) {
  const cx = CELL / 2;
  g.lineStyle(2, P.outline, 1);
  g.fillStyle(robe, 1);
  g.fillEllipse(cx, 41, 30, 15); // flaring hem (the bottom-heavy base)
  g.fillRoundedRect(cx - 8, headY + headR - 2, 16, 22, 6); // torso
  g.strokeEllipse(cx, 41, 30, 15);
  g.strokeRoundedRect(cx - 8, headY + headR - 2, 16, 22, 6);
  g.fillStyle(hi, 1).fillRoundedRect(cx - 6, headY + headR, 6, 9, 3); // top-left cloak light
  g.fillStyle(headCol, 1).fillCircle(cx, headY, headR); // head
  g.strokeCircle(cx, headY, headR);
  g.fillStyle(P.glowCore, 0.45).fillCircle(cx - headR / 2, headY - headR / 2, 2); // cheek light
}

function drawKeeper(g: Phaser.GameObjects.Graphics): void {
  const cx = CELL / 2;
  figure(g, P.timber, P.timberLight, P.parchment, 15, 7);
  // hood cowl framing the face (bark, lit rim)
  g.lineStyle(2, P.outline, 1).fillStyle(P.bark, 1);
  g.fillEllipse(cx, 11, 20, 14);
  g.strokeEllipse(cx, 11, 20, 14);
  g.fillStyle(P.timber, 1).fillEllipse(cx, 9, 16, 8); // lit hood top
  g.fillStyle(P.parchment, 1).fillCircle(cx, 16, 6).lineStyle(2, P.outline, 1).strokeCircle(cx, 16, 6); // face
  g.fillStyle(P.outline, 1).fillCircle(cx - 2, 16, 1).fillCircle(cx + 2, 16, 1); // eyes
  // lantern staff
  g.fillStyle(P.bark, 1).fillRect(cx + 10, 18, 3, 24).lineStyle(1, P.outline, 1).strokeRect(cx + 10, 18, 3, 24);
  g.fillStyle(P.amber, 0.3).fillCircle(cx + 11, 20, 8);
  g.fillStyle(P.lanternGold, 1).fillCircle(cx + 11, 20, 4).lineStyle(1, P.outline, 1).strokeCircle(cx + 11, 20, 4);
  g.fillStyle(P.glowCore, 1).fillCircle(cx + 11, 20, 2);
}

function drawMira(g: Phaser.GameObjects.Graphics): void {
  const cx = CELL / 2;
  figure(g, P.orchid, P.blossom, P.parchment, 16, 6);
  g.fillStyle(P.outline, 1).fillCircle(cx - 2, 16, 1).fillCircle(cx + 2, 16, 1); // eyes
  // pointed scholar's hat
  g.lineStyle(2, P.outline, 1).fillStyle(P.duskViolet, 1);
  g.fillTriangle(cx - 9, 12, cx + 9, 12, cx, 1);
  g.strokeTriangle(cx - 9, 12, cx + 9, 12, cx, 1);
  g.fillStyle(P.blossom, 1).fillTriangle(cx - 3, 11, cx + 2, 11, cx, 3); // hat sheen
  g.fillStyle(P.lanternGold, 1).fillCircle(cx, 1, 2); // star tip
  g.fillStyle(P.parchment, 1).fillRect(cx - 10, 30, 7, 9); // her ledger/book
  g.lineStyle(1, P.outline, 1).strokeRect(cx - 10, 30, 7, 9).lineBetween(cx - 6, 30, cx - 6, 39);
}

function drawWisp(g: Phaser.GameObjects.Graphics): void {
  const cx = CELL / 2;
  const cy = CELL / 2 + 4;
  g.fillStyle(P.waterLight, 0.22).fillCircle(cx, cy, 15);
  g.lineStyle(2, P.outline, 1).fillStyle(P.waterLight, 1).fillCircle(cx, cy, 10);
  g.strokeCircle(cx, cy, 10);
  g.fillStyle(P.glowCore, 1).fillCircle(cx - 2, cy - 3, 4);
  g.fillStyle(P.outline, 1).fillCircle(cx - 3, cy - 1, 1.5).fillCircle(cx + 3, cy - 1, 1.5); // eyes
}

function drawWraith(g: Phaser.GameObjects.Graphics): void {
  const cx = CELL / 2;
  g.lineStyle(2, P.outline, 1).fillStyle(P.duskDeep, 1);
  g.beginPath();
  g.moveTo(cx - 12, CELL - 4);
  g.lineTo(cx - 9, 12);
  g.lineTo(cx, 4);
  g.lineTo(cx + 9, 12);
  g.lineTo(cx + 12, CELL - 4);
  g.closePath();
  g.fillPath();
  g.strokePath();
  g.fillStyle(P.duskViolet, 1).fillTriangle(cx - 8, 14, cx, 6, cx + 2, 16); // lit fold
  g.fillStyle(P.waterLight, 1).fillCircle(cx - 4, 16, 2).fillCircle(cx + 4, 16, 2); // cold eyes
}

function drawConstruct(g: Phaser.GameObjects.Graphics): void {
  const cx = CELL / 2;
  g.lineStyle(2, P.outline, 1).fillStyle(P.stoneGrey, 1);
  g.fillRoundedRect(cx - 15, 12, 30, CELL - 15, 5).strokeRoundedRect(cx - 15, 12, 30, CELL - 15, 5);
  g.fillStyle(P.parchment, 0.5).fillRect(cx - 12, 14, 22, 4); // top light
  g.lineStyle(2, P.darkBark, 1);
  g.lineBetween(cx - 15, 26, cx + 15, 26).lineBetween(cx, 12, cx, CELL - 3); // seams
  g.fillStyle(P.glowCore, 1).fillCircle(cx, 20, 3);
  g.fillStyle(P.amber, 1).fillCircle(cx, 20, 1.5);
}

function drawWarden(g: Phaser.GameObjects.Graphics): void {
  const cx = CELL / 2;
  g.lineStyle(2, P.outline, 1).fillStyle(P.darkBark, 1);
  g.fillRoundedRect(cx - 16, 8, 32, CELL - 10, 6).strokeRoundedRect(cx - 16, 8, 32, CELL - 10, 6);
  g.fillStyle(P.bark, 1).fillRoundedRect(cx - 13, 10, 26, 8, 4); // shoulders
  g.fillStyle(P.lanternGold, 1).fillRect(cx - 12, 24, 24, 3).fillRect(cx - 3, 18, 6, 22); // gold trim
  g.fillStyle(P.deepEmber, 1).fillCircle(cx, 15, 8);
  g.lineStyle(2, P.outline, 1).strokeCircle(cx, 15, 8); // helm
  g.fillStyle(P.berry, 1).fillRect(cx - 5, 14, 10, 2); // visor glow
  g.fillStyle(P.glowCore, 1).fillCircle(cx - 3, 14, 1).fillCircle(cx + 3, 14, 1);
}

// ---- Ch. VIII's three (greybox only — the real grids live in art/sprites/set-bestiary.ts,
//      which registers the SAME keys at boot and wins; these draw only if it hasn't run) ----

/** The Lurker — low, wide and many-legged, nesting in the gutter of the page. Deliberately the
 *  only enemy silhouette that is wider than it is tall: at a glance it reads as a thing that
 *  belongs to the floor, not a figure standing on it. */
function drawLurker(g: Phaser.GameObjects.Graphics): void {
  const cx = CELL / 2;
  const cy = CELL / 2 + 6;
  g.lineStyle(2, P.outline, 1);
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    g.lineBetween(cx + i * 2, cy, cx + i * 6, cy + 9); // legs
  }
  g.fillStyle(P.duskDeep, 1).fillEllipse(cx, cy, 24, 13);
  g.strokeEllipse(cx, cy, 24, 13);
  g.fillStyle(P.duskViolet, 1).fillEllipse(cx - 3, cy - 3, 12, 5); // lit top-left
  g.fillStyle(P.amber, 1).fillCircle(cx - 5, cy - 1, 1.6).fillCircle(cx + 5, cy - 1, 1.6); // low eyes
}

/** The Husk — a heavy standing mass with the name gnawed out of it: the hollow is the point, so
 *  it is drawn as a void in the chest rather than as any kind of face. */
function drawHusk(g: Phaser.GameObjects.Graphics): void {
  const cx = CELL / 2;
  g.lineStyle(2, P.outline, 1).fillStyle(P.bark, 1);
  g.fillRoundedRect(cx - 14, 9, 28, CELL - 12, 4).strokeRoundedRect(cx - 14, 9, 28, CELL - 12, 4);
  g.fillStyle(P.timber, 1).fillRect(cx - 11, 11, 12, 5); // warm top-left key
  g.fillStyle(P.barkShadow, 1).fillRect(cx + 6, 16, 6, CELL - 22); // cool shadow side
  g.fillStyle(P.shadowPlum, 1).fillRoundedRect(cx - 7, 20, 14, 12, 3); // the gnawed-out name
  g.lineStyle(1, P.darkBark, 1).strokeRoundedRect(cx - 7, 20, 14, 12, 3);
}

/** The Pall — a hung shade: a curtain with no feet, hem tattered, bottom edge never touching
 *  the floor line the other enemies stand on. */
function drawPall(g: Phaser.GameObjects.Graphics): void {
  const cx = CELL / 2;
  g.lineStyle(2, P.outline, 1).fillStyle(P.duskDeep, 1);
  g.beginPath();
  g.moveTo(cx - 13, 8);
  g.lineTo(cx + 13, 8);
  g.lineTo(cx + 11, CELL - 9);
  g.lineTo(cx + 5, CELL - 13);
  g.lineTo(cx, CELL - 8);
  g.lineTo(cx - 5, CELL - 13);
  g.lineTo(cx - 11, CELL - 9);
  g.closePath();
  g.fillPath();
  g.strokePath();
  g.fillStyle(P.duskMauve, 0.85).fillRect(cx - 10, 10, 7, CELL - 22); // one lit fold, top-left
  g.fillStyle(P.duskViolet, 1).fillRect(cx + 2, 12, 4, CELL - 26); // a second, dimmer
}

// ---- action icons -------------------------------------------------------

function iconBase(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(P.outline, 0); // transparent ground
}

function drawIconStrike(g: Phaser.GameObjects.Graphics): void {
  iconBase(g);
  g.lineStyle(4, P.outline, 1).lineBetween(8, 28, 28, 8);
  g.lineStyle(3, P.lanternGold, 1).lineBetween(8, 28, 28, 8); // blade
  g.fillStyle(P.timber, 1).fillCircle(9, 27, 4); // pommel
  g.lineStyle(2, P.parchment, 1).lineBetween(22, 6, 30, 14); // guard
}

function drawIconSmite(g: Phaser.GameObjects.Graphics): void {
  iconBase(g);
  g.fillStyle(P.amber, 0.3).fillCircle(19, 18, 12); // hot glow behind the bolt
  const bolt = [
    new Phaser.Geom.Point(22, 4),
    new Phaser.Geom.Point(11, 20),
    new Phaser.Geom.Point(18, 20),
    new Phaser.Geom.Point(14, 32),
    new Phaser.Geom.Point(28, 14),
    new Phaser.Geom.Point(20, 14),
  ];
  g.lineStyle(2, P.outline, 1);
  g.fillStyle(P.ember, 1).fillPoints(bolt, true);
  g.strokePoints(bolt, true);
  g.fillStyle(P.lanternGold, 1).fillTriangle(21, 7, 15, 19, 20, 15); // lit upper facet
}

function drawIconWeave(g: Phaser.GameObjects.Graphics): void {
  iconBase(g);
  g.lineStyle(6, P.outline, 1).lineBetween(18, 6, 18, 30).lineBetween(6, 18, 30, 18);
  g.lineStyle(4, P.orchid, 1).lineBetween(18, 6, 18, 30).lineBetween(6, 18, 30, 18);
  g.fillStyle(P.blossom, 1).fillCircle(18, 18, 4);
}

function drawIconSequence(g: Phaser.GameObjects.Graphics): void {
  iconBase(g);
  g.fillStyle(P.outline, 1).fillRect(6, 22, 8, 8).fillRect(15, 16, 8, 14).fillRect(24, 10, 8, 20);
  g.fillStyle(P.waterBlue, 1).fillRect(7, 23, 6, 6).fillRect(16, 17, 6, 12).fillRect(25, 11, 6, 18);
  g.fillStyle(P.waterLight, 1).fillRect(7, 23, 6, 2).fillRect(16, 17, 6, 2).fillRect(25, 11, 6, 2);
}

function drawIconCast(g: Phaser.GameObjects.Graphics): void {
  iconBase(g);
  g.lineStyle(2, P.outline, 1).fillStyle(P.parchment, 1);
  g.fillRoundedRect(6, 12, 24, 18, 3).strokeRoundedRect(6, 12, 24, 18, 3);
  g.lineStyle(2, P.outline, 1).lineBetween(18, 12, 18, 30); // spine
  g.fillStyle(P.amber, 0.35).fillCircle(18, 10, 8); // glow
  star(g, 18, 9, 6, P.lanternGold);
}

function drawIconParley(g: Phaser.GameObjects.Graphics): void {
  iconBase(g);
  g.lineStyle(2, P.outline, 1).fillStyle(P.blossom, 1);
  g.fillRoundedRect(6, 8, 24, 16, 5).strokeRoundedRect(6, 8, 24, 16, 5);
  g.fillTriangle(12, 22, 20, 22, 11, 30).lineStyle(2, P.outline, 1);
  g.fillStyle(P.parchment, 1).fillCircle(13, 16, 2).fillCircle(18, 16, 2).fillCircle(23, 16, 2);
}

/** The Satchel action's HUD icon (inventory-handoff §10) — a leather pouch,
 *  matching the "warm bark, lantern-gold buckle" palette family so it reads
 *  at home next to Strike/Cast/etc. Distinct icon system from the DOM item
 *  icons in inventory/icons.ts (that's 16×16 palette-char grids for the
 *  Satchel/shop panes; this is the same 36×36-baked-texture style every other
 *  combat action icon here uses — the "§8 UI-icon exception" the handoff notes). */
function drawIconSatchel(g: Phaser.GameObjects.Graphics): void {
  iconBase(g);
  g.lineStyle(3, P.outline, 1).lineBetween(9, 10, 27, 4); // strap
  g.lineStyle(2, P.bark, 1).lineBetween(9, 10, 27, 4);
  g.lineStyle(2, P.outline, 1).fillStyle(P.timber, 1);
  g.fillRoundedRect(7, 13, 22, 18, 5).strokeRoundedRect(7, 13, 22, 18, 5); // bag body
  g.fillStyle(P.timberLight, 1).fillRoundedRect(9, 15, 8, 6, 3); // top-left lit patch
  g.fillStyle(P.bark, 1).fillRoundedRect(9, 11, 18, 8, 4);
  g.lineStyle(2, P.outline, 1).strokeRoundedRect(9, 11, 18, 8, 4); // flap
  g.fillStyle(P.lanternGold, 1).fillCircle(18, 18, 2.5);
  g.lineStyle(1, P.outline, 1).strokeCircle(18, 18, 2.5); // buckle
}

function drawIconWait(g: Phaser.GameObjects.Graphics): void {
  iconBase(g);
  g.lineStyle(3, P.outline, 1).fillStyle(P.stoneGrey, 1);
  g.fillTriangle(10, 8, 26, 8, 18, 18).fillTriangle(18, 18, 10, 28, 26, 28);
  g.lineBetween(10, 8, 26, 8).lineBetween(10, 28, 26, 28);
  g.fillStyle(P.lanternGold, 1).fillTriangle(14, 11, 22, 11, 18, 17); // sand
}

/** Press On's HUD icon (Ch. VI action economy) — a forward double-chevron: "press onward, the
 *  road stretches further" (the button's own pathStone tint, then the banner's lantern-gold —
 *  ties both colors into the glyph itself, same double-stroke technique as drawIconStrike). */
function drawIconPressOn(g: Phaser.GameObjects.Graphics): void {
  iconBase(g);
  g.lineStyle(4, P.outline, 1);
  g.lineBetween(6, 8, 17, 18).lineBetween(17, 18, 6, 28);
  g.lineStyle(3, P.pathStone, 1);
  g.lineBetween(6, 8, 17, 18).lineBetween(17, 18, 6, 28);
  g.lineStyle(4, P.outline, 1);
  g.lineBetween(17, 8, 28, 18).lineBetween(28, 18, 17, 28);
  g.lineStyle(3, P.lanternGold, 1);
  g.lineBetween(17, 8, 28, 18).lineBetween(28, 18, 17, 28);
}

/** Brace's HUD icon (Ch. VI Task 4) — a small shield: a hexagonal outline (same
 *  points-polygon technique as drawIconSmite's bolt) in the deep-water tone, a lit facet
 *  top-left (the double-tone shading every other icon here uses — Strike's blade,
 *  Satchel's bag), and a small core rivet — "brace behind a shield", tying the glyph to the
 *  same shield/absorb blue family as the boss-shield pips and Warded's own HUD chip. */
function drawIconBrace(g: Phaser.GameObjects.Graphics): void {
  iconBase(g);
  const shield = [
    new Phaser.Geom.Point(18, 5),
    new Phaser.Geom.Point(29, 9),
    new Phaser.Geom.Point(27, 20),
    new Phaser.Geom.Point(18, 31),
    new Phaser.Geom.Point(9, 20),
    new Phaser.Geom.Point(7, 9),
  ];
  g.lineStyle(2, P.outline, 1);
  g.fillStyle(P.waterDeep, 1).fillPoints(shield, true);
  g.strokePoints(shield, true);
  g.fillStyle(P.waterLight, 1).fillTriangle(12, 10, 18, 8, 14, 18); // lit facet
  g.fillStyle(P.glowCore, 0.9).fillCircle(18, 16, 2.5); // core rivet
}

/** Shove's HUD icon (Ch. VIII Task 3) — a driving wedge (the shoulder) striking a displaced
 *  block (the target), with two short motion-lines trailing behind it: physical impact and
 *  displacement, deliberately distinct from Press On's forward double-chevron (that reads as
 *  travel, not a hit) and from Strike's diagonal blade. Same outline-then-tint double-stroke
 *  technique as drawIconPressOn/drawIconBrace. */
function drawIconShove(g: Phaser.GameObjects.Graphics): void {
  iconBase(g);
  // trailing motion-lines behind the displaced block
  g.lineStyle(3, P.stoneGrey, 0.8);
  g.lineBetween(8, 14, 14, 14).lineBetween(6, 22, 12, 22);
  // the displaced block (the shoved target), pushed toward the right edge
  g.lineStyle(2, P.outline, 1).fillStyle(P.timberLight, 1);
  g.fillRoundedRect(21, 9, 11, 18, 3).strokeRoundedRect(21, 9, 11, 18, 3);
  g.fillStyle(P.parchment, 0.5).fillRect(22, 11, 3, 14); // lit facing edge
  // the driving wedge (the shove itself), striking the block's left face
  const wedge = [
    new Phaser.Geom.Point(4, 18),
    new Phaser.Geom.Point(19, 11),
    new Phaser.Geom.Point(19, 25),
  ];
  g.lineStyle(2, P.outline, 1);
  g.fillStyle(P.timber, 1).fillPoints(wedge, true);
  g.strokePoints(wedge, true);
}

function star(g: Phaser.GameObjects.Graphics, cx: number, cy: number, rad: number, color: number): void {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? rad : rad / 2.3;
    pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.fillStyle(color, 1).fillPoints(
    pts.reduce<Phaser.Geom.Point[]>((acc, _v, i) => (i % 2 === 0 ? [...acc, new Phaser.Geom.Point(pts[i], pts[i + 1])] : acc), []),
    true,
  );
}

// ---- status chips (§3/§12.3) --------------------------------------------
// 8 tiny condition glyphs, up to 3 shown under a unit's HP bar. At CHIP (18px =
// 6px-native ×3) there's no room for shaded vector curves to read cleanly, so
// every glyph is authored on an explicit 6×6 logical-pixel grid (CHIP_UNIT=3px
// per cell) and drawn as exact axis-aligned blocks — crisp "3-5 pixels of
// gesture", never fuzzy antialiased edges. One dominant status color each
// (spec §3's chip column) so the row scans by color+silhouette at a glance.

const CHIP_UNIT = CHIP / 6;

/** Fill one logical cell (or a gw×gh block of cells) on the 6×6 glyph grid. */
function chipBlock(
  g: Phaser.GameObjects.Graphics,
  gx: number,
  gy: number,
  gw: number,
  gh: number,
  color: number,
  alpha = 1,
): void {
  g.fillStyle(color, alpha).fillRect(gx * CHIP_UNIT, gy * CHIP_UNIT, gw * CHIP_UNIT, gh * CHIP_UNIT);
}

/** Kindled — ember ▲: a rising, wide-based triangle (kindling catching). */
function drawChipKindled(g: Phaser.GameObjects.Graphics): void {
  chipBlock(g, 2, 1, 1, 1, P.ember);
  chipBlock(g, 1, 2, 3, 1, P.ember);
}

/** Bound — orchid ⌗: a square knot/ring (tied, not crushed). iter1 fix: a 3×3
 *  footprint with a 1-cell hole read as a near-solid square (8/9 cells
 *  filled) — widened to 4×4 with a proper 2×2 hole so the ring actually reads
 *  as hollow. */
function drawChipBound(g: Phaser.GameObjects.Graphics): void {
  chipBlock(g, 1, 1, 4, 1, P.orchid);
  chipBlock(g, 1, 2, 1, 1, P.orchid);
  chipBlock(g, 4, 2, 1, 1, P.orchid);
  chipBlock(g, 1, 3, 1, 1, P.orchid);
  chipBlock(g, 4, 3, 1, 1, P.orchid);
  chipBlock(g, 1, 4, 4, 1, P.orchid);
}

/** Dimmed — dusk-violet ◗: a small solid rounded blob (a shrunken, dim
 *  light). iter1 fix: a stacked 1-3-1 "diamond" is geometrically identical to
 *  a plus-sign at this resolution (no true diagonal edge) and collided with
 *  Emboldened/Weakened's also-broken cross shapes — this is a squat solid
 *  blob with no protruding arms, unambiguous next to the arrows/rings. */
function drawChipDimmed(g: Phaser.GameObjects.Graphics): void {
  chipBlock(g, 2, 1, 2, 1, P.duskViolet);
  chipBlock(g, 1, 2, 4, 2, P.duskViolet);
  chipBlock(g, 2, 4, 2, 1, P.duskViolet);
}

/** Warded — water-blue ◈: a larger HOLLOW diamond ring (a ward/shield rune) —
 *  filled-vs-hollow and size both separate it from Dimmed's small solid one. */
function drawChipWarded(g: Phaser.GameObjects.Graphics): void {
  chipBlock(g, 2, 1, 2, 1, P.waterBlue);
  chipBlock(g, 1, 2, 1, 1, P.waterBlue);
  chipBlock(g, 4, 2, 1, 1, P.waterBlue);
  chipBlock(g, 1, 3, 1, 1, P.waterBlue);
  chipBlock(g, 4, 3, 1, 1, P.waterBlue);
  chipBlock(g, 2, 4, 2, 1, P.waterBlue);
}

/** Inked — ink-dark ✎: a diagonal quill slash. Its status color IS
 *  outline-warm, which would vanish on the dusk floor alone, so a 1px
 *  parchment rim (4-direction offset underdraw, then the true shape on top)
 *  is baked in per the brief — "light outline so it reads on dark ground". */
function drawChipInked(g: Phaser.GameObjects.Graphics): void {
  const cells: Array<[number, number]> = [
    [1, 0],
    [2, 1],
    [3, 2],
    [4, 3],
    [4, 4],
  ];
  const put = (dx: number, dy: number, color: number): void => {
    g.fillStyle(color, 1);
    for (const [gx, gy] of cells) g.fillRect(gx * CHIP_UNIT + dx, gy * CHIP_UNIT + dy, CHIP_UNIT, CHIP_UNIT);
  };
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) put(dx, dy, P.parchment);
  put(0, 0, P.outline);
}

/** Emboldened — moss ↑: an up arrow — tip + two diagonally-stepped wing cells
 *  (the Inked-slash technique: single-cell diagonal steps read as an angled
 *  chevron) + a 2-cell stem below. iter1 fix: the wings previously filled
 *  the FULL row including the tip's own column, so tip+wings+stem formed one
 *  unbroken vertical line crossed by one unbroken horizontal bar — a plain
 *  plus-sign, indistinguishable from Weakened/Dimmed. Leaving the tip's
 *  column empty at the wing row breaks the cross and reads as a proper
 *  arrowhead. */
function drawChipEmboldened(g: Phaser.GameObjects.Graphics): void {
  chipBlock(g, 2, 1, 1, 1, P.moss); // tip
  chipBlock(g, 1, 2, 1, 1, P.moss); // left wing
  chipBlock(g, 3, 2, 1, 1, P.moss); // right wing
  chipBlock(g, 2, 3, 1, 1, P.moss); // stem
  chipBlock(g, 2, 4, 1, 1, P.moss); // stem
}

/** Weakened — stone-grey ↓: a down arrow, the exact vertical mirror of
 *  Emboldened's fixed chevron (shaft-then-head vs head-then-shaft) — the
 *  +1/−1 pairing reads as opposites. */
function drawChipWeakened(g: Phaser.GameObjects.Graphics): void {
  chipBlock(g, 2, 1, 1, 1, P.stoneGrey); // stem
  chipBlock(g, 2, 2, 1, 1, P.stoneGrey); // stem
  chipBlock(g, 1, 3, 1, 1, P.stoneGrey); // left wing
  chipBlock(g, 3, 3, 1, 1, P.stoneGrey); // right wing
  chipBlock(g, 2, 4, 1, 1, P.stoneGrey); // tip
}

/** Staggered — dusk-peach ✱: a 5-point sparkle/asterisk (seeing stars, skip a turn). */
function drawChipStaggered(g: Phaser.GameObjects.Graphics): void {
  chipBlock(g, 1, 1, 1, 1, P.duskPeach);
  chipBlock(g, 3, 1, 1, 1, P.duskPeach);
  chipBlock(g, 2, 2, 1, 1, P.duskPeach);
  chipBlock(g, 1, 3, 1, 1, P.duskPeach);
  chipBlock(g, 3, 3, 1, 1, P.duskPeach);
}

// ---- Ch. VIII's three (the Bestiary newcomers) --------------------------
// Silhouettes deliberately chosen from the shapes the shipped eight DON'T use.
// Taken: triangle, square ring, solid blob, diamond ring, diagonal slash, up
// arrow, down arrow, sparkle. Free, and used here: stacked horizontals, a
// HORIZONTAL arrow (both existing arrows are vertical), and separated dots.

/** Toppled — timber ▼: a body tipped over above the ground it came down on. Two
 *  stacked horizontal bars, the lower one wider — the one silhouette family none
 *  of the shipped eight uses, so it never has to out-argue them. Deliberately NOT
 *  a down-arrow: Weakened already owns that shape, and Toppled is a position, not
 *  a decrease. */
function drawChipToppled(g: Phaser.GameObjects.Graphics): void {
  chipBlock(g, 1, 2, 3, 1, P.timber); // the fallen body, lying flat
  chipBlock(g, 1, 4, 4, 1, P.timber); // the ground under it
}

/** Daunted — dusk-mauve ↚: an arrow pointing AWAY (cannot willingly close on the
 *  source). Horizontal, where Emboldened/Weakened are vertical, so the axis alone
 *  separates them before color does. Built with Emboldened's own iter-2 fix: the
 *  wings sit off the tip's ROW (here, off its column-2 centre cell) so tip + wings
 *  + shaft never close into a plain plus-sign. */
function drawChipDaunted(g: Phaser.GameObjects.Graphics): void {
  chipBlock(g, 1, 2, 1, 1, P.duskMauve); // tip, pointing left/away
  chipBlock(g, 2, 1, 1, 1, P.duskMauve); // upper wing
  chipBlock(g, 2, 3, 1, 1, P.duskMauve); // lower wing
  chipBlock(g, 3, 2, 1, 1, P.duskMauve); // shaft
  chipBlock(g, 4, 2, 1, 1, P.duskMauve); // shaft
}

/** Unwritten — parchment ◌: three separated dots, a line the Ledger hasn't taken
 *  down yet. Disconnected on purpose — every other glyph is one connected mass, so
 *  "not yet joined up" is doing the work that a third hollow ring could not (Bound
 *  and Warded already hold the ring and the diamond). Spans the full 6 cells rather
 *  than the usual 1-4 inset, which also keeps it from reading as a shrunken blob. */
function drawChipUnwritten(g: Phaser.GameObjects.Graphics): void {
  chipBlock(g, 0, 2, 1, 1, P.parchment);
  chipBlock(g, 2, 2, 1, 1, P.parchment);
  chipBlock(g, 4, 2, 1, 1, P.parchment);
}
