import { test, expect, type Page } from '@playwright/test';
import { waitReady, tapKey, waitHamletPlayer, waitProvincesLoaded, warpHamletTo } from '../e2e/helpers';

// Wave 1 "the Draw Service" (2026-08-03-wave1-draw-service) task 6 — the two-pack interleave
// rig. Two real, schema-valid packs (fx-alpha, fx-beta — e2e-interleave/fixture-packs/) are
// installed together; this proves whether a Wellspring drill draws from BOTH once their facts
// are due, or only from one. Before task 7 it was the latter: HamletScene.bootstrap() set
// `this.packId = this.provinces[0]?.id` once at boot (HamletScene.ts) and doWellspring() never
// looked past that single pack for the whole 3-round burst — a second installed pack was
// silently never drilled. This spec was DELIBERATELY RED at task 6 (task 7 flipped it green by
// making Wellspring draw globally, across every installed pack, via the new draw service).

type Entry = { box: number; next_due: number; history: Array<{ ts: string; quality: 0 | 0.5 | 1; encounter_id: string }> };

/** Same shape/precedent as e2e/redemption-bell.spec.ts's hist()/seedSrs() — a fact seeded with
 *  next_due in the past is due, so the drill's picker prefers it over anything unseen. */
function hist(): Entry {
  const now = Date.now();
  return {
    box: 1,
    next_due: now - 5_000,
    history: [{ ts: new Date(now - 10_000).toISOString(), quality: 1, encounter_id: 'seed-0' }],
  };
}

async function seedSrs(page: Page, facts: Record<string, Entry>): Promise<void> {
  const res = await page.request.put('/api/state/srs.json', { data: { version: 1, facts } });
  expect(res.ok(), 'seeded state/srs.json through the dev bridge').toBe(true);
}

// Answer whichever kind the overlay shows (verbatim copy of e2e/wellspring-srs.spec.ts's local
// helper — not exported there, so duplicated here per this repo's per-spec-file convention).
async function answerAnyOverlay(page: Page): Promise<void> {
  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
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
  const cont = page.getByRole('button', { name: 'Onward ▸' });
  if (await cont.count()) await cont.click();
  await page.waitForTimeout(250);
}

test('two installed packs: a Wellspring drill surfaces facts from BOTH installed packs', async ({ page }) => {
  test.setTimeout(90_000);

  // Rig sanity: both fixture packs are actually installed (PACKS_DIR wiring works).
  const packsRes = await page.request.get('/api/packs');
  expect(packsRes.ok(), 'the dev bridge serves /api/packs').toBe(true);
  const { packs } = (await packsRes.json()) as {
    packs: Array<{ id: string; pack?: { facts?: Array<{ id: string }> } }>;
  };
  expect(packs.map((p) => p.id).sort(), 'both fixture packs are installed').toEqual(['fx-alpha', 'fx-beta']);

  // Seed EVERY fact in BOTH packs as due, so whichever pack the drill draws from, it has
  // plenty due to pick from — this isolates the assertion to "which pack", not "was anything due".
  const facts: Record<string, Entry> = {};
  for (const entry of packs) for (const f of entry.pack?.facts ?? []) facts[f.id] = hist();
  expect(Object.keys(facts).length, 'both packs contributed facts to seed').toBeGreaterThan(60);
  await seedSrs(page, facts);

  // This rig's STATE_DIR is a scratch dir SHARED across its three specs, and BootScene's
  // title-screen gesture resumes the SAVED scene (`save.scene === 'vaults' ? 'vaults' : 'hamlet'`
  // — BootScene.ts). combat-mix's crawl parks the save at scene:'vaults', so without pinning the
  // save here the Enter below enters the VAULTS and the `hamlet` wait can never resolve. Both
  // sibling specs already seed their own save.json before navigating; this one must too.
  await page.request.put('/api/state/save.json', {
    data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' },
  });

  await page.goto('/?renderer=classic&seed=7');
  await waitReady(page, 'boot');
  await page.keyboard.press('Enter');
  await waitReady(page, 'hamlet');
  await waitHamletPlayer(page);
  await waitProvincesLoaded(page); // else doWellspring() takes the no-pack branch (no drill)

  const warped = await warpHamletTo(page, 'wellspring');
  expect(warped, 'dev warp hook parked the Keeper at the Wellspring').toBe(true);
  await tapKey(page, 'e'); // open the Wellspring intro
  await page.waitForTimeout(220);

  // advance the intro dialogue until the first drill encounter opens
  for (let k = 0; k < 12; k++) {
    if (await page.locator('.fw-overlay').count()) break;
    await tapKey(page, 'e');
    await page.waitForTimeout(300);
  }
  await expect(page.locator('.fw-overlay'), 'the drill opened an encounter').toBeVisible({ timeout: 8000 });

  // run the full 3-round burst
  for (let n = 0; n < 3; n++) {
    if (!(await page.locator('.fw-overlay').count())) break;
    await answerAnyOverlay(page);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(400);

  // fact ids surfaced across the whole drill (HamletScene's test-support debug accessor —
  // added this task, additive-only, mirrors hoverTipDebug()'s precedent).
  const surfaced = await page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const h = g?.scene?.getScene?.('hamlet') as { wellspringDrillDebug?(): string[] } | undefined;
    return h?.wellspringDrillDebug?.() ?? [];
  });

  // Rig sanity: the drill genuinely surfaced something (proves the accessor + seeding work).
  expect(surfaced.length, 'the drill surfaced at least one fact id').toBeGreaterThan(0);
  // Pack fx-alpha is drawn from (provinces[0] on this install — the real bug, not rig flakiness).
  expect(surfaced.some((id) => id.startsWith('fx.a.')), 'pack fx-alpha is drawn from').toBe(true);
  // RED today: doWellspring() pins `this.packId` to provinces[0] for the whole burst, so a
  // second installed pack (fx-beta) is silently never drilled. Task 7 makes this green.
  expect(surfaced.some((id) => id.startsWith('fx.b.')), 'pack fx-beta is drawn from too').toBe(true);
});
