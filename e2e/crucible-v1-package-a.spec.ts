import { test, expect, type Page } from '@playwright/test';
import {
  waitReady,
  currentScene,
  readState,
  waitForState,
  canvasClick,
  tapKey,
  waitHamletPlayer,
  waitProvincesLoaded,
  warpHamletTo,
  enterVaultsViaGate,
} from './helpers';

/**
 * Crucible v1 Package A (dungeon/hamlet/persistence) regression specs — one per fixed
 * finding, run against this agent's own scratch server (never 5175/5219). Uses the dev
 * packless fixture (?dev=1 → app/src/game/scenes/dungeon/__fixtures__/dev.dungeon.json:
 * under-1, under-2, under-3 (gated), under-boss) unless a finding specifically needs the
 * real installed vc-law pack (V1-16).
 */

const EV = 'screenshots';

type Save = {
  scene?: string;
  hp?: number;
  streak?: number;
  lastPlayed?: string;
  dungeon?: { roomIndex: number; cleared: string[]; gatePending?: string };
};
type Srs = { facts?: Record<string, unknown> };

async function seedSave(page: Page, data: Save): Promise<void> {
  await page.request.put('/api/state/save.json', { data });
}

/** Fill the free_recall textarea with deliberately unrelated text and submit — the stub
 *  judge's keyword-overlap heuristic (app/src/judge/stub.ts) reliably grades this a 'fail'
 *  (quality 0) regardless of which real pack encounter substituted in for the request. */
async function answerGateWrong(page: Page): Promise<void> {
  await page.locator('.fw-textarea').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
  await page.locator('.fw-textarea').fill('zzz completely unrelated nonsense zzz qqq');
  await page.getByRole('button', { name: 'Cast' }).click();
  // Cast awaits an async judge round-trip (kinds.ts's renderFreeRecall submit() calls
  // ctx.judge(), a POST to the dev bridge's /api/judge) before the verdict + Onward button
  // render — under CPU starvation (parallel agent fleets) that round-trip balloons past a
  // fixed delay. A fixed 300ms wait + single-shot count() check caught the button not yet
  // rendered and silently skipped the click forever, stranding runGate's pending encounter
  // promise. Wait for it instead of sampling once — same hardening family as
  // boss-victory.spec.ts's driveParley (commit 50d7216).
  const cont = page.getByRole('button', { name: 'Onward ▸' });
  await cont.waitFor({ state: 'visible', timeout: 10_000 });
  await cont.click();
  await page.waitForTimeout(250);
}

// ---------------------------------------------------------------------------------------
// V1-1 (sev4): reaching 0 pooled HP and clicking a room node used to bounce the player to
// hamlet with a generic toast — a dead end, since hamlet shows no HP indicator and the
// vaults' own halo affordance points straight back at the same "wrong" node. DungeonScene's
// enterRoom() now routes its hp<=0 branch through onCamp()'s existing heal-and-toast instead
// (Fade-flavored toast copy kept) — the wrong click becomes the fix. Covers the genuine
// INTERACTIVE click path (persist:false / 'wait' mode); the ?auto= dev-driver path (which
// needs persist:true so it never blocks on a click that will never come) is covered by the
// updated 'crucible #7/V1-1' test in e2e/crucible-combat.spec.ts.
// ---------------------------------------------------------------------------------------
test('V1-1: clicking a room node at 0 HP heals in place instead of bouncing to hamlet', async ({ page }) => {
  test.setTimeout(30_000);
  const before = await readState<Save>(page, 'save.json');
  try {
    await seedSave(page, { scene: 'vaults', hp: 0, streak: 0, lastPlayed: '' });
    await page.goto('/?scene=vaults&dev=1&seed=7'); // no auto= — genuine interactive click path
    await waitReady(page, 'vaults');
    await page.waitForTimeout(400);

    // fixture layout: camp at x~96, room0 ("under-1") at x~290, y=300 (5 nodes evenly spaced)
    await canvasClick(page, 290, 300);
    await page.waitForTimeout(500);

    expect(await currentScene(page), 'stays in vaults — no bounce to hamlet').toBe('vaults');
    const afterClick = await readState<Save>(page, 'save.json');
    expect(afterClick?.hp, 'healed in place (onCamp), not left stranded at 0').toBe(16);
    expect(afterClick?.scene, 'scene persists as vaults, not hamlet').toBe('vaults');
    expect(afterClick?.dungeon?.cleared ?? [], 'no room falsely marked cleared by the heal').toEqual([]);

    await page.screenshot({ path: `${EV}/v1-1-heal-in-place.png` });

    // the camp card is up in 'wait' mode (interactive path) — dismiss it and confirm we're
    // still in vaults afterward (no further scene change from just closing the card)
    await canvasClick(page, 480, 270);
    await page.waitForTimeout(300);
    expect(await currentScene(page), 'still vaults after dismissing the camp card').toBe('vaults');
  } finally {
    await seedSave(page, before ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' });
  }
});

// ---------------------------------------------------------------------------------------
// V1-3 (sev3): 3 retreat paths visually reach hamlet with a toast, but none of them saved
// scene:'hamlet' before scene.start — a reload within the ~1s toast window resumed vaults'
// resume-choice dialog instead of hamlet, contradicting what the player just saw. One of the
// 3 sites (enterRoom's own 0-hp guard) is superseded entirely by V1-1 (it no longer leaves
// vaults at all). This covers the remaining 2 sites' shared fix: persist scene:'hamlet'
// BEFORE scene.start, mirroring bossVictory's already-correct pattern. Uses the gate's
// HP-exhausted branch (runGate) — reachable deterministically via the packless dev fixture's
// sim=true synthetic-victory path, so combat RNG never interferes with the HP arithmetic.
// ---------------------------------------------------------------------------------------
test('V1-3: a gate-exhausted retreat persists scene:hamlet before the visual transition', async ({ page }) => {
  test.setTimeout(60_000);
  const before = await readState<Save>(page, 'save.json');
  try {
    await seedSave(page, {
      scene: 'vaults',
      hp: 1, // GATE_FAIL_HP=1 — a single gate miss exhausts it
      streak: 0,
      lastPlayed: '',
      dungeon: { roomIndex: 2, cleared: ['under-1', 'under-2'] }, // under-3 (gated) is current
    });
    // dev=1 with no explicit sim= defaults sim=true: doCombat() synthesizes an instant,
    // zero-hpLost victory, so only the GATE (not combat RNG) can move hp from here.
    await page.goto('/?scene=vaults&dev=1&auto=win&seed=7');

    await answerGateWrong(page);

    // hp should now read 0 (1 - GATE_FAIL_HP) and the Fade-closes-in branch should have
    // ALREADY persisted scene:'hamlet' — poll immediately rather than waiting for the ~1s
    // visual transition, which is exactly the gap the pre-fix bug lived in.
    //
    // runGate() (DungeonScene.ts) persists this in TWO separate awaited save() calls:
    // applyHp() writes {hp} first, then (after a services.save.get() readback + a toast)
    // a second call writes {scene:'hamlet'}. Under CPU starvation the gap between those two
    // awaited round-trips balloons, and a poll keyed on hp alone can catch save.json mid-gap
    // (hp already 0, scene still 'vaults') — confirmed empirically under 8-burner load. Poll
    // for the FULL settled condition, not just the half that lands first — same hardening
    // family as boss-victory.spec.ts's driveParley (commit 50d7216).
    const save = await waitForState<Save>(
      page,
      'save.json',
      (d) => d?.hp === 0 && d?.scene === 'hamlet',
      10_000,
    );
    expect(
      save?.scene,
      'V1-3: scene:hamlet persisted the moment hp hit 0, not only after the visual transition',
    ).toBe('hamlet');

    // and the visual transition follows through
    await expect.poll(() => currentScene(page), { timeout: 5000 }).toBe('hamlet');
  } finally {
    await seedSave(page, before ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' });
  }
});

// ---------------------------------------------------------------------------------------
// V1-12 (sev3): a gate wipe used to discard an already-won room's combat clear — runGate's
// hp<=0 branch returned before markRoomCleared() was ever reached, so dungeon.cleared omitted
// the room and re-entering later re-fought the FULL combat from scratch. Contradicts
// Fable_SPEC.md:31 ("wipes cost the loot roll, never story progress"). resolveCombat now
// marks + persists the win immediately after the retreat check, before the gate runs — a
// gate wipe only re-triggers the gate (were sub-room state to exist), never the combat.
//
// crucible-2 amendment: that sub-room state now exists. Crediting the win as a FULL room
// clear overshot — the node came back marked ✓ with its ward, loot and streak gone for good
// (a cleared node only re-shows its blurb). The win is now banked as `dungeon.gatePending`
// instead: the room stays uncleared (the ward really is still shut) while re-entry resumes
// straight into the drill without re-fighting. V1-12's invariant is unchanged and this
// asserts it more exactly.
// ---------------------------------------------------------------------------------------
test('V1-12: a gate wipe banks the combat win without granting passage (fight not re-litigated)', async ({ page }) => {
  test.setTimeout(60_000);
  const before = await readState<Save>(page, 'save.json');
  try {
    await seedSave(page, {
      scene: 'vaults',
      hp: 1,
      streak: 0,
      lastPlayed: '',
      dungeon: { roomIndex: 2, cleared: ['under-1', 'under-2'] },
    });
    await page.goto('/?scene=vaults&dev=1&auto=win&seed=7');

    await answerGateWrong(page);
    await waitForState<Save>(page, 'save.json', (d) => d?.hp === 0, 10_000);

    const save = await readState<Save>(page, 'save.json');
    expect(
      save?.dungeon?.gatePending,
      'V1-12: the won fight is banked, so re-entry resumes the ward instead of the battle',
    ).toBe('under-3');
    // …and passage is NOT granted: an unopened ward is not a passed vault (crucible-2).
    expect(
      save?.dungeon?.cleared ?? [],
      'crucible-2: the wiped gate room is not marked cleared',
    ).not.toContain('under-3');

    // control: loot/streak are still correctly withheld on a gate wipe — only story
    // progress (the combat clear) survives, matching Fable_SPEC.md:31 exactly.
    expect(save?.streak ?? -1, 'streak not bumped on a gate wipe').toBe(0);
  } finally {
    await seedSave(page, before ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' });
  }
});

// ---------------------------------------------------------------------------------------
// V1-16 (sev3): dev=1 always resolves rooms/boss content from the packless fixture, but a
// REAL packId chosen via HamletScene's South Gate (Alder) used to survive unchanged into the
// dungeon's launch object — a fixture-only boss-phase branchEncounterId requested against
// that real, installed pack (which never defines it) silently substituted an arbitrary real
// encounter (encounters/engine.ts's pick() candidates[0] fallback), same bug class as the
// already-fixed crucible #11 but on a different, not-yet-covered path. DungeonScene.init()
// now forces packId to FIXTURE_PACK_ID whenever dev=1, regardless of what was passed in —
// the SAME marker CombatScene's own crucible #11 reconciler already recognizes — so that
// reconciler now also fires here, swapping in the REAL installed pack's own authored boss
// phases instead of leaving a fixture/real hybrid.
// ---------------------------------------------------------------------------------------
async function lastEncounterId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { lastEncounterId?(): string | null } | undefined;
    return s?.lastEncounterId?.() ?? null;
  });
}

test('V1-16: a real province chosen under dev=1 reaches the boss with a reconciled, matching pack (not a fixture/real hybrid)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const before = await readState<Save>(page, 'save.json');
  try {
    await seedSave(page, { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' });
    // dev=1 (fixture rooms/boss) + sim=0 (real, non-simulated CombatScene) + auto=boss
    // (DungeonScene's own dev driver: marks pre-boss rooms cleared, then enters the boss
    // room in 'drive' mode) sitting in the URL throughout — including through the hamlet
    // gate walk below, which is what hands DungeonScene a REAL chosen packId while dev=1
    // is active, the exact repro shape.
    await page.goto('/?scene=hamlet&dev=1&sim=0&auto=boss&seed=7');
    await waitReady(page, 'hamlet');
    await waitHamletPlayer(page);
    const provincesLoaded = await waitProvincesLoaded(page);
    expect(provincesLoaded, 'a real province (vc-law) is installed and loaded').toBe(true);

    // Walk to the South Gate and pick the (default, first) real province — this is the
    // HamletScene.doGate() call site that hands DungeonScene a real packId while dev=1 is
    // still set in the URL. Reuses the shared gate-walk helper (real input, closed-loop).
    // NOTE: this URL's auto=boss makes DungeonScene auto-drive straight through vaults into
    // combat the instant it boots, often faster than enterVaultsViaGate's own polling can
    // observe an intermediate 'vaults' reading — so its return value isn't asserted here;
    // what matters is that the walk got PAST hamlet at all (proven by waitReady('combat')
    // below actually resolving, rather than timing out stuck in hamlet or a cancelled gate).
    await enterVaultsViaGate(page);

    // auto=boss now auto-drives straight to the boss room via REAL combat.
    await waitReady(page, 'combat');

    // the boss-phase overlay (scenario_branch) opens after a reveal beat — same settle
    // delay the existing crucible #11 test in e2e/crucible-combat.spec.ts uses.
    await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(600);
    await page.keyboard.press('1');
    const cont = page.getByRole('button', { name: 'Onward ▸' });
    await cont.waitFor({ state: 'visible', timeout: 10_000 });
    await cont.click();
    await page.waitForTimeout(300);

    const id = await lastEncounterId(page);
    expect(id, 'a boss-phase encounter resolved').not.toBeNull();
    // vc-law's real authored boss phases are named enc.sb.boss*; the dev fixture's own
    // placeholder ids (moss.boss.pN) or an arbitrary unrelated real encounter are both the
    // pre-fix, mismatched-hybrid giveaway.
    expect(
      id,
      'resolved a REAL vc-law-authored boss-phase encounter, not a mismatched fixture/real hybrid',
    ).toMatch(/^enc\.sb\.boss/);

    await page.screenshot({ path: `${EV}/v1-16-boss-reconciled.png` });
  } finally {
    await seedSave(page, before ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' });
  }
});

// ---------------------------------------------------------------------------------------
// V1-17 (sev3): Escape during the Wellspring intro used to discard dialogue.run()'s resolved
// value entirely and proceed unconditionally into the graded drill — the one place in the
// hamlet where "never mind" silently committed you anyway, writing an unconsented SRS grade
// (state/ is explicitly precious). wellspringIntro() now has real choices (a proceed value,
// and '__cancel__'), and doWellspring() bails like doGate()/doFactor() already do.
// ---------------------------------------------------------------------------------------
test('V1-17: Escaping the Wellspring intro cancels — no drill opens, no SRS grade recorded', async ({ page }) => {
  test.setTimeout(60_000);
  const beforeSave = await readState<Save>(page, 'save.json');
  const beforeSrs = await readState<Srs>(page, 'srs.json');
  await page.goto('/?scene=hamlet&seed=7');
  await waitReady(page, 'hamlet');
  await waitHamletPlayer(page);
  await waitProvincesLoaded(page);

  const warped = await warpHamletTo(page, 'wellspring');
  expect(warped, 'warp hook parked the Keeper at the Wellspring').toBe(true);
  await tapKey(page, 'e'); // open the intro (real keypress)
  await page.waitForTimeout(220);
  await page.keyboard.press('Escape'); // cancel mid-typewriter — the exact repro
  await page.waitForTimeout(1200); // past the ~1s window a silently-committed drill would need

  expect(await page.locator('.fw-overlay').count(), 'no graded drill opened after Escape').toBe(0);
  const afterSrs = await readState<Srs>(page, 'srs.json');
  expect(
    Object.keys(afterSrs?.facts ?? {}).length,
    'no new SRS grade written by a cancelled drill',
  ).toBe(Object.keys(beforeSrs?.facts ?? {}).length);
  const afterSave = await readState<Save>(page, 'save.json');
  expect(afterSave?.streak ?? 0, 'streak did not bump from a cancelled drill').toBe(beforeSave?.streak ?? 0);
});

test('V1-17: choosing to proceed at the Wellspring intro still opens the drill (choices did not break the happy path)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=hamlet&seed=7');
  await waitReady(page, 'hamlet');
  await waitHamletPlayer(page);
  await waitProvincesLoaded(page);

  const warped = await warpHamletTo(page, 'wellspring');
  expect(warped, 'warp hook parked the Keeper at the Wellspring').toBe(true);
  await tapKey(page, 'e');
  await page.waitForTimeout(220);
  // advance the intro (typewriter skip / next page / confirm the default first choice —
  // "Recall them") until the first drill encounter opens, same loop shape as the existing
  // wellspring-srs.spec.ts, which this content.ts change must not disturb.
  for (let k = 0; k < 12; k++) {
    if (await page.locator('.fw-overlay').count()) break;
    await tapKey(page, 'e');
    await page.waitForTimeout(300);
  }
  await expect(page.locator('.fw-overlay'), 'choosing to proceed still opens the graded drill').toBeVisible({
    timeout: 8000,
  });
});

// ---------------------------------------------------------------------------------------
// V1-20 (sev2): the "Continue from X" resume-prompt button only called focusNode() (a
// cosmetic scale tween) instead of enterRoom(idx) — the card closed, the node pulsed, but
// scene/progress were unchanged even 1.5s later. offerResume()'s 'continue' branch now
// calls enterRoom(idx) directly.
// ---------------------------------------------------------------------------------------
test('V1-20: "Continue from X" actually enters the room, not just a cosmetic pulse', async ({ page }) => {
  test.setTimeout(30_000);
  const before = await readState<Save>(page, 'save.json');
  try {
    await seedSave(page, {
      scene: 'vaults',
      hp: 16,
      streak: 0,
      lastPlayed: '',
      dungeon: { roomIndex: 1, cleared: ['under-1'] }, // under-2 is current; resumable (1 room already cleared)
    });
    // dev=1, no sim= override → sim defaults true (synthetic instant victory), so the whole
    // chain (blurb → teaching → combat) completes without needing a real fight.
    await page.goto('/?scene=vaults&dev=1&seed=7');
    await waitReady(page, 'vaults');
    await page.waitForTimeout(500); // let offerResume()'s card render

    // showResumeChoice: 500x232 panel, buttons at (cx, top+84) "Continue from X" and
    // (cx, top+136) "Return to the camp" — cx=480, top=182.
    await canvasClick(page, 480, 266); // "Continue from The Sunken Reading-Room"
    await page.waitForTimeout(500);

    // the blurb card (enterRoom's first UI action) is up in 'wait' mode — dismiss it
    await canvasClick(page, 480, 270);
    await page.waitForTimeout(400);

    // the teaching modal (under-2 has 1 fact → its only page already reads "Close the
    // archive") — dismiss it so the sim-combat/resolveCombat chain can complete
    const closeArchive = page.getByRole('button', { name: 'Close the archive' });
    if (await closeArchive.count()) await closeArchive.click();

    // proof enterRoom() genuinely ran (not just a cosmetic tween): the room becomes cleared
    const save = await waitForState<Save>(
      page,
      'save.json',
      (d) => (d?.dungeon?.cleared ?? []).includes('under-2'),
      15_000,
    );
    expect(save?.dungeon?.cleared, 'V1-20: Continue actually entered and cleared the room').toContain(
      'under-2',
    );
  } finally {
    await seedSave(page, before ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' });
  }
});
