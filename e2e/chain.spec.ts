import { test, expect } from '@playwright/test';
import {
  waitReady,
  currentScene,
  registryGet,
  canvasClick,
  walkHamletTo,
  enterVaultsViaGate,
  readState,
  waitForState,
} from './helpers';

type Save = { scene?: string; hp?: number; dungeon?: { roomIndex: number; cleared: string[] } };
const EV = 'screenshots';

// The full player path, driven with REAL input: boot title screen → key gesture → hamlet →
// walk to the South Gate → Gatewarden Alder → province select → the Preference Vaults (real
// vc-law pack) → enter the first room → discovered-documents teaching → combat launches. Then
// asserts the dungeon progress persisted to state/, and that it survives a page reload.
test('full chain: boot → hamlet → gate → vaults → room → teaching → combat → save/reload', async ({ page }) => {
  test.setTimeout(150_000); // headroom for CI's cold first-compile (~2x local)

  // 1. boot title screen (plain '/', the true entry). One gesture enters the hamlet.
  await page.goto('/?seed=7');
  await waitReady(page, 'boot');
  await page.keyboard.press('Enter');
  await waitReady(page, 'hamlet');

  // 2. walk to the South Gate and enter the vaults (real keyboard; closed-loop on position)
  await walkHamletTo(page, 248, 204, 14);
  const entered = await enterVaultsViaGate(page);
  expect(entered, 'reached the Preference Vaults via the South Gate').toBe(true);
  await waitReady(page, 'vaults');
  expect(await registryGet(page, 'vaults:packId'), 'the real vc-law pack loaded').toBe('vc-law');
  await page.screenshot({ path: `${EV}/e2e-chain-vaults.png` });

  // 3. enter the first room ("The Threshold Ledger"): node → blurb card → teaching
  await canvasClick(page, 225, 300); // green current-room node
  await page.waitForTimeout(500);
  await canvasClick(page, 478, 365); // dismiss the blurb ("Descend")
  await expect(page.locator('.fw-doc'), 'discovered-documents teaching shown').toBeVisible({ timeout: 8000 });
  await page.screenshot({ path: `${EV}/e2e-chain-teaching.png` });

  // page through the teaching cards
  const tbtn = page.locator('.fw-footer .fw-btn-primary');
  for (let i = 0; i < 8; i++) {
    const label = await tbtn.innerText();
    await tbtn.click();
    if (label.includes('Close')) break;
    await page.waitForTimeout(140);
  }

  // 4. combat launches from the room
  await page.waitForFunction(() => (window as Window).__FABLEWOOD_STATE?.scene === 'combat', undefined, {
    timeout: 15_000,
  });
  expect(await currentScene(page)).toBe('combat');
  await page.screenshot({ path: `${EV}/e2e-chain-combat.png` });

  // 5. the dungeon persisted progress on room entry (before combat) — assert + survives reload
  const save = await waitForState<Save>(page, 'save.json', (s) => !!s?.dungeon && s.scene === 'vaults');
  expect(save?.dungeon).toBeTruthy();
  expect(save?.hp).toBeGreaterThan(0);

  await page.goto('/?scene=vaults&seed=7');
  await waitReady(page, 'vaults');
  const save2 = await readState<Save>(page, 'save.json');
  expect(save2?.dungeon, 'progress survives a page reload').toEqual(save?.dungeon);
  expect(await registryGet(page, 'vaults:packId')).toBe('vc-law');
});
