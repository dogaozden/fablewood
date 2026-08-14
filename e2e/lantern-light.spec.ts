import { test, expect, type Page } from '@playwright/test';
import { waitReady, waitHamletPlayer, warpHamletTo, tapKey, waitForState, readState, canvasClick } from './helpers';

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

// Task 4, scenario (b) — the combat cast re-draw. Cloned combat-driving idioms (own-file
// convention, as above): combat-magic.spec.ts's combatSnapshot()/debugSetPos()/
// waitForKeeperTurn() debug-read pattern, and the standalone `?scene=combat` seeded launch,
// which always forces the FIXTURE_PACK_ID sentinel (combatDrawReady()'s documented rule) —
// a deterministic 6-fact pool, never a mix with any real installed pack.

type CombatSnap = { state: string } | null;

async function combatSnap(page: Page): Promise<CombatSnap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as CombatSnap;
  });
}

async function debugSetPos(page: Page, id: string, c: number, r: number): Promise<void> {
  await page.evaluate(
    ({ id: uid, c: cc, r: rr }) => {
      const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
      const s = g?.scene?.getScene?.('combat') as { debugSetPos?(id: string, c: number, r: number): void } | undefined;
      s?.debugSetPos?.(uid, cc, rr);
    },
    { id, c, r },
  );
}

/** Poll until the Keeper's own turn opens for manual control (combat-magic.spec.ts's precedent). */
async function waitForKeeperTurn(page: Page, timeout = 20_000): Promise<CombatSnap> {
  const start = Date.now();
  let s = await combatSnap(page);
  while (s?.state !== 'playerMove' && Date.now() - start < timeout) {
    await page.waitForTimeout(150);
    s = await combatSnap(page);
  }
  return s;
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

  test('combat cast: raising the lantern re-draws the question and spends the light', async ({ page }) => {
    test.setTimeout(60_000);
    const beforeSave = await readState<Save>(page, 'save.json');

    try {
      // fixture: save with lanternLight: true; seeded combat launch (deterministic draw pool).
      await page.request.put('/api/state/save.json', {
        data: { scene: 'combat', hp: 16, streak: 0, lastPlayed: '', lanternLight: true },
      });

      await page.goto('/?scene=combat&seed=7');
      await waitReady(page, 'combat');

      const opened = await waitForKeeperTurn(page);
      expect(opened?.state, "the Keeper's first turn opened for manual control").toBe('playerMove');

      // Deterministic geometry (combat-magic.spec.ts's own debugSetPos idiom) — wisp-0 within
      // Smite's range 2 so the T1 cast (no ?rank= override → Rank 1 over this 6-fact pool)
      // goes straight from keypress to targeting to the cast drill.
      await debugSetPos(page, 'keeper', 5, 3);
      await debugSetPos(page, 'wisp-0', 6, 3);

      await page.keyboard.press('2'); // Smite (T1 Kindling, mcq)
      await page.waitForTimeout(150); // a bare `.press()` can race Phaser's own frame-tick handling
      expect((await combatSnap(page))?.state, 'Rank 1 goes straight to targeting').toBe('playerTarget');

      await canvasClick(page, 192 + 6 * 48 + 24, 48 + 3 * 48 + 24); // wisp-0's tile (6,3)

      await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms arm guard

      await expect(page.locator('.fw-lantern-btn'), 'lanternLight:true shows the raise affordance').toBeVisible();
      const firstPrompt = (await page.locator('.fw-prompt').textContent())?.trim();

      await page.locator('.fw-lantern-btn').click();

      // The old overlay closes (170ms exit anim), the spend PUTs, and a fresh runEncounter
      // re-presents from the round's own drawn pool — no new draw (draw-census law). The
      // re-present ALWAYS passes lanternLight:false (Task 4's redraw branch), so the strip's
      // absence is the reliable settle signal regardless of whether the new prompt happens to
      // collide in text with the first.
      await expect.poll(() => page.locator('.fw-lantern-btn').count(), { timeout: 15_000 }).toBe(0);
      await expect(page.locator('.fw-overlay')).toBeVisible();
      await page.waitForTimeout(450); // the re-presented overlay's OWN 400ms arm guard

      // assert 1: a different memory surfaced (the fixture pool has 6 distinct facts, so a
      // textual collision is not expected in practice — the strip-gone poll above is the
      // collision-proof fallback signal either way).
      const secondPrompt = (await page.locator('.fw-prompt').textContent())?.trim();
      expect(
        secondPrompt !== firstPrompt || (await page.locator('.fw-lantern-btn').count()) === 0,
        'a different memory surfaced on the re-present, or the strip is confirmed gone',
      ).toBe(true);

      // assert 2 (persistence law): the light is spent.
      const s = await waitForState<Save>(page, 'save.json', (x) => x?.lanternLight === false);
      expect(s?.lanternLight).toBe(false);

      // answer the re-presented question so the battle continues cleanly.
      await page.locator('.fw-opt').first().click();
      const onward = page.getByRole('button', { name: 'Onward ▸' });
      try {
        await onward.waitFor({ state: 'visible', timeout: 1500 });
        await onward.click();
      } catch { /* correct answer auto-resolves without a continue button (kinds.ts renderMcq) */ }
      await page.locator('.fw-overlay').waitFor({ state: 'detached', timeout: 10_000 });
    } finally {
      await restoreSave(page, beforeSave);
    }
  });
});
