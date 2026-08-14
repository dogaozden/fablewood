import { test, expect, type Page } from '@playwright/test';
import { waitReady, currentScene, readState, waitForState, canvasClick } from './helpers';

const EV = 'screenshots';

type Snap = {
  state: string;
  activeId: string;
  log: Array<{ action: string; dmg: number; overlay: boolean }>;
  /** Ch. VII Mira's Stall — e2e-only debug read (combatSnapshot's `armedAid` field, Task 2). */
  armedAid: { itemId: string; kind: string } | null;
} | null;

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as Snap;
  });
}

/** Debug: the HUD banner's current text (e2e-only — same forwarding method combat-magic.spec.ts/
 *  v1fix-arts.spec.ts already use to assert dynamic banner copy). */
async function bannerText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { bannerText?(): string } | undefined;
    return s?.bannerText?.() ?? '';
  });
}

/** Wait for the KEEPER's own playerMove turn specifically. Mira (speed 4, right behind the
 *  Keeper's 5 in this fixture's fixed initiative — initiative.ts sorts by speed desc, party
 *  before enemy on a tie) gets her own manual playerMove turn too, so a plain "any playerMove"
 *  wait (fine for existing single-turn specs) would stop on HER turn the second time this is
 *  called. Waits her out with the Wait hotkey ('7') so only the Keeper's turn is ever returned. */
async function waitForKeeperTurn(page: Page, timeout = 30_000): Promise<Snap> {
  const start = Date.now();
  let s = await snap(page);
  while (Date.now() - start < timeout) {
    if ((await currentScene(page)) !== 'combat') return null; // fight resolved early
    s = await snap(page);
    if (s?.state === 'playerMove') {
      if (s.activeId === 'keeper') return s;
      await page.keyboard.press('7'); // Wait out Mira's turn
    }
    await page.waitForTimeout(150);
  }
  return s;
}

/** combat-magic.spec.ts / lantern-light.spec.ts's own debug-positioning idiom (own-file
 *  convention — each e2e spec clones the helpers it needs rather than importing across files). */
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

/** Arm the Hint via the Satchel (Task 2's own flow) — shared setup for the fire scenarios below.
 *  Must be called on the Keeper's own open turn; spends it (same turn-cost shape as heal/glow). */
async function armHint(page: Page): Promise<void> {
  await page.keyboard.press('q');
  await page.locator('.inv-overlay').waitFor({ state: 'visible', timeout: 5_000 });
  const hintRow = page.locator('.inv-row', { hasText: "Scrivener's Hint" });
  await hintRow.getByRole('button', { name: 'Use' }).click();
  await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(250); // let useSatchelItem's arm branch land + the banner render
}

// Ch. VII Mira's Stall, Task 2 (arming-model amendment): the combat Satchel used to filter
// usableSatchelItems down to heal|glow only — the trial tools (Scrivener's Hint/Second Wind
// Seal) stayed catalog/shop-only, with the encounter-surface hookup explicitly deferred
// (satchel.ts's own SCOPE comment, pre-this-task). This proves the Satchel now admits them,
// that using one ARMS it rather than consuming it on the spot (defer-removal law — the item
// count never drops), and that a second arm REPLACES the first (one live arm at a time).
test('combat Satchel admits trial tools; arming defers removal and a second arm replaces the first', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.request.put('/api/state/save.json', { data: { hp: 16 } });
  await page.request.put('/api/state/inventory.json', {
    data: { version: 1, gold: 20, stacks: { 'scriveners-hint': 1, 'second-wind-seal': 1 } },
  });

  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');

  let s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's first turn opened for manual control").toBe('playerMove');

  // ---- open the Satchel: the Hint tool row is present and clickable. Today (pre-fix)
  // usableSatchelItems filters reveal_option/retry_cast out entirely, so this row never
  // renders and this assertion is the RED signal.
  await page.keyboard.press('q');
  await page.locator('.inv-overlay').waitFor({ state: 'visible', timeout: 5_000 });
  const hintRow = page.locator('.inv-row', { hasText: "Scrivener's Hint" });
  await expect(hintRow.getByRole('button', { name: 'Use' })).toBeVisible({ timeout: 5_000 });
  await page.screenshot({ path: `${EV}/miras-stall-satchel-tools-admitted.png` });

  // ---- arm the Hint: verbatim banner, no consumption (defer-removal), turn spent (same
  // 560ms delayedCall -> endPlayerTurn shape heal/glow already use on this branch).
  await hintRow.getByRole('button', { name: 'Use' }).click();
  await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(250); // let useSatchelItem's new branch land + the banner render

  expect(await bannerText(page), 'Hint arm banner is the verbatim amendment copy').toBe(
    'The nib gleams — your next casting shows a false line struck.',
  );
  const armedAfterHint = (await snap(page))?.armedAid;
  expect(armedAfterHint, 'the Hint is armed').toEqual({ itemId: 'scriveners-hint', kind: 'reveal_option' });

  const invAfterHint = await readState<{ stacks?: Record<string, number> }>(page, 'inventory.json');
  expect(invAfterHint?.stacks?.['scriveners-hint'] ?? 0, 'arming does NOT consume the item (defer-removal law)').toBe(1);

  const used = await snap(page);
  expect(used?.log.at(-1)?.action, 'the arm resolved as a satchel action (spent the turn)').toBe('satchel');

  // ---- second Keeper turn: arm the Seal instead. This REPLACES the standing Hint arm —
  // one live arm at a time, old arm dissolved (item retained, no refund bookkeeping).
  s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's second turn opened").toBe('playerMove');

  await page.keyboard.press('q');
  await page.locator('.inv-overlay').waitFor({ state: 'visible', timeout: 5_000 });
  const sealRow = page.locator('.inv-row', { hasText: 'Second Wind Seal' });
  await expect(sealRow.getByRole('button', { name: 'Use' })).toBeVisible({ timeout: 5_000 });
  await sealRow.getByRole('button', { name: 'Use' }).click();
  await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(250);

  expect(await bannerText(page), 'Seal arm banner is the verbatim amendment copy').toBe(
    'The seal warms — a failed casting may be tried again, once.',
  );

  const finalArmed = (await snap(page))?.armedAid;
  expect(finalArmed, 'arming the Seal REPLACED the standing Hint arm — only the Seal is live now').toEqual({
    itemId: 'second-wind-seal',
    kind: 'retry_cast',
  });

  const invFinal = await readState<{ stacks?: Record<string, number> }>(page, 'inventory.json');
  expect(invFinal?.stacks?.['scriveners-hint'] ?? 0, 'the dissolved Hint arm cost nothing — item retained').toBe(1);
  expect(invFinal?.stacks?.['second-wind-seal'] ?? 0, 'the Seal is armed, not consumed').toBe(1);

  await page.screenshot({ path: `${EV}/miras-stall-arm-over-arm-replace.png` });
});

// Ch. VII Mira's Stall, Task 3 (Scrivener's Hint fires): an armed Hint strikes exactly one
// WRONG option on the next COMBAT cast — deterministic (first wrong option in presentation
// order, no rng anywhere near answers), never the correct one, inert (disabled, not clickable,
// no data-commit), and fires (consumes the item, clears the arm) only once genuinely answered.
test("armed Scrivener's Hint strikes one wrong MCQ option and fires on the answered cast", async ({ page }) => {
  test.setTimeout(90_000);
  await page.request.put('/api/state/save.json', { data: { hp: 16 } });
  await page.request.put('/api/state/inventory.json', {
    data: { version: 1, gold: 20, stacks: { 'scriveners-hint': 1 } },
  });

  // ?rank=1: the shared .state-e2e directory accumulates real SRS history across the suite's
  // runs, so the computed rank isn't stable — force Rank 1 so Smite casts T1 directly (no
  // tier flyout), same idiom as combat-magic.spec.ts's own Rank-1 tests.
  await page.goto('/?scene=combat&seed=7&rank=1');
  await waitReady(page, 'combat');

  let s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's first turn opened for manual control").toBe('playerMove');

  await armHint(page);
  expect((await snap(page))?.armedAid, 'the Hint is armed going into the cast').toEqual({
    itemId: 'scriveners-hint', kind: 'reveal_option',
  });

  s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's second turn opened, Hint still armed").toBe('playerMove');

  // dev-antechamber spawns enemies far from the party (combat-status.spec.ts's own note) — put
  // wisp-0 within Smite's range 2 (combat-magic.spec.ts's own (5,3)/(6,3) precedent).
  await debugSetPos(page, 'keeper', 5, 3);
  await debugSetPos(page, 'wisp-0', 6, 3);
  await page.keyboard.press('2'); // Smite (T1 Kindling, mcq)
  await page.waitForTimeout(150); // a bare `.press()` can race Phaser's own frame-tick handling
  expect((await snap(page))?.state, 'Rank 1 goes straight to targeting').toBe('playerTarget');

  await canvasClick(page, 192 + 6 * 48 + 24, 48 + 3 * 48 + 24); // wisp-0's tile

  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms arm guard
  await page.screenshot({ path: `${EV}/miras-stall-hint-strike.png` });

  // ---- exactly one wrong option struck, deterministic, inert.
  const struck = page.locator('.fw-opt.fw-struck');
  await expect(struck, 'exactly one option renders struck').toHaveCount(1);
  await expect(struck, 'the struck option is disabled').toBeDisabled();
  await expect(
    struck.locator('.fw-struck-sub'),
    'the struck sub-line is the verbatim amendment copy',
  ).toHaveText("— struck by the scrivener's hand");
  expect(
    await struck.getAttribute('data-commit'),
    'the struck option never carries the commit-button marking (W6 M2)',
  ).toBeNull();

  // ---- answer a DIFFERENT option to resolve the cast; the struck card is proven wrong (never
  // `is-correct`) regardless of which real fact this seed happens to draw.
  await page.locator('.fw-opt:not(.fw-struck)').first().click();
  await page.waitForTimeout(300);
  expect(
    await struck.evaluate((el) => el.classList.contains('is-correct')),
    'the struck option is never the correct answer',
  ).toBe(false);
  const onward = page.getByRole('button', { name: 'Onward ▸' });
  try {
    await onward.waitFor({ state: 'visible', timeout: 1500 });
    await onward.click();
  } catch { /* correct answer auto-resolves without a continue button (kinds.ts renderMcq) */ }

  // ---- fired: item deducted, arm cleared.
  const inv = await waitForState<{ stacks?: Record<string, number> }>(
    page, 'inventory.json', (i) => (i?.stacks?.['scriveners-hint'] ?? 0) === 0,
  );
  expect(inv?.stacks?.['scriveners-hint'] ?? 0, 'the Hint is consumed on fire').toBe(0);
  expect((await snap(page))?.armedAid, 'the arm is cleared after firing').toBeNull();
});

// Ch. VII Mira's Stall, Task 3 scenario b2: a lantern-raise mid-cast re-presents the SAME
// strikeOneFalse request — the strike persists across the redraw, and the Hint only fires
// (consumes, clears) once, on the eventual genuine answer, never on the sentinel re-present.
test('a lantern-raise redraw during a struck cast keeps the strike; the Hint fires once, on the eventual answer', async ({ page }) => {
  test.setTimeout(90_000);
  await page.request.put('/api/state/save.json', { data: { hp: 16, lanternLight: true } });
  await page.request.put('/api/state/inventory.json', {
    data: { version: 1, gold: 20, stacks: { 'scriveners-hint': 1 } },
  });

  await page.goto('/?scene=combat&seed=7&rank=1');
  await waitReady(page, 'combat');

  let s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's first turn opened for manual control").toBe('playerMove');

  await armHint(page);

  s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's second turn opened, Hint still armed").toBe('playerMove');

  await debugSetPos(page, 'keeper', 5, 3);
  await debugSetPos(page, 'wisp-0', 6, 3);
  await page.keyboard.press('2'); // Smite (T1 Kindling, mcq)
  await page.waitForTimeout(150);
  await canvasClick(page, 192 + 6 * 48 + 24, 48 + 3 * 48 + 24); // wisp-0's tile

  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms arm guard

  await expect(page.locator('.fw-opt.fw-struck'), 'struck before the raise').toHaveCount(1);
  await expect(page.locator('.fw-lantern-btn'), 'lanternLight:true shows the raise affordance').toBeVisible();

  await page.locator('.fw-lantern-btn').click();

  // The old overlay closes (170ms exit anim) and a fresh runEncounter re-presents from the
  // round's own drawn pool (draw-census law, unchanged) — same strikeOneFalse flag riding the
  // re-present request (T3 law: the redraw sentinel itself never fires the aid).
  await expect.poll(() => page.locator('.fw-lantern-btn').count(), { timeout: 15_000 }).toBe(0);
  await expect(page.locator('.fw-overlay')).toBeVisible();
  await page.waitForTimeout(450); // the re-presented overlay's OWN 400ms arm guard

  // ---- the strike persists across the redraw re-present.
  const struck = page.locator('.fw-opt.fw-struck');
  await expect(struck, 'exactly one option still renders struck after the redraw').toHaveCount(1);
  await expect(struck, 'the re-presented struck option is disabled').toBeDisabled();

  // ---- the redraw sentinel itself must NOT have fired the Hint (still armed, item retained).
  expect(
    (await snap(page))?.armedAid,
    'the Hint is still armed — the redraw sentinel never fires it',
  ).toEqual({ itemId: 'scriveners-hint', kind: 'reveal_option' });
  const invMidRedraw = await readState<{ stacks?: Record<string, number> }>(page, 'inventory.json');
  expect(invMidRedraw?.stacks?.['scriveners-hint'] ?? 0, 'not consumed yet — nothing was answered').toBe(1);

  // ---- answer the re-presented question; NOW the Hint fires, exactly once.
  await page.locator('.fw-opt:not(.fw-struck)').first().click();
  await page.waitForTimeout(300);
  const onward = page.getByRole('button', { name: 'Onward ▸' });
  try {
    await onward.waitFor({ state: 'visible', timeout: 1500 });
    await onward.click();
  } catch { /* correct answer auto-resolves without a continue button (kinds.ts renderMcq) */ }

  const inv = await waitForState<{ stacks?: Record<string, number> }>(
    page, 'inventory.json', (i) => (i?.stacks?.['scriveners-hint'] ?? 0) === 0,
  );
  expect(inv?.stacks?.['scriveners-hint'] ?? 0, 'the Hint fires exactly once, on the genuine answer').toBe(0);
  expect((await snap(page))?.armedAid, 'the arm is cleared after firing').toBeNull();
});
