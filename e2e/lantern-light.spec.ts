import { test, expect, type Page } from '@playwright/test';
import {
  waitReady,
  waitHamletPlayer,
  warpHamletTo,
  tapKey,
  waitForState,
  readState,
  canvasClick,
  waitProvincesLoaded,
  currentScene,
} from './helpers';

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
// waitForKeeperTurn() debug-read pattern.
//
// Fix round 1 root-cause note: the standalone `?scene=combat` dev launch always forces the
// FIXTURE_PACK_ID sentinel, whose candidate factIds (the 6 moss-* fixture ids) never exist in
// any REAL installed pack. encounters/engine.ts's pick() resolves an unknown packId to
// `packs[0]` (the real vc-law pack) and, when none of the requested factIds match anything in
// it, falls through to `candidates[0]` — the same fixed encounter every time, regardless of
// WHICH factIds were requested. Confirmed empirically: the original version of this test (which
// asserted `secondPrompt !== firstPrompt`) received the identical real vc-law prompt on both
// draws. So the packless route can never observe planRedraw's exclusion — it needs a REAL
// (non-fixture) combat launch, where the due-queue draws genuine vc-law fact ids that DO
// resolve, so excluding the shown one actually changes what pick() returns. Entering via the
// vault map (chain.spec.ts's own direct `?scene=vaults` route + room/teaching drive, cloned
// below) gives combat a real packId for exactly that reason.

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

/** The real room's layout is generated per seed/room id — unlike the packless fixture's
 *  proven-safe (5,3)/(6,3) (combat-magic.spec.ts et al.), it can't be hardcoded. Scan for a
 *  horizontally-adjacent non-wall pair instead (combat-status.spec.ts's own brazier-adjacency
 *  idiom, applied generically). */
async function findAdjacentFloorPair(page: Page): Promise<[{ c: number; r: number }, { c: number; r: number }]> {
  const layout = await page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { layoutDebug?(): { tiles: string[][] } } | undefined;
    return s?.layoutDebug?.() ?? null;
  });
  const tiles = layout?.tiles ?? [];
  for (let r = 0; r < tiles.length; r++) {
    for (let c = 0; c < (tiles[r]?.length ?? 0) - 1; c++) {
      if (tiles[r][c] !== 'wall' && tiles[r][c + 1] !== 'wall') return [{ c, r }, { c: c + 1, r }];
    }
  }
  throw new Error('no adjacent floor pair found in the room layout');
}

// Task 5, scenario (c) — the Wellspring round re-draw. Cloned drive: wellspring-srs.spec.ts's
// own boot → hamlet → warp → intro-advance → answerAnyOverlay idioms (own-file convention, as
// above). Real-pack drive (waitProvincesLoaded before the warp — else doWellspring() takes the
// no-pack branch): T4's fix-round finding applies here too — only a real pack's due queue can
// prove a DIFFERENT question surfaced; a packless launch always falls through to the same fixed
// encounter regardless of which factIds were excluded.
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

// Task 6, scenario (d) — the Death's Door re-draw. Unlike combat/Wellspring (re-present from
// the round's own drawn pool), the door's pool is a SINGLE fact, so raising the lantern here
// triggers a genuine second draw through ddDraw itself: salted (LANTERN_REDRAW_SALT) and
// exclusion-listed against the shown fact. Entry drive cloned from deaths-door.spec.ts's own
// Pins (own-file convention, as above): the packless-DUNGEON `dev=1&sim=0&auto=win` harness
// (two wisps, no gate/boss), driveToZeroHp's Wait-spam idiom to bring the party to 0 HP.
//
// T4 fix-round note resolved: that route is safe for a prompt-text assertion here, unlike the
// packless `?scene=combat` T1 combat-cast route. Confirmed by reading the source, not assumed:
// ddDraw (CombatScene.ts) never scopes to the launch's packId — it awaits
// services.draw.indexReady() itself and draws off the GLOBAL index, so `id`/the salted `alt`
// are always real installed-pack fact ids, never the dev route's fixture ids. And pick()
// (encounters/engine.ts) resolves each requested factId via services.draw.encountersOf
// (register.ts:83, threaded whenever real packs are installed — always true on the e2e
// server), a global per-fact lookup independent of req.packId. The T1 bug's mechanism (pick()
// falling through to the same candidates[0] regardless of which factId was requested) only
// bites when the requested factIds themselves have zero entries in encountersOf — true for
// the T1 route's fixture moss-* ids, never true for ddDraw's real ones.
type SrsEntry = { box: number; next_due: number; history: unknown[] };

/** Step 0d (T7 review discovery): ddDraw's ladder (due() -> fresh() -> seeded shuffle,
 *  CombatScene.ts) reads whatever the accumulated .state-e2e/srs.json holds — which drifts
 *  across the whole suite's runs (every spec that answers a question leaves its own
 *  history/box/next_due behind), so the door's FIRST draw was not deterministic run-to-run
 *  (reproduced red at two commits; the known due-queue artifact previously worked around by
 *  hand-clearing state). Two known, pre-verified free_recall facts — nights-ledger.spec.ts's
 *  STABILIZE_FACTS idiom, reused (both already confirmed free_recall-only and pack-resident
 *  there) — at box 1 (safely below REVIVE_BOX=4) with strictly decreasing next_due (most
 *  overdue first), so due()'s due-first tier deterministically deals DOOR_FACTS[0] on the
 *  round's own draw and DOOR_FACTS[1] on the lantern's salted, exclusion-listed redraw
 *  (due({count:2}) returns both; DOOR_FACTS[0] is filtered by the exclusion list, DOOR_FACTS[1]
 *  survives) — regardless of what any earlier spec left behind. seedDoorFacts PUTs (not
 *  patches) srs.json wholesale, so this is a genuinely self-contained fixture, not an addition
 *  on top of drift; the test captures and restores whatever srs.json held before it, own-file
 *  convention (this spec owns no other file).
 */
const DOOR_FACTS: ReadonlyArray<{ factId: string }> = [
  { factId: 'vc.econ.liqpref.preference-plus-participation' },
  { factId: 'vc.econ.paytoplay.ubiquitous-after-dotcom' },
];

async function seedDoorFacts(page: Page): Promise<void> {
  const now = Date.now();
  const facts: Record<string, SrsEntry> = {};
  DOOR_FACTS.forEach(({ factId }, i) => {
    facts[factId] = { box: 1, next_due: now - (500_000 - i * 100_000), history: [] };
  });
  const res = await page.request.put('/api/state/srs.json', { data: { version: 1, facts } });
  expect(res.ok(), 'seeded the two known door facts').toBe(true);
}

async function driveToDeathsDoor(page: Page, timeoutMs = 75_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await currentScene(page)) !== 'combat') return;
    const s = await combatSnap(page);
    if (!s || s.state === 'over' || s.state === 'deathsdoor') return;
    if (s.state === 'playerMove') await page.keyboard.press('7'); // Wait
    await page.waitForTimeout(150);
  }
}

// Task 7, scenario (e) — the loot-advantage spend at the boss hoard. Cloned drive: the boss
// XP pin's own sim-harness (leveling-grant-sequence.spec.ts) — `?scene=vaults&sim=1&auto=boss
// &seed=7`, deliberately WITHOUT dev=1. dev=1 forces DungeonScene.useFixture() (this.pack =
// null), and the packless fixture's own loot math is identical, but that file's own precedent
// route (a real installed pack, sim=1 skips the fight, auto=boss clears rooms 1-5 without
// entering them and drives straight to the boss) is the established, already-proven-safe rig
// for a deterministic rng-chain assertion here — no reason to diverge. auto=boss means
// offerLantern's `this.auto` branch always raises (Step 3): the run never waits on a manual
// click, so this is the only loot beat the run produces (grantRoomLoot never fires along this
// route — the pre-boss rooms are marked cleared, never entered).
//
// Expected outcome verified against the REAL economy.ts (not hand-derived) via a throwaway
// vitest run during authoring: mulberry32((7 + 104729) >>> 0) — bossVictory's own seed
// expression — rolls 'mossbound-locket' (uncommon) at edge:'none', but 'clerks-silver-nib'
// (rare) at edge:'advantage' — a genuinely different, better outcome, so a build that silently
// stays on a single roll (edge unthreaded) fails this pin on the trinket id, not a coincidence.
type Inventory = { version: number; gold: number; stacks: Record<string, number> };

/** leveling-grant-sequence.spec.ts's restoreState idiom, verbatim in shape: quiesce the page
 *  first (a live boss-victory run's own persist writes can otherwise land AFTER a bare PUT and
 *  poison whatever spec runs next in this shared, serial suite), then PUT-and-verify. Inventory
 *  too, not just save — unlike scenarios (a)-(d) above, this route grants loot. */
async function restoreLootState(page: Page, save: Save | null, inv: Inventory | null): Promise<void> {
  const saveData: Save = save ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
  const invData: Inventory = inv ?? { version: 1, gold: 20, stacks: {} };
  await page.goto('about:blank');
  for (let i = 0; i < 5; i++) {
    await page.request.put('/api/state/save.json', { data: saveData });
    await page.request.put('/api/state/inventory.json', { data: invData });
    await new Promise((r) => setTimeout(r, 150));
    const nowSave = (await page.request
      .get('/api/state/save.json')
      .then((r) => r.json())
      .catch(() => undefined)) as Save | undefined;
    if (nowSave?.scene === saveData.scene && (nowSave?.lanternLight ?? false) === (saveData.lanternLight ?? false)) {
      return;
    }
  }
  throw new Error('restoreLootState: save.json never settled on the restored snapshot');
}

// Task 8 (W6 T8) — scenarios (f)/(g)/(h): the interactive loot-advantage CHOICE itself, not
// auto-drive's forced raise (offerLantern's `this.auto` branch always raises unconditionally —
// DungeonScene.ts:637 — so 'keep'/decline is only ever reachable without an ?auto= param at
// all). Route: the packless dev/e2e fixture (dev.dungeon.json), room `under-1` (roomIndex 0) —
// deliberately NOT room.threshold (the real vc-law pack's own roomIndex-0 room scenario (b)
// above uses): EVERY non-boss room in the real pack carries a `gate` (an extra interactive
// free_recall the player must clear before grantRoomLoot ever fires — DungeonScene.ts's
// runGate), while under-1 has none, so this is the simplest room that reaches offerLantern's
// own card directly. ?sim=1 (independent of `dev` — DungeonScene.ts:455) skips the fight
// itself; roomClearLoot's rng is a pure function of (roomIndex, seed, edge) only (economy.ts),
// so it doesn't care which dungeon spec is active — the seeds below were verified against the
// REAL economy.ts (throwaway vitest probe during authoring, same discipline as scenario (e)
// above), not hand-derived.

/** Node-map x for room index `i` — VaultView.ts's renderMap formula, reproduced (no debug
 *  accessor exists for node bounds): count = rooms.length+1 (camp), left=96, right=W-86=874,
 *  step=(right-left)/(count-1), room i sits at nodeXs[i+1] = left+(i+1)*step; STRIP_Y=300. The
 *  dev fixture carries 4 rooms (count=5, step=194.5), so under-1 (i=0) sits at x≈290.5 — a
 *  DIFFERENT x than the real pack's room.threshold (225, count=7) scenario (b) above clicks;
 *  both sit on the same STRIP_Y=300 row. */
const UNDER1_NODE = { x: 291, y: 300 };

/** Drive into the packless fixture's under-1 (gate-less, roomIndex 0) and past its 2-fact
 *  teaching modal, ending with the sim-victory chain in flight. The node-click + blurb-dismiss
 *  + teaching-footer-loop is scenario (b)'s own drive above, generalized: only the node's own x
 *  differs per room — the blurb/teaching cards themselves are fixed-position regardless. */
async function enterLootRoomInteractive(page: Page): Promise<void> {
  await canvasClick(page, UNDER1_NODE.x, UNDER1_NODE.y);
  await page.waitForTimeout(500);
  await canvasClick(page, 478, 365); // dismiss the blurb card ("Descend") — same fixed position every room
  await expect(page.locator('.fw-doc'), 'discovered-documents teaching shown (under-1 carries 2 facts)').toBeVisible({ timeout: 8000 });

  const tbtn = page.locator('.fw-footer .fw-btn-primary');
  for (let i = 0; i < 8; i++) {
    const label = await tbtn.innerText();
    await tbtn.click();
    if (label.includes('Close')) break;
    await page.waitForTimeout(140);
  }

  // sim=1's combatFlash (~700ms, two chained tweens) + SIM_COMBAT_MS (700ms, DungeonScene.ts:51)
  // + resolveCombat's own streak/save/drawMap bookkeeping (a couple of fast disk round-trips)
  // all run before grantRoomLoot's offerLantern ever opens the lantern-choice card — pad
  // generously; a parallel agent fleet can stretch Phaser's own tween/delayedCall timers under
  // CPU contention.
  await page.waitForTimeout(2500);
}

/** Click showLanternChoice's real button (VaultView.ts's 500x232 panel: cx=480, top=182,
 *  buttons at top+84 "Raise it…"/top+136 "Keep the light" — crucible-v1-package-a.spec.ts's
 *  V1-20 test already proved this exact geometry out for showResumeChoice's identically-shaped
 *  panel). The card is pure Phaser with no DOM/debug signal for "is it open yet" (sim's
 *  combatFlash tween + SIM_COMBAT_MS delay + save bookkeeping all precede it), so this retries
 *  the click against the one signal this file DOES have: grantRoomLoot's gold grant, which can
 *  only ever fire once offerLantern's promise resolves. A too-early click just lands on inert
 *  map background (harmless, nothing else interactive sits at this panel's screen position once
 *  the blurb/teaching cards are closed) and the next iteration tries again. */
async function clickLanternChoiceAndAwaitGold(
  page: Page,
  pick: 'raise' | 'keep',
  beforeGold: number,
  timeoutMs = 20_000,
): Promise<Inventory | null> {
  const y = pick === 'raise' ? 266 : 318;
  const start = Date.now();
  let inv = await readState<Inventory>(page, 'inventory.json');
  while ((inv?.gold ?? beforeGold) <= beforeGold && Date.now() - start < timeoutMs) {
    await canvasClick(page, 480, y);
    await page.waitForTimeout(700);
    inv = await readState<Inventory>(page, 'inventory.json');
  }
  return inv;
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
    test.setTimeout(90_000);
    const beforeSave = await readState<Save>(page, 'save.json');

    try {
      // fixture: save with lanternLight: true, no dungeon progress (room.threshold reads as
      // "first uncleared"). A REAL combat launch (see the route note above), not the packless
      // `?scene=combat` dev harness.
      await page.request.put('/api/state/save.json', {
        data: { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '', lanternLight: true },
      });

      // Direct-to-vaults boot — real vc-law pack, no hamlet/gate walk needed (trim-the-lantern.
      // spec.ts / vault-hover.spec.ts / chain.spec.ts's own reload-check all use this route).
      // rank=1 (combat-magic.spec.ts's own idiom): the shared .state-e2e directory accumulates
      // real SRS history across the whole suite's runs, so the COMPUTED rank isn't stable —
      // force it rather than assume a fresh save means an unwelded pool.
      await page.goto('/?scene=vaults&seed=7&rank=1');
      await waitReady(page, 'vaults');

      // Enter room.threshold ("The Threshold Ledger") — chain.spec.ts's own node/blurb
      // coordinates for this seed's map layout, and its own teaching-card pagination loop.
      await canvasClick(page, 225, 300); // green current-room node
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

      // combat launches from the room with a real packId ('vc-law') — drawGlobal will be true.
      await page.waitForFunction(() => (window as Window).__FABLEWOOD_STATE?.scene === 'combat', undefined, {
        timeout: 15_000,
      });

      const opened = await waitForKeeperTurn(page);
      expect(opened?.state, "the Keeper's first turn opened for manual control").toBe('playerMove');

      // room.threshold's first enemy (packs/vc-law/assets/preference-vaults.dungeon.json) is a
      // wisp with an mcq encounter — wisp-0, same archetype-index id convention the fixture and
      // boss-victory's real-dungeon test ('warden-0') both rely on. The room's own layout is
      // independently generated, so scan for a safe adjacent pair rather than hardcoding tiles.
      const [keeperTile, targetTile] = await findAdjacentFloorPair(page);
      await debugSetPos(page, 'keeper', keeperTile.c, keeperTile.r);
      await debugSetPos(page, 'wisp-0', targetTile.c, targetTile.r);

      await page.keyboard.press('2'); // Smite (T1 Kindling, mcq)
      await page.waitForTimeout(150); // a bare `.press()` can race Phaser's own frame-tick handling
      expect((await combatSnap(page))?.state, 'Rank 1 goes straight to targeting (fresh SRS, any pool size)').toBe('playerTarget');

      await canvasClick(page, 192 + targetTile.c * 48 + 24, 48 + targetTile.r * 48 + 24); // wisp-0's tile

      await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms arm guard

      await expect(page.locator('.fw-lantern-btn'), 'lanternLight:true shows the raise affordance').toBeVisible();
      const firstPrompt = (await page.locator('.fw-prompt').textContent())?.trim();

      await page.locator('.fw-lantern-btn').click();

      // The old overlay closes (170ms exit anim), the spend PUTs, and a fresh runEncounter
      // re-presents from the round's own drawn pool — no new draw (draw-census law). This poll
      // is the SETTLE signal (and proof the re-present passed lanternLight:false) — not the
      // regression check itself; that's assert 1 below.
      await expect.poll(() => page.locator('.fw-lantern-btn').count(), { timeout: 15_000 }).toBe(0);
      await expect(page.locator('.fw-overlay')).toBeVisible();
      await page.waitForTimeout(450); // the re-presented overlay's OWN 400ms arm guard

      // assert 1: a different memory surfaced. This is the real vc-law pack's global due queue
      // (COMBAT_DRAW_COUNT=20 candidates, mcq-kind-narrowed) and planRedraw excludes the shown
      // fact from that pool, so this is deterministic, not a flake risk — a build that
      // re-presented the ORIGINAL pool (the likeliest regression) would fail here.
      const secondPrompt = (await page.locator('.fw-prompt').textContent())?.trim();
      expect(secondPrompt, 'a different memory surfaced on the re-present').not.toBe(firstPrompt);

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

  test('Wellspring round: raising the lantern re-presents a different memory and spends the light', async ({ page }) => {
    test.setTimeout(90_000);
    const beforeSave = await readState<Save>(page, 'save.json');

    try {
      // fixture: lanternLight held, otherwise the same base fixture as the SRS wellspring drive.
      await page.request.put('/api/state/save.json', {
        data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '', lanternLight: true },
      });

      await page.goto('/?scene=hamlet&seed=7');
      await waitReady(page, 'hamlet');
      await waitHamletPlayer(page);
      await waitProvincesLoaded(page); // else doWellspring() takes the no-pack branch (no drill)

      const warped = await warpHamletTo(page, 'wellspring');
      expect(warped, 'dev warp hook parked the Keeper at the Wellspring').toBe(true);
      await tapKey(page, 'e'); // open the Wellspring intro (real keypress)
      await page.waitForTimeout(220);

      // advance the intro dialogue until the first drill encounter opens (wellspring-srs.spec.ts
      // idiom).
      for (let k = 0; k < 12; k++) {
        if (await page.locator('.fw-overlay').count()) break;
        await tapKey(page, 'e');
        await page.waitForTimeout(300);
      }
      await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 8000 });
      await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms arm guard

      await expect(page.locator('.fw-lantern-btn'), 'lanternLight:true shows the raise affordance').toBeVisible();
      const firstPrompt = (await page.locator('.fw-prompt').textContent())?.trim();

      await page.locator('.fw-lantern-btn').click();

      // The old overlay closes (170ms exit anim), the spend PUTs, and a fresh runEncounter
      // re-presents from THIS ROUND's own drawn pool — no new draw (draw-census law stays at
      // five sites). This poll is the SETTLE signal, not the regression check itself.
      await expect.poll(() => page.locator('.fw-lantern-btn').count(), { timeout: 15_000 }).toBe(0);
      await expect(page.locator('.fw-overlay')).toBeVisible();
      await page.waitForTimeout(450); // the re-presented overlay's OWN 400ms arm guard

      // assert 1: a different memory surfaced, and the strip does not return this round (the
      // light is spent, not offered again mid-round). Real vc-law pack, WELLSPRING_DRAW_COUNT=20
      // candidates — planRedraw excludes the shown fact from that pool, so this is deterministic.
      const secondPrompt = (await page.locator('.fw-prompt').textContent())?.trim();
      expect(secondPrompt, 'a different memory surfaced on the re-present').not.toBe(firstPrompt);
      expect(await page.locator('.fw-lantern-btn').count(), 'the lantern strip is gone — the light is spent').toBe(0);

      // answer out the rest of the drill: this round's re-presented question, then rounds 2 and 3.
      for (let n = 0; n < 3; n++) {
        if (!(await page.locator('.fw-overlay').count())) break;
        await answerAnyOverlay(page);
        await page.waitForTimeout(400);
      }

      // assert 2 (persistence law): the light is spent.
      const s = await waitForState<Save>(page, 'save.json', (x) => x?.lanternLight === false);
      expect(s?.lanternLight).toBe(false);
    } finally {
      await restoreSave(page, beforeSave);
    }
  });

  test("Death's Door: raising the lantern re-draws a different memory and spends the light", async ({ page }) => {
    test.setTimeout(120_000);
    const beforeSave = await readState<Save>(page, 'save.json');
    const beforeSrs = await readState<{ version: number; facts: Record<string, unknown> }>(page, 'srs.json');

    try {
      // fixture: hp low enough that one connecting hit ends the party (deaths-door.spec.ts's
      // own seedSave idiom, hp:2 — splitPooledHp(2) leaves the Keeper at 2 pool hp, Mira at 0),
      // lanternLight held.
      await page.request.put('/api/state/save.json', {
        data: {
          scene: 'hamlet', hp: 2, streak: 0, lastPlayed: '',
          dungeon: { roomIndex: 0, cleared: [] }, lanternLight: true,
        },
      });
      // Step 0d hermetic fix — seed BEFORE goto (nights-ledger.spec.ts's own
      // seedStabilizeFacts-before-goto idiom): the door's due queue must see this fixture from
      // the moment the app boots, not partway through the run.
      await seedDoorFacts(page);

      // Same route as deaths-door.spec.ts's Pins (see the file-level note above for why this
      // is safe for a prompt-text assertion despite the dungeon room itself being fixture-fed).
      await page.goto('/?scene=vaults&dev=1&sim=0&auto=win&seed=7');
      await waitReady(page, 'combat');

      await driveToDeathsDoor(page);

      const doorCard = page.locator('.fw-overlay', { hasText: /Ledger Holds Your Line/ });
      await doorCard.waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms arm guard

      await expect(page.locator('.fw-lantern-btn'), 'lanternLight:true shows the raise affordance').toBeVisible();
      const firstPrompt = (await page.locator('.fw-prompt').textContent())?.trim();

      await page.locator('.fw-lantern-btn').click();

      // The old overlay closes (170ms exit anim), the spend PUTs, and ddDraw runs again —
      // salted + exclusion-listed against the shown fact. The door's pool is ONE fact, so this
      // is a genuine second draw (not a re-present from an already-drawn pool like combat/
      // Wellspring) — draw-census law still holds: it's the SAME ddDraw call site, parameterized.
      await expect.poll(() => page.locator('.fw-lantern-btn').count(), { timeout: 15_000 }).toBe(0);
      await expect(page.locator('.fw-overlay')).toBeVisible();
      await page.waitForTimeout(450); // the re-presented overlay's OWN 400ms arm guard

      // assert 1: a different memory surfaced — the real vc-law pack's global due/fresh/shuffle
      // ladder, exclusion-filtered, so a build that re-presented the SAME fact (the likeliest
      // regression) fails here.
      const secondPrompt = (await page.locator('.fw-prompt').textContent())?.trim();
      expect(secondPrompt, 'a different memory surfaced on the re-present').not.toBe(firstPrompt);

      // answer the re-presented question so the round resolves cleanly.
      await answerAnyOverlay(page);

      // assert 2 (persistence law): the light is spent.
      const s = await waitForState<Save>(page, 'save.json', (x) => x?.lanternLight === false);
      expect(s?.lanternLight).toBe(false);
    } finally {
      await restoreSave(page, beforeSave);
      await page.request.put('/api/state/srs.json', { data: beforeSrs ?? { version: 1, facts: {} } });
    }
  });

  test('boss hoard: raising the lantern grants advantage on the loot-rarity roll and spends the light', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const beforeSave = await readState<Save>(page, 'save.json');
    const beforeInv = await readState<Inventory>(page, 'inventory.json');

    try {
      // fixture: lanternLight held, a fresh purse, no dungeon progress (auto=boss marks its
      // own pre-boss progress below) — the boss+quest sim-harness route (see file note above).
      await page.request.put('/api/state/save.json', {
        data: { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '', lanternLight: true },
      });
      await page.request.put('/api/state/inventory.json', {
        data: { version: 1, gold: 20, stacks: {} },
      });

      await page.goto('/?scene=vaults&sim=1&auto=boss&seed=7');

      // assert 1 (persistence law): the light is spent after the boss trove's loot beat.
      const save = await waitForState<Save>(page, 'save.json', (s) => s?.lanternLight === false, 60_000);
      expect(save?.lanternLight).toBe(false);

      // assert 2: the deterministic advantaged outcome landed — the exact rare trinket the
      // real rng chain rolls under edge:'advantage' for this seed (see file note above), never
      // the un-advantaged uncommon roll.
      const inv = await waitForState<Inventory>(
        page,
        'inventory.json',
        (i) => (i?.stacks?.['clerks-silver-nib'] ?? 0) >= 1,
        60_000,
      );
      expect(inv?.stacks?.['clerks-silver-nib']).toBe(1);
      expect(inv?.stacks?.['mossbound-locket'], 'the un-advantaged uncommon roll did NOT land').toBeUndefined();
    } finally {
      await restoreLootState(page, beforeSave, beforeInv);
    }
  });

  test('room-trove (interactive): raising the lantern grants advantage on the loot-rarity roll', async ({ page }) => {
    test.setTimeout(90_000);
    const beforeSave = await readState<Save>(page, 'save.json');
    const beforeInv = await readState<Inventory>(page, 'inventory.json');

    try {
      await page.request.put('/api/state/save.json', {
        data: { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '', lanternLight: true },
      });
      await page.request.put('/api/state/inventory.json', {
        data: { version: 1, gold: 20, stacks: {} },
      });

      // seed 11, roomIndex 0 (under-1): verified against the real economy.ts (throwaway vitest
      // probe during authoring — roomClearLoot's own documented rng order: gold jitter, the 35%
      // drop gate, then the rarity roll(s), then the tier pick). edge:'advantage' rolls gold 14
      // + 'clerks-silver-nib' (rare); the SAME seed under edge:'none' instead lands
      // 'mossbound-locket' (uncommon — scenario h below) — a genuinely different, better
      // outcome, so a build that silently drops the edge (or never renders the interactive
      // choice at all) fails this pin on the trinket id, not a coincidence.
      await page.goto('/?scene=vaults&dev=1&sim=1&seed=11');
      await waitReady(page, 'vaults');

      const before = await readState<Inventory>(page, 'inventory.json');
      await enterLootRoomInteractive(page);
      await clickLanternChoiceAndAwaitGold(page, 'raise', before?.gold ?? 20);

      const inv = await waitForState<Inventory>(
        page, 'inventory.json',
        (i) => (i?.stacks?.['clerks-silver-nib'] ?? 0) >= 1,
        20_000,
      );
      expect(inv?.gold, 'the room-clear gold landed').toBe(20 + 14);
      expect(inv?.stacks?.['clerks-silver-nib'], 'advantage beat a plain roll — the rare trinket landed').toBe(1);
      expect(inv?.stacks?.['mossbound-locket'], 'the un-advantaged uncommon roll did NOT land').toBeUndefined();

      const save = await waitForState<Save>(page, 'save.json', (s) => s?.lanternLight === false, 10_000);
      expect(save?.lanternLight, 'the light is spent').toBe(false);
    } finally {
      await restoreLootState(page, beforeSave, beforeInv);
    }
  });

  test('room-trove (interactive): raising the lantern refunds when the trove itself rolls no trinket', async ({ page }) => {
    test.setTimeout(90_000);
    const beforeSave = await readState<Save>(page, 'save.json');
    const beforeInv = await readState<Inventory>(page, 'inventory.json');

    try {
      await page.request.put('/api/state/save.json', {
        data: { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '', lanternLight: true },
      });
      await page.request.put('/api/state/inventory.json', {
        data: { version: 1, gold: 20, stacks: {} },
      });

      await page.goto('/?scene=vaults&dev=1&sim=1&seed=9');
      await waitReady(page, 'vaults');

      // trim-the-lantern.spec.ts's own disambiguation idiom: final-state equality alone can't
      // tell "spent then refunded" from "the choice never spent anything" (both end up
      // lanternLight:true) — collect every real save.json write and prove the actual sequence.
      // srs/store.ts's ObjectStore.save() re-fetches the REMOTE state and PUTs the whole merged
      // object (never a sparse patch), so EVERY write in this multi-step drive (room entry,
      // teaching, sim-resolve bookkeeping) carries a lanternLight value, not just the two that
      // change it — the signal is the VALUE SEQUENCE, not which writes merely mention the key.
      const saveWrites: Array<string | null> = [];
      page.on('request', (req) => {
        if (req.method() === 'PUT' && req.url().includes('/api/state/save.json')) {
          saveWrites.push(req.postData());
        }
      });

      // seed 9, roomIndex 0: verified via the same throwaway probe — the 35% trinket-drop gate
      // itself misses under this seed (edge:'advantage' only ever touches RARITY, never the
      // drop chance — DungeonScene.ts's own comment on grantRoomLoot), so this is genuinely the
      // honest-refund edge, not a coincidental empty pool.
      const before = await readState<Inventory>(page, 'inventory.json');
      await enterLootRoomInteractive(page);
      const inv = await clickLanternChoiceAndAwaitGold(page, 'raise', before?.gold ?? 20);

      expect(inv?.gold, 'the room-clear gold landed (no trinket this roll)').toBe(20 + 15);
      expect(Object.keys(inv?.stacks ?? {}), 'no trinket dropped').toHaveLength(0);

      await waitForState<Save>(page, 'save.json', (s) => s?.lanternLight === true, 20_000);
      const lanternValues = saveWrites
        .map((b) => JSON.parse(b ?? '{}') as Save)
        .map((w) => w.lanternLight)
        .filter((v): v is boolean => v !== undefined);
      expect(lanternValues.length, 'save writes carrying lanternLight were captured').toBeGreaterThan(0);
      expect(lanternValues, 'a genuine spend (false) landed on disk somewhere in the drive').toContain(false);
      expect(lanternValues[lanternValues.length - 1], 'the LAST write in the drive reflects the refund (true) — the merged-toast path').toBe(true);

      await page.screenshot({ path: 'screenshots/e2e-lantern-light-trove-refund.png' }); // the merged toast, visually
    } finally {
      await restoreLootState(page, beforeSave, beforeInv);
    }
  });

  test('room-trove (interactive): declining the lantern (Keep the light) spends nothing — loot resolves normally', async ({ page }) => {
    test.setTimeout(90_000);
    const beforeSave = await readState<Save>(page, 'save.json');
    const beforeInv = await readState<Inventory>(page, 'inventory.json');

    try {
      await page.request.put('/api/state/save.json', {
        data: { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '', lanternLight: true },
      });
      await page.request.put('/api/state/inventory.json', {
        data: { version: 1, gold: 20, stacks: {} },
      });

      // SAME seed as the raise scenario above (11) but 'keep' instead of 'raise': the gold
      // jitter and 35%-drop rolls are identical either way (edge only ever touches the RARITY
      // roll — economy.ts's own rng-order comment), so this is a direct contrast on the same
      // rng stream — edge:'none' lands the plain first roll, 'mossbound-locket' (uncommon),
      // never the advantaged 'clerks-silver-nib' (rare) the raise scenario gets.
      await page.goto('/?scene=vaults&dev=1&sim=1&seed=11');
      await waitReady(page, 'vaults');

      const saveWrites: Array<string | null> = [];
      page.on('request', (req) => {
        if (req.method() === 'PUT' && req.url().includes('/api/state/save.json')) {
          saveWrites.push(req.postData());
        }
      });

      const before = await readState<Inventory>(page, 'inventory.json');
      await enterLootRoomInteractive(page);
      const inv = await clickLanternChoiceAndAwaitGold(page, 'keep', before?.gold ?? 20);

      expect(inv?.gold, 'the same gold roll as the raise scenario above — edge never touches it').toBe(20 + 14);
      expect(inv?.stacks?.['mossbound-locket'], 'the plain, un-advantaged roll landed').toBe(1);
      expect(inv?.stacks?.['clerks-silver-nib'], 'the advantaged rare never had a chance to land').toBeUndefined();

      // no spend: 'keep' returns 'none' before offerLantern's own save call ever runs. Every
      // write in this drive still carries a lanternLight value (srs/store.ts's ObjectStore.save
      // re-fetches the remote state and PUTs the whole merged object, never a sparse patch), so
      // the proof is that it holds true across EVERY write, never once dipping to false —
      // stronger than inferring absence from an unchanged final value.
      const lanternValues = saveWrites
        .map((b) => JSON.parse(b ?? '{}') as Save)
        .map((w) => w.lanternLight)
        .filter((v): v is boolean => v !== undefined);
      expect(lanternValues.length, 'save writes carrying lanternLight were captured').toBeGreaterThan(0);
      expect(lanternValues.every((v) => v === true), 'lanternLight never dipped to false anywhere in the drive').toBe(true);
      const save = await readState<Save>(page, 'save.json');
      expect(save?.lanternLight, 'declining spends nothing — the light is still held').toBe(true);
    } finally {
      await restoreLootState(page, beforeSave, beforeInv);
    }
  });
});
