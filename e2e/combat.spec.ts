import { test, expect, type Page } from '@playwright/test';
import { waitReady, currentScene, readState } from './helpers';

const EV = 'screenshots';

type Snap = {
  state: string;
  activeTeam: string | null;
  enemyHp: number;
  partyHp: number;
  log: Array<{ action: string; dmg: number; overlay: boolean }>;
} | null;

/** Read the combat scene's DEV debug snapshot (the board exposes no other turn/board state). */
async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as Snap;
  });
}

/** Force the ?demo autopilot to prefer one action kind (so the test drives WHICH move fires). */
async function setPilot(page: Page, kind: string | null): Promise<void> {
  await page.evaluate((k) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { setPilotPreference?(k: string | null): void } | undefined;
    s?.setPilotPreference?.(k);
  }, kind);
}

/** Poll the action log for the first `action` entry at/after `fromIndex`. null if the fight ends first. */
async function waitForLoggedAction(
  page: Page,
  action: string,
  fromIndex: number,
  timeout = 35_000,
): Promise<{ action: string; dmg: number; overlay: boolean } | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await currentScene(page)) !== 'combat') return null; // fight resolved early
    const s = await snap(page);
    const entry = s?.log.slice(fromIndex).find((l) => l.action === action);
    if (entry) return entry;
    await page.waitForTimeout(300);
  }
  return null;
}

/** Answer an open free_recall (Cast) overlay with a rubric-rich answer → a Clerk pass. */
async function answerCast(page: Page): Promise<void> {
  await page.locator('.fw-textarea').waitFor({ state: 'visible', timeout: 10_000 });
  // The economics-vs-control rubric is the first free_recall vc-law offers combat; a substantive
  // answer clears the stub judge's keyword bar → a real PASS (quality 1), so the Cast lands full.
  await page.locator('.fw-textarea').fill(
    'Economics and control are the two things that matter in a term sheet. Economics is the investor return in a liquidity event and the terms that drive it; control is the mechanisms letting investors direct or veto company decisions.',
  );
  await page.getByRole('button', { name: 'Cast' }).click();
  const cont = page.getByRole('button', { name: 'Continue' });
  await cont.waitFor({ state: 'visible', timeout: 15_000 });
  await cont.click();
}

// The friction redesign, end to end. ?demo=1 pilots the party's grid movement + targeting (driving
// the tactics grid blind is infeasible headlessly). setPilotPreference chooses WHICH move fires;
// the combatSnapshot debug read observes damage + whether an overlay opened. What this proves:
//  (a) a free Strike resolves with NO encounter overlay and still deals damage;
//  (b) a gated Cast DOES open its overlay, and a correct answer out-damages the free Strike;
//  (c) the answered question is recorded to the Leitner SRS (verdict → quality → record).
test('combat friction: free Strike (no overlay) vs gated Cast (overlay → bigger dmg) → records SRS', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e))); // tolerated (logged, see note)

  await page.goto('/?scene=combat&seed=7&demo=1');
  await waitReady(page, 'combat');

  // ---- (b)+(c) GATED CAST FIRST (fresh enemies, so its big hit isn't capped by a chipped HP bar).
  await setPilot(page, 'cast');
  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 30_000 });
  await page.screenshot({ path: `${EV}/e2e-combat-cast-overlay.png` });
  await answerCast(page);

  const cast = await waitForLoggedAction(page, 'cast', 0);
  expect(cast, 'a Cast resolved through its overlay').not.toBeNull();
  expect(cast!.overlay, 'Cast opened its encounter overlay').toBe(true);
  expect(cast!.dmg, 'the Cast dealt damage').toBeGreaterThan(0);

  const afterCast = (await snap(page))?.log.length ?? 0;

  // ---- (a) FREE STRIKE: pilot to Strike; it must resolve with NO overlay and still bite.
  await setPilot(page, 'strike');
  const strike = await waitForLoggedAction(page, 'strike', afterCast);
  expect(strike, 'a Strike resolved').not.toBeNull();
  expect(strike!.overlay, 'Strike opened NO encounter overlay (the friction is gone)').toBe(false);
  expect(strike!.dmg, 'Strike still deals damage').toBeGreaterThan(0);
  expect(await page.locator('.fw-overlay').count(), 'no overlay lingers around a Strike beat').toBe(0);

  // The economy: answering a question hits harder than the free move.
  expect(cast!.dmg, 'a correct Cast out-damages a free Strike').toBeGreaterThan(strike!.dmg);

  // ---- SRS recorded for the answered question (learning is never lost).
  const srs = await readState<{ facts?: Record<string, unknown> }>(page, 'srs.json');
  expect(
    Object.keys(srs?.facts ?? {}).length,
    'combat recorded SRS (verdict → quality → Leitner record)',
  ).toBeGreaterThan(0);

  if (pageErrors.length) console.log('note: pageerrors during combat (tolerated):', pageErrors.slice(0, 2).join(' | '));
});
