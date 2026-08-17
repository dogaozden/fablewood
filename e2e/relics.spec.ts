import { test, expect, type Page } from '@playwright/test';
import {
  waitReady,
  waitHamletPlayer,
  waitProvincesLoaded,
  tapKey,
  readState,
  waitForState,
  warpHamletTo,
} from './helpers';

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

// ---- Task 4: economy passives + the rotation law -----------------------------

// Task 4, the Warden Signet of Terms — cloned drive: lantern-light.spec.ts's OWN "boss hoard:
// raising the lantern grants advantage" sim-harness (`?scene=vaults&sim=1&auto=boss&seed=7`,
// deliberately WITHOUT dev=1 — a real installed pack; auto=boss clears rooms 1-5 without
// entering them and drives straight to the boss, so this is the only loot beat the run
// produces). That file's own comment records the seed-7 outcome, verified against the REAL
// economy.ts (throwaway vitest probe, not hand-derived): mulberry32((7 + 104729) >>> 0) rolls
// 'mossbound-locket' (uncommon) at edge:'none', 'clerks-silver-nib' (rare) at edge:'advantage'.
// Task 4's own unit tests (economy.test.ts) pin edged:true as BYTE-IDENTICAL to edge:'advantage'
// — same finalEdge, same rollRarityEdged call, same rng chain — so the SAME seed, with the
// Signet borne and NO Lantern-light held at all, must land the SAME 'clerks-silver-nib' if (and
// only if) DungeonScene actually reads bornRelic() and threads it into bossLoot. A build that
// left the wiring unthreaded reverts to the un-edged 'mossbound-locket' control, so this is a
// genuinely discriminating live proof of the call-site wiring, not a vacuous one.
type LootSave = {
  scene?: string;
  hp?: number;
  streak?: number;
  lastPlayed?: string;
  lanternLight?: boolean;
  wickCaught?: boolean;
  lastHearthAt?: string;
};
type LootInventory = { version: number; gold: number; stacks: Record<string, number>; bornRelicId?: string | null };

/** leveling-grant-sequence.spec.ts / lantern-light.spec.ts's own restoreLootState idiom,
 *  verbatim in shape: quiesce the page first (a live boss-victory run's own persist writes can
 *  otherwise land AFTER a bare PUT and poison whatever spec runs next in this shared, serial
 *  suite), then PUT-and-verify both save AND inventory (this route grants loot). */
async function restoreLootState(page: Page, save: LootSave | null, inv: LootInventory | null): Promise<void> {
  const saveData: LootSave = save ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
  const invData: LootInventory = inv ?? { version: 1, gold: 20, stacks: {} };
  await page.goto('about:blank');
  for (let i = 0; i < 5; i++) {
    await page.request.put('/api/state/save.json', { data: saveData });
    await page.request.put('/api/state/inventory.json', { data: invData });
    await new Promise((r) => setTimeout(r, 150));
    const nowSave = (await page.request
      .get('/api/state/save.json')
      .then((r) => r.json())
      .catch(() => undefined)) as LootSave | undefined;
    if (nowSave?.scene === saveData.scene) return;
  }
  throw new Error('restoreLootState: save.json never settled on the restored snapshot');
}

test('boss hoard: a borne Warden Signet of Terms edges the loot-rarity roll, with no Lantern-light in play (Ch. IX)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    // fixture: lanternLight ABSENT — the Signet is the only edge source in play. Owned AND
    // borne (bornRelicId, not just held — Ch. IX's "held is the mechanic, borne is the choice").
    await page.request.put('/api/state/save.json', {
      data: { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '' },
    });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 20, stacks: { [RELIC_ID]: 1 }, bornRelicId: RELIC_ID },
    });

    await page.goto('/?scene=vaults&sim=1&auto=boss&seed=7');

    const inv = await waitForState<LootInventory>(
      page,
      'inventory.json',
      (i) => (i?.stacks?.['clerks-silver-nib'] ?? 0) >= 1 || (i?.stacks?.['mossbound-locket'] ?? 0) >= 1,
      60_000,
    );
    expect(inv?.stacks?.['clerks-silver-nib'], 'the Signet alone (no Lantern-light) edged the roll').toBe(1);
    expect(inv?.stacks?.['mossbound-locket'], 'the un-edged control outcome did NOT land').toBeUndefined();
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
  }
});

// Task 4, the rotation law — cloned drive: inventory-pane-cross-reopen.spec.ts's own
// openMiraShop() verbatim (warp to the stall, tap through the dialogue until the shop opens).
async function openMiraShop(page: Page): Promise<void> {
  await warpHamletTo(page, 'factor');
  for (let i = 0; i < 6; i++) {
    await tapKey(page, 'e');
    await page.waitForTimeout(200);
    if (await page.locator('.inv-overlay').count()) return;
  }
}

test("Mira's shelf shows ten rows: the eight staples plus both of today's two rotating wares (Ch. IX rotation law)", async ({
  page,
}, testInfo) => {
  test.setTimeout(45_000);
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/inventory.json', { data: { version: 1, gold: 20, stacks: {} } });

    await page.goto('/?scene=hamlet&seed=7');
    await waitReady(page, 'hamlet');
    await waitHamletPlayer(page);
    await waitProvincesLoaded(page); // else Mira's conversation takes the pack-less branch — no shop

    await openMiraShop(page);
    await expect(page.locator('.inv-overlay')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.inv-title')).toHaveText(
      "Mira's Ledger — Wares & Trade (she fights, she trades, she remembers)",
    );

    // Buy section only — a fresh, trinket-less purse means the Sell section renders its
    // '.inv-empty' message, never an '.inv-row', so this count is exactly the shop stock.
    await expect(page.locator('.inv-row')).toHaveCount(10);
    for (const name of [
      'Embermend Draught',
      'Lantern-Oil Tonic',
      "Wardancer's Restorative",
      'Wick-Tallow',
      'Lantern-Brand',
      "Scrivener's Hint",
      'Second Wind Seal',
      'Ward of Focus',
      'Superior Draught',
      'Sealed Page of the Geyser',
    ]) {
      await expect(page.locator('.inv-row', { hasText: name }), `${name} on the shelf`).toHaveCount(1);
    }

    await page.screenshot({ path: testInfo.outputPath('relics-shop-rotation.png') });
  } finally {
    await page.request.put('/api/state/inventory.json', {
      data: beforeInv ?? { version: 1, gold: 0, stacks: {} },
    });
  }
});

// Task 4, the Second Wick — corrected 2026-08-17: the chapter's first translation ("+1
// Lantern-light, banked, compounding") contradicted Ch. IV's ratified binary light and was
// re-authored. The lawful mechanic: while borne, the FIRST spend of the raise after a hearth
// rest re-banks the light at once instead of clearing it — once per rest-cycle, never a second
// stockpiled light. All four scenarios drive the SAME deterministic spend surface as the
// Signet's own proof above: `?scene=vaults&sim=1&auto=boss&seed=7` (auto=boss always raises
// when a light is held — DungeonScene.offerLantern's own auto-threading rule — so a single
// page.goto is one full, real spend, no manual clicking).
const WICK_ID = 'second-wick';

/** Minimal Cottage-rest drive (miras-stall.spec.ts's own runCottageConversation, specialized
 *  to the 2-BASE-page case: absent lastHearthAt is grace, not a break, so no 3rd page). */
async function restAtCottage(page: Page): Promise<void> {
  await tapKey(page, 'e'); // open (page 1 starts typing)
  await page.waitForTimeout(250);
  await tapKey(page, 'e'); // skip page 1's typewriter
  await page.waitForTimeout(200);
  await tapKey(page, 'e'); // advance to page 2 (starts typing)
  await page.waitForTimeout(250);
  await tapKey(page, 'e'); // skip its typewriter
  await page.waitForTimeout(200);
  await tapKey(page, 'e'); // the closing tap
  await page.waitForTimeout(200);
}

test('the Second Wick borne, catch available: the first spend re-banks the light instead of clearing it', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    // wickCaught absent = catch available (correct default — nobody is mid-cycle).
    await page.request.put('/api/state/save.json', {
      data: { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '', lanternLight: true },
    });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 20, stacks: { [WICK_ID]: 1 }, bornRelicId: WICK_ID },
    });

    await page.goto('/?scene=vaults&sim=1&auto=boss&seed=7');

    const save = await waitForState<LootSave>(page, 'save.json', (s) => s?.wickCaught === true, 60_000);
    expect(save?.wickCaught, 'the catch fired').toBe(true);
    expect(save?.lanternLight, 'the light re-banked at once — still held, not cleared').toBe(true);
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
  }
});

test('the Second Wick borne, catch already used this cycle: the next spend clears the light normally (once per rest-cycle)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/save.json', {
      data: { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '', lanternLight: true, wickCaught: true },
    });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 20, stacks: { [WICK_ID]: 1 }, bornRelicId: WICK_ID },
    });

    await page.goto('/?scene=vaults&sim=1&auto=boss&seed=7');

    const save = await waitForState<LootSave>(page, 'save.json', (s) => s?.lanternLight === false, 60_000);
    expect(save?.lanternLight, 'no second catch this cycle — the light clears normally').toBe(false);
    expect(save?.wickCaught, 'the used-catch flag is untouched by a normal spend').toBe(true);
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
  }
});

test('a hearth rest resets the Second Wick\'s catch — spent, rested, and it catches again', async ({ page }) => {
  test.setTimeout(90_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 20, stacks: { [WICK_ID]: 1 }, bornRelicId: WICK_ID },
    });

    // Fixture: the catch is already spent this cycle, no lastHearthAt (never-rested grace —
    // canRestTonight(undefined, now) is true, and the Cottage conversation stays 2 base pages,
    // no break/ward line).
    await page.request.put('/api/state/save.json', {
      data: { scene: 'hamlet', hp: 3, embers: 0, wickCaught: true, lastPlayed: '' },
    });

    await page.goto('/?scene=hamlet&seed=7');
    await waitReady(page, 'hamlet');
    await waitHamletPlayer(page);

    const warped = await warpHamletTo(page, 'cottage');
    expect(warped, 'warp hook parked the Keeper at the Cottage').toBe(true);
    await restAtCottage(page);

    const afterRest = await waitForState<LootSave>(page, 'save.json', (s) => s?.wickCaught === false, 20_000);
    expect(afterRest?.wickCaught, 'the hearth rest reset the catch').toBe(false);
    expect(afterRest?.lanternLight, "Solace's own grant still bank the ONE light, as ever").toBe(true);

    // Spend again — the reset catch fires a SECOND time, proving the reset is real (not just a
    // one-shot flag that happened to start false).
    await page.request.put('/api/state/save.json', {
      data: { ...afterRest, scene: 'vaults' },
    });
    await page.goto('/?scene=vaults&sim=1&auto=boss&seed=7');

    const afterSpend = await waitForState<LootSave>(page, 'save.json', (s) => s?.wickCaught === true, 60_000);
    expect(afterSpend?.wickCaught, 'the catch fired again after the rest reset it').toBe(true);
    expect(afterSpend?.lanternLight, 'still held — re-banked, not cleared').toBe(true);
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
  }
});

test('without the Second Wick borne, the spend clears the light normally (regression: the hoisted helper preserves the base case)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/save.json', {
      data: { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '', lanternLight: true },
    });
    await page.request.put('/api/state/inventory.json', { data: { version: 1, gold: 20, stacks: {} } });

    await page.goto('/?scene=vaults&sim=1&auto=boss&seed=7');

    const save = await waitForState<LootSave>(page, 'save.json', (s) => s?.lanternLight === false, 60_000);
    expect(save?.lanternLight, 'no Wick borne — the light clears normally, exactly as before this task').toBe(false);
    expect(save?.wickCaught, 'wickCaught never sets when the Wick is not borne').not.toBe(true);
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
  }
});
