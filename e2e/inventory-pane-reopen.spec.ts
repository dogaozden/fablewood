import { test, expect, type Page } from '@playwright/test';
import { waitReady } from './helpers';

/**
 * Regression for crucible finding #2 ("rapid q→Escape pane reopen leaves Escape dead for
 * seconds", satchel-abuser sortie). Root-caused via an instrumented repro against real
 * CombatScene: dom.ts's own add/remove of its keydown listener is airtight — every Escape
 * press closes whatever Satchel pane is currently open, every time. The bug is upstream, in
 * Phaser itself: KeyboardPlugin queues every native keydown/keyup (KeyboardManager#queue)
 * and never clears that queue; its de-dup only remembers the ONE most-recently-processed
 * entry, so while CombatScene's keyboard is disabled for a pane's lifetime (the mandatory
 * caller wrap documented on openPane) the queue keeps growing untouched, and once more than
 * one stale event has piled up, an OLD keydown — e.g. the very 'q' that opened the pane
 * Escape just closed — can replay and silently reopen it the instant the caller re-enables
 * its keyboard. That ghost reopen is indistinguishable, from the outside, from "Escape
 * didn't work." openPane() now swallows any reopen within REOPEN_SETTLE_MS of the previous
 * close (opened and immediately self-closed before the browser ever paints it), since no
 * human can perceive the pane close, decide to reopen it, and press a key that fast. This
 * spec drives the exact same rapid q/Escape pace the crucible sortie used and asserts the
 * observable guarantee a player cares about: after Escape, the pane closes and STAYS closed.
 */

type Snap = { state: string; log: Array<{ action: string }> } | null;

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as Snap;
  });
}

test('rapid q/Escape loop never leaves a ghost-reopened Satchel pane behind', async ({ page }) => {
  test.setTimeout(60_000);

  await page.request.put('/api/state/save.json', { data: { hp: 16 } });
  await page.request.put('/api/state/inventory.json', {
    data: { version: 1, gold: 20, stacks: { 'embermend-draught': 2 } },
  });

  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');

  let s = await snap(page);
  const start = Date.now();
  while (s?.state !== 'playerMove' && Date.now() - start < 20_000) {
    await page.waitForTimeout(150);
    s = await snap(page);
  }
  expect(s?.state, 'the first player turn opened for manual control').toBe('playerMove');

  // No artificial delay between q and Escape, or between loop iterations — matching the
  // crucible sortie's own canonical repro pace (battles.spec.ts), which is exactly what
  // surfaces Phaser's ghost-replay window ~1-10ms after a caller re-enables its keyboard.
  // 20 iterations: pre-fix this caught the ghost reopen 7-11 times per 20-iteration run
  // (instrumented verification); post-fix, 0/20 across every run tried.
  let stuckCount = 0;
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('q');
    try {
      await page.locator('.inv-overlay').first().waitFor({ state: 'visible', timeout: 1_000 });
    } catch {
      // A 'q' landing inside another iteration's settle window can legitimately be
      // swallowed (or not yet processed) — fine; the check below still must hold.
    }
    await page.keyboard.press('Escape');

    // The guarantee that matters, checked the same way the original repro caught it: does
    // the pane become — and STAY — detached? A poll-based waitFor (not a fixed sleep) is
    // required here: it re-queries '.inv-overlay' on every tick, so it correctly keeps
    // waiting (and times out) if a ghost pane silently replaces the one Escape just closed,
    // rather than latching onto the instant the ORIGINAL pane detached.
    try {
      await page.locator('.inv-overlay').first().waitFor({ state: 'detached', timeout: 2_000 });
    } catch {
      stuckCount++;
      // recover so the loop can keep probing subsequent iterations
      try {
        await page.locator('.inv-close', { hasText: 'Cancel' }).click({ timeout: 1_000 });
        await page.locator('.inv-overlay').first().waitFor({ state: 'detached', timeout: 2_000 });
      } catch { /* best-effort recovery only */ }
    }
  }
  expect(stuckCount, 'Escape must close the pane and it must stay closed on every iteration').toBe(0);

  // The loop must never have corrupted combat state (still our own turn, no action spent).
  s = await snap(page);
  expect(s?.state, 'combat survives the rapid loop still on playerMove').toBe('playerMove');
  expect(s?.log.length, 'no rapid open/close/escape cycle spent the turn').toBe(0);
});
