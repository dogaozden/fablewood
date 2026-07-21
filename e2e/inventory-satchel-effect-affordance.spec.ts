import { test, expect, type Page } from '@playwright/test';
import { waitReady, waitHamletPlayer, tapKey } from './helpers';

type CombatSnap = { state: string } | null;

async function combatSnap(page: Page): Promise<CombatSnap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as CombatSnap;
  });
}

/**
 * Crucible V1-21: the in-battle Satchel (combatSatchelPane.ts) rendered only `item.flavor`
 * (lore prose) for every row, never `item.effect` — no heal/Glow amount anywhere, unlike
 * Mira's shop, which computes an `effectLabel` ("Restores 6 vigor" / "Grants 1 glow in
 * battle"). Fixed by exporting that helper from shopPane.ts and mirroring it in the combat
 * pane's row (same `.inv-flavor` slot shopPane.ts already reuses for this).
 */
test('combat Satchel rows show heal/Glow magnitude, matching the shop', async ({ page }, testInfo) => {
  test.setTimeout(45_000);

  await page.request.put('/api/state/save.json', { data: { hp: 16 } });
  await page.request.put('/api/state/inventory.json', {
    data: { version: 1, gold: 20, stacks: { 'embermend-draught': 2, 'wick-tallow': 3 } },
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

  const healRow = page.locator('.inv-row', { hasText: 'Embermend Draught' });
  const glowRow = page.locator('.inv-row', { hasText: 'Wick-Tallow' });
  await expect(healRow.locator('.inv-flavor')).toHaveText('Restores 6 vigor');
  await expect(glowRow.locator('.inv-flavor')).toHaveText('Grants 1 glow in battle');

  await page.screenshot({ path: testInfo.outputPath('v1-21-combat-satchel-effect-labels.png') });
});

/**
 * Crucible V1-22: the hamlet (field) Satchel's `useCell()` branched only on `item.use ===
 * 'field'` ("Use" button) and `'trial'` ("Trial-bound" muted pill) — every 'combat'-only item
 * (every Glow item, by construction: catalog.ts's item() factory) fell through to an empty
 * cell, identical to a fully-inert trinket, with zero cue that it's usable anywhere. Fixed by
 * adding a 'combat' branch mirroring the 'trial' muted-pill pattern ("Combat-only").
 * Trinkets (use: null) must still render nothing, unchanged — this spec checks that too.
 */
test('field Satchel gives Glow (combat-only) items a muted pill, like the trial-tool pattern', async ({
  page,
}, testInfo) => {
  await page.request.put('/api/state/inventory.json', {
    data: {
      version: 1,
      gold: 20,
      stacks: {
        'embermend-draught': 1, // use: 'field' -> "Use" button
        'scriveners-hint': 1, // use: 'trial' -> "Trial-bound" pill
        'wick-tallow': 1, // use: 'combat' -> was empty; now "Combat-only" pill
        'faded-coin-cache': 1, // use: null (trinket) -> must stay empty
      },
    },
  });

  await page.goto('/?scene=hamlet&seed=7');
  await waitReady(page, 'hamlet');
  await waitHamletPlayer(page);

  await tapKey(page, 'i');
  await expect(page.locator('.inv-overlay')).toBeVisible();
  await expect(page.locator('.inv-title')).toHaveText('Satchel');

  const row = (name: string) => page.locator('.inv-row', { hasText: name });
  await expect(row('Embermend Draught').getByRole('button', { name: 'Use' })).toBeVisible();
  await expect(row("Scrivener's Hint").locator('.is-muted')).toHaveText('Trial-bound');
  await expect(row('Wick-Tallow').locator('.is-muted')).toHaveText('Combat-only');
  await expect(row('Faded Coin-Cache').locator('.inv-btn')).toHaveCount(0);

  await page.screenshot({ path: testInfo.outputPath('v1-22-field-satchel-combat-pill.png') });
});
