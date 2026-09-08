import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { screenshot as capturePage } from './screenshot.mjs';

const screenshot = process.argv[2] ?? '.dream-loop/candidate.png';
const report = { screenshot, errors: [], samples: [] };
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1672, height: 941 }, deviceScaleFactor: 1 });
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
page.on('requestfailed', request => report.errors.push(`${request.failure()?.errorText} ${request.url()}`));
try {
  await page.goto(`${process.env.FABLEWOOD_PREVIEW_URL ?? 'http://127.0.0.1:5411'}/?cinematic=1`);
  await page.waitForFunction(() => window.__FABLEWOOD_READY, null, { timeout: 15000 });
  if (process.argv.includes('--party')) {
    await page.getByRole('button', { name: 'Exit photo mode' }).press('Enter');
    await page.getByRole('button', { name: /Wayfinder.*Places & paths/ }).press('Enter');
    await page.locator('.map-locations button').filter({ hasText: 'Mira' }).press('Enter');
    await page.waitForFunction(() => Math.hypot(window.__FW3D.state.position.x - 3, window.__FW3D.state.position.z - 6) < 2.5, null, { timeout: 25000 });
    await page.getByRole('button', { name: 'Mira', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Ask Mira to join you' }).press('Enter');
    // Walk the recruited party into the well's foreground through normal input.
    for (const key of ['s','s','s','s','s','s','d','d']) {
      const before = await page.evaluate(() => window.__FW3D.state.position);
      await page.keyboard.press(key);
      await page.waitForFunction(p => Math.hypot(window.__FW3D.state.position.x-p.x,window.__FW3D.state.position.z-p.z)>.5, before);
    }
    await page.getByRole('button', { name: 'Controls', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Enter photo mode' }).press('Enter');
  }
  await page.waitForTimeout(3000);
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(1100);
    report.samples.push(await page.evaluate(() => window.__FW3D?.stats));
  }
  report.game = await page.evaluate(() => window.__FW3D);
  await writeFile(screenshot.replace(/\.png$/, '.json'), JSON.stringify(report, null, 2) + '\n');
  await capturePage(page, screenshot);
  report.captured = true;
} catch (error) {
  report.failure = String(error);
  report.body = await page.locator('body').innerText().catch(() => 'Page unavailable');
  process.exitCode = 1;
} finally {
  await writeFile(screenshot.replace(/\.png$/, '.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  await browser.close();
}
