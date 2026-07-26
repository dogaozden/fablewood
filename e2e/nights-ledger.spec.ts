import { test, expect, type Page } from '@playwright/test';
import { waitReady, currentScene, waitForState } from './helpers';

// "The Night's Ledger" (fun-review.md §3.2) — the run-harvest overlay DungeonScene shows when a
// run ENDS (boss victory / retreat), NOT after a mid-crawl room clear. Proves: run-end-only firing,
// the exit-specific subtitle, "Held against the Fade" always present, zero-row suppression.
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
  // Read the load-bearing data FIRST (one atomic evaluate) — under fleet CPU load a slow
  // screenshot must never let the auto-advance dismiss the ledger before we've captured it.
  const data = await page.evaluate(() => {
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
  await page.screenshot({ path: shotPath });
  return data;
}

// The retreat test wipes the pool to 0; reset HP afterwards so the shared STATE_DIR never
// strands a downstream combat spec at a near-death party (they rely on the default full pool).
test.afterEach(async ({ request }) => {
  await request.put('/api/state/save.json', { data: { hp: 16 } });
});

async function combatState(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): { state: string } } | undefined;
    return s?.combatSnapshot?.()?.state ?? null;
  });
}

test('no Night\'s Ledger after a mid-run room clear — only at run end', async ({ page }) => {
  test.setTimeout(60_000);
  // auto=win sim-clears a single normal room mid-crawl; the ledger must NOT fire here (§3.2 rescope).
  await page.goto('/?scene=vaults&dev=1&auto=win&seed=7');
  await waitReady(page, 'vaults');
  // wait until the room-clear has settled (persisted) — a ledger WOULD have shown by now if it fired
  await waitForState(page, 'save.json', (s: { dungeon?: { cleared?: string[] } } | null) =>
    !!s?.dungeon?.cleared?.includes('under-1'),
  );
  await expect(
    page.locator('.fw-overlay .fw-ledger-title'),
    'no run-end ledger mid-crawl',
  ).toHaveCount(0);
});

test('Night\'s Ledger at boss victory (run end): title, "vault stands cleared", Held always shown, zero rows suppressed', async ({ page }) => {
  test.setTimeout(60_000);
  // auto=boss sim-clears to the Vault-Warden → bossVictory → vaultOpensBeat → the run-end ledger.
  await page.goto('/?scene=vaults&dev=1&auto=boss&seed=7');

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
