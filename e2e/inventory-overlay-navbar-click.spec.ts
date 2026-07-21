import { test, expect } from '@playwright/test';
import { waitReady, waitHamletPlayer, tapKey } from './helpers';

/**
 * Crucible V1-18: `.inv-overlay` (fixed, inset:0, z-index:9999 — inventory/ui/styles.ts) used
 * to cover the ENTIRE viewport, including the shell's tab bar (`.tabbar` in App.tsx), which has
 * no competing z-index/positioning of its own. A click on a tab button's real screen position
 * hit-tested the overlay, not the button underneath — the overlay's click-outside-to-close
 * handler fired (closing the pane) instead of the tab actually navigating; only a SECOND click,
 * now unobstructed, worked.
 *
 * Fixed by excluding the overlay from the nav bar's rendered screen region: dom.ts measures
 * `.tabbar`'s live height at open time and insets the overlay's `top` below it, so the nav bar
 * is never geometrically covered — everywhere else (crucially, over the game canvas, where the
 * overlay exists specifically to suppress WASD/E bleed-through) it still fully covers input,
 * unchanged.
 */
test.describe('inventory overlay leaves the shell tab bar clickable', () => {
  test('a single click on a tab button navigates immediately with the Satchel open', async ({ page }, testInfo) => {
    await page.goto('/?scene=hamlet&seed=7');
    await waitReady(page, 'hamlet');
    await waitHamletPlayer(page);

    await tapKey(page, 'i');
    await expect(page.locator('.inv-overlay')).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath('v1-18-overlay-open-with-navbar.png') });

    // One real click, no retry loop — pre-fix this needed two clicks (the first swallowed by
    // the overlay closing the pane instead of navigating to the tab).
    await page.getByRole('button', { name: 'The Ledger' }).click();

    await expect(page.locator('.dash')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('.phaser-root')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('v1-18-navbar-click-navigated.png') });
  });

  test('a click over the game-canvas region still closes the pane (click-outside-to-close unaffected)', async ({
    page,
  }) => {
    await page.goto('/?scene=hamlet&seed=7');
    await waitReady(page, 'hamlet');
    await waitHamletPlayer(page);

    await tapKey(page, 'i');
    await expect(page.locator('.inv-overlay')).toBeVisible();

    // Click near the overlay's own bottom-left corner — below the tab-bar-excluded top inset,
    // and (at the default 1280px-wide viewport) well clear of the centered ~620px-wide panel —
    // this must still land on the overlay backdrop itself and close via click-outside.
    const box = await page.locator('.inv-overlay').boundingBox();
    if (!box) throw new Error('.inv-overlay has no bounding box');
    await page.mouse.click(box.x + 8, box.y + box.height - 8);

    await expect(page.locator('.inv-overlay')).toHaveCount(0);
  });

  test("the overlay's top inset clears the tab bar's actual rendered height", async ({ page }) => {
    await page.goto('/?scene=hamlet&seed=7');
    await waitReady(page, 'hamlet');
    await waitHamletPlayer(page);

    await tapKey(page, 'i');
    await expect(page.locator('.inv-overlay')).toBeVisible();

    const navBox = await page.locator('.tabbar').boundingBox();
    const overlayBox = await page.locator('.inv-overlay').boundingBox();
    if (!navBox || !overlayBox) throw new Error('missing bounding box');
    expect(overlayBox.y).toBeGreaterThanOrEqual(navBox.y + navBox.height - 1);
  });
});
