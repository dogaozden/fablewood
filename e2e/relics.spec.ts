import { test, expect, type Page } from '@playwright/test';
import { waitReady, waitHamletPlayer, tapKey, readState } from './helpers';

/**
 * Concordance Ch. IX — "held is the mechanic, borne is the choice." A relic derives
 * `use: null` from catalog.ts's deriveUse (same as a trinket — holding/bearing IS the
 * mechanic, never a button-driven "use"), so inventoryPane.ts's useCell() used to fall
 * every relic row through to the same silent-blank cell a trinket gets. This spec pins the
 * fix: a Held/Borne pill plus a Bear/Set-down affordance, and the law that a relic never
 * surfaces in the in-battle Satchel (swap never mid-combat).
 *
 * This is the wave's dedicated e2e home for Ch. IX relic scenarios (named "this wave's
 * scenario home" in the plan's Task 5 brief — created here, one task early, since T3 is the
 * first task with relic-specific scenarios to pin; later relic-passive tasks extend this
 * file rather than creating it).
 */

const RELIC_ID = 'warden-signet-of-terms';
const RELIC_NAME = 'Warden Signet of Terms';

type InvState = { bornRelicId?: string | null } | null;
type CombatSnap = { state: string } | null;

async function combatSnap(page: Page): Promise<CombatSnap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as CombatSnap;
  });
}

async function openHamletSatchel(page: Page): Promise<void> {
  await waitReady(page, 'hamlet');
  await waitHamletPlayer(page);
  await tapKey(page, 'i');
  await expect(page.locator('.inv-overlay')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.inv-title')).toHaveText('Satchel');
}

test('owning a relic shows Held + Bear; Bearing flips the pill, banners exactly, and persists across reload; Set down returns to Held', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);

  await page.request.put('/api/state/inventory.json', {
    data: { version: 1, gold: 0, stacks: { [RELIC_ID]: 1 }, bornRelicId: null },
  });

  await page.goto('/?scene=hamlet&seed=7');
  await openHamletSatchel(page);

  const row = page.locator('.inv-row', { hasText: RELIC_NAME });
  await expect(row.locator('.is-muted')).toHaveText('Held');
  await expect(row.getByRole('button', { name: 'Bear' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Set down' })).toHaveCount(0);

  await row.getByRole('button', { name: 'Bear' }).click();
  await expect(page.locator('.inv-banner.ok')).toHaveText(`Borne: ${RELIC_NAME}.`);
  await expect(row.locator('.is-muted')).toHaveText('Borne');
  await expect(row.getByRole('button', { name: 'Set down' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Bear' })).toHaveCount(0);

  // Persistence, part 1: the write actually landed in state/inventory.json (not just an
  // optimistic in-memory pill flip).
  const afterBear = await readState<InvState>(page, 'inventory.json');
  expect(afterBear?.bornRelicId, 'bearRelic wrote bornRelicId to state').toBe(RELIC_ID);

  await page.screenshot({ path: testInfo.outputPath('relics-borne.png') });

  // Persistence, part 2: a real reload re-reads it back off disk into the pane.
  await page.reload();
  await openHamletSatchel(page);
  const rowAfterReload = page.locator('.inv-row', { hasText: RELIC_NAME });
  await expect(rowAfterReload.locator('.is-muted')).toHaveText('Borne');
  await expect(rowAfterReload.getByRole('button', { name: 'Set down' })).toBeVisible();

  await rowAfterReload.getByRole('button', { name: 'Set down' }).click();
  await expect(page.locator('.inv-banner.ok')).toHaveText('Set down.');
  await expect(rowAfterReload.locator('.is-muted')).toHaveText('Held');
  await expect(rowAfterReload.getByRole('button', { name: 'Bear' })).toBeVisible();
  await expect(rowAfterReload.getByRole('button', { name: 'Set down' })).toHaveCount(0);

  const afterSetDown = await readState<InvState>(page, 'inventory.json');
  expect(afterSetDown?.bornRelicId ?? null, 'set-down cleared bornRelicId in state').toBeNull();
});

test('the combat Satchel pane never lists relics, even one owned and borne', async ({ page }, testInfo) => {
  test.setTimeout(45_000);

  await page.request.put('/api/state/save.json', { data: { hp: 16 } });
  await page.request.put('/api/state/inventory.json', {
    data: {
      version: 1,
      gold: 0,
      stacks: { [RELIC_ID]: 1, 'embermend-draught': 1 },
      bornRelicId: RELIC_ID,
    },
  });

  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');

  let s = await combatSnap(page);
  const start = Date.now();
  while (s?.state !== 'playerMove' && Date.now() - start < 20_000) {
    await page.waitForTimeout(150);
    s = await combatSnap(page);
  }
  expect(s?.state, 'first player turn reached for manual control').toBe('playerMove');

  await page.keyboard.press('q');
  await expect(page.locator('.inv-overlay')).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('.inv-title')).toHaveText('Satchel');

  // A real combat-usable item proves the pane isn't merely empty by omission...
  await expect(page.locator('.inv-row', { hasText: 'Embermend Draught' })).toBeVisible();
  // ...while the relic — owned AND borne — never gets a row at all: swap never mid-combat,
  // and usableSatchelItems' effect-kind filter structurally excludes every relic passive.
  await expect(page.locator('.inv-row', { hasText: RELIC_NAME })).toHaveCount(0);

  await page.screenshot({ path: testInfo.outputPath('relics-combat-satchel-excluded.png') });
});
