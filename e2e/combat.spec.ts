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

/** Answer an open free_recall (Cast) overlay with a terse-but-correct answer → a Clerk pass. */
async function answerCast(page: Page): Promise<void> {
  await page.locator('.fw-textarea').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
  // The packless combat fixture has no packId, so runEncounter falls through to packs[0] —
  // vc-law, the only installed pack — and this is the first free_recall it offers combat:
  // enc.fr.economics-vs-control. Its rubric is written in the tiered house style ("Full
  // credit for X… Partial credit for Y… No credit for Z"), and the stub judge (app/src/
  // judge/stub.ts) grades terse answers against it by design — a bare, correct answer clears
  // the keyword bar → a real PASS (quality 1), so the Cast lands full.
  await page.locator('.fw-textarea').fill('Economics and control.');
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
  await page.getByRole('button', { name: /The Study/ }).click();
  await expect(page.locator('.settings-judge')).toContainText('grains', { timeout: 5000 });
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

  /** Read whether `.fw-opt` cards exist / have resolved (gone `disabled`) together with
   *  the PAGE's own clock, in one round trip. A slow/loaded runner's IPC latency has no
   *  guaranteed relationship to the browser's timeline once frames stall, so a wall-clock
   *  sleep measured from the Node side can't be trusted to still land inside the arm
   *  window — measuring `now` alongside the DOM read in the same evaluate() call keeps
   *  every comparison below honest regardless of how long anything around it took. */
  const sample = () =>
    page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll<HTMLButtonElement>('.fw-opt'));
      return { exists: opts.length > 0, resolved: opts.some((e) => e.disabled), now: performance.now() };
    });

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

    // overlay.ts's shared ENCOUNTER_ARM_MS guard arms `choose()` only ARM_MS after
    // mount. This ONE loop both finds the anchor and proves the
    // window, with NOTHING else — no Playwright locator/assertion call, which are their
    // own round trips — between capturing T0 and the very next read: measured
    // empirically, even the overlay/eyebrow content checks sitting BEFORE this section
    // let enough real time pass that a legitimate ~400ms resolution could land soon
    // enough after a late anchor to look artificially early. So content checks are
    // deferred to AFTER this section entirely (order doesn't matter for them — they're
    // confirming we hit the right repro, not part of the timing proof), and the anchor
    // here is the first RAW poll (no toBeVisible/toContainText machinery) to observe
    // `.fw-opt` at all, with the mash loop hammering throughout. A resolution timestamped
    // suspiciously close to that anchor always means the guard broke, no matter how long
    // anything before `first` took. SAFE_MS is deliberately well under the real ARM_MS:
    // the original bug resolved within about one frame of mount (~1-2ms, confirmed by
    // temporarily reverting the guard), so even this much slack still catches a
    // regression easily while tolerating this loop's own small per-sample round trip.
    const ARM_MS = 400; // mirrors overlay.ts's ENCOUNTER_ARM_MS — the contract under test
    const SAFE_MS = 100;
    let first: { now: number } | null = null;
    let elapsed = 0;
    const pollCeiling = Date.now() + 15_000; // circuit breaker only, not part of the timing proof
    while (Date.now() < pollCeiling) {
      const s = await sample();
      if (!first) {
        if (!s.exists) { await page.waitForTimeout(10); continue; } // overlay not mounted yet
        first = s;
        continue; // next statement executed is the very next `sample()` below — no gap
      }
      elapsed = s.now - first.now;
      if (s.resolved) {
        expect(
          elapsed,
          `a mashed hotkey resolved the branch only ${Math.round(elapsed)}ms after the overlay became interactive (arm window is ${ARM_MS}ms) — must not resolve before the overlay has had a moment to be read`,
        ).toBeGreaterThanOrEqual(SAFE_MS);
        break;
      }
      if (elapsed >= SAFE_MS) break; // held unresolved for the full safety margin: guard proven
      await page.waitForTimeout(20);
    }
    if (!first) throw new Error('the Parley overlay\'s .fw-opt cards never appeared');

    // Content checks: confirm this hit the right repro. Order doesn't matter for these —
    // they're not part of the timing proof above.
    await expect(page.locator('.fw-eyebrow'), 'the forced boss phase opens a Parley (scenario_branch)').toContainText('Parley');
    expect(sawReveal, 'the Vault-Warden reveal cutscene actually played (this bug is scoped to it)').toBe(true);
  } finally {
    mashing = false;
    await mashLoop;
  }

  // The guard only delays, never breaks, activation: once settled, a press still picks a
  // branch normally. Poll with repeated deliberate presses rather than one fixed sleep
  // then a single attempt, so an occasional heavy stall past the arm window still lands
  // it instead of racing it.
  const pressDeadline = Date.now() + 5_000;
  let sawVerdict = false;
  while (Date.now() < pressDeadline) {
    await page.keyboard.press('1');
    if (await page.locator('.fw-verdict').count()) { sawVerdict = true; break; }
    await page.waitForTimeout(150);
  }
  expect(sawVerdict, 'a deliberate press after the overlay settles still resolves the branch').toBe(true);
});

// The same native-button hazard exists outside the boss path: Smite's first MCQ card takes
// focus one frame after mount, so Space mashing can activate it without ever touching the
// renderer's number-key handler. Drive a regular combat Smite and anchor the proof to the
// browser's own first observation of `.fw-opt`, exactly like the boss regression above.
test('regular combat Smite: mashing Space cannot commit an unread MCQ before the overlay is ready', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=7&demo=1');
  await waitReady(page, 'combat');
  await setPilot(page, 'smite');

  let mashing = true;
  const mashLoop = (async () => {
    while (mashing) {
      await page.keyboard.press(' ').catch(() => {});
      await page.waitForTimeout(40);
    }
  })();

  const sample = () =>
    page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll<HTMLButtonElement>('.fw-opt'));
      return { exists: opts.length > 0, resolved: opts.some((e) => e.disabled), now: performance.now() };
    });

  const ARM_MS = 400; // mirrors overlay.ts's ENCOUNTER_ARM_MS — the contract under test
  const SAFE_MS = 100;
  let first: { now: number } | null = null;
  let elapsed = 0;
  try {
    const pollCeiling = Date.now() + 20_000; // circuit breaker only, not part of the timing proof
    while (Date.now() < pollCeiling) {
      const s = await sample();
      if (!first) {
        if (!s.exists) { await page.waitForTimeout(10); continue; }
        first = s;
        continue; // next statement executed is the very next `sample()` below — no gap
      }
      elapsed = s.now - first.now;
      if (s.resolved || elapsed >= SAFE_MS) break;
      await page.waitForTimeout(20);
    }
    if (!first) throw new Error('the regular Smite overlay\'s .fw-opt cards never appeared');
    expect(
      elapsed,
      `a mashed Space resolved the MCQ only ${Math.round(elapsed)}ms after the overlay became interactive (arm window is ${ARM_MS}ms) — must remain unresolved for the safety margin`,
    ).toBeGreaterThanOrEqual(SAFE_MS);
  } finally {
    mashing = false;
    await mashLoop;
  }

  // Content checks stay after the raw timing window so they cannot move its anchor.
  await expect(page.locator('.fw-eyebrow'), 'the regular combat action opened a Smite (mcq)').toContainText('Smite');

  // The shared guard delays activation; it never permanently locks the card.
  const pressDeadline = Date.now() + 5_000;
  let sawVerdict = false;
  while (Date.now() < pressDeadline) {
    await page.keyboard.press(' ');
    if (await page.locator('.fw-verdict').count()) { sawVerdict = true; break; }
    await page.waitForTimeout(150);
  }
  expect(sawVerdict, 'a deliberate Space press after the overlay settles still resolves the MCQ').toBe(true);
});
