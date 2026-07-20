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
  const cont = page.getByRole('button', { name: 'Onward ▸' });
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

  // Settings surfaces the Clerk's latency + tier for the Cast's judge call above
  // (JUDGE_MODE=stub here, so tier reads 'stub-mode' — still a real, non-empty
  // reading, proving the plugin→client→Settings plumbing works end to end).
  // Checked LAST: switching tabs tears down the combat scene (by design — see
  // overlay-teardown.spec.ts), which would break the Strike assertions above.
  await page.getByRole('button', { name: /Settings/ }).click();
  await expect(page.locator('.settings-judge')).toContainText('ms', { timeout: 5000 });
});

// Satchel in battle (inventory-handoff §10). No ?demo=1 here — the autopilot would race
// opening the panel, so this drives the Keeper's first turn under full manual control:
// seed a damaged pool + an owned heal item straight through the bridge (the packless
// ?scene=combat fixture otherwise starts every wallet at gold:20/stacks:{}, and a full
// pool has nothing to heal), open the Satchel with the real 'q' hotkey, use the potion,
// and confirm the pool rose, the store decremented, and the action resolved (spent the turn).
test('Satchel in battle: using a potion heals the pool and consumes it from the persistent satchel', async ({ page }) => {
  test.setTimeout(60_000);
  await page.request.put('/api/state/save.json', { data: { hp: 6 } });
  await page.request.put('/api/state/inventory.json', {
    data: { version: 1, gold: 20, stacks: { 'embermend-draught': 2 } },
  });

  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');

  // Wait for the Keeper's first turn to open (initiative: Keeper speed 5 goes first).
  const start = Date.now();
  let s = await snap(page);
  while (s?.state !== 'playerMove' && Date.now() - start < 20_000) {
    await page.waitForTimeout(200);
    s = await snap(page);
  }
  expect(s?.state, 'the first player turn opened for manual control').toBe('playerMove');
  const partyHpBefore = s!.partyHp;
  expect(partyHpBefore, 'the seeded damaged pool (hp:6) is what the battle launched with').toBe(6);

  await page.keyboard.press('q');
  await page.locator('.inv-overlay').waitFor({ state: 'visible', timeout: 5_000 });
  await page.screenshot({ path: `${EV}/e2e-combat-satchel-open.png` });

  await page.locator('.inv-row').getByRole('button', { name: 'Use' }).first().click();
  await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });

  const used = await waitForLoggedAction(page, 'satchel', 0);
  expect(used, 'a satchel use resolved (the action spent the turn)').not.toBeNull();
  await page.screenshot({ path: `${EV}/e2e-combat-satchel-used.png` });

  const after = await snap(page);
  expect(after!.partyHp, 'party HP rose from the heal (+6 draught, pool 6→12)').toBe(12);

  const inv = await readState<{ stacks?: Record<string, number> }>(page, 'inventory.json');
  expect(inv?.stacks?.['embermend-draught'] ?? 0, 'exactly one potion was consumed from the persistent store').toBe(1);
});

/** True exactly while CombatScene's boss-phase-opening portrait reveal is on screen (e2e-only debug read). */
async function bossRevealActive(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { bossRevealActive?(): boolean } | undefined;
    return !!s?.bossRevealActive?.();
  });
}

// Crucible finding #4 (sev3, input-mangler): mashing a hotkey through the ~1.2-1.4s
// Vault-Warden reveal cutscene (CombatScene.showBossReveal) used to commit an unread Parley
// branch the instant the scenario_branch overlay mounted — kinds.ts's renderScenario armed
// its onKey handler synchronously at mount, a full frame before focus ever settled inside
// the overlay (overlay.ts's rAF-deferred panel/card focus). Canonical repro:
// /?scene=combat&seed=7&boss=1, mash '1' continuously through the reveal. This drives the
// same shape and proves the branch stays unresolved until the overlay has had a moment to
// be read, while confirming a deliberate press still works once it has (no permanent lockout).
//
// The mash loop is throttled to ~25 presses/s (real repeated key taps), not an unbounded
// tight loop: a delay-free loop floods Chrome's input pipeline (1000+/s), starving the
// page's own rAF/timer processing so Phaser's tweens and delayedCalls never advance and the
// reveal itself never completes — a test artifact, not a reproduction of human mashing.
test('boss-phase reveal: mashing a hotkey cannot commit an unread Parley pick before the overlay is ready', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=7&boss=1');
  await waitReady(page, 'combat');

  let mashing = true;
  const mashLoop = (async () => {
    while (mashing) {
      await page.keyboard.press('1').catch(() => {});
      await page.waitForTimeout(40);
    }
  })();

  try {
    // Confirm this repro actually hits the reveal cutscene it depends on (a boss room opens
    // phase 0 automatically — CombatScene sets pendingBossPhase at creation).
    const start = Date.now();
    let sawReveal = false;
    while (Date.now() - start < 10_000) {
      if (await bossRevealActive(page)) { sawReveal = true; break; }
      if (await page.locator('.fw-overlay').count()) break; // reveal may already have finished
      await page.waitForTimeout(30);
    }

    await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
    await expect(page.locator('.fw-eyebrow'), 'the forced boss phase opens a Parley (scenario_branch)').toContainText('Parley');
    expect(sawReveal, 'the Vault-Warden reveal cutscene actually played (this bug is scoped to it)').toBe(true);

    // Still well inside the overlay's arming window — mashing continues throughout — no
    // branch may have resolved yet.
    await page.waitForTimeout(200);
    const opts = page.locator('.fw-opt');
    await expect(opts.first()).toBeVisible();
    const disabled = await opts.evaluateAll((els) => els.some((e) => (e as HTMLButtonElement).disabled));
    expect(disabled, 'a mashed hotkey must not resolve a branch before the overlay is interactively ready').toBe(false);
  } finally {
    mashing = false;
    await mashLoop;
  }

  // The guard only delays, never breaks, activation: once settled, a press still picks a
  // branch normally.
  await page.waitForTimeout(400);
  await page.keyboard.press('1');
  await expect(
    page.locator('.fw-verdict'),
    'a deliberate press after the overlay settles still resolves the branch',
  ).toBeVisible({ timeout: 5_000 });
});
