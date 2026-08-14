import { test, expect, type Page } from '@playwright/test';
import { waitReady, currentScene, readState } from './helpers';

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
