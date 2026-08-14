import { test, expect, type Page } from '@playwright/test';
import { waitReady, waitHamletPlayer, warpHamletTo, tapKey, waitForState, readState } from './helpers';

// Wave 5 (Lantern-Light) Task 3, scenario (a) — Concordance Ch. IV, DECIDED: "banking a
// hearth streak-night grants ONE stored Lantern-light (binary, no stockpiling)". Fresh
// red-green TDD: written and run RED against the pre-Task-3 tree (doCottage's rest patch
// had no lanternLight field, hearthRestConv had no lantern line) before Step 2/3 landed.

type Save = {
  scene?: string;
  hp?: number;
  streak?: number;
  lastPlayed?: string;
  embers?: number;
  lastHearthAt?: string;
  lanternLight?: boolean;
};

async function restoreSave(page: Page, save: Save | null): Promise<void> {
  const data: Save = save ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
  await page.request.put('/api/state/save.json', { data });
}

/** Cottage-rest drive, cloned from hearth-rest.spec.ts's runCottageConversation (this spec
 *  owns no other file — repo convention, see hamlet-dialogue-close.spec.ts). hearthRestConv()
 *  is 2 physical pages post Task 3 (the rest beat, then the lantern-grant line): the rest
 *  beat's own text already fills DialogueBox's MAX_ROWS=3 word-wrap budget with zero slack,
 *  so the appended line always lands on its own page regardless of how it's composed. */
async function runCottageConversation(page: Page, pageCount: number): Promise<void> {
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
  await tapKey(page, 'e'); // the closing tap
  await page.waitForTimeout(200);
}

test.describe('Lantern-light (Wave 5, Ch. IV)', () => {
  test('hearth night-rest banks Lantern-light (Ch. IV grant)', async ({ page }) => {
    test.setTimeout(60_000);
    const beforeSave = await readState<Save>(page, 'save.json');

    try {
      // fixture: a save that CAN rest tonight (no lastHearthAt), lanternLight absent
      await page.request.put('/api/state/save.json', {
        data: { scene: 'hamlet', hp: 3, embers: 0, lastHearthAt: '', streak: 0, lastPlayed: '' },
      });

      await page.goto('/?scene=hamlet&seed=7');
      await waitReady(page, 'hamlet');
      await waitHamletPlayer(page);

      const warped = await warpHamletTo(page, 'cottage');
      expect(warped, 'warp hook parked the Keeper at the Cottage').toBe(true);

      // drive: hamlet → cottage → rest (exactly as the existing rest spec does)
      await runCottageConversation(page, 2);

      const after = await waitForState<Save>(page, 'save.json', (s) => s?.lanternLight === true);
      expect(after?.lanternLight).toBe(true);
      expect(after?.lastHearthAt).toBeTruthy();
    } finally {
      await restoreSave(page, beforeSave);
    }
  });
});
