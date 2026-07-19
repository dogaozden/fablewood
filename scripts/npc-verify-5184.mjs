#!/usr/bin/env node
// Verifies the Lane-B still / Lane-A anim switchover live on port 5184.
// Prints per-key: texture source type, idle-anim existence, and what the placed
// hamlet NPC sprite is actually doing (anim playing vs tween-bobbed).
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto('http://localhost:5184/?scene=hamlet&seed=7', { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => window.__FABLEWOOD_READY === true, undefined, { timeout: 45000 });
  await page.waitForFunction(() => window.__FABLEWOOD_STATE?.scene === 'hamlet', undefined, { timeout: 20000 });
  await page.waitForFunction(() => !!window.__FABLEWOOD_GAME?.scene?.getScene?.('hamlet')?.player, undefined, { timeout: 15000 });
  await page.waitForTimeout(500);

  const report = await page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME;
    const h = g.scene.getScene('hamlet');
    const out = {};
    for (const key of ['char.berry', 'char.clerk', 'char.alder']) {
      const texExists = g.textures.exists(key);
      let srcType = null;
      if (texExists) {
        const s = g.textures.get(key).getSourceImage();
        srcType = s && s.constructor ? s.constructor.name : String(s);
      }
      const tex = texExists ? g.textures.get(key) : null;
      const frame = tex ? tex.get() : null;
      const sprite = h.children.list.find(
        (c) => c.texture && (c.texture.key === key || c.texture.key === key + '__sheet') && c.type === 'Sprite',
      );
      out[key] = {
        texExists,
        srcType,
        frameSize: frame ? [frame.width, frame.height] : null,
        idleAnimExists: g.anims.exists(key + '.idle'),
        spriteFound: !!sprite,
        spriteAnimPlaying: sprite ? !!sprite.anims?.isPlaying : null,
        spriteTextureKeyNow: sprite ? sprite.texture.key : null,
        spriteTweened: sprite ? h.tweens.getTweensOf(sprite).length > 0 : null,
      };
    }
    return out;
  });
  console.log(JSON.stringify(report, null, 2));
  console.log('[console-errors]', JSON.stringify(errors));
} finally {
  await browser.close();
}
