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
  currentScene,
} from './helpers';
// Pure, no-Phaser module (same precedent as miras-stall.spec.ts's own buildLayout import) —
// reuse the shipped constant rather than re-typing the literal (avoids drift/typos).
import { WICK_CATCH_LINE } from '../app/src/game/lantern';

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
