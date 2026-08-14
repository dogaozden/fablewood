import { test, expect, type Page } from '@playwright/test';
import { waitReady, waitHamletPlayer, warpHamletTo, tapKey, readState } from './helpers';

const EV = 'screenshots';

// Wave 3 (Hearth) — pins the Cottage's night-rest flow landed by Task 3 (HamletScene.doCottage(),
// rest/embers.ts's canRestTonight()/EMBER_MAX, PARTY_MAX_HP=16). Regression protection for
// Tasks 5-7 and the merge train, not fresh red-green TDD: Task 3 (d91c42b/4371a58) was already
// on this branch when this spec was written, so there is no natural pre-Task-3 red phase here —
// see task-4-report.md for the manual RED-capture proof performed in its place.

type Save = {
  scene?: string;
  hp?: number;
  streak?: number;
  lastPlayed?: string;
  embers?: number;
  lastHearthAt?: string;
};

async function restoreSave(page: Page, save: Save | null): Promise<void> {
  const data: Save = save ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
  await page.request.put('/api/state/save.json', { data });
}

/** Read the live DialogueBox's currently-rendered page text. Phaser-canvas-drawn, not DOM
 *  (dialogue/DialogueBox.ts's bodyText is a Phaser.GameObjects.Text) — the same private-field
 *  backdoor hamletPlayer() already uses for dialogue.isOpen (TS `private` is erased at
 *  runtime; no purpose-built e2e debug getter exists for dialogue text, unlike hoverTipDebug()). */
async function dialogueBodyText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const h = g?.scene?.getScene?.('hamlet') as
      | { dialogue?: { bodyText?: { text?: string } } }
      | undefined;
    return h?.dialogue?.bodyText?.text ?? '';
  });
}

/** Open the Cottage conversation, skip every page's typewriter, and close it — the exact
 *  open, skip, (advance, skip) repeated, close tap choreography hamlet-dialogue-close.spec.ts
 *  already proved for this same conversation (2N+1 taps for an N-page, no-choice dialogue). Verified
 *  by hand against pagination.ts's word-wrap for every string doCottage() shows: none of them
 *  split across an extra internal page, so N here equals conv.pages.length. Returns the last
 *  page's fully-shown text, read right before the closing tap (the crucible spec's own
 *  "before close" checkpoint). */
async function runCottageConversation(page: Page, pageCount: number): Promise<string> {
  await tapKey(page, 'e'); // open (page 1 starts typing)
  await page.waitForTimeout(250);
  await tapKey(page, 'e'); // skip page 1's typewriter
  await page.waitForTimeout(200);
  for (let p = 1; p < pageCount; p++) {
    await tapKey(page, 'e'); // advance to the next page (starts typing)
    await page.waitForTimeout(250);
    await tapKey(page, 'e'); // skip its typewriter
    await page.waitForTimeout(200);
  }
  const lastPageText = await dialogueBodyText(page);
  await tapKey(page, 'e'); // the closing tap
  await page.waitForTimeout(200);
  return lastPageText;
}

test.describe('hearth night-rest (Wave 3)', () => {
  test('Pin A+B: first rest of the night, then once per night means once', async ({ page }) => {
    test.setTimeout(60_000);
    const beforeSave = await readState<Save>(page, 'save.json');

    try {
      // Pin A seed: never rested (empty lastHearthAt), HP/embers depleted, a distinguishable
      // streak (5, not the usual 0) so "streak untouched" actually proves something.
      await page.request.put('/api/state/save.json', {
        data: { scene: 'hamlet', hp: 3, embers: 0, lastHearthAt: '', streak: 5, lastPlayed: '' },
      });

      await page.goto('/?scene=hamlet&seed=7');
      await waitReady(page, 'hamlet');
      await waitHamletPlayer(page);

      const warped = await warpHamletTo(page, 'cottage');
      expect(warped, 'warp hook parked the Keeper at the Cottage').toBe(true);

      // --- Pin A: first rest of the night (hearthRestConv, 2 pages post W5 Task 3's
      // lantern-grant line — the rest beat's own text already fills MAX_ROWS, so the
      // appended line lands on its own page; no choices) ---
      await runCottageConversation(page, 2);

      const afterA = await readState<Save>(page, 'save.json');
      expect(afterA?.hp, 'first rest heals to full (PARTY_MAX_HP)').toBe(16);
      expect(afterA?.embers, 'first rest refills embers to EMBER_MAX').toBe(2);
      expect(afterA?.streak, 'the rest patch never touches streak').toBe(5);
      const stampA = new Date(afterA?.lastHearthAt ?? '');
      const today = new Date();
      expect(stampA.getFullYear(), 'lastHearthAt stamped today (year)').toBe(today.getFullYear());
      expect(stampA.getMonth(), 'lastHearthAt stamped today (month)').toBe(today.getMonth());
      expect(stampA.getDate(), 'lastHearthAt stamped today (day)').toBe(today.getDate());

      await page.screenshot({ path: `${EV}/e2e-hearth-rest-pinA.png` });

      // --- Pin B: once per night means once — interact again immediately, no re-seed, no
      // re-warp (cottageConv(true), 3 pages, the already-rested line appended) ---
      const lastLine = await runCottageConversation(page, 3);
      // paginate() word-wraps this page across 2 lines within the box, joined by '\n' — a
      // rendering detail (font/box width), not the content Pin B is pinning. Normalize before
      // comparing so the assertion tracks the line's words, not its wrap point.
      expect(
        lastLine.replace(/\s+/g, ' '),
        "the already-rested line appears on the conversation's last page",
      ).toBe("The hearth still glows from tonight's banking. Rest again come tomorrow's dark.");

      const afterB = await readState<Save>(page, 'save.json');
      expect(afterB?.hp, 'no second rest: HP unchanged from Pin A').toBe(afterA?.hp);
      expect(afterB?.embers, 'no second rest: embers unchanged from Pin A').toBe(afterA?.embers);
      expect(afterB?.lastHearthAt, 'no second rest: lastHearthAt unchanged from Pin A').toBe(
        afterA?.lastHearthAt,
      );

      await page.screenshot({ path: `${EV}/e2e-hearth-rest-pinB.png` });
    } finally {
      await restoreSave(page, beforeSave);
    }
  });

  test('Pin C: legacy save (no embers/lastHearthAt keys) still gets a first rest', async ({ page }) => {
    test.setTimeout(60_000);
    const beforeSave = await readState<Save>(page, 'save.json');

    try {
      // Legacy shape: a pre-Wave-3 save — embers/lastHearthAt are entirely absent (not just
      // falsy), the additive-field regression guard (contracts.ts's embers?/lastHearthAt?).
      // streak: 4 (distinguishable from 0) so Task 5's Vigil break law is also pinned here:
      // an absent lastHearthAt is legacy GRACE, never a break — the streak must survive
      // untouched, not get snapped to 0 by a break-detector that mistook "never rested" for
      // "missed a night."
      await page.request.put('/api/state/save.json', {
        data: { scene: 'hamlet', hp: 3, streak: 4, lastPlayed: '' },
      });

      await page.goto('/?scene=hamlet&seed=7');
      await waitReady(page, 'hamlet'); // boots clean off a legacy save shape
      await waitHamletPlayer(page);

      const warped = await warpHamletTo(page, 'cottage');
      expect(warped, 'warp hook parked the Keeper at the Cottage').toBe(true);

      await runCottageConversation(page, 2); // hearthRestConv, 2 pages — see Pin A above

      const after = await readState<Save>(page, 'save.json');
      expect(after?.hp, 'legacy save still gets a first rest (heal to full)').toBe(16);
      expect(after?.embers, 'legacy save still gets embers refilled').toBe(2);
      expect(after?.lastHearthAt, 'legacy save still gets a lastHearthAt stamp').toBeTruthy();
      expect(after?.streak, 'absent lastHearthAt is grace, not a break — streak untouched').toBe(4);
    } finally {
      await restoreSave(page, beforeSave);
    }
  });
});
