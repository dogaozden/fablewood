import { test, expect, type Page } from '@playwright/test';
import { openOverlay } from './helpers';

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

    await keyboardSwitchTab(page, 'Dashboard');
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
    await keyboardSwitchTab(page, 'Game');
    await page.waitForFunction(() => window.__FABLEWOOD_READY === true, undefined, { timeout: 45_000 });
    const kbEnabled = await page.evaluate(
      () => (window.__FABLEWOOD_GAME as { input?: { keyboard?: { enabled?: boolean } } } | undefined)?.input?.keyboard?.enabled,
    );
    expect(kbEnabled).toBe(true);
  });
});
