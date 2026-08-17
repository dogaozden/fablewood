import { test, expect, type Page } from '@playwright/test';
import {
  waitReady,
  waitHamletPlayer,
  waitProvincesLoaded,
  tapKey,
  readState,
  waitForState,
  warpHamletTo,
  canvasClick,
  tileClick,
  currentScene,
} from './helpers';
// Pure, no-Phaser module (same precedent as miras-stall.spec.ts's own buildLayout import) —
// reuse the shipped constant rather than re-typing the literal (avoids drift/typos).
import { WICK_CATCH_LINE } from '../app/src/game/lantern';
// Fix round 2 addendum — the SAME pure resolver CombatScene itself calls (previewPick wraps
// this verbatim), imported directly so the redraw-pool precondition below is checked the real
// way, not merely assumed from an external probe run once during authoring.
import { pick } from '../app/src/game/encounters/engine';
import type { Pack } from '../app/src/packs/types';

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

// Task 10 (the wave sweep) — the Signet was the one relic of five missing its "without borne"
// regression pair (Heel/Lamp/Clasp/Wick each have one; this closes the asymmetry, same rig and
// seed as the borne test above, `stacks: {}, bornRelicId: null` matching every other relic's
// own regression convention, e.g. the Clasp's at line ~1170).
test('without the Warden Signet of Terms borne: the loot-rarity roll is NOT edged — regression (Ch. IX)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/save.json', {
      data: { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '' },
    });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 20, stacks: {}, bornRelicId: null },
    });

    await page.goto('/?scene=vaults&sim=1&auto=boss&seed=7');

    const inv = await waitForState<LootInventory>(
      page,
      'inventory.json',
      (i) => (i?.stacks?.['clerks-silver-nib'] ?? 0) >= 1 || (i?.stacks?.['mossbound-locket'] ?? 0) >= 1,
      60_000,
    );
    expect(inv?.stacks?.['mossbound-locket'], 'no relic borne: the un-edged control outcome lands').toBe(1);
    expect(inv?.stacks?.['clerks-silver-nib'], 'the edged outcome did NOT land — nothing was borne to edge it').toBeUndefined();
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

// ---- Fix round 1, F2: the catch's player-facing banner/notice text, at the four sites that
// have a checkable hook (bannerText() for CombatScene's two showBanner sites, the .fw-notice
// DOM paragraph for HamletScene/Death's Door's notice-channel sites — both proven, already-
// in-use routes per the review). DungeonScene's site (post-F1, folded into the loot toast) has
// no hook today; left unit-covered, noted in the report. All four helpers below are cloned from
// their originating specs (own-file convention) — combat-magic.spec.ts (debugSetPos/
// debugSetGlow/waitForKeeperTurn shape), miras-stall.spec.ts (bannerText), lantern-light.spec.ts
// (the Wellspring/Death's Door drives, trimmed to what F2 needs: reaching the notice, not
// proving which memory redrew — that's already pinned there).

// combatSnap()/CombatSnap already declared above (T3's own — same shape, reused verbatim).

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

async function debugSetGlow(page: Page, pips: number): Promise<void> {
  await page.evaluate((p) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { debugSetGlow?(pips: number): void } | undefined;
    s?.debugSetGlow?.(p);
  }, pips);
}

async function waitForKeeperTurn(page: Page, timeout = 20_000): Promise<CombatSnap> {
  const start = Date.now();
  let s = await combatSnap(page);
  while (s?.state !== 'playerMove' && Date.now() - start < timeout) {
    await page.waitForTimeout(150);
    s = await combatSnap(page);
  }
  return s;
}

/** miras-stall.spec.ts's own debug forwarding method (CombatScene.bannerText). */
async function bannerText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { bannerText?(): string } | undefined;
    return s?.bannerText?.() ?? '';
  });
}

type LayoutDbg = { tiles: string[][] } | null;

async function layoutDebug(page: Page): Promise<LayoutDbg> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { layoutDebug?(): unknown } | undefined;
    return (s?.layoutDebug?.() ?? null) as LayoutDbg;
  });
}

/** The real room's layout is generated per seed/room id (lantern-light.spec.ts's own idiom) —
 *  scan for a horizontally-adjacent non-wall pair rather than hardcoding tiles. */
async function findAdjacentFloorPair(page: Page): Promise<[{ c: number; r: number }, { c: number; r: number }]> {
  const layout = await layoutDebug(page);
  const tiles = layout?.tiles ?? [];
  for (let r = 0; r < tiles.length; r++) {
    for (let c = 0; c < (tiles[r]?.length ?? 0) - 1; c++) {
      if (tiles[r][c] !== 'wall' && tiles[r][c + 1] !== 'wall') return [{ c, r }, { c: c + 1, r }];
    }
  }
  throw new Error('no adjacent floor pair found in the room layout');
}

/** miras-stall.spec.ts's own idiom: every real installed fact id, read off the live packs API. */
async function installedFactIds(page: Page): Promise<string[]> {
  const res = await page.request.get('/api/packs');
  expect(res.ok(), 'read installed packs').toBe(true);
  const { packs } = (await res.json()) as { packs: Array<{ pack?: { facts?: Array<{ id: string }> } }> };
  const ids: string[] = [];
  for (const entry of packs) for (const f of entry.pack?.facts ?? []) ids.push(f.id);
  expect(ids.length, 'the installed pack has facts to seed').toBeGreaterThan(0);
  return ids;
}

// Fix round 2 (F2 re-opened) — the review ran the T2/T3 cast test cold 4 times and got a
// byte-identical failure every time: the redraw showed the SAME encounter both draws. Root
// cause (review's own diagnosis, confirmed against the real pack data below): the test's
// "COMBAT_DRAW_COUNT=20 guarantees an alternative" comment was an assumption, not a guarantee —
// the app's own wouldBe===result.encounterId safety net legitimately falls back to fate-holds
// when the drawn pool's remainder happens to resolve to the same encounter, which this exact
// seed/rank/tier combination does. Verified directly against packs/vc-law/pack.json: two
// PREREQ-FREE facts that resolve to two GENUINELY DISTINCT mcq encounters —
// vc.econ.valuation.pre-vs-post-money -> enc.mcq.pre-post-money, and
// vc.econ.vesting.four-year-one-year-cliff -> enc.mcq.vesting-standard (the only two mcq
// encounters reachable by a prereq-free fact in the whole pack, so both are eligible on a cold
// save with zero history). Seeding BOTH as far-more-overdue than anything else installed
// (miras-stall.spec.ts's own seedSrsBaseline idiom: seed every installed fact at a baseline,
// override the two targets to win "most overdue" deterministically) removes the redraw pool's
// dependence on ambient .state-e2e history entirely — the shown fact and the redraw target are
// pinned, on two different encounters, regardless of what any other spec's run left behind.
// Applied to BOTH combat tests (T1 passed cold before this fix, but on the same unguaranteed
// assumption — this closes that gap too rather than leaving it merely lucky).
const WICK_CAST_FACT_A = 'vc.econ.valuation.pre-vs-post-money'; // -> enc.mcq.pre-post-money
const WICK_CAST_FACT_B = 'vc.econ.vesting.four-year-one-year-cliff'; // -> enc.mcq.vesting-standard

async function seedWickCastFacts(page: Page): Promise<void> {
  const ids = await installedFactIds(page);
  const now = Date.now();
  const facts: Record<string, { box: number; next_due: number; history: unknown[] }> = {};
  for (const id of ids) facts[id] = { box: 1, next_due: now - 5_000, history: [] };
  facts[WICK_CAST_FACT_A] = { box: 1, next_due: now - 999_999_999, history: [] };
  facts[WICK_CAST_FACT_B] = { box: 1, next_due: now - 999_999_998, history: [] };
  const res = await page.request.put('/api/state/srs.json', { data: { version: 1, facts } });
  expect(res.ok(), 'seeded the two known-distinct-encounter facts').toBe(true);
}

/**
 * Fix round 2 addendum — the fixture's own load-bearing premise, proven structurally rather
 * than assumed from an external probe run once during authoring (the W8 headroom-assertion
 * precedent, miras-stall.spec.ts's buildLayout check: "an 'assert exact outcome' pin alone
 * would NOT catch a regression against this precondition — asserting the precondition is what
 * actually makes the pin self-defending"). Calls the REAL, pure engine.pick() — the exact
 * function CombatScene's own previewPick wraps for its wouldBe===result.encounterId safety
 * net — so this can never silently drift out of sync with how the app itself resolves a
 * redraw. If a future pack edit ever collapsed these two facts back onto one encounter, THIS
 * assertion fails here, loudly and first — never masquerading as a wiring failure three steps
 * later at a bannerText() mismatch.
 *
 * Task 10 (the wave sweep) addendum — the fragility spelled out in numbers, independently
 * re-counted against the live pack rather than taken on trust from an earlier report:
 * packs/vc-law/pack.json carries 42 facts total; exactly 7 are prerequisite-free; of those 7,
 * exactly 2 resolve to ANY mcq encounter at all — WICK_CAST_FACT_A
 * ('vc.econ.valuation.pre-vs-post-money' -> 'enc.mcq.pre-post-money') and WICK_CAST_FACT_B
 * ('vc.econ.vesting.four-year-one-year-cliff' -> 'enc.mcq.vesting-standard'). The other 5
 * prerequisite-free facts resolve to non-mcq encounters or none at all. So this named pair
 * isn't merely today's convenient choice — it is the pack's ONLY possible prerequisite-free,
 * distinct-mcq pair, which is exactly why this assertion (not a comment, not a one-off probe)
 * has to be the thing that catches a future pack edit that closes the gap.
 */
async function assertWickCastFactsResolveToDistinctEncounters(page: Page): Promise<void> {
  const res = await page.request.get('/api/packs');
  expect(res.ok(), 'read installed packs').toBe(true);
  const { packs: entries } = (await res.json()) as { packs: Array<{ pack: Pack }> };
  const packs = entries.map((e) => e.pack);
  const home = packs.find((p) => p.facts.some((f) => f.id === WICK_CAST_FACT_A));
  expect(home, 'the pack installing the two seeded facts is present').toBeTruthy();

  const resolve = (factId: string) =>
    pick({ context: 'combat', kinds: ['mcq'], factIds: [factId], packId: home!.meta.id }, packs);
  const encA = resolve(WICK_CAST_FACT_A);
  const encB = resolve(WICK_CAST_FACT_B);
  expect(encA, 'fact A resolves to a real mcq encounter').not.toBeNull();
  expect(encB, 'fact B resolves to a real mcq encounter').not.toBeNull();
  expect(
    encA!.id,
    'the two seeded facts resolve to GENUINELY DISTINCT encounters — checked the same way ' +
      'the app itself resolves a redraw, not merely assumed from a one-off probe',
  ).not.toBe(encB!.id);
}

/** Enter room.threshold via the real vaults map and ride the teaching cards to combat launch —
 *  lantern-light.spec.ts's own "combat cast" drive, cloned verbatim (own-file convention). A
 *  REAL packId is required here, not the packless dev fixture: that file's own file-level note
 *  explains why — the packless pool's due queue never has more than one fact per kind, so
 *  planRedraw's exclusion always empties the pool (fate holds, no genuine spend), which is
 *  exactly the false-negative this test hit on its first pass before this drive replaced it. */
async function enterThresholdCombat(page: Page, rank: 1 | 2): Promise<void> {
  await page.goto(`/?scene=vaults&seed=7&rank=${rank}`);
  await waitReady(page, 'vaults');

  await canvasClick(page, 225, 300); // green current-room node (room.threshold, this seed's map)
  await page.waitForTimeout(500);
  await canvasClick(page, 478, 365); // dismiss the blurb ("Descend")
  await expect(page.locator('.fw-doc'), 'discovered-documents teaching shown').toBeVisible({ timeout: 8000 });

  const tbtn = page.locator('.fw-footer .fw-btn-primary');
  for (let i = 0; i < 8; i++) {
    const label = await tbtn.innerText();
    await tbtn.click();
    if (label.includes('Close')) break;
    await page.waitForTimeout(140);
  }

  await page.waitForFunction(() => (window as Window).__FABLEWOOD_STATE?.scene === 'combat', undefined, {
    timeout: 15_000,
  });
}

test('CombatScene T1 cast site: the catch banner is the exact verbatim string (F2)', async ({ page }) => {
  test.setTimeout(90_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');
  const beforeSrs = await readState<{ version: number; facts: Record<string, unknown> }>(page, 'srs.json');

  try {
    // fixture: no dungeon progress (room.threshold reads as "first uncleared") — same shape as
    // lantern-light.spec.ts's own combat-cast fixture, Wick borne instead of just lanternLight.
    await page.request.put('/api/state/save.json', {
      data: { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '', lanternLight: true },
    });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 20, stacks: { [WICK_ID]: 1 }, bornRelicId: WICK_ID },
    });
    await seedWickCastFacts(page); // seed BEFORE goto — the due queue must see it from boot
    await assertWickCastFactsResolveToDistinctEncounters(page); // the fixture's own premise, proven

    await enterThresholdCombat(page, 1);

    const opened = await waitForKeeperTurn(page);
    expect(opened?.state, "the Keeper's turn opened for manual control").toBe('playerMove');

    const [keeperTile, targetTile] = await findAdjacentFloorPair(page);
    await debugSetPos(page, 'keeper', keeperTile.c, keeperTile.r);
    await debugSetPos(page, 'wisp-0', targetTile.c, targetTile.r);

    await page.keyboard.press('2'); // Smite (T1 Kindling, mcq)
    await page.waitForTimeout(150);
    expect((await combatSnap(page))?.state, 'Rank 1 goes straight to targeting').toBe('playerTarget');
    await canvasClick(page, 192 + targetTile.c * 48 + 24, 48 + targetTile.r * 48 + 24); // wisp-0's tile

    await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms arm guard
    await expect(page.locator('.fw-lantern-btn'), 'lanternLight:true shows the raise affordance').toBeVisible();
    const firstPrompt = (await page.locator('.fw-prompt').textContent())?.trim();

    await page.locator('.fw-lantern-btn').click();
    await expect.poll(() => page.locator('.fw-lantern-btn').count(), { timeout: 15_000 }).toBe(0);
    await expect(page.locator('.fw-overlay')).toBeVisible();
    await page.waitForTimeout(450); // the re-presented overlay's OWN 400ms arm guard

    // A real vc-law pack's due queue (COMBAT_DRAW_COUNT=20 candidates) guarantees planRedraw
    // finds an alternative, so this proves a GENUINE redraw happened — not the false-holds case
    // the earlier, packless version of this test silently fell into.
    const secondPrompt = (await page.locator('.fw-prompt').textContent())?.trim();
    expect(secondPrompt, 'a genuine redraw surfaced a different memory').not.toBe(firstPrompt);

    expect(await bannerText(page), 'the T1 cast site shows the catch, verbatim, replacing the flare banner').toBe(
      WICK_CATCH_LINE,
    );

    // resolve cleanly so the run doesn't strand.
    await page.locator('.fw-opt').first().click();
    const onward = page.getByRole('button', { name: 'Onward ▸' });
    try { await onward.waitFor({ state: 'visible', timeout: 1500 }); await onward.click(); } catch { /* auto-resolves */ }
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
    await page.request.put('/api/state/srs.json', { data: beforeSrs ?? { version: 1, facts: {} } });
  }
});

test('CombatScene T2/T3 cast site: the catch banner is the exact verbatim string (F2)', async ({ page }) => {
  test.setTimeout(90_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');
  const beforeSrs = await readState<{ version: number; facts: Record<string, unknown> }>(page, 'srs.json');

  try {
    await page.request.put('/api/state/save.json', {
      data: { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '', lanternLight: true },
    });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 20, stacks: { [WICK_ID]: 1 }, bornRelicId: WICK_ID },
    });
    await seedWickCastFacts(page); // seed BEFORE goto — the due queue must see it from boot
    await assertWickCastFactsResolveToDistinctEncounters(page); // the fixture's own premise, proven

    await enterThresholdCombat(page, 2);

    const opened = await waitForKeeperTurn(page);
    expect(opened?.state, "the Keeper's turn opened").toBe('playerMove');

    const [keeperTile, targetTile] = await findAdjacentFloorPair(page);
    await debugSetPos(page, 'keeper', keeperTile.c, keeperTile.r);
    await debugSetPos(page, 'wisp-0', targetTile.c, targetTile.r);
    await debugSetGlow(page, 1); // Cinder-Rebuke (tier 2) costs 1 pip

    await page.keyboard.press('2'); // open the Kindling flyout
    await page.waitForTimeout(150);
    expect((await combatSnap(page))?.state, 'Rank 2 opens the tier flyout').toBe('playerTier');
    await page.keyboard.press('2'); // pick tier 2 — Cinder-Rebuke, castGatedSpell's own site
    await page.waitForTimeout(150);
    expect((await combatSnap(page))?.state, 'picking an enabled tier enters targeting').toBe('playerTarget');
    await canvasClick(page, 192 + targetTile.c * 48 + 24, 48 + targetTile.r * 48 + 24); // wisp-0's tile

    await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(450);
    await expect(page.locator('.fw-lantern-btn'), 'lanternLight:true shows the raise affordance').toBeVisible();
    const firstPrompt = (await page.locator('.fw-prompt').textContent())?.trim();

    await page.locator('.fw-lantern-btn').click();
    await expect.poll(() => page.locator('.fw-lantern-btn').count(), { timeout: 15_000 }).toBe(0);
    await expect(page.locator('.fw-overlay')).toBeVisible();
    await page.waitForTimeout(450);

    const secondPrompt = (await page.locator('.fw-prompt').textContent())?.trim();
    expect(secondPrompt, 'a genuine redraw surfaced a different memory').not.toBe(firstPrompt);

    expect(await bannerText(page), 'the T2/T3 cast site (castGatedSpell) shows the catch, verbatim').toBe(
      WICK_CATCH_LINE,
    );

    await page.locator('.fw-opt').first().click();
    const onward = page.getByRole('button', { name: 'Onward ▸' });
    try { await onward.waitFor({ state: 'visible', timeout: 1500 }); await onward.click(); } catch { /* auto-resolves */ }
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
    await page.request.put('/api/state/srs.json', { data: beforeSrs ?? { version: 1, facts: {} } });
  }
});

test('HamletScene Wellspring site: the catch notice is the exact verbatim string, riding the FATE_HOLDS_LINE channel (F2)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/save.json', {
      data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '', lanternLight: true },
    });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 20, stacks: { [WICK_ID]: 1 }, bornRelicId: WICK_ID },
    });

    await page.goto('/?scene=hamlet&seed=7');
    await waitReady(page, 'hamlet');
    await waitHamletPlayer(page);
    await waitProvincesLoaded(page); // else doWellspring() takes the no-pack branch

    const warped = await warpHamletTo(page, 'wellspring');
    expect(warped, 'dev warp hook parked the Keeper at the Wellspring').toBe(true);
    await tapKey(page, 'e'); // open the Wellspring intro
    await page.waitForTimeout(220);
    for (let k = 0; k < 12; k++) {
      if (await page.locator('.fw-overlay').count()) break;
      await tapKey(page, 'e');
      await page.waitForTimeout(300);
    }
    await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(450);

    await expect(page.locator('.fw-lantern-btn'), 'lanternLight:true shows the raise affordance').toBeVisible();
    await page.locator('.fw-lantern-btn').click();

    await expect.poll(() => page.locator('.fw-lantern-btn').count(), { timeout: 15_000 }).toBe(0);
    await expect(page.locator('.fw-overlay')).toBeVisible();
    await page.waitForTimeout(450);

    await expect(
      page.locator('.fw-notice'),
      'the Wellspring re-present shows the catch notice, verbatim, riding the SAME channel FATE_HOLDS_LINE uses',
    ).toHaveText(WICK_CATCH_LINE);
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
  }
});

// Death's Door fixture (cloned from lantern-light.spec.ts's own "Death's Door" test — trimmed
// to what F2 needs: reaching the notice, not proving which memory redrew, so no factId-diff
// assertion here).
const WICK_DOOR_FACTS: ReadonlyArray<{ factId: string }> = [
  { factId: 'vc.econ.liqpref.preference-plus-participation' },
  { factId: 'vc.econ.paytoplay.ubiquitous-after-dotcom' },
];

async function seedWickDoorFacts(page: Page): Promise<void> {
  const now = Date.now();
  const facts: Record<string, { box: number; next_due: number; history: unknown[] }> = {};
  WICK_DOOR_FACTS.forEach(({ factId }, i) => {
    facts[factId] = { box: 1, next_due: now - (500_000 - i * 100_000), history: [] };
  });
  const res = await page.request.put('/api/state/srs.json', { data: { version: 1, facts } });
  expect(res.ok(), 'seeded the two known door facts').toBe(true);
}

async function driveToWickDoor(page: Page, timeoutMs = 75_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await currentScene(page)) !== 'combat') return;
    const s = await combatSnap(page);
    if (!s || s.state === 'over' || s.state === 'deathsdoor') return;
    if (s.state === 'playerMove') await page.keyboard.press('7'); // Wait
    await page.waitForTimeout(150);
  }
}

test("CombatScene Death's Door site: the catch notice is the exact verbatim string (F2)", async ({ page }) => {
  test.setTimeout(120_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');
  const beforeSrs = await readState<{ version: number; facts: Record<string, unknown> }>(page, 'srs.json');

  try {
    await page.request.put('/api/state/save.json', {
      data: {
        scene: 'hamlet', hp: 2, streak: 0, lastPlayed: '',
        dungeon: { roomIndex: 0, cleared: [] }, lanternLight: true,
      },
    });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 20, stacks: { [WICK_ID]: 1 }, bornRelicId: WICK_ID },
    });
    await seedWickDoorFacts(page);

    await page.goto('/?scene=vaults&dev=1&sim=0&auto=win&seed=7');
    await waitReady(page, 'combat');

    await driveToWickDoor(page);

    const doorCard = page.locator('.fw-overlay', { hasText: /Ledger Holds Your Line/ });
    await doorCard.waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(450);

    await expect(page.locator('.fw-lantern-btn'), 'lanternLight:true shows the raise affordance').toBeVisible();
    await page.locator('.fw-lantern-btn').click();

    await expect.poll(() => page.locator('.fw-lantern-btn').count(), { timeout: 15_000 }).toBe(0);
    await expect(page.locator('.fw-overlay')).toBeVisible();
    await page.waitForTimeout(450);

    await expect(
      page.locator('.fw-notice'),
      "the Death's Door re-draw shows the catch notice, verbatim, riding the SAME channel FATE_HOLDS_LINE uses",
    ).toHaveText(WICK_CATCH_LINE);
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
    await page.request.put('/api/state/srs.json', { data: beforeSrs ?? { version: 1, facts: {} } });
  }
});

// ---------------------------------------------------------------------------------------
// Task 5 — the two spawn passives: the Waymark Heel (+1 party move base) and the Margin Lamp
// (enemies begin combat already written). Both land at ONE seam, CombatScene.spawnUnits — the
// budget/move-field/rise-toll/stance math (turnBudget.ts/status.ts, unmodified) and the
// Unwritten lifecycle (status.ts/CombatScene's damage-seam clear, unmodified) already read
// unit.move/unit.statuses fresh, so nothing downstream needed to learn either relic exists.
//
// These launch bare `?scene=combat` (bestiary.spec.ts's own standalone-combat idiom — this file's
// header notes CombatScene is "testable standalone" precisely for this), which — unlike the
// dungeon/hamlet flow — never warms services.inventory before spawnUnits() reads bornRelic()
// synchronously. spawnUnits() calls applyBornRelicSpawnState() (idempotent) once at spawn AND
// loadContent() calls it again once services.inventory.ready() has genuinely resolved, so the
// standalone harness (this suite) and real play (already-warm store) both land correct.
//
// Own-file local debug helpers, richer than combatSnap()/CombatSnap above (T3's minimal
// {state}-only shape, still used by every earlier test in this file) — same "own-file local
// copy" convention bestiary.spec.ts/measured-turn.spec.ts each follow for their own combat debug
// surface, ported here rather than risking a shared-type edit against 12 already-green tests.
// ---------------------------------------------------------------------------------------

const HEEL_ID = 'waymark-heel';
const LAMP_ID = 'margin-lamp';

type Budget = { total: number; left: number; legSpent: boolean; actionSpent: boolean; pressedOn: boolean };
type BudgetSnap = { state: string; activeId: string; budget: Budget } | null;

async function budgetSnap(page: Page): Promise<BudgetSnap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as BudgetSnap;
  });
}

/** Presses End Turn for whichever party unit is up but isn't `id`, and otherwise just waits
 *  (enemy turns play themselves) — until it's `id`'s own turn. Generalizes this file's own
 *  waitForKeeperTurn (state-only) / bestiary.spec.ts's passUntilKeeper (Keeper-only) to either
 *  party unit, since the Heel scenario below needs to prove the bonus on BOTH. */
async function passUntilPartyTurn(page: Page, id: 'keeper' | 'mira', timeout = 30_000): Promise<NonNullable<BudgetSnap>> {
  const start = Date.now();
  let last: BudgetSnap = null;
  while (Date.now() - start < timeout) {
    last = await budgetSnap(page);
    if (last && last.state === 'playerMove') {
      if (last.activeId === id) return last;
      if (last.activeId === 'keeper' || last.activeId === 'mira') await page.keyboard.press('7'); // End Turn
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`relics T5: timed out waiting for ${id}'s turn; last snapshot=${JSON.stringify(last)}`);
}

/** The party panel's rendered raw text (CombatScene.hudPartyText, wrapping CombatHud's own
 *  partyPanelText — measured-turn.spec.ts's own idiom for reading the "Move N/M" readout). */
async function partyPanelText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { hudPartyText?(): string } | undefined;
    return s?.hudPartyText?.() ?? '';
  });
}

/** Full e2e read of a unit's live statuses (CombatScene.unitDebug — bestiary.spec.ts's own idiom;
 *  needed here to prove the Lurker's spawn statuses directly, without fighting canvas chip
 *  pixels: drawStatusChips renders straight off this same array, so it's the ground truth). */
async function unitState(
  page: Page,
  id: string,
): Promise<{ hp: number; statuses: Array<{ id: string; turnsLeft: number; magnitude: number }> } | null> {
  return page.evaluate((uid) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as
      | { unitDebug?(id: string): { hp: number; statuses: Array<{ id: string; turnsLeft: number; magnitude: number }> } | null }
      | undefined;
    return s?.unitDebug?.(uid) ?? null;
  }, id);
}

/** Valid target ids for `action` from the ACTIVE unit (CombatScene.validTargetsDebug —
 *  bestiary.spec.ts's own idiom for observing Strike's Unwritten exclusion without menu-click
 *  geometry). */
async function validTargets(page: Page, action: string): Promise<string[]> {
  return page.evaluate((a) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { validTargetsDebug?(action: string): string[] } | undefined;
    return s?.validTargetsDebug?.(a) ?? [];
  }, action);
}

/** Apply a status directly (CombatScene.debugApplyStatus — bestiary.spec.ts's own idiom); used
 *  below to prove the Unwritten lifecycle is untouched by the Lamp — only its spawn-time GRANT
 *  is gated, never the general apply/exclude machinery. */
async function debugApplyStatus(page: Page, id: string, statusId: string, turns = 1, magnitude = 1): Promise<void> {
  await page.evaluate(
    ({ id, statusId, turns, magnitude }) => {
      const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
      const s = g?.scene?.getScene?.('combat') as
        | { debugApplyStatus?(id: string, statusId: string, turns: number, magnitude?: number): void }
        | undefined;
      s?.debugApplyStatus?.(id, statusId, turns, magnitude);
    },
    { id, statusId, turns, magnitude },
  );
}

async function restoreInventoryOnly(page: Page, inv: LootInventory | null): Promise<void> {
  await page.request.put('/api/state/inventory.json', { data: inv ?? { version: 1, gold: 0, stacks: {} } });
}

test("the Waymark Heel borne: every party unit's Move N/M HUD readout shows base+1 at combat start (Ch. IX)", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 0, stacks: { [HEEL_ID]: 1 }, bornRelicId: HEEL_ID },
    });

    await page.goto('/?scene=combat&seed=7');
    await waitReady(page, 'combat');

    const keeperTurn = await passUntilPartyTurn(page, 'keeper');
    expect(keeperTurn.budget.total, "the Keeper's fresh budget: base 4 +1 Heel = 5").toBe(5);
    expect(keeperTurn.budget.left).toBe(5);
    expect(await partyPanelText(page), 'the rendered HUD readout shows the Heel\'d total, not the plain base').toContain('Move 5/5');

    await page.keyboard.press('7'); // End the Keeper's turn 1.
    const miraTurn = await passUntilPartyTurn(page, 'mira');
    expect(miraTurn.budget.total, "the Heel reads 'every party unit', not just the Keeper — Mira's own base 4 +1 = 5").toBe(5);
    expect(miraTurn.budget.left).toBe(5);
  } finally {
    await restoreInventoryOnly(page, beforeInv);
  }
});

test('without the Waymark Heel borne: Move N/M reads the plain base — regression', async ({ page }) => {
  test.setTimeout(60_000);
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/inventory.json', { data: { version: 1, gold: 0, stacks: {} } });

    await page.goto('/?scene=combat&seed=7');
    await waitReady(page, 'combat');

    const keeperTurn = await passUntilPartyTurn(page, 'keeper');
    expect(keeperTurn.budget.total, 'no relic borne: the Keeper\'s plain base').toBe(4);
    expect(await partyPanelText(page)).toContain('Move 4/4');
  } finally {
    await restoreInventoryOnly(page, beforeInv);
  }
});

// Task 10 (the wave sweep) — the chapter's own wording for the Heel is emphatic that it is "a
// base change, not a lane: the budget, the move field, the rise toll, AND BOTH STANCES all see
// it." The borne test above only ever reads the fresh-turn budget (the move field/budget seam);
// neither stance's OWN separate base-read (turnBudget.ts's header: "Careful Step's halving in
// ai.ts, Press On's bonus calc in CombatScene.ts — separate call sites") had ever been exercised
// against a Heel-boosted base before this. This is the same bug SHAPE the W8 sweep caught for
// Toppled's rise toll ("only Press On's separate read had ever been exercised on a rising turn
// before this") — a second base-reading site silently missing the modifier everyone assumes it
// shares. Press On, not Careful Step, is the discriminating choice: at this fixture's base move
// (4), Careful Step's floor(base/2) gives floor(4/2)=2 and floor(5/2)=2 — the SAME number either
// way, so a Careful-Step-only pin could not tell "composes correctly" from "silently ignores the
// Heel." Press On's additive bonus (total + effectiveMove) has no such collision: 4+4=8 vs
// 5+5=10, unambiguous.
test('the Waymark Heel borne: Press On grants the boosted base twice over, not a stale plain base (Ch. IX × Ch. VI)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 0, stacks: { [HEEL_ID]: 1 }, bornRelicId: HEEL_ID },
    });

    await page.goto('/?scene=combat&seed=7');
    await waitReady(page, 'combat');

    const keeperTurn = await passUntilPartyTurn(page, 'keeper');
    expect(keeperTurn.budget.total, 'sanity: fresh budget is base 4 +1 Heel = 5, same as the borne test above').toBe(5);

    await page.keyboard.press('8'); // Press On — forgo the action, add effectiveMove to the budget again
    await expect
      .poll(async () => (await budgetSnap(page))?.budget.pressedOn, { timeout: 10_000, message: 'Press On to fire' })
      .toBe(true);

    const pressed = await budgetSnap(page);
    expect(
      pressed?.budget.total,
      "Press On re-reads the Heel-boosted base (5), not a stale plain 4 — grants 5+5=10, not the un-Heel'd 4+4=8",
    ).toBe(10);
    expect(pressed?.budget.left, 'left matches the doubled total — the bonus extends, never just refills').toBe(10);
    expect(pressed?.budget.actionSpent, 'Press On still spends the action, Heel or no Heel').toBe(true);
  } finally {
    await restoreInventoryOnly(page, beforeInv);
  }
});

test('the Margin Lamp borne: the Lurker begins combat already written, is immediately Strike-targetable, and the Unwritten lifecycle still works normally afterward (Ch. IX)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 0, stacks: { [LAMP_ID]: 1 }, bornRelicId: LAMP_ID },
    });

    await page.goto('/?scene=combat&seed=7&enemies=lurker');
    await waitReady(page, 'combat');
    await passUntilPartyTurn(page, 'keeper');

    // The spawn grant never landed.
    const atSpawn = await unitState(page, 'lurker-0');
    expect(atSpawn?.statuses.some((s) => s.id === 'unwritten'), 'the Lamp: no Unwritten at spawn').toBe(false);

    // Immediately Strike-targetable — no waiting for it to act or take damage first.
    await debugSetPos(page, 'lurker-0', 6, 1);
    await debugSetPos(page, 'keeper', 5, 1);
    const targets = await validTargets(page, 'strike');
    expect(targets, 'Strike-targetable from the very first turn, with no reveal trigger needed').toContain('lurker-0');

    // The reveal-on-act/damage LIFECYCLE is untouched: the Lamp only ever gated the spawn grant.
    // A status applied through the normal machinery still behaves exactly as it always has,
    // Lamp or no Lamp — proving this isn't a blanket disable of Unwritten while the Lamp is held.
    await debugApplyStatus(page, 'lurker-0', 'unwritten', 1, 1);
    const reapplied = await unitState(page, 'lurker-0');
    expect(reapplied?.statuses.some((s) => s.id === 'unwritten'), 'the general apply machinery is untouched').toBe(true);
    const targetsAfter = await validTargets(page, 'strike');
    expect(targetsAfter, 'and Strike\'s own exclusion still honors it, same as ever').not.toContain('lurker-0');
  } finally {
    await restoreInventoryOnly(page, beforeInv);
  }
});

test('without the Margin Lamp borne: the Lurker still begins combat Unwritten — regression', async ({ page }) => {
  test.setTimeout(60_000);
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/inventory.json', { data: { version: 1, gold: 0, stacks: {} } });

    await page.goto('/?scene=combat&seed=7&enemies=lurker');
    await waitReady(page, 'combat');
    await passUntilPartyTurn(page, 'keeper');

    const atSpawn = await unitState(page, 'lurker-0');
    expect(atSpawn?.statuses.some((s) => s.id === 'unwritten'), 'no relic borne: the shipped Ch. VIII spawn grant stands').toBe(true);

    await debugSetPos(page, 'lurker-0', 6, 1);
    await debugSetPos(page, 'keeper', 5, 1);
    const targets = await validTargets(page, 'strike');
    expect(targets, 'still excluded from Strike until it acts or takes damage').not.toContain('lurker-0');
  } finally {
    await restoreInventoryOnly(page, beforeInv);
  }
});

// ---------------------------------------------------------------------------------------
// Task 6 — the Unbroken Clasp: once per battle, party-side only, the first blow that would
// take a party unit to 0 leaves it at 1 HP instead, caught at the damage seam BEFORE
// checkEnd()/enterDeathsDoor() ever sees the fall.
//
// Rig: `save.json {hp: 2}` seeds the pooled HP that `splitPooledHp` (CombatScene.ts:198-203)
// hands to the party at spawn — pool=2 puts the Keeper at 2 and Mira at 0 (the SAME math
// deaths-door.spec.ts's own rig relies on), so Mira starts already fallen and the Keeper is
// the party's sole living member: every felling blow is unambiguous, and a SECOND one (once
// the Clasp's catch is spent) opens the Door outright, with nothing else to keep the party up.
//
// Damage comes from a single `warden` trash mob (`?enemies=warden`) — ENEMY_STATS.warden:
// attack 2, melee, and (unlike `construct`/`husk`) NOT in enemyStrike's push-branch gate
// (CombatScene.ts:3251's `kind === 'construct' || kind === 'husk' || isBoss`), so its hit is a
// flat, unmodified 2 with no push/bump/topple to complicate the arithmetic. Positioned
// adjacent to the Keeper via debugSetPos before its first turn: decideEnemy's "already in
// range from where we stand" branch (ai.ts) then attacks immediately, no approach needed.
// Keeper pool=2 means the warden's flat 2 exactly matches "would take a party unit to 0" on
// the first hit, and again (from 1 hp) on the second.
//
// The Clasp's own banner is deliberately delayed inside damageUnit (see its comment) to land
// after enemyStrike's own synchronous closing banner — showBanner is replace-not-stack, so an
// undelayed call would be overwritten in the same tick and never actually be visible. Polled
// with expect.poll below rather than read at a single instant, since it is itself transient
// (superseded again once the next turn's own opening banner fires) — polling catches its
// window regardless of exact engine timing, rather than betting the test on it.
// ---------------------------------------------------------------------------------------

const CLASP_ID = 'unbroken-clasp';

/** Own-file local copy (T5's own "richer than the last" convention) — needs `alive`, which
 *  the T5-era `unitState` above (hp + statuses only) doesn't carry. */
async function claspUnitState(page: Page, id: string): Promise<{ hp: number; alive: boolean } | null> {
  return page.evaluate((uid) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as
      | { unitDebug?(id: string): { hp: number; alive: boolean } | null }
      | undefined;
    return s?.unitDebug?.(uid) ?? null;
  }, id);
}

test('the Unbroken Clasp borne: the first felling blow leaves the Keeper at 1 HP and banners exactly; the Door opens only on the second (Ch. IX)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/save.json', { data: { hp: 2 } });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 0, stacks: { [CLASP_ID]: 1 }, bornRelicId: CLASP_ID },
    });

    await page.goto('/?scene=combat&seed=7&enemies=warden');
    await waitReady(page, 'combat');

    await passUntilPartyTurn(page, 'keeper');
    await debugSetPos(page, 'keeper', 5, 1);
    await debugSetPos(page, 'warden-0', 6, 1);

    const beforeFirst = await claspUnitState(page, 'keeper');
    expect(beforeFirst?.hp, 'sanity: the seeded pool puts the Keeper at exactly 2 hp — the warden\'s flat 2 would fell').toBe(2);
    expect(beforeFirst?.alive).toBe(true);

    await page.keyboard.press('7'); // End the Keeper's turn 1 — the adjacent warden strikes.

    await expect
      .poll(async () => (await claspUnitState(page, 'keeper'))?.hp, {
        timeout: 20_000,
        message: 'the Clasp catches the felling blow: 2 -> 1, not 2 -> 0',
      })
      .toBe(1);
    const afterFirst = await claspUnitState(page, 'keeper');
    expect(afterFirst?.alive, 'still standing — the catch happened before the death branch, not after it').toBe(true);

    await expect
      .poll(() => bannerText(page), { timeout: 5_000, intervals: [50] })
      .toBe('The Clasp holds.'); // ruled copy, verbatim

    expect((await combatSnap(page))?.state, 'the door never opened — the catch fires before its trigger').not.toBe('deathsdoor');

    // Round 2 genuinely opens under manual control (not hijacked by the Door), and the catch's
    // effect persisted rather than reverting once the banner's own window closed.
    await passUntilPartyTurn(page, 'keeper');
    const beforeSecond = await claspUnitState(page, 'keeper');
    expect(beforeSecond?.hp, 'still at 1 going into round 2').toBe(1);

    await page.keyboard.press('7'); // End turn 2 — the SAME warden's second flat-2 blow.

    await expect
      .poll(async () => (await combatSnap(page))?.state, {
        timeout: 20_000,
        message: 'the battle\'s SECOND felling blow lands true — once per battle, not once per unit',
      })
      .toBe('deathsdoor');

    const afterSecond = await claspUnitState(page, 'keeper');
    expect(afterSecond?.alive, 'this time the fall was real').toBe(false);
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
  }
});

test('without the Unbroken Clasp borne: the first felling blow opens the Door directly — regression (Ch. IX)', async ({ page }) => {
  test.setTimeout(60_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/save.json', { data: { hp: 2 } });
    await page.request.put('/api/state/inventory.json', { data: { version: 1, gold: 0, stacks: {}, bornRelicId: null } });

    await page.goto('/?scene=combat&seed=7&enemies=warden');
    await waitReady(page, 'combat');

    await passUntilPartyTurn(page, 'keeper');
    await debugSetPos(page, 'keeper', 5, 1);
    await debugSetPos(page, 'warden-0', 6, 1);

    const before = await claspUnitState(page, 'keeper');
    expect(before?.hp, 'sanity: same rig as the borne test — the warden\'s flat 2 would fell').toBe(2);

    await page.keyboard.press('7'); // End the Keeper's only turn — no relic to catch what follows.

    await expect
      .poll(async () => (await combatSnap(page))?.state, {
        timeout: 20_000,
        message: 'no Clasp borne: the FIRST felling blow opens the Door directly',
      })
      .toBe('deathsdoor');

    const after = await claspUnitState(page, 'keeper');
    expect(after?.hp, 'the fall was real — no catch').toBe(0);
    expect(after?.alive).toBe(false);
    expect(await bannerText(page), 'never the Clasp\'s line — nothing was borne to catch it').not.toBe('The Clasp holds.');
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
  }
});

// ---- Task 7: THE SEALED PAGE OF THE GEYSER (Ch. IX) ---------------------------------------
//
// The wave's one item-driven TARGETED flow, and the only Satchel item that does not resolve the
// instant it is picked: Satchel → "Use" → a target-selection mode over enemies within reach 3 →
// click a foe → the push resolves and the page crumbles. It is Shove written down, so it inherits
// Shove's own targeting idiom (validTargets → enterTargeting → runPlayerAction, reusing
// pendingAction/targetTiles rather than a second input system) and Ch. VI's action gate. What it
// does NOT inherit is Shove's no-damage purity — an item's push is an item's blow, so it goes
// through pushUnit with the bump ENABLED, and a blocked page-push bumps for 1 where a blocked
// Shove bumps for nothing.
//
// REACH, as the chapter now states it: "reach 3 down a straight, clear line — row or column,
// walls and mist stand between; the wraith's own reach law (hasLineOfFire)". Not a manhattan
// disk, and the distinction is load-bearing rather than cosmetic: a push needs a Dir,
// CombatScene.dirTo is 4-way and returns null off the orthogonals, so a disk would admit
// diagonals the engine has no "away" direction for. Ritual Sequence — the other directional
// player action at range 3 — already targets through this exact predicate. Pinned at the pure
// level too (combat.test.ts, "the Sealed Page reaches three tiles along a clear row/column"),
// which is also where the walls-and-mist half of the law is pinned directly on hasLineOfFire;
// the straight-line half gets its live pin below ("a diagonal foe cannot be paged at all").
//
// GEOMETRY: every scenario below plays on ROW 1, which is fully floor across cols 1-10 at
// seed=7, with col 0 the west wall border (bestiary.spec.ts's own fixture dump, reused rather
// than re-derived). Landed pushes run rightward into open floor; the blocked push runs leftward
// into that wall. Each test takes a fresh combat launch and reads exactly one Page inside the
// Keeper's own turn 1, so no enemy AI turn, no rise, and no cross-turn status decay can
// contaminate a reading — Toppled and Unwritten both sit in status.ts's NO_TURN_END_DECAY set,
// which makes a two-uses-across-two-turns test measurably less deterministic than two tests.
// -------------------------------------------------------------------------------------------

const PAGE_ID = 'sealed-page-geyser';
const PAGE_NAME = 'Sealed Page of the Geyser';
/** Ruled copy (Ch. IX), verbatim — the banner the reading itself shows. */
const PAGE_LINE = 'The page speaks water, once.';

/**
 * Long enough to clear dom.ts's GHOST-REOPEN GUARD (`REOPEN_SETTLE_MS = 150`, per-pane-scoped):
 * any openPane() for the same pane id within that window of its last close is appended and
 * self-closed before the browser paints, so a reopen inside it never becomes visible. That guard
 * is a deliberate shipped mitigation for a Phaser stale-key-queue bug (see dom.ts's own header),
 * and the Page is simply the FIRST flow that closes and reopens the combat Satchel inside a
 * single turn — cancelling an aim and immediately re-pressing Q is exactly the shape the guard
 * was written for. Doubled for margin rather than imported: dom.ts pulls in ./styles and the
 * encounter overlay, which is more app surface than a Playwright spec should load to read one
 * number. Root-caused live with an instrumented MutationObserver run (a reopen 65ms after the
 * close appeared and vanished in the same millisecond) — not guessed from the timeout.
 */
const PANE_SETTLE_MS = 300;

/** Own-file local copy, richer than budgetSnap above (T5's own "richer than the last"
 *  convention): the Page's assertions need the action LOG as well as the budget. */
type PageSnap = {
  state: string;
  activeId: string;
  budget: Budget;
  log: Array<{ action: string; dmg: number; overlay: boolean }>;
} | null;

async function pageSnap(page: Page): Promise<PageSnap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as PageSnap;
  });
}

/** Own-file local copy — needs position AND hp AND statuses together (T5's unitState carries no
 *  c/r; T6's claspUnitState carries no statuses), since one page-push is asserted on all three. */
async function pageUnit(
  page: Page,
  id: string,
): Promise<{ c: number; r: number; hp: number; alive: boolean; statuses: Array<{ id: string }> } | null> {
  return page.evaluate((uid) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as
      | { unitDebug?(id: string): { c: number; r: number; hp: number; alive: boolean; statuses: Array<{ id: string }> } | null }
      | undefined;
    return s?.unitDebug?.(uid) ?? null;
  }, id);
}

/** How many Pages the store holds ON DISK — the crumble is only real if it survives to state. */
async function pagesOnDisk(page: Page): Promise<number> {
  const inv = await readState<LootInventory>(page, 'inventory.json');
  return inv?.stacks?.[PAGE_ID] ?? 0;
}

const hasStatusId = (u: { statuses: Array<{ id: string }> } | null, id: string): boolean =>
  !!u?.statuses.some((s) => s.id === id);

/** Opens the in-battle Satchel and reads the Page — miras-stall.spec.ts's own armHint idiom
 *  (row.getByRole('button', { name: 'Use' })), which is the canonical "Use" selector for this
 *  pane. Asserts the row is THERE on the way past: the Page reaching the pane at all is
 *  usableSatchelItems' push_blast admission, proven end-to-end rather than by unit test alone. */
async function readPageFromSatchel(page: Page): Promise<void> {
  // tapKey, not page.keyboard.press: the Page is the only flow that opens this pane TWICE in one
  // battle, and an instant press is edge-detect-flaky on the second open (helpers.ts's tapKey
  // exists for exactly this Phaser behaviour). The first open works either way, which is why
  // every earlier single-open spec in this suite gets away with press().
  await tapKey(page, 'q');
  await expect(page.locator('.inv-overlay')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.inv-title')).toHaveText('Satchel');
  const row = page.locator('.inv-row', { hasText: PAGE_NAME });
  await expect(row, 'the Page reaches the combat Satchel — push_blast is admitted').toBeVisible();
  await row.getByRole('button', { name: 'Use' }).click();
  await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });
}

/** Waits out the hand-off from the closing DOM pane into the Page's own target-selection mode.
 *  Unlike every other Satchel item, picking the Page resolves NOTHING yet — it arms targeting. */
async function waitForPageTargeting(page: Page): Promise<void> {
  await expect
    .poll(async () => (await pageSnap(page))?.state, {
      timeout: 10_000,
      intervals: [50],
      message: 'the Page enters target selection instead of resolving on pick',
    })
    .toBe('playerTarget');
}

test('the Sealed Page of the Geyser: read at reach 3, it pushes one tile, crumbles, and spends the action (Ch. IX)', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/save.json', { data: { hp: 16 } });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 0, stacks: { [PAGE_ID]: 1 }, bornRelicId: null },
    });

    await page.goto('/?scene=combat&seed=7');
    await waitReady(page, 'combat');
    await passUntilPartyTurn(page, 'keeper');

    // Exile the two enemies this scenario does not use (bestiary.spec.ts's own "exile" idiom),
    // then lay the reach-3 line out on row 1: Keeper(2,1) → wisp-0(5,1), a clear three-tile
    // channel, with (6,1) open floor for the push to land on.
    await debugSetPos(page, 'wisp-1', 10, 6);
    await debugSetPos(page, 'wraith-2', 10, 1);
    await debugSetPos(page, 'keeper', 2, 1);
    await debugSetPos(page, 'wisp-0', 5, 1);

    const before = await pageUnit(page, 'wisp-0');
    expect(before?.hp, 'sanity: wisp-0 opens at full hp').toBe(2);
    expect(await pagesOnDisk(page), 'sanity: exactly one Page carried in').toBe(1);

    await readPageFromSatchel(page);
    await waitForPageTargeting(page);

    // The targeting banner names the ITEM, not the Satchel button it came from.
    const targetingBanner = await bannerText(page);
    expect(targetingBanner, 'the target-selection banner names the Page').toContain(PAGE_NAME);
    expect(targetingBanner, "and carries the house cancel hint, same as Strike's own").toContain('Esc cancels');
    // Nothing is spent yet — the page is still whole and the action still unspent while the
    // target is being chosen.
    expect(await pagesOnDisk(page), 'the page has NOT crumbled merely by being picked').toBe(1);
    expect((await pageSnap(page))?.budget.actionSpent, 'nor is the action spent before a target commits').toBe(false);

    await tileClick(page, 5, 1); // commit: read the page at wisp-0, three tiles down the row

    // The ruled line lands the instant the reading resolves. Polled rather than read at one
    // instant because the W6 gate's own "Steps remain" banner replaces it ~560ms later — the
    // Clasp test's own reason for polling its transient banner.
    await expect
      .poll(() => bannerText(page), { timeout: 10_000, intervals: [30], message: 'the ruled cast line' })
      .toBe(PAGE_LINE);

    await expect
      .poll(async () => (await pageSnap(page))?.budget.actionSpent, {
        timeout: 15_000,
        message: 'the reading spends the turn\'s one action',
      })
      .toBe(true);
    const after = await pageSnap(page);

    expect(after?.state, 'banked movement survives — the steps-remain shape every gated action shares').toBe('playerMove');
    const last = after?.log[after.log.length - 1];
    expect(last?.action, 'the action log records the reading as a Satchel use').toBe('satchel');
    expect(last?.dmg, 'a LANDED page-push deals no damage of its own').toBe(0);

    const pushed = await pageUnit(page, 'wisp-0');
    expect({ c: pushed?.c, r: pushed?.r }, 'wisp-0 moved exactly one tile further down the row').toEqual({ c: 6, r: 1 });
    expect(pushed?.hp, 'a landed push never bumps — forceMove moved, so the bump branch is never reached').toBe(2);
    expect(hasStatusId(pushed, 'toppled'), 'the wisp is not a toppleable entry, so no knock').toBe(false);

    // The crumble, on disk: single-use means the stack is genuinely gone, not flagged.
    await expect
      .poll(() => pagesOnDisk(page), { timeout: 10_000, message: 'the page crumbles after the reading' })
      .toBe(0);

    // ...and the pane agrees. This has to wait for the Keeper's NEXT turn: Ch. VI greys the
    // Satchel button once the turn's one action is spent, and the reading just spent it — so 'q'
    // is correctly refused for the rest of this turn, which is itself part of the law under test.
    await page.keyboard.press('7'); // End Turn
    await passUntilPartyTurn(page, 'keeper');
    await tapKey(page, 'q');
    await expect(page.locator('.inv-overlay')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.inv-row', { hasText: PAGE_NAME }), 'nothing left to read').toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('relics-sealed-page-spent.png') });
    await page.locator('.inv-close', { hasText: 'Never Mind' }).click({ timeout: 2_000 });
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
  }
});

test('a diagonal foe cannot be paged at all, and refusing costs nothing — the straight-jet law, live (Ch. IX)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/save.json', { data: { hp: 16 } });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 0, stacks: { [PAGE_ID]: 1 }, bornRelicId: null },
    });

    await page.goto('/?scene=combat&seed=7');
    await waitReady(page, 'combat');
    await passUntilPartyTurn(page, 'keeper');

    await debugSetPos(page, 'wisp-1', 10, 6);
    await debugSetPos(page, 'wraith-2', 10, 5);
    // The discriminating case for the whole predicate choice: wisp-0 sits DIAGONALLY adjacent at
    // manhattan 2 — comfortably inside a manhattan-3 disk, and there is no other foe on the
    // Keeper's row or column. Under a disk this would be a legal target the engine has no "away"
    // direction for; under the ratified straight-line law it is simply not a target.
    await debugSetPos(page, 'keeper', 4, 1);
    await debugSetPos(page, 'wisp-0', 5, 2);
    const before = await pageUnit(page, 'wisp-0');

    await tapKey(page, 'q');
    await expect(page.locator('.inv-overlay')).toBeVisible({ timeout: 5_000 });
    await page.locator('.inv-row', { hasText: PAGE_NAME }).getByRole('button', { name: 'Use' }).click();
    await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });

    // Refused before anything is armed, in the house's own refusal vocabulary — never a silent
    // no-op, which is precisely the failure mode a manhattan disk would have shipped.
    await expect
      .poll(() => bannerText(page), { timeout: 10_000, intervals: [50], message: 'the reach refusal' })
      .toBe(`${PAGE_NAME}: no foe within reach.`);

    const refused = await pageSnap(page);
    expect(refused?.state, 'and it hands the turn straight back to the action menu').toBe('playerMove');
    expect(refused?.budget.actionSpent, 'a refused pick costs no action').toBe(false);
    expect(await pagesOnDisk(page), 'and no page was read').toBe(1);
    expect({ c: before?.c, r: before?.r }, 'sanity: the diagonal foe never moved').toEqual({ c: 5, r: 2 });

    // The control: step that SAME foe onto the Keeper's row at reach 3 — strictly FURTHER away in
    // manhattan terms than the diagonal it was just refused at — and the Page reaches it fine.
    // Alignment is the only thing that changed.
    await debugSetPos(page, 'wisp-0', 7, 1);
    await page.waitForTimeout(PANE_SETTLE_MS); // the pane's own reopen guard (see PANE_SETTLE_MS)
    await readPageFromSatchel(page);
    await waitForPageTargeting(page);
    await tileClick(page, 7, 1);

    await expect
      .poll(async () => (await pageSnap(page))?.budget.actionSpent, {
        timeout: 15_000,
        message: 'the same foe, three tiles down a clear row, reads fine',
      })
      .toBe(true);
    expect({ ...(await pageUnit(page, 'wisp-0')) }, 'pushed one tile along the line').toMatchObject({ c: 8, r: 1 });
    await expect.poll(() => pagesOnDisk(page), { timeout: 10_000 }).toBe(0);
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
  }
});

test('a landed page-push knocks a toppleable entry Toppled — the heave-gate mirror, without a scratch on it (Ch. IX)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/save.json', { data: { hp: 16 } });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 0, stacks: { [PAGE_ID]: 1 }, bornRelicId: null },
    });

    await page.goto('/?scene=combat&seed=7&enemies=husk,wisp,wraith');
    await waitReady(page, 'combat');
    await passUntilPartyTurn(page, 'keeper');

    await debugSetPos(page, 'wisp-1', 10, 6);
    await debugSetPos(page, 'wraith-2', 10, 5);
    await debugSetPos(page, 'keeper', 2, 1);
    await debugSetPos(page, 'husk-0', 5, 1); // the one shipped toppleable:true entry

    const before = await pageUnit(page, 'husk-0');
    expect(hasStatusId(before, 'toppled'), 'sanity: the stub starts on its feet').toBe(false);

    await readPageFromSatchel(page);
    await waitForPageTargeting(page);
    await tileClick(page, 5, 1);

    await expect
      .poll(async () => (await pageSnap(page))?.budget.actionSpent, { timeout: 15_000, message: 'the reading resolves' })
      .toBe(true);

    const knocked = await pageUnit(page, 'husk-0');
    expect({ c: knocked?.c, r: knocked?.r }, 'the push landed — one tile down the row').toEqual({ c: 6, r: 1 });
    expect(hasStatusId(knocked, 'toppled'), 'landed && alive && isToppleable — the heave\'s own gate, mirrored').toBe(true);
    // For the Page these two are mutually exclusive by construction: bump damage happens only
    // when the push is BLOCKED, and the knock only when it LANDED. So a knock always arrives
    // clean, and the heave's "knock after damage" ordering is inherited but never exercised.
    expect(knocked?.hp, 'the knock cost it nothing — a landed push deals no damage').toBe(before?.hp);
    await expect.poll(() => pagesOnDisk(page), { timeout: 10_000 }).toBe(0);
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
  }
});

test('a BLOCKED page-push bumps for 1, knocks nothing, and still spends both page and action (Ch. IX)', async ({ page }) => {
  test.setTimeout(90_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/save.json', { data: { hp: 16 } });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 0, stacks: { [PAGE_ID]: 1 }, bornRelicId: null },
    });

    await page.goto('/?scene=combat&seed=7&enemies=husk,wisp,wraith');
    await waitReady(page, 'combat');
    await passUntilPartyTurn(page, 'keeper');

    await debugSetPos(page, 'wisp-1', 10, 6);
    await debugSetPos(page, 'wraith-2', 10, 5);
    // Keeper(4,1) reads westward at husk-0(1,1) — three clear tiles of channel, and (0,1) is the
    // west wall border, so the push has nowhere to put it.
    await debugSetPos(page, 'keeper', 4, 1);
    await debugSetPos(page, 'husk-0', 1, 1);

    const before = await pageUnit(page, 'husk-0');

    await readPageFromSatchel(page);
    await waitForPageTargeting(page);
    await tileClick(page, 1, 1);

    // Same ruled line either way: a read page is a read page, landed or blocked.
    await expect
      .poll(() => bannerText(page), { timeout: 10_000, intervals: [30], message: 'the ruled cast line, blocked case too' })
      .toBe(PAGE_LINE);

    await expect
      .poll(async () => (await pageSnap(page))?.budget.actionSpent, {
        timeout: 15_000,
        message: 'a blocked reading still spends the action — you read the page',
      })
      .toBe(true);
    const after = await pageSnap(page);

    const bumped = await pageUnit(page, 'husk-0');
    expect({ c: bumped?.c, r: bumped?.r }, 'nowhere to go — the west wall held it in place').toEqual({ c: 1, r: 1 });
    expect(bumped?.hp, "the ordinary bump: an item's push is an item's blow (contrast Shove, which suppresses it)")
      .toBe((before?.hp ?? 0) - 1);
    expect(hasStatusId(bumped, 'toppled'), 'no knock without a landed push — even against the toppleable entry').toBe(false);
    expect(bumped?.alive, 'sanity: the stub survives a 1-point bump').toBe(true);

    // pushUnit's own bump entry, then the reading's — the log carries both halves.
    const kinds = (after?.log ?? []).map((l) => l.action);
    expect(kinds[kinds.length - 2], 'the bump logged first, from inside pushUnit').toBe('bump');
    expect(kinds[kinds.length - 1], 'then the reading itself').toBe('satchel');

    await expect
      .poll(() => pagesOnDisk(page), { timeout: 10_000, message: 'a blocked reading crumbles the page all the same' })
      .toBe(0);
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
  }
});

test('backing out of the Page\'s targeting spends nothing — the page is kept and the action stays open (Ch. IX)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/save.json', { data: { hp: 16 } });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 0, stacks: { [PAGE_ID]: 1 }, bornRelicId: null },
    });

    await page.goto('/?scene=combat&seed=7');
    await waitReady(page, 'combat');
    await passUntilPartyTurn(page, 'keeper');

    await debugSetPos(page, 'wisp-1', 10, 6);
    await debugSetPos(page, 'wraith-2', 10, 5);
    await debugSetPos(page, 'keeper', 2, 1);
    await debugSetPos(page, 'wisp-0', 5, 1);
    const before = await pageUnit(page, 'wisp-0');

    await readPageFromSatchel(page);
    await waitForPageTargeting(page);

    // The house cancel path (CombatScene.cancelTargeting, reached by Esc exactly as it is from
    // Strike/Shove's own targeting) — the ONE route out of a picked Page that costs nothing.
    await page.keyboard.press('Escape');

    await expect
      .poll(async () => (await pageSnap(page))?.state, {
        timeout: 10_000,
        intervals: [50],
        message: 'Esc returns to the action menu',
      })
      .toBe('playerMove');
    const backedOut = await pageSnap(page);

    expect(backedOut?.budget.actionSpent, 'backing out spends no action — nothing was committed').toBe(false);
    expect(await pagesOnDisk(page), 'and the page is still whole, on disk').toBe(1);
    const untouched = await pageUnit(page, 'wisp-0');
    expect({ c: untouched?.c, r: untouched?.r }, 'nobody moved').toEqual({ c: 5, r: 1 });
    expect(untouched?.hp, 'nobody was hurt').toBe(before?.hp);

    // The action really is still available: the same page can be read again this very turn, and
    // THAT reading resolves — proving the cancel left no half-armed state behind. The wait is the
    // pane's own reopen guard, not a flake patch (see PANE_SETTLE_MS): this is the one scenario
    // in the suite that reopens the combat Satchel within a single turn.
    await page.waitForTimeout(PANE_SETTLE_MS);
    await readPageFromSatchel(page);
    await waitForPageTargeting(page);
    await tileClick(page, 5, 1);
    await expect
      .poll(async () => (await pageSnap(page))?.budget.actionSpent, {
        timeout: 15_000,
        message: 'the re-read resolves normally after a cancel',
      })
      .toBe(true);
    expect({ ...(await pageUnit(page, 'wisp-0')) }, 'the second reading pushed for real').toMatchObject({ c: 6, r: 1 });
    await expect.poll(() => pagesOnDisk(page), { timeout: 10_000 }).toBe(0);
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
  }
});

test('the Page REACHES the Unwritten, and a CLEAN push leaves it unwritten still (Ch. IX / Ch. VIII composition)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/save.json', { data: { hp: 16 } });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 0, stacks: { [PAGE_ID]: 1 }, bornRelicId: null },
    });

    // A written foe rides along as the CONTROL: without it, "Strike cannot see the Lurker" would
    // pass for the boring reason that Strike is range 1 and nothing was adjacent.
    await page.goto('/?scene=combat&seed=7&enemies=lurker,wisp');
    await waitReady(page, 'combat');
    await passUntilPartyTurn(page, 'keeper');

    await debugSetPos(page, 'keeper', 4, 1);
    await debugSetPos(page, 'lurker-0', 5, 1); // adjacent right
    await debugSetPos(page, 'wisp-1', 3, 1); // adjacent left, and entered in the Ledger
    const before = await pageUnit(page, 'lurker-0');
    expect(hasStatusId(before, 'unwritten'), 'sanity: the Lurker opens Unwritten (Ch. VIII spawn grant)').toBe(true);

    // The contrast that makes the ruling visible: from ONE tile, with both foes adjacent, Strike
    // sees the written wisp and refuses the Unwritten Lurker. The Page is spell-family under Ch.
    // VIII's "spells and area effects reach it fine" — a written thing's answer, not a shoulder —
    // so isStrikeTargetable is deliberately NOT on its reach predicate.
    const strikeable = await validTargets(page, 'strike');
    expect(strikeable, 'control: Strike genuinely reaches an adjacent written foe from here').toContain('wisp-1');
    expect(strikeable, 'but refuses the Unwritten one standing just as close').not.toContain('lurker-0');

    // Clear the control away and step back to the Page's own reach-3 line.
    await debugSetPos(page, 'wisp-1', 10, 6);
    await debugSetPos(page, 'keeper', 2, 1);

    await readPageFromSatchel(page);
    await waitForPageTargeting(page);
    await tileClick(page, 5, 1); // a click that only lands if the Page's targets include it

    await expect
      .poll(async () => (await pageSnap(page))?.budget.actionSpent, {
        timeout: 15_000,
        message: 'the Page resolves against the Unwritten — it reaches',
      })
      .toBe(true);

    const pushed = await pageUnit(page, 'lurker-0');
    expect({ c: pushed?.c, r: pushed?.r }, 'the Page reached it and moved it — proof of the reach ruling').toEqual({ c: 6, r: 1 });
    // The composition law: a landed clean push is neither damage taken nor the holder acting, so
    // NEITHER Unwritten trigger fires. It is moved, and it is still unwritten.
    expect(pushed?.hp, 'no damage — so trigger 2 (being struck writes you) never fires').toBe(before?.hp);
    expect(hasStatusId(pushed, 'unwritten'), 'and it did not ACT, so trigger 1 never fires either — it survives the shove')
      .toBe(true);
    // Still unwritten means still un-Strikeable, and this is read from ADJACENT again so it says
    // something: the sibling blocked-push test runs this exact check from this exact distance and
    // gets the opposite answer once the bump has revealed it.
    await debugSetPos(page, 'keeper', 5, 1);
    expect(await validTargets(page, 'strike'), 'un-Strikeable still, from one tile away').not.toContain('lurker-0');
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
  }
});

test('a BLOCKED page-push consumes the Unwritten — the bump IS damage taken (Ch. IX / Ch. VIII composition)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const beforeSave = await readState<LootSave>(page, 'save.json');
  const beforeInv = await readState<LootInventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/save.json', { data: { hp: 16 } });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 0, stacks: { [PAGE_ID]: 1 }, bornRelicId: null },
    });

    await page.goto('/?scene=combat&seed=7&enemies=lurker');
    await waitReady(page, 'combat');
    await passUntilPartyTurn(page, 'keeper');

    await debugSetPos(page, 'lurker-0', 1, 1); // pinned against the west wall
    await debugSetPos(page, 'keeper', 2, 1); // adjacent, for the before-reading control
    const before = await pageUnit(page, 'lurker-0');
    expect(hasStatusId(before, 'unwritten'), 'sanity: still Unwritten going in').toBe(true);
    expect(before?.hp, 'sanity: the Lurker has 2 hp, so a 1-point bump leaves it standing to be read').toBe(2);
    // The control half: from THIS tile, right now, Strike cannot see it. The same read is taken
    // from the same tile after the bump, so the only thing that changes is the status.
    expect(await validTargets(page, 'strike'), 'before: Unwritten, so Strike is blind to it from one tile away')
      .not.toContain('lurker-0');

    await debugSetPos(page, 'keeper', 4, 1); // step back to the Page's reach-3 line
    await readPageFromSatchel(page);
    await waitForPageTargeting(page);
    await tileClick(page, 1, 1);

    await expect
      .poll(async () => (await pageSnap(page))?.budget.actionSpent, { timeout: 15_000, message: 'the blocked reading resolves' })
      .toBe(true);

    const revealed = await pageUnit(page, 'lurker-0');
    expect({ c: revealed?.c, r: revealed?.r }, 'the wall held it').toEqual({ c: 1, r: 1 });
    expect(revealed?.hp, 'the bump landed for 1 — this is real damage taken').toBe(1);
    expect(revealed?.alive, 'and it is still standing to be read').toBe(true);
    // The other half of the composition: damage routes through damageUnit, which is where Ch.
    // VIII's trigger 2 lives, so THIS push writes the thing into the Ledger.
    expect(hasStatusId(revealed, 'unwritten'), 'being struck writes you — the bump consumed the Unwritten').toBe(false);
    // Back to the control tile — same distance as before the reading, opposite answer.
    await debugSetPos(page, 'keeper', 2, 1);
    expect(await validTargets(page, 'strike'), 'after: written, so Strike can see it from that same tile').toContain('lurker-0');
  } finally {
    await restoreLootState(page, beforeSave, beforeInv);
  }
});

test('Shove itself is untouched by the Page\'s pushUnit reuse: still zero damage, blocked or landed — regression (Ch. VIII)', async ({
  page,
}) => {
  test.setTimeout(90_000);

  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await passUntilPartyTurn(page, 'keeper');

  await debugSetPos(page, 'wisp-1', 10, 6);
  await debugSetPos(page, 'wraith-2', 10, 5);
  // Adjacent and pinned against the west wall: a blocked Shove, the exact case where the Page
  // bumps for 1 and Shove must still bump for nothing ({ bump: false } is Shove's alone).
  await debugSetPos(page, 'keeper', 2, 1);
  await debugSetPos(page, 'wisp-0', 1, 1);
  const before = await pageUnit(page, 'wisp-0');

  await page.keyboard.press('0'); // Shove hotkey
  await tileClick(page, 1, 1);

  await expect
    .poll(async () => (await pageSnap(page))?.budget.actionSpent, {
      timeout: 15_000,
      message: 'the blocked Shove still spends the action',
    })
    .toBe(true);
  const after = await pageSnap(page);

  const shoved = await pageUnit(page, 'wisp-0');
  expect({ c: shoved?.c, r: shoved?.r }, 'blocked by the west wall, same as ever').toEqual({ c: 1, r: 1 });
  expect(shoved?.hp, "Shove's no-damage purity is intact — the Page's { bump: true } did not leak into it").toBe(before?.hp);
  const last = after?.log[after.log.length - 1];
  expect(last?.action).toBe('shove');
  expect(last?.dmg, 'and it logs zero, as it always has').toBe(0);
  expect((after?.log ?? []).some((l) => l.action === 'bump'), 'no bump entry anywhere — Shove suppresses it always').toBe(false);
});
