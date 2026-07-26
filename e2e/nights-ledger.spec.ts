import { test, expect, type Page } from '@playwright/test';
import { waitReady, currentScene } from './helpers';

// "The Night's Ledger" (fun-review.md §3.2) — the run-harvest overlay DungeonScene shows when a
// run ends. Proves: the exit-specific subtitle, "Held against the Fade" always present, zero-row
// suppression (welds/reclaimed hidden when 0), and that it fires on BOTH victory and retreat.
// It's a DOM overlay (document.body child) so it's queryable directly.

const EV = 'screenshots';

interface LedgerSnap {
  title: string;
  sub: string;
  rows: Array<{ label: string; val: string }>;
  signoff: string;
}

/** Wait for the ledger, screenshot it, then grab it in one atomic read — the auto-drive path
 *  dismisses it after a beat, so capture the visual first, then read all the text at once. */
async function captureLedger(page: Page, shotPath: string): Promise<LedgerSnap | null> {
  await page.locator('.fw-overlay .fw-ledger-title').waitFor({ state: 'visible', timeout: 30_000 });
  await page.screenshot({ path: shotPath });
  return page.evaluate(() => {
    const root = document.querySelector('.fw-overlay');
    if (!root) return null;
    return {
      title: root.querySelector('.fw-ledger-title')?.textContent ?? '',
      sub: root.querySelector('.fw-ledger-sub')?.textContent ?? '',
      rows: Array.from(root.querySelectorAll('.fw-ledger-row')).map((r) => ({
        label: r.querySelector('.fw-ledger-label')?.textContent ?? '',
        val: r.querySelector('.fw-ledger-val')?.textContent ?? '',
      })),
      signoff: root.querySelector('.fw-ledger-signoff')?.textContent ?? '',
    } as LedgerSnap;
  });
}

async function combatState(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): { state: string } } | undefined;
    return s?.combatSnapshot?.()?.state ?? null;
  });
}

test('Night\'s Ledger on victory: title, "vault stands cleared" subtitle, Held always shown, zero rows suppressed', async ({ page }) => {
  test.setTimeout(60_000);
  // packless sim victory drives straight through DungeonScene.resolveCombat's normal-victory tail.
  await page.goto('/?scene=vaults&dev=1&auto=win&seed=7');

  const led = await captureLedger(page, `${EV}/e2e-nights-ledger-victory.png`);
  expect(led, 'the ledger rendered').not.toBeNull();

  expect(led!.title).toBe("The Night's Ledger");
  expect(led!.sub).toContain('the vault stands cleared');

  const labels = led!.rows.map((r) => r.label);
  // "Held against the Fade" always shows, even at zero.
  expect(labels).toContain('Held against the Fade');
  // sim victory answered nothing → these stats are 0 → their rows are suppressed.
  expect(labels, 'Newly welded row suppressed at zero').not.toContain('Newly welded');
  expect(labels, 'Reclaimed row suppressed at zero').not.toContain('Reclaimed from the Fade');
  // a cleared room bumps the streak, so that row renders as "N nights".
  const streak = led!.rows.find((r) => r.label === 'Streak');
  expect(streak, 'Streak row present after a victory').toBeTruthy();
  expect(streak!.val).toMatch(/\d+ nights?$/);
});

test('Night\'s Ledger on retreat: "a wise withdrawal" subtitle after a wipe', async ({ page }) => {
  test.setTimeout(90_000);
  // near-death party → a wipe lands fast; real combat (sim=0) so it flows through
  // CombatScene.resolveBattle('retreat') → DungeonScene.resolveCombat's retreat branch.
  await page.request.put('/api/state/save.json', { data: { hp: 2 } });
  await page.goto('/?scene=vaults&dev=1&sim=0&auto=win&seed=7');
  await waitReady(page, 'combat');

  // Only ever Wait — the party never fights back, so the wisps close in and wipe the pool.
  const start = Date.now();
  while (Date.now() - start < 75_000) {
    if ((await currentScene(page)) !== 'combat') break;
    const st = await combatState(page);
    if (st === null || st === 'over') break;
    if (st === 'playerMove') await page.keyboard.press('7'); // Wait
    await page.waitForTimeout(150);
  }

  const led = await captureLedger(page, `${EV}/e2e-nights-ledger-retreat.png`);
  expect(led, 'the ledger rendered on retreat').not.toBeNull();
  expect(led!.title).toBe("The Night's Ledger");
  expect(led!.sub).toContain('a wise withdrawal');
  // "Held against the Fade" shows even on a thin retreat page.
  expect(led!.rows.map((r) => r.label)).toContain('Held against the Fade');
});
