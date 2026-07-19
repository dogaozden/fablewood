import { test, expect } from '@playwright/test';
import { openOverlay } from './helpers';

// Drives the encounter overlay + Laconic Clerk judge (JUDGE_MODE=stub) through the ?overlay=
// dev harness — all five kinds + teaching, correct and wrong answers, asserting the quality→
// verdict mapping the combat layer relies on. Deterministic (fixture data + seed 7 + stub judge).

test.describe('encounter overlay — all kinds', () => {
  test('mcq (Smite): correct answer → pass verdict', async ({ page }) => {
    await openOverlay(page, 'mcq');
    await expect(page.locator('.fw-eyebrow')).toContainText('Smite');
    await page.locator('.fw-opt', { hasText: 'The third week' }).click();
    await expect(page.locator('.fw-verdict.pass')).toBeVisible();
  });

  test('mcq (Smite): wrong answer → fail verdict + teach-on-miss reveals the answer', async ({ page }) => {
    await openOverlay(page, 'mcq');
    await page.locator('.fw-opt', { hasText: 'It never glows' }).click();
    await expect(page.locator('.fw-verdict.fail')).toBeVisible();
    // teach-on-miss shows the correct answer + the fact statement
    await expect(page.locator('.fw-teach')).toContainText('The third week');
  });

  test('free_recall (Cast From Memory): good answer → stub judge pass', async ({ page }) => {
    await openOverlay(page, 'free_recall');
    await expect(page.locator('.fw-eyebrow')).toContainText('Cast From Memory');
    await page.locator('.fw-textarea').fill('wait for the frost-bell before harvesting whispermoss');
    await page.getByRole('button', { name: 'Cast' }).click();
    // stub judge is deterministic + instant; a verdict banner + Clerk line renders
    await expect(page.locator('.fw-verdict.pass')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.fw-verdict.pass')).not.toBeEmpty();
    // the book's verbatim words show even on a correct cast (the author's live request)
    await expect(page.locator('.fw-excerpt')).toBeVisible();
    await expect(page.locator('.fw-cite')).toContainText('compendium');
  });

  test('free_recall: real typing survives the game key captures (WASD/E/Space)', async ({ page }) => {
    // Regression: hamlet's Phaser key captures preventDefault'ed W/A/S/D/E/Space at the
    // window level even while the recall textarea was focused — "economics and control"
    // arrived as "conomicncontrol". Real key events (not fill), over the hamlet scene so
    // the captures are actually registered.
    await openOverlay(page, 'free_recall', 7, 'hamlet');
    const ta = page.locator('.fw-textarea');
    await ta.click();
    await page.keyboard.type('we saved economics and control', { delay: 20 });
    await expect(ta).toHaveValue('we saved economics and control');
    await page.screenshot({ path: 'screenshots/e2e-freerecall-typing.png' });
  });

  test('scenario_branch (Parley): correct branch → pass verdict + consequence', async ({ page }) => {
    await openOverlay(page, 'scenario_branch');
    await expect(page.locator('.fw-eyebrow')).toContainText('Parley');
    await page.locator('.fw-opt', { hasText: 'Shoo it gently' }).click();
    await expect(page.locator('.fw-verdict.pass')).toBeVisible();
    await expect(page.locator('.fw-verdict.pass')).toContainText('spared');
  });

  test('match (Binding Weave): all pairs correct → pass verdict', async ({ page }) => {
    await openOverlay(page, 'match');
    const pair = async (left: string, right: string) => {
      await page.locator('.fw-chip', { hasText: left }).click();
      await page.locator('.fw-chip', { hasText: right }).click();
    };
    await pair('Lantern-moss', 'glow');
    await pair('Whispermoss', 'song');
    await pair('Dampmoss', 'balm');
    await page.getByRole('button', { name: 'Seal the Weave' }).click();
    await expect(page.locator('.fw-verdict.pass')).toBeVisible();
  });

  test('order (Ritual Sequence): sorted correctly → pass verdict', async ({ page }) => {
    await openOverlay(page, 'order');
    const target = ['Wait for the frost-bell', 'Gather at first light', 'Dry in lantern-glow', 'Bind with reed'];
    // selection sort by clicking each item's "up" button until it reaches its slot
    for (let i = 0; i < target.length; i++) {
      for (let guard = 0; guard < 12; guard++) {
        const labels = (await page.locator('.fw-steplabel').allInnerTexts()).map((t) => t.trim());
        const j = labels.findIndex((l) => l === target[i]);
        if (j <= i) break;
        await page.locator('.fw-step').nth(j).locator('.fw-move button').first().click();
        await page.waitForTimeout(60);
      }
    }
    await page.getByRole('button', { name: 'Seal the Sequence' }).click();
    await expect(page.locator('.fw-verdict.pass')).toBeVisible();
  });

  test('teaching (discovered documents): pages through and closes', async ({ page }) => {
    await openOverlay(page, 'teaching');
    await expect(page.locator('.fw-doc')).toBeVisible();
    await expect(page.locator('.fw-eyebrow')).toContainText('Discovered Document');
    const btn = page.locator('.fw-footer .fw-btn-primary');
    for (let i = 0; i < 8; i++) {
      const txt = await btn.innerText();
      await btn.click();
      if (txt.includes('Close')) break;
      await page.waitForTimeout(80);
    }
    await expect(page.locator('.fw-overlay')).toHaveCount(0);
  });
});
