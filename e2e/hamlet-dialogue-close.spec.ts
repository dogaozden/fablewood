import { test, expect, type Page } from '@playwright/test';
import {
  waitReady,
  waitHamletPlayer,
  hamletPlayer,
  tapKey,
  warpHamletTo,
  waitProvincesLoaded,
  readState,
} from './helpers';

const EV = 'screenshots';

// Crucible v0 finding #1 (severity 4, softlock): closing a plain hamlet conversation
// with E/Space silently reopens it from page 1 — only Escape actually exits. Root
// cause: DialogueBox closes via its OWN raw Phaser 'keydown' listener
// (dialogue/DialogueBox.ts:130), completely independent of the `keyE`/`keySpace` Key
// objects HamletScene polls with Phaser.Input.Keyboard.JustDown(). The exact same
// physical keypress that closes the dialogue ALSO sets that Key's `_justDown` flag —
// and HamletScene's updatePromptAndInteract() never calls JustDown() while the scene
// is "locked" (busy || dialogue.isOpen), so the flag is never consumed. The instant
// both go false again (the same frame enter()'s `finally` clears `busy`), the very
// next update() reads the stale flag as a brand-new press and calls enter() again.
// Escape is unaffected because HamletScene never polls an Escape Key object at all.

/** Patch the LIVE HamletScene's enter() to count real invocations — a timing-independent
 *  assertion channel for "did the scene silently re-enter a location with no fresh
 *  player input", the same instrumentation trick the crucible verifier used. */
async function instrumentEnter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const h = g?.scene?.getScene?.('hamlet') as { enter?: (id: string) => Promise<void> } | undefined;
    if (!h?.enter) throw new Error('hamlet scene / enter() not found for instrumentation');
    const calls: string[] = [];
    (window as unknown as { __fwEnterCalls: string[] }).__fwEnterCalls = calls;
    const orig = h.enter.bind(h);
    h.enter = (id: string) => {
      calls.push(id);
      return orig(id);
    };
  });
}

async function enterCallCount(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __fwEnterCalls?: string[] }).__fwEnterCalls?.length ?? 0,
  );
}

/** Poll for `ms`, failing immediately the moment the dialogue reopens or enter() refires
 *  with no fresh player input — mirrors the verifier's real repro (tap E through a
 *  conversation; the reopen, if present, happens one frame after the close). */
async function assertNoSilentReopen(page: Page, expectedCalls: number, ms = 1500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const [p, calls] = await Promise.all([hamletPlayer(page), enterCallCount(page)]);
    expect(p?.dialogueOpen, 'dialogue silently reopened after a clean close').toBe(false);
    expect(calls, 'enter() fired again with no fresh interact keypress').toBe(expectedCalls);
    await page.waitForTimeout(100);
  }
}

// Same generic "answer whatever the drill offers" helper as wellspring-srs.spec.ts,
// duplicated locally so this spec is fully self-contained (it owns no other file).
async function answerAnyOverlay(page: Page): Promise<void> {
  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 8000 });
  if (await page.locator('.fw-textarea').count()) {
    await page.locator('.fw-textarea').fill('the preferred shares convert at the stated ratio');
    await page.getByRole('button', { name: 'Cast' }).click();
  } else if (await page.locator('.fw-chip').count()) {
    const lefts = page.locator('.fw-col').nth(0).locator('.fw-chip');
    const rights = page.locator('.fw-col').nth(1).locator('.fw-chip');
    const n = await lefts.count();
    for (let i = 0; i < n; i++) {
      await lefts.nth(i).click();
      await rights.nth(i).click();
    }
    await page.getByRole('button', { name: /Seal the Weave/ }).click();
  } else if (await page.locator('.fw-step').count()) {
    await page.getByRole('button', { name: /Seal the Sequence/ }).click();
  } else {
    await page.locator('.fw-opt').first().click(); // mcq or scenario
  }
  await page.waitForTimeout(300);
  const cont = page.getByRole('button', { name: 'Continue' });
  if (await cont.count()) await cont.click();
  await page.waitForTimeout(250);
}

test.describe('hamlet dialogue close (crucible v0 #1)', () => {
  test('closing the Cottage conversation with E does not silently reopen it', async ({ page }) => {
    await page.goto('/?scene=hamlet&seed=7');
    await waitReady(page, 'hamlet');
    await waitHamletPlayer(page);

    const warped = await warpHamletTo(page, 'cottage');
    expect(warped, 'warp hook parked the Keeper at the Cottage').toBe(true);

    await instrumentEnter(page);

    // open — real E tap (page 1/2, typing)
    await tapKey(page, 'e');
    await page.waitForTimeout(250);
    expect(await enterCallCount(page), 'the open tap invoked enter() exactly once').toBe(1);
    expect((await hamletPlayer(page))?.dialogueOpen, 'dialogue opened').toBe(true);

    // skip page 1's typewriter
    await tapKey(page, 'e');
    await page.waitForTimeout(200);
    // advance to page 2 (starts typing)
    await tapKey(page, 'e');
    await page.waitForTimeout(250);
    // skip page 2's typewriter — now on the last page, fully shown, no choices
    await tapKey(page, 'e');
    await page.waitForTimeout(200);
    expect((await hamletPlayer(page))?.dialogueOpen, 'still open before the closing tap').toBe(true);

    await page.screenshot({ path: `${EV}/e2e-crucible1-cottage-before-close.png` });

    // THE closing tap — the exact physical keypress DialogueBox uses to close AND
    // Phaser uses to set keyE._justDown (crucible #1's root cause).
    await tapKey(page, 'e');

    await assertNoSilentReopen(page, 1, 1500);
    expect(await enterCallCount(page), 'enter() must not fire again after a clean close').toBe(1);
    await page.screenshot({ path: `${EV}/e2e-crucible1-cottage-after-close.png` });
  });

  test('Wellspring outro closes cleanly — streak increments exactly once, drill does not silently rerun', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // Known baseline so the post-outro streak assertion is exact regardless of what
    // any earlier spec in this run left behind.
    await page.request.put('/api/state/save.json', {
      data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' },
    });

    await page.goto('/?scene=hamlet&seed=7');
    await waitReady(page, 'hamlet');
    await waitHamletPlayer(page);
    await waitProvincesLoaded(page); // else doWellspring() takes the no-pack branch

    const warped = await warpHamletTo(page, 'wellspring');
    expect(warped, 'warp hook parked the Keeper at the Wellspring').toBe(true);

    await instrumentEnter(page);

    // open — real E tap (intro page 1/2, typing)
    await tapKey(page, 'e');
    await page.waitForTimeout(250);
    expect(await enterCallCount(page), 'the open tap invoked enter() exactly once').toBe(1);

    // intro: skip p1, advance to p2, skip p2, close. (Closing the INTRO can't yet
    // trigger the reopen: `busy` stays true until doWellspring() fully returns, so
    // the scene never unlocks here — the outro's close below is the one that can.)
    await tapKey(page, 'e');
    await page.waitForTimeout(200);
    await tapKey(page, 'e');
    await page.waitForTimeout(250);
    await tapKey(page, 'e');
    await page.waitForTimeout(200);
    await tapKey(page, 'e'); // closes the intro -> doWellspring() proceeds into the drill
    await page.waitForTimeout(300);

    // answer the 3 real drill encounters through the real overlay
    for (let n = 0; n < 3; n++) {
      if (!(await page.locator('.fw-overlay').count())) break;
      await answerAnyOverlay(page);
      await page.waitForTimeout(400); // let the next encounter (or the outro) come up
    }

    // the outro appears on its own once the streak save completes
    await expect
      .poll(async () => (await hamletPlayer(page))?.dialogueOpen, {
        message: 'the Wellspring outro opened after the 3rd encounter',
        timeout: 8000,
      })
      .toBe(true);

    // outro: 1 page, no choices — skip typewriter, then the CLOSING tap that exercises
    // crucible #1's exact mechanism at the bug report's named worst case (a silently
    // rerun drill + a double streak bump).
    await tapKey(page, 'e');
    await page.waitForTimeout(200);
    await tapKey(page, 'e'); // the closing tap

    await assertNoSilentReopen(page, 1, 1500);
    expect(await enterCallCount(page), 'enter() must not silently refire after the outro closes').toBe(1);

    const save = await readState<{ streak?: number }>(page, 'save.json');
    expect(save?.streak, 'the streak incremented exactly once — no silent drill rerun').toBe(1);
  });
});
