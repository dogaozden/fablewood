import { test, expect, type Page } from '@playwright/test';
import { waitReady, readState } from './helpers';

// magic-combat-depth.md Phase 3 (§9) — the Vault-Warden reforged, driven live.
//
// Covers the spec's own three e2e verdicts:
//   1. Objection! — a free Strike at the Warden is negated with the banner "Overruled." and
//      answered by a 1-damage riposte. This is soul guarantee S4's visible half: only FREE
//      steel gets lawyered, never an answered question (the exhaustive "never on an Art"
//      proof is the unit test in combat.test.ts, over all 15 spells).
//   2. Call the Clause — a clause-wisp really appears mid-battle AND is really appended to
//      the initiative order (orderDebug, not just a unit count).
//   3. The full negotiation still completes: three correct Parleys still open the vault, with
//      the Warden at his new 12 HP and the phase script running underneath.
//
// Route: the standalone dev/e2e combat fixture (`?scene=combat&boss=1`, combat/fixtures.ts) —
// boss.name 'The Vault-Warden', shields 3, one trash wisp ('wisp-0'). CombatScene's
// routeFixtureBossToInstalledPack swaps the fixture's placeholder phases for the installed
// vc-law pack's real enc.sb.boss1/2/3, so the Parley CONTENT here is the pack's own (hence
// CORRECT_BRANCH_PREFIX below, lifted from boss-victory.spec.ts). It copies only `phases`,
// NOT `moveLabels` — so this fixture path deliberately exercises the ENGINE-GENERIC move
// labels ("Writ of Seizure", "Call the Clause"), which is exactly what an engine spec should
// assert. The pack's relabels are covered by pipeline/validate_dungeon.test.mjs.
//
// Timing discipline: a parallel agent fleet is running, so every wait here is expect.poll or
// a state predicate — never a fixed sleep standing in for a condition. (The few short
// waitForTimeouts that remain are deliberate input arming, matching the existing specs'
// 600ms pre-press guard, not condition waits.)

const EV = 'screenshots';

type Save = { scene?: string; hp?: number; streak?: number; lastPlayed?: string };
type Inventory = { version: number; gold: number; stacks: Record<string, number> };

type Snap = {
  state: string; activeTeam: string | null; activeId: string; enemyHp: number; partyHp: number;
  log: Array<{ action: string; dmg: number; overlay: boolean }>;
  rank: number; welded3: number; welded4: number; glow: number;
} | null;

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as Snap;
  });
}

async function bannerText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { bannerText?(): string } | undefined;
    return s?.bannerText?.() ?? '';
  });
}

/**
 * Start an IN-PAGE banner recorder (25ms sampler pushing each distinct banner into a window
 * array). Necessary, not belt-and-braces: the Warden's move banners live for roughly one
 * delayedCall(460) before the next unit's turn line replaces them, and "Call the Clause" fires
 * exactly ONCE per battle — an expect.poll whose round-trip happens to land after that window
 * would never see it again, no matter how long its timeout. Sampling inside the page removes
 * the round-trip from the race entirely. Purely test-side: no app hook exists for this.
 */
async function startBannerRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __fwBanners?: string[]; __fwBannerTimer?: number };
    w.__fwBanners = [];
    if (w.__fwBannerTimer) clearInterval(w.__fwBannerTimer);
    w.__fwBannerTimer = setInterval(() => {
      const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
      const s = g?.scene?.getScene?.('combat') as { bannerText?(): string } | undefined;
      const t = s?.bannerText?.() ?? '';
      const arr = w.__fwBanners!;
      if (t && arr[arr.length - 1] !== t) arr.push(t);
    }, 25) as unknown as number;
  });
}

/** Every distinct banner the recorder has seen since it started. */
async function recordedBanners(page: Page): Promise<string[]> {
  return page.evaluate(() => ((window as unknown as { __fwBanners?: string[] }).__fwBanners ?? []).slice());
}

/** Wait until some recorded banner contains `text` — the race-free form of a banner assertion. */
async function expectBannerSeen(page: Page, text: string, message: string, timeout = 90_000): Promise<void> {
  await expect
    .poll(async () => ((await recordedBanners(page)).some((b) => b.includes(text)) ? 'seen' : 'not-yet'),
      { message, timeout })
    .toBe('seen');
}

/**
 * Wait for a banner while KEEPING THE ROUND MOVING: whenever a party turn opens, press Wait
 * ('7'). Without this the initiative loop simply parks on the next party unit and the enemy —
 * the Warden — never gets another turn, so any wait on one of HIS banners would time out
 * having proved nothing about the feature. Wait is the inert action (§4.5: "Wait keeps its
 * slot and gains no secret powers"), so passing turns cannot influence what is being asserted.
 */
async function driveTurnsUntilBanner(page: Page, text: string, message: string, timeout = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await recordedBanners(page)).some((b) => b.includes(text))) return;
    const s = await snap(page);
    if (s?.state === 'over') break;
    if (s?.state === 'playerMove') {
      await page.keyboard.press('7'); // Wait — hand the turn back without acting
    }
    await page.waitForTimeout(120);
  }
  await expectBannerSeen(page, text, message, 5_000);
}

async function orderDebug(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { orderDebug?(): string[] } | undefined;
    return s?.orderDebug?.() ?? [];
  });
}

async function unitDebug(page: Page, id: string): Promise<{ hp: number; alive: boolean; c: number; r: number } | null> {
  return page.evaluate((uid) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { unitDebug?(id: string): unknown } | undefined;
    return (s?.unitDebug?.(uid) ?? null) as { hp: number; alive: boolean; c: number; r: number } | null;
  }, id);
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

/** tileToScreen: ORIGIN(192,48) + c*48+24, r*48+24 (same formula boss-victory.spec.ts uses). */
async function clickTile(page: Page, c: number, r: number): Promise<void> {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const ix = 192 + c * 48 + 24;
  const iy = 48 + r * 48 + 24;
  await page.mouse.click(box.x + (ix / 960) * box.width, box.y + (iy / 540) * box.height);
}

/** Poll the live combat snapshot until `pred` holds. expect.poll so a slow frame under a
 *  parallel fleet extends the wait instead of failing it. */
async function waitForCombat(page: Page, pred: (s: Snap) => boolean, message: string, timeout = 40_000): Promise<Snap> {
  await expect.poll(async () => (pred(await snap(page)) ? 'yes' : 'no'), { message, timeout }).toBe('yes');
  return snap(page);
}

// The pack's own authored correct-branch text per boss phase (packs/vc-law/pack.json).
// encounters/engine.ts's reskin() seed-shuffles branch ORDER, so options are matched BY TEXT,
// never by slot or hotkey (the hard-won lesson recorded in boss-victory.spec.ts's header).
const CORRECT_BRANCH_PREFIX = [
  'Cite the standard',           // enc.sb.boss1-preference-multiple
  'Counter to nonparticipating', // enc.sb.boss2-participation-cap
  'Counter both terms',          // enc.sb.boss3-antidilution-pool
];

/**
 * Drive one automatic boss Parley. `pick: 'correct'` clicks the pack's authored correct branch
 * (shield shatters); `pick: 'wrong'` clicks any OTHER rendered branch, which leaves the shields
 * standing — that is what keeps the fight alive past the third phase so the Warden actually
 * takes turns at phaseIndex 2+ and Call the Clause can fire.
 */
async function driveParley(page: Page, phaseNum: number, pick: 'correct' | 'wrong'): Promise<void> {
  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 40_000 });
  await expect(page.locator('.fw-eyebrow'), `phase ${phaseNum} opens a Parley`).toContainText('Parley');

  const labels = await page.locator('.fw-optlabel').allTextContents();
  const prefix = CORRECT_BRANCH_PREFIX[phaseNum - 1];
  const correctIdx = labels.findIndex((l) => l.startsWith(prefix));
  expect(correctIdx, `phase ${phaseNum}: found the authored correct branch ("${prefix}") among ${JSON.stringify(labels)}`)
    .toBeGreaterThanOrEqual(0);
  const idx = pick === 'correct' ? correctIdx : labels.findIndex((_, i) => i !== correctIdx);
  expect(idx, `phase ${phaseNum}: found a '${pick}' branch to click`).toBeGreaterThanOrEqual(0);

  await page.waitForTimeout(600); // deliberate input arming (the existing specs' pre-press guard)
  await page.locator('.fw-opt').nth(idx).click();
  const cont = page.getByRole('button', { name: 'Onward ▸' });
  await cont.waitFor({ state: 'visible', timeout: 20_000 });
  await cont.click();

  if (pick === 'correct') {
    await expect
      .poll(() => bannerText(page), { message: `phase ${phaseNum}'s correct branch shatters a shield`, timeout: 20_000 })
      .toContain('shield shatters');
  }
  // The post-branch effect lands inside a delayedCall(900); wait for the board to actually be
  // playable (or the fight to be over) rather than sleeping through it.
  await waitForCombat(page, (s) => s?.state === 'playerMove' || s?.state === 'over',
    `phase ${phaseNum} handed control back (or ended the fight)`);
}

/** Drive ONE T1 Cast (Attestation, hotkey '5') at the Warden — the only action that advances
 *  phaseIndex and re-arms the next Parley (answerCast idiom from boss-victory.spec.ts). */
async function driveCastOnWarden(page: Page): Promise<void> {
  for (let guard = 0; guard < 8; guard++) {
    const s = await waitForCombat(page, (x) => x?.state === 'playerMove', 'a party turn opened for manual control');
    const active = s!.activeId;

    await debugSetPos(page, active, 5, 3);
    await debugSetPos(page, 'warden', 6, 3); // range 1 — always in Cast range (3)
    await debugSetPos(page, 'wisp-0', 1, 1); // parked away — never the click target

    await page.keyboard.press('5');
    await expect.poll(async () => (await snap(page))?.state, { message: 'Cast entered targeting', timeout: 10_000 })
      .toBe('playerTarget');

    await clickTile(page, 6, 3);
    await page.locator('.fw-textarea').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(450); // overlay.ts's paint-anchored 400ms answer guard
    await page.locator('.fw-textarea').fill(
      'The Warden’s terms favor the house: a 1x liquidation preference is the market standard, ' +
      'nonparticipating preferred avoids the double dip, and weighted-average antidilution with a ' +
      'right-sized option pool protects the founders’ pre-money stake.',
    );
    await page.getByRole('button', { name: 'Cast' }).click();
    const cont = page.getByRole('button', { name: 'Onward ▸' });
    try {
      await cont.waitFor({ state: 'visible', timeout: 15_000 });
      await cont.click();
    } catch { /* a fully auto-resolving pass needs no continue click */ }
    // The honest completion signal is the recall overlay tearing down — NOT `state !== 'resolving'`:
    // a Cast at the Warden re-arms the next boss phase, and openBossPhase holds `state` at
    // 'resolving' for as long as its own Parley overlay is open (deadlocking that predicate).
    // Whatever comes next (a Parley overlay, or ordinary turns) waits on its own condition.
    await page.locator('.fw-textarea').waitFor({ state: 'detached', timeout: 20_000 });
    return;
  }
  throw new Error('driveCastOnWarden: could not land a Cast on the Warden after 8 attempts');
}

/** Restore the shared state files this spec seeds (boot-resume.spec.ts's restoreSave idiom). */
async function restoreState(page: Page, save: Save | null, inv: Inventory | null): Promise<void> {
  const saveData: Save = save ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
  const invData: Inventory = inv ?? { version: 1, gold: 20, stacks: {} };
  await page.goto('about:blank'); // kill the app context so no scene write races the restore
  for (let i = 0; i < 5; i++) {
    await page.request.put('/api/state/save.json', { data: saveData });
    await page.request.put('/api/state/inventory.json', { data: invData });
    const nowSave = (await page.request.get('/api/state/save.json').then((r) => r.json()).catch(() => undefined)) as Save | undefined;
    if (nowSave?.scene === saveData.scene) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function seed(page: Page): Promise<void> {
  await page.request.put('/api/state/save.json', { data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' } });
  await page.request.put('/api/state/inventory.json', { data: { version: 1, gold: 20, stacks: { 'embermend-draught': 2 } } });
}

// ---------------------------------------------------------------------------------------
test('§9.3 Objection! — a free Strike at the Warden is overruled and riposted; the Art is not', async ({ page }) => {
  test.setTimeout(180_000);
  const beforeSave = await readState<Save>(page, 'save.json');
  const beforeInv = await readState<Inventory>(page, 'inventory.json');

  try {
    await seed(page);
    await page.goto('/?scene=combat&seed=7&boss=1');
    await waitReady(page, 'combat');
    await startBannerRecorder(page);

    // Phase 1's Parley opens automatically; answer it to reach ordinary turns.
    await driveParley(page, 1, 'correct');

    const s = await waitForCombat(page, (x) => x?.state === 'playerMove', 'a party turn opened');
    const active = s!.activeId;
    const wardenBefore = await unitDebug(page, 'warden');
    expect(wardenBefore, 'the boss unit is readable').not.toBeNull();
    // §9.1 — the reforged Warden's pool.
    expect(wardenBefore!.hp, 'the Warden fights at his new 12 HP (§9.1)').toBe(12);
    const partyBefore = s!.partyHp;

    // Stand adjacent to the Warden and swing FREE steel at him (hotkey '1' = Strike).
    await debugSetPos(page, active, 5, 3);
    await debugSetPos(page, 'warden', 6, 3);
    await debugSetPos(page, 'wisp-0', 1, 1);
    await page.keyboard.press('1');
    await expect.poll(async () => (await snap(page))?.state, { message: 'Strike entered targeting', timeout: 10_000 })
      .toBe('playerTarget');
    await clickTile(page, 6, 3);

    // THE VERDICT: the banner reads exactly the spec's word.
    await expectBannerSeen(page, 'Overruled.', '§9.3 — the free Strike is Objected with "Overruled."', 20_000);
    expect(await bannerText(page), 'the Objection banner is still the one on screen').toContain('Overruled.');
    await page.screenshot({ path: `${EV}/e2e-boss-reforged-objection-banner.png` });

    // …and the log records the reaction, the Warden takes NO damage, and the party pays 1.
    const after = await snap(page);
    expect(after!.log.some((l) => l.action === 'objection'), 'the Objection is recorded in the action log').toBe(true);
    const wardenAfter = await unitDebug(page, 'warden');
    expect(wardenAfter!.hp, 'the negated Strike cost the Warden no HP').toBe(wardenBefore!.hp);
    expect(after!.partyHp, 'the riposte cost the party exactly 1 (§9.3)').toBe(partyBefore - 1);

    // Once per round: a SECOND free Strike in the same round is not Objected again. (It is
    // still absorbed by the shields — the point is only that the reaction does not re-arm.)
    const logAfterFirst = after!.log.filter((l) => l.action === 'objection').length;
    expect(logAfterFirst, 'exactly one Objection so far').toBe(1);

    // §9.4/§9.5 — his phase-1 base kit announces itself by its engine-generic name when he
    // swings back. (The fixture carries no pack moveLabels — see the file header.)
    await driveTurnsUntilBanner(page, 'Writ of Seizure',
      '§9.4 — the Warden answers with his base kit, the Writ of Seizure', 60_000);
    await page.screenshot({ path: `${EV}/e2e-boss-reforged-writ-of-seizure.png` });
  } finally {
    await restoreState(page, beforeSave, beforeInv);
  }
});

// ---------------------------------------------------------------------------------------
test('§9.4 Call the Clause — a clause-wisp spawns and is appended to the initiative order', async ({ page }) => {
  test.setTimeout(240_000);
  const beforeSave = await readState<Save>(page, 'save.json');
  const beforeInv = await readState<Inventory>(page, 'inventory.json');

  try {
    await seed(page);
    await page.goto('/?scene=combat&seed=7&boss=1');
    await waitReady(page, 'combat');
    await startBannerRecorder(page);

    const orderAtStart = await orderDebug(page);
    expect(orderAtStart, 'the fixture boss room starts with keeper/mira/wisp-0/warden').toHaveLength(4);

    // Reach phaseIndex 2 (the third phase) with shields still standing: answer every Parley
    // with a WRONG branch so no shield shatters and the fight cannot end at the third one.
    // Each Cast advances phaseIndex and re-arms the next Parley.
    await driveParley(page, 1, 'wrong');
    await driveCastOnWarden(page);
    await driveParley(page, 2, 'wrong');
    await driveCastOnWarden(page);
    await driveParley(page, 3, 'wrong');

    // Now ordinary turns run at phaseIndex 2, so the Warden's next turn calls the clause —
    // announced by its engine-generic label (the fixture carries no pack moveLabels).
    await driveTurnsUntilBanner(page, 'Call the Clause',
      '§9.4 — the Warden reaches a phase-3 turn and calls the clause', 90_000);
    await page.screenshot({ path: `${EV}/e2e-boss-reforged-clause-wisp.png` });
    expect((await snap(page))!.log.some((l) => l.action === 'summon'), 'the summon is recorded in the action log').toBe(true);

    // The wisp is REAL: a new unit exists, alive, on the board…
    const order = await orderDebug(page);
    expect(order.length, 'the initiative order grew by exactly one').toBe(orderAtStart.length + 1);
    const spawnedId = order[order.length - 1];
    expect(spawnedId, 'the reinforcement was APPENDED (last initiative slot), never spliced in')
      .not.toBe(orderAtStart[orderAtStart.length - 1]);
    expect(spawnedId, 'the reinforcement is a wisp').toMatch(/^wisp-/);
    expect(orderAtStart, 'and its id is genuinely new, not a reused one').not.toContain(spawnedId);

    const wisp = await unitDebug(page, spawnedId);
    expect(wisp, 'the spawned unit really exists in the scene').not.toBeNull();
    expect(wisp!.alive, 'the clause-wisp spawned alive').toBe(true);
    expect(wisp!.hp, 'the clause-wisp is a standard 2hp wisp').toBe(2);

    // …and once per battle only: the log never gains a second summon.
    const summons = (await snap(page))!.log.filter((l) => l.action === 'summon').length;
    expect(summons, 'Call the Clause is once per battle').toBe(1);

    // The order stayed wrap-safe: the loop kept running and reached a party turn again.
    await waitForCombat(page, (s) => s?.state === 'playerMove' || s?.state === 'over',
      'the turn loop keeps running with the appended unit in the order', 90_000);
  } finally {
    await restoreState(page, beforeSave, beforeInv);
  }
});

// ---------------------------------------------------------------------------------------
test('the full negotiation still completes — three correct Parleys open the vault', async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  const beforeSave = await readState<Save>(page, 'save.json');
  const beforeInv = await readState<Inventory>(page, 'inventory.json');

  try {
    await seed(page);
    await page.goto('/?scene=combat&seed=7&boss=1');
    await waitReady(page, 'combat');
    await startBannerRecorder(page);

    await driveParley(page, 1, 'correct'); // shields 3 -> 2
    await driveCastOnWarden(page);
    await driveParley(page, 2, 'correct'); // shields 2 -> 1
    await driveCastOnWarden(page);
    await driveParley(page, 3, 'correct'); // shields 1 -> 0 -> victory

    const dead = await waitForCombat(page, (s) => s?.state === 'over',
      'the third shield broke and combat resolved', 40_000);
    await page.screenshot({ path: `${EV}/e2e-boss-reforged-negotiation-victory.png` });
    expect(dead!.partyHp, 'the party survived with HP to spare').toBeGreaterThan(0);
    expect(Number.isFinite(dead!.partyHp), 'partyHp is finite, not NaN').toBe(true);
    expect(Number.isFinite(dead!.enemyHp), 'enemyHp is finite, not NaN').toBe(true);

    expect(pageErrors.length, `no uncaught page errors during the reforged fight: ${pageErrors.join(' | ')}`).toBe(0);
  } finally {
    await restoreState(page, beforeSave, beforeInv);
  }
});
