import { test, expect, type Page } from '@playwright/test';
import { waitReady, waitHamletPlayer, warpHamletTo, tapKey } from './helpers';

/**
 * Crucible V1-15: openPane()'s ghost-reopen guard (REOPEN_SETTLE_MS=150ms, inventory/ui/
 * dom.ts — added to fix v0 #2's "rapid q/Escape leaves a ghost-reopened pane behind") used to
 * key off ONE shared module-level `lastCloseAt` timestamp for every pane (Satchel/Shop/
 * combat-Satchel alike). Closing Mira's Shop and then opening a genuinely DIFFERENT pane (the
 * Satchel) within 150ms was misjudged as a ghost reopen of Shop and silently swallowed —
 * opened and immediately self-closed before the browser ever painted it: no DOM node, no
 * flash, no error. Waiting out the window (or a same-pane re-press, the original v0 #2 case)
 * both worked fine; only the CROSS-pane case within the window was broken.
 *
 * Fixed by scoping the guard's timestamp per pane-type (`Map<PaneId, number>` instead of one
 * shared scalar) — see ui/dom.test.ts for the pure decision-logic unit coverage (this project's
 * vitest runs under environment 'node', not jsdom, so openPane() itself isn't directly
 * unit-testable). This spec drives the actual repro end to end, same pace as the finding.
 */
async function openMiraShop(page: Page): Promise<void> {
  await warpHamletTo(page, 'factor');
  for (let i = 0; i < 6; i++) {
    await tapKey(page, 'e');
    await page.waitForTimeout(200);
    if (await page.locator('.inv-overlay').count()) return;
  }
}

test("closing Mira's Shop then opening the Satchel within 150ms opens it, not swallows it", async ({ page }) => {
  test.setTimeout(45_000);

  await page.goto('/?scene=hamlet&seed=7');
  await waitReady(page, 'hamlet');
  await waitHamletPlayer(page);

  await openMiraShop(page);
  await expect(page.locator('.inv-overlay')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.inv-title')).toHaveText("Mira's Ledger — Wares & Trade");

  // Close Shop, then IMMEDIATELY request the Satchel — no artificial delay, matching the
  // finding's own repro pace ("press 'I' within ~150ms").
  await page.keyboard.press('Escape');
  await expect(page.locator('.inv-overlay')).toHaveCount(0);
  await tapKey(page, 'i');

  await expect(page.locator('.inv-overlay')).toBeVisible({ timeout: 1_000 });
  await expect(page.locator('.inv-title')).toHaveText('Satchel');
});

test('a same-pane rapid re-open right after close is still swallowed (the original v0 #2 guarantee)', async ({ page }) => {
  test.setTimeout(45_000);

  await page.goto('/?scene=hamlet&seed=7');
  await waitReady(page, 'hamlet');
  await waitHamletPlayer(page);

  await tapKey(page, 'i');
  await expect(page.locator('.inv-overlay')).toBeVisible({ timeout: 5_000 });

  await page.keyboard.press('Escape');
  await expect(page.locator('.inv-overlay')).toHaveCount(0);
  await tapKey(page, 'i'); // same pane, immediately — must still be swallowed (per-pane guard, not removed)

  // Give it a moment to prove it stays closed rather than asserting on a single instant.
  await page.waitForTimeout(120);
  await expect(page.locator('.inv-overlay')).toHaveCount(0);
});
