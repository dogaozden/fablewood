import { test, expect, type Page } from '@playwright/test';
import { waitReady, tapKey, waitHamletPlayer, warpHamletTo, readState } from './helpers';

const EV = 'screenshots';

type Srs = { facts?: Record<string, { box: number; next_due: number; history?: unknown[] }> };

// Answer whichever kind the overlay shows (drill encounters come from the pack, kind unknown).
// Correctness doesn't matter — any answer records SRS. Resolves the overlay.
async function answerAnyOverlay(page: Page): Promise<void> {
  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 8000 });
  if (await page.locator('.fw-textarea').count()) {
    await page.locator('.fw-textarea').fill('the preferred shares convert at the stated ratio');
    await page.getByRole('button', { name: 'Cast' }).click();
  } else if (await page.locator('.fw-chip').count()) {
    const lefts = page.locator('.fw-col').nth(0).locator('.fw-chip');
    const rights = page.locator('.fw-col').nth(1).locator('.fw-chip');
    const n = await lefts.count();
    for (let i = 0; i < n; i++) {
      await lefts.nth(i).click();
      await rights.nth(i).click();
    }
    await page.getByRole('button', { name: /Seal the Weave/ }).click();
  } else if (await page.locator('.fw-step').count()) {
    await page.getByRole('button', { name: /Seal the Sequence/ }).click();
  } else {
    await page.locator('.fw-opt').first().click(); // mcq or scenario
  }
  await page.waitForTimeout(300);
  const cont = page.getByRole('button', { name: 'Continue' });
  if (await cont.count()) await cont.click();
  await page.waitForTimeout(250);
}

// Real bounty run: boot → hamlet → the Wellspring drill (3 encounters through the real overlay).
// Proves the Leitner SRS records real due-queue facts to state/srs.json and survives a reload.
test('SRS: Wellspring drill records facts to state/ and persists across reload', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?seed=7');
  await waitReady(page, 'boot');
  await page.keyboard.press('Enter');
  await waitReady(page, 'hamlet');
  await waitHamletPlayer(page);

  // Setup-only: warp next to the Wellspring door instead of walking there with real
  // input (dev/e2e-only hook — see HamletScene's window.__fwWarp gate). This spec is
  // about the drill/SRS mechanics, not hamlet navigation — that real-input proof lives
  // in chain.spec.ts's South Gate walk, which this hook deliberately never touches.
  const warped = await warpHamletTo(page, 'wellspring');
  expect(warped, 'dev warp hook parked the Keeper at the Wellspring').toBe(true);
  await tapKey(page, 'e'); // open the Wellspring intro (real keypress)
  await page.waitForTimeout(220);

  // advance the intro dialogue until the first drill encounter opens
  for (let k = 0; k < 12; k++) {
    if (await page.locator('.fw-overlay').count()) break;
    await tapKey(page, 'e');
    await page.waitForTimeout(300);
  }
  await expect(page.locator('.fw-overlay'), 'the drill opened an encounter').toBeVisible({ timeout: 8000 });
  await page.screenshot({ path: `${EV}/e2e-wellspring-drill.png` });

  // answer the drill encounters (up to 3), waiting for each to appear
  for (let n = 0; n < 3; n++) {
    if (!(await page.locator('.fw-overlay').count())) break;
    await answerAnyOverlay(page);
    await page.waitForTimeout(400); // let the next encounter (or outro) come up
  }

  // SRS recorded real due-queue facts to state/srs.json
  await page.waitForTimeout(600);
  const srs = await readState<Srs>(page, 'srs.json');
  const ids = Object.keys(srs?.facts ?? {});
  expect(ids.length, 'the drill recorded at least one fact').toBeGreaterThan(0);
  const advanced = ids.some((id) => {
    const f = srs!.facts![id];
    return f.box >= 1 && f.next_due > 0 && (f.history?.length ?? 0) >= 1;
  });
  expect(advanced, 'a recorded fact has a box, a due date, and history').toBe(true);

  // persists across a page reload (state lives on disk under STATE_DIR)
  await page.goto('/?seed=7');
  await waitReady(page, 'boot');
  const srs2 = await readState<Srs>(page, 'srs.json');
  expect(Object.keys(srs2?.facts ?? {}).length).toBeGreaterThanOrEqual(ids.length);
});
