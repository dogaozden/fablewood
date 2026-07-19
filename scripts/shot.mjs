#!/usr/bin/env node
// Screenshot harness. Starts the dev server if one isn't already on the port
// (reuses it otherwise), waits for the boot scene's ready flag, and shoots the page.
//   node scripts/shot.mjs '/?scene=boot' screenshots/boot.png
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5173;
const BASE = `http://localhost:${PORT}`;

const [target, out] = process.argv.slice(2);
if (!target || !out) {
  console.error("usage: node scripts/shot.mjs <path-with-query> <out.png>");
  console.error("example: node scripts/shot.mjs '/?scene=boot' screenshots/boot.png");
  process.exit(1);
}

async function serverUp() {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function waitFor(pred, { timeout = 60000, interval = 400, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`timed out waiting for ${label} after ${timeout}ms`);
}

let child = null;

async function main() {
  if (await serverUp()) {
    console.log('[shot] reusing dev server on', BASE);
  } else {
    console.log('[shot] starting dev server…');
    child = spawn('npm', ['run', 'dev'], { cwd: REPO_ROOT, stdio: 'ignore', env: process.env });
    child.on('error', (e) => console.error('[shot] dev server spawn error:', e.message));
    await waitFor(serverUp, { label: 'dev server' });
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const url = BASE + (target.startsWith('/') ? target : '/' + target);
    console.log('[shot] navigating to', url);
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.__FABLEWOOD_READY === true, undefined, {
      timeout: 20000,
    });
    await page.waitForTimeout(400); // let a few animation frames paint
    const outPath = resolve(REPO_ROOT, out);
    await mkdir(dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath });
    console.log('[shot] wrote', outPath);
  } finally {
    await browser.close();
  }
}

main()
  .then(() => {
    if (child) child.kill('SIGTERM');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[shot] error:', err.message);
    if (child) child.kill('SIGTERM');
    process.exit(1);
  });
