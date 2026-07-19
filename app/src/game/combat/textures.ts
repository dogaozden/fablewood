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

export const TILE_KEYS = {
  floor: 'tile.vault-floor',
  wall: 'tile.vault-wall',
  gold: 'tile.gold-heap',
  lantern: 'tile.lantern',
} as const;

export const UNIT_KEYS: Record<string, string> = {
  keeper: 'char.keeper',
  mira: 'char.mira',
  wisp: 'enemy.wisp',
  wraith: 'enemy.wraith',
  construct: 'enemy.construct',
  warden: 'enemy.warden',
};

export const ICON_KEYS: Record<string, string> = {
  strike: 'icon.strike',
  weave: 'icon.weave',
  sequence: 'icon.sequence',
  cast: 'icon.cast',
  parley: 'icon.parley',
  wait: 'icon.wait',
};

export function ensureTextures(scene: Phaser.Scene): void {
  bake(scene, TILE_KEYS.floor, CELL, CELL, drawFloor);
  bake(scene, TILE_KEYS.wall, CELL, CELL, drawWall);
  bake(scene, TILE_KEYS.gold, CELL, CELL, drawGold);
  bake(scene, TILE_KEYS.lantern, CELL, CELL, drawLantern);

  bake(scene, UNIT_KEYS.keeper, CELL, CELL, (g) => drawKeeper(g));
  bake(scene, UNIT_KEYS.mira, CELL, CELL, (g) => drawMira(g));
  bake(scene, UNIT_KEYS.wisp, CELL, CELL, (g) => drawWisp(g));
  bake(scene, UNIT_KEYS.wraith, CELL, CELL, (g) => drawWraith(g));
  bake(scene, UNIT_KEYS.construct, CELL, CELL, (g) => drawConstruct(g));
  bake(scene, UNIT_KEYS.warden, CELL, CELL, (g) => drawWarden(g));

  bake(scene, ICON_KEYS.strike, ICON, ICON, drawIconStrike);
  bake(scene, ICON_KEYS.weave, ICON, ICON, drawIconWeave);
  bake(scene, ICON_KEYS.sequence, ICON, ICON, drawIconSequence);
  bake(scene, ICON_KEYS.cast, ICON, ICON, drawIconCast);
  bake(scene, ICON_KEYS.parley, ICON, ICON, drawIconParley);
  bake(scene, ICON_KEYS.wait, ICON, ICON, drawIconWait);
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

// ---- units (friendly = rounded/bottom-heavy; threats = taller/colder) -----

function body(g: Phaser.GameObjects.Graphics, color: number, hi: number, w: number, top: number) {
  const cx = CELL / 2;
  g.lineStyle(2, P.outline, 1);
  g.fillStyle(color, 1).fillRoundedRect(cx - w / 2, top, w, CELL - top - 3, 6);
  g.strokeRoundedRect(cx - w / 2, top, w, CELL - top - 3, 6);
  g.fillStyle(hi, 1).fillRoundedRect(cx - w / 2 + 3, top + 2, w / 2 - 2, 6, 3); // top-left light
}

function head(g: Phaser.GameObjects.Graphics, color: number, y: number, rad = 7) {
  const cx = CELL / 2;
  g.lineStyle(2, P.outline, 1).fillStyle(color, 1).fillCircle(cx, y, rad);
  g.strokeCircle(cx, y, rad);
  g.fillStyle(P.glowCore, 0.5).fillCircle(cx - 2, y - 2, 2);
}

function drawKeeper(g: Phaser.GameObjects.Graphics): void {
  body(g, P.timber, P.timberLight, 26, 20);
  head(g, P.parchment, 15, 8);
  g.fillStyle(P.timber, 1).fillRoundedRect(CELL / 2 - 10, 8, 20, 8, 4); // hood brim
  g.lineStyle(2, P.outline, 1).strokeRoundedRect(CELL / 2 - 10, 8, 20, 8, 4);
  g.fillStyle(P.bark, 1).fillRect(CELL / 2 + 9, 22, 3, 20); // staff
  g.fillStyle(P.lanternGold, 1).fillCircle(CELL / 2 + 10, 22, 4);
  g.fillStyle(P.glowCore, 1).fillCircle(CELL / 2 + 10, 22, 2);
}

function drawMira(g: Phaser.GameObjects.Graphics): void {
  body(g, P.orchid, P.blossom, 22, 21);
  head(g, P.parchment, 15, 7);
  g.fillStyle(P.blossom, 1).fillTriangle(CELL / 2 - 8, 12, CELL / 2 + 8, 12, CELL / 2, 2); // hat
  g.lineStyle(2, P.outline, 1).strokeTriangle(CELL / 2 - 8, 12, CELL / 2 + 8, 12, CELL / 2, 2);
  g.fillStyle(P.lanternGold, 1).fillCircle(CELL / 2, 2, 2);
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

function drawIconWait(g: Phaser.GameObjects.Graphics): void {
  iconBase(g);
  g.lineStyle(3, P.outline, 1).fillStyle(P.stoneGrey, 1);
  g.fillTriangle(10, 8, 26, 8, 18, 18).fillTriangle(18, 18, 10, 28, 26, 28);
  g.lineBetween(10, 8, 26, 8).lineBetween(10, 28, 26, 28);
  g.fillStyle(P.lanternGold, 1).fillTriangle(14, 11, 22, 11, 18, 17); // sand
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
