import Phaser from 'phaser';
import { PAL_CHAR } from './palette';
import { SPRITES } from './sprites';

/**
 * Rasterize every registered palette-indexed string-grid sprite into Phaser
 * textures + animations (style-contract §3/§8). Called ONCE from
 * BootScene.create() as `buildTextures(this)` before other scenes start.
 *
 * Per sprite (see SpriteDef): frames[] are 16px-native grids; `scale` bakes at
 * 1 (hamlet 16-native + camera zoom) or 3 (combat 48-native). Nearest-neighbor.
 *   - The base texture `key` = frame 0 (so `add.image(key)` / `add.sprite(key)`
 *     shows the idle pose correctly, never the whole sheet).
 *   - Multi-frame sprites also get a `<key>__sheet` spritesheet (frames 0..n-1)
 *     that the animations reference, and each `anims[]` entry is registered
 *     globally as `<key>.<state>` (e.g. char.keeper.walk.down).
 * Idempotent: skips textures/anims that already exist, so a scene's on-palette
 * placeholder is only replaced when real art registers the SAME key.
 */
export function buildTextures(scene: Phaser.Scene): void {
  for (const def of SPRITES) {
    const frames = def.frames;
    if (!frames || frames.length === 0) continue;
    const f0 = frames[0];
    if (!f0 || f0.length === 0) continue;
    const scale = def.scale ?? 1;
    const fw = f0.reduce((m, r) => Math.max(m, r.length), 0) * scale;
    const fh = f0.length * scale;
    if (fw === 0 || fh === 0) continue;

    // base texture (frame 0) — used by add.image/add.sprite(key)
    if (!scene.textures.exists(def.key)) {
      const c = frameCanvas(f0, scale);
      if (c) scene.textures.addCanvas(def.key, c);
    }

    if (frames.length > 1) {
      // spritesheet holding every frame side by side, with numbered frames
      const sheetKey = def.key + '__sheet';
      if (!scene.textures.exists(sheetKey)) {
        const sheet = document.createElement('canvas');
        sheet.width = fw * frames.length;
        sheet.height = fh;
        const ctx = sheet.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = false;
          frames.forEach((g, i) => {
            const fc = frameCanvas(g, scale);
            if (fc) ctx.drawImage(fc, i * fw, 0);
          });
          const tex = scene.textures.addCanvas(sheetKey, sheet);
          if (tex) for (let i = 0; i < frames.length; i++) tex.add(i, 0, i * fw, 0, fw, fh);
        }
      }
      for (const a of def.anims ?? []) {
        if (scene.anims.exists(a.name)) continue;
        const frs: Phaser.Types.Animations.AnimationFrame[] = [];
        for (let i = a.from; i <= a.to; i++) frs.push({ key: sheetKey, frame: i });
        scene.anims.create({ key: a.name, frames: frs, frameRate: a.frameRate, repeat: a.repeat });
      }
    }
  }
}

/** One grid -> a canvas at `scale` (nearest-neighbor). '.' and off-palette = transparent. */
function frameCanvas(grid: readonly string[], scale: number): HTMLCanvasElement | null {
  const h = grid.length;
  const w = grid.reduce((m, r) => Math.max(m, r.length), 0);
  if (w === 0 || h === 0) return null;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sctx = src.getContext('2d');
  if (!sctx) return null;
  const img = sctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const row = grid[y] ?? '';
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (!ch || ch === '.') continue;
      const int = PAL_CHAR[ch];
      if (int === undefined) continue;
      const o = (y * w + x) * 4;
      img.data[o] = (int >> 16) & 0xff;
      img.data[o + 1] = (int >> 8) & 0xff;
      img.data[o + 2] = int & 0xff;
      img.data[o + 3] = 0xff;
    }
  }
  sctx.putImageData(img, 0, 0);
  if (scale === 1) return src;
  const out = document.createElement('canvas');
  out.width = w * scale;
  out.height = h * scale;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(src, 0, 0, w * scale, h * scale);
  return out;
}
