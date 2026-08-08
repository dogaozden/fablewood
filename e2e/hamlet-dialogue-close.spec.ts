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
//
// Every kind eventually calls resolve() — via an explicit "Onward ▸" click, or (a
// CORRECT mcq pick only, kinds.ts's renderMcq) a ~720ms auto-continue with no button at
// all — and every resolve() tears the overlay's DOM down (overlay.ts's close(), which
// completes before presentEncounter()'s own promise settles) before the caller can mount
// the next one. So "this specific overlay element is gone" is the one signal that holds
// for every kind; waiting for it (instead of a fixed settle time) is what makes this
// robust when a judge round trip or general load pushes the real close later than usual.
// Deliberately an ElementHandle wait, not a bare `.fw-overlay` locator wait: the NEXT
// encounter's overlay mounts with the same class, and a plain selector-based 'detached'
// wait can latch onto that fresh element and never see the original as gone.
async function answerAnyOverlay(page: Page): Promise<void> {
  const overlay = page.locator('.fw-overlay').first();
  await overlay.waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
  const handle = await overlay.elementHandle();
  const cont = page.getByRole('button', { name: 'Onward ▸' });
  let expectContinue = true;
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
    // mcq or scenario_branch (both use .fw-opt). scenario_branch's choose() always
    // appends the continue button; only a CORRECT mcq pick skips it (kinds.ts's
    // renderMcq auto-continues on its own ~720ms timer instead) — so only mcq's
    // continue button is optional.
    const isScenario = (await page.locator('.fw-eyebrow').innerText()).includes('Scenario');
    await page.locator('.fw-opt').first().click();
    expectContinue = isScenario;
  }
  if (expectContinue) {
    await cont.waitFor({ state: 'visible', timeout: 15_000 });
  } else {
    await cont.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {});
  }
  if (await cont.count()) await cont.click();
  if (handle) {
    await page.waitForFunction((el) => !el.isConnected, handle, { timeout: 10_000 });
    await handle.dispose();
  }
}

test.describe('hamlet dialogue close (crucible v0 #1)', () => {
  test('closing the Cottage conversation with E does not silently reopen it', async ({ page }) => {
    // Wave 3 (Hearth): a same-day lastHearthAt keeps doCottage() on the pre-existing
    // checkpoint path (not the new night-rest path) — this test's subject is E-close
    // mechanics, not which Cottage content is showing.
    await page.request.put('/api/state/save.json', {
      data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '', lastHearthAt: new Date().toISOString() },
    });

    await page.goto('/?scene=hamlet&seed=7');
    await waitReady(page, 'hamlet');
    await waitHamletPlayer(page);

    const warped = await warpHamletTo(page, 'cottage');
    expect(warped, 'warp hook parked the Keeper at the Cottage').toBe(true);

    await instrumentEnter(page);

    // open — real E tap (page 1/3, typing)
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
    // skip page 2's typewriter
    await tapKey(page, 'e');
    await page.waitForTimeout(200);
    // advance to page 3 — the already-rested line a same-day lastHearthAt appends (starts typing)
    await tapKey(page, 'e');
    await page.waitForTimeout(250);
    // skip page 3's typewriter — now on the last page, fully shown, no choices
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

    // answer the 3 real drill encounters through the real overlay. Poll for whichever
    // comes next — the following encounter's overlay, or (after the 3rd) the outro
    // dialogue — instead of guessing a fixed settle time: doWellspring()'s async gap
    // (pack/fact lookups, judge setup) can run long under load, and a fixed sleep that
    // undercounts it used to break out of this loop before the next encounter had even
    // mounted, leaving a drill step unanswered and the outro never opening.
    for (let n = 0; n < 3; n++) {
      await expect
        .poll(
          async () =>
            (await page.locator('.fw-overlay').count()) > 0 || Boolean((await hamletPlayer(page))?.dialogueOpen),
          { message: 'the next encounter or the outro should follow the previous step', timeout: 8000 },
        )
        .toBe(true);
      if (!(await page.locator('.fw-overlay').count())) break;
      await answerAnyOverlay(page);
    }

    // the outro appears on its own once the streak save completes
    await expect
      .poll(async () => (await hamletPlayer(page))?.dialogueOpen, {
        message: 'the Wellspring outro opened after the 3rd encounter',
        timeout: 8000,
      })
      .toBe(true);

    // DialogueBox.advance() swallows any keypress within 140ms of its OWN run()-time
    // openedAt (dialogue/DialogueBox.ts:224) — a guard against the SAME physical tap that
    // opens a dialogue also being read as its first advance. The intro's opening tap gets
    // this for free (its own subsequent 250ms wait, above, safely clears 140ms). The
    // outro instead opens ITSELF, mid-drill, with no player tap to anchor a wait against —
    // and expect.poll's detection can (rarely) fire close enough behind openedAt that an
    // immediate first tap here lands inside that 140ms window, gets swallowed, and shifts
    // every subsequent tap in this sequence by one — one of them then lands as the actual
    // close a beat early, which can misalign the closing tap this spec is built around.
    // Waiting a beat past the swallow window before the FIRST post-open tap (irrespective
    // of how fast or slow the poll above was) removes that race outright.
    await page.waitForTimeout(200);

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
