import Phaser from 'phaser';
import { PAL_CHAR } from './palette';
import { SPRITES } from './sprites';

/**
 * Rasterize every registered palette-indexed string-grid sprite into a Phaser
 * texture (style-contract §3). Call ONCE from BootScene.create() before other
 * scenes start: `buildTextures(this)`.
 *
 * Sprites are authored once at 16px-native (contract). `scale` bakes the texture
 * at that native multiplier so it matches the consuming scene's convention:
 *   - hamlet is 16px-native + 3x camera zoom  -> scale 1
 *   - combat is 48px-native (CELL=48, 3x baked, no zoom) -> scale 3
 * Nearest-neighbor upscale keeps pixels crisp. Idempotent: skips existing keys
 * (so a scene's on-palette placeholder is only replaced when real art registers
 * the SAME key).
 */
export function buildTextures(scene: Phaser.Scene): void {
  for (const { key, grid, scale = 1 } of SPRITES) {
    if (scene.textures.exists(key)) continue;
    const h = grid.length;
    const w = grid.reduce((m, r) => Math.max(m, r.length), 0);
    if (w === 0 || h === 0) continue;

    // 1x source from the grid
    const src = document.createElement('canvas');
    src.width = w;
    src.height = h;
    const sctx = src.getContext('2d');
    if (!sctx) continue;
    const img = sctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const row = grid[y] ?? '';
      for (let x = 0; x < w; x++) {
        const ch = row[x];
        if (!ch || ch === '.') continue; // transparent
        const int = PAL_CHAR[ch];
        if (int === undefined) continue; // off-palette -> transparent (harness flags pre-ship)
        const o = (y * w + x) * 4;
        img.data[o] = (int >> 16) & 0xff;
        img.data[o + 1] = (int >> 8) & 0xff;
        img.data[o + 2] = int & 0xff;
        img.data[o + 3] = 0xff;
      }
    }
    sctx.putImageData(img, 0, 0);

    // bake at native scale, nearest-neighbor
    const tex = scene.textures.createCanvas(key, w * scale, h * scale);
    if (!tex) continue;
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, w * scale, h * scale);
    tex.refresh();
  }
}
