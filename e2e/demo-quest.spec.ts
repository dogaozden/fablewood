import { test, expect } from '@playwright/test';
import {
  waitReady, currentScene, registryGet, canvasClick, walkHamletTo, enterVaultsViaGate,
} from './helpers';

const OUT = process.env.DEMO_SHOTS ?? 'test-results/demo-quest';
const SIZES = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
];

for (const size of SIZES) {
  test(`demo quest: boot → hamlet → gate → room → teaching → combat (${size.name})`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    const shot = (n: string) => page.screenshot({ path: `${OUT}/${size.name}-${n}.png` });

    await page.request.put('/api/state/save.json', { data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' } });
    await page.goto('/?renderer=classic&seed=7&demo=1');
    await waitReady(page, 'boot');
    await shot('1-boot');
    await page.keyboard.press('Enter');
    await waitReady(page, 'hamlet');
    await shot('2-hamlet');

    await walkHamletTo(page, 248, 204, 14);
    expect(await enterVaultsViaGate(page), 'reached the dungeon via the South Gate').toBe(true);
    await waitReady(page, 'vaults');
    expect(await registryGet(page, 'vaults:packId')).toBe('demo');
    await shot('3-dungeon');

    await canvasClick(page, 874, 301);
    await page.waitForTimeout(500);
    await shot('4-room-blurb');
    await canvasClick(page, 478, 365);
    await expect(page.locator('.fw-doc')).toBeVisible({ timeout: 8000 });
    await shot('5-teaching');
    const next = page.locator('.fw-footer .fw-btn-primary');
    for (let i = 0; i < 8; i++) {
      const label = await next.innerText();
      await next.click();
      if (label.includes('Close')) break;
      await page.waitForTimeout(140);
    }
    await page.waitForFunction(() => (window as Window).__FABLEWOOD_STATE?.scene === 'combat', undefined, { timeout: 15_000 });
    expect(await currentScene(page)).toBe('combat');
    await shot('6-combat');

    await page.evaluate(() => {
      const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
      (g?.scene?.getScene?.('combat') as { setPilotPreference?(k: string | null): void } | undefined)?.setPilotPreference?.('cast');
    });
    const seen = new Set<string>();
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && (await currentScene(page)) === 'combat') {
      const overlay = page.locator('.fw-overlay');
      if (await overlay.count()) {
        const kind = (await page.locator('.fw-textarea').count()) ? 'free-recall' : 'choice';
        const cont = page.getByRole('button', { name: 'Onward ▸' });
        if (await cont.count()) {
          if (!seen.has('verdict')) { seen.add('verdict'); await shot('8-verdict'); }
          await cont.click();
        } else if (kind === 'free-recall') {
          if (!seen.has(kind)) { seen.add(kind); await shot('7-encounter-free-recall'); }
          await page.waitForTimeout(450);
          await page.locator('.fw-textarea').fill('Airtight, away from light and moisture, because air, light and damp dull the flavour.');
          await page.getByRole('button', { name: 'Cast' }).click();
        } else {
          if (!seen.has(kind)) { seen.add(kind); await shot('7-encounter-choice'); }
          await page.waitForTimeout(450);
          await page.locator('.fw-optlabel').first().click();
          const submit = page.getByRole('button', { name: /Cast|Answer|Confirm|Submit/ });
          if (await submit.count()) await submit.first().click();
        }
      }
      await page.waitForTimeout(400);
    }
    await shot('9-after-combat');
    console.log('stages seen', [...seen].join(','), 'scene now', await currentScene(page));
    expect(await currentScene(page)).not.toBe('combat');
  });
}
