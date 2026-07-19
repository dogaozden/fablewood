#!/usr/bin/env node
// Worktree-only NPC screenshot harness (port 5184 — NEVER 5173/5175).
// Boots straight into the hamlet, parks the camera so all three stationary
// NPCs are in frame, and saves a full-canvas shot plus a tight crop per NPC
// at true game zoom. usage: node scripts/npc-shot-5184.mjs <outdir> <tag>
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const BASE = 'http://localhost:5184';
const [outdirArg, tag] = process.argv.slice(2);
if (!outdirArg || !tag) {
  console.error('usage: node scripts/npc-shot-5184.mjs <outdir> <tag>');
  process.exit(1);
}
const outdir = resolve(outdirArg);
await mkdir(outdir, { recursive: true });

const NPCS = [
  { who: 'berry', x: 245, y: 76 },
  { who: 'clerk', x: 44, y: 180 },
  { who: 'alder', x: 224, y: 202 },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text());
  });
  await page.goto(`${BASE}/?scene=hamlet&seed=7`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => window.__FABLEWOOD_READY === true, undefined, { timeout: 45000 });
  await page.waitForFunction(() => window.__FABLEWOOD_STATE?.scene === 'hamlet', undefined, { timeout: 20000 });
  // hamlet bootstrap is async — wait for the player to exist
  await page.waitForFunction(() => {
    const g = window.__FABLEWOOD_GAME;
    const h = g?.scene?.getScene?.('hamlet');
    return !!h?.player;
  }, undefined, { timeout: 15000 });
  await page.waitForTimeout(600); // let idle anims/tweens settle a few frames

  // Park the camera so berry (y76) and alder (y202) are both in the 180px-tall view.
  const cam = await page.evaluate(() => {
    const h = window.__FABLEWOOD_GAME.scene.getScene('hamlet');
    const c = h.cameras.main;
    c.stopFollow();
    c.setScroll(0, 40);
    return {
      scrollX: c.scrollX, scrollY: c.scrollY, zoom: c.zoom,
      w: c.width, h: c.height, worldView: { x: c.worldView.x, y: c.worldView.y, w: c.worldView.width, h: c.worldView.height },
    };
  });
  await page.waitForTimeout(250);
  console.log('[cam]', JSON.stringify(cam));

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  console.log('[canvas]', JSON.stringify(box));
  await canvas.screenshot({ path: `${outdir}/${tag}-full.png` });

  // world -> page coords. Phaser camera: screen = (world - worldView.xy) * zoom, then CSS scale.
  const fx = box.width / 960;
  const fy = box.height / 540;
  const cam2 = await page.evaluate(() => {
    const c = window.__FABLEWOOD_GAME.scene.getScene('hamlet').cameras.main;
    return { vx: c.worldView.x, vy: c.worldView.y, zoom: c.zoom };
  });
  for (const n of NPCS) {
    const x0 = box.x + (n.x - 16 - cam2.vx) * cam2.zoom * fx;
    const y0 = box.y + (n.y - 32 - cam2.vy) * cam2.zoom * fy;
    const w = 32 * cam2.zoom * fx;
    const h = 40 * cam2.zoom * fy;
    const clip = {
      x: Math.max(0, x0), y: Math.max(0, y0),
      width: Math.min(w, 960 - Math.max(0, x0)), height: Math.min(h, 540 - Math.max(0, y0)),
    };
    console.log('[crop]', n.who, JSON.stringify(clip));
    await page.screenshot({ path: `${outdir}/${tag}-${n.who}.png`, clip });
  }
} finally {
  await browser.close();
}
console.log('[done]');
