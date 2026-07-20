import { test, expect, type Page } from '@playwright/test';
import { openOverlay, waitReady, waitHamletPlayer, tapKey } from './helpers';

// Regression: encounter overlays are document.body children, so they outlive the
// canvas. The overlay's fixed full-viewport root swallows mouse clicks on the
// tabbar (verified: playwright reports "fw-overlay intercepts pointer events"),
// but keyboard users can still Tab/Enter to a shell tab mid-encounter — that
// unmounts PhaserGame, destroys the game, and left the orphaned card floating
// over the Dashboard while its drill loop ran on against a dead scene. On game
// teardown every open overlay must be torn down with it. The abandoned
// encounter promises are deliberately left unresolved: an encounter nobody
// answered must never be graded, and rejecting would crash the dead scene's
// continuations.

/** Activate a shell tab the way a keyboard user can despite the overlay: focus + Enter. */
async function keyboardSwitchTab(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name }).focus();
  await page.keyboard.press('Enter');
}

test.describe('overlay ↔ game teardown', () => {
  test('keyboard tab-switch mid-encounter removes the overlay with the game', async ({ page }) => {
    await openOverlay(page, 'mcq');
    await expect(page.locator('.fw-overlay')).toHaveCount(1);

    await keyboardSwitchTab(page, 'The Ledger');
    await expect(page.locator('.phaser-root')).toHaveCount(0); // game unmounted
    await expect(page.locator('.fw-overlay')).toHaveCount(0); // overlay went with it
    await expect(page.locator('.dash')).toBeVisible(); // shell stays usable
  });

  test('teaching overlay is torn down too, and the game remounts clean', async ({ page }) => {
    await openOverlay(page, 'teaching');
    await keyboardSwitchTab(page, 'Library');
    await expect(page.locator('.fw-overlay')).toHaveCount(0);
    await expect(page.locator('.lib')).toBeVisible();

    // back to the game: a fresh mount must boot with its keyboard live (the
    // depth latch stepped down on abort, so nothing re-quiets the new game)
    await keyboardSwitchTab(page, 'Realms');
    await page.waitForFunction(() => window.__FABLEWOOD_READY === true, undefined, { timeout: 45_000 });
    const kbEnabled = await page.evaluate(
      () => (window.__FABLEWOOD_GAME as { input?: { keyboard?: { enabled?: boolean } } } | undefined)?.input?.keyboard?.enabled,
    );
    expect(kbEnabled).toBe(true);
  });

  // Same class of bug, different overlay family: the Satchel/shop panes (inventory-handoff
  // §7) are ALSO document.body children built on the shared openPane() scaffold
  // (inventory/ui/dom.ts) — they got the same GAME_TEARDOWN_EVENT subscription as the
  // encounter overlay above. shopPane.ts shares this exact fix (same openPane function);
  // this drives it through the more directly reachable Satchel (hamlet 'i' hotkey).
  test('inventory Satchel pane is torn down with the game too (shares openPane\'s teardown fix)', async ({ page }) => {
    await page.goto('/?scene=hamlet&seed=7');
    await waitReady(page, 'hamlet');
    await waitHamletPlayer(page);
    await tapKey(page, 'i');
    await expect(page.locator('.inv-overlay')).toHaveCount(1);

    await keyboardSwitchTab(page, 'The Ledger');
    await expect(page.locator('.phaser-root')).toHaveCount(0); // game unmounted
    await expect(page.locator('.inv-overlay')).toHaveCount(0); // pane went with it, no orphan
    await expect(page.locator('.dash')).toBeVisible(); // shell stays usable
  });
});
