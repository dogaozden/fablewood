import { test, expect, type Page } from '@playwright/test';
import { waitReady, currentScene, readState } from './helpers';

// Genuine Vault-Warden kills — the boss-victory path had zero suite coverage before this file
// (promoted from a read-only boss-kill-lens playtest pilot that proved both routes live, on its
// own isolated server, before this promotion). Two tests, two ways a player reaches the fight:
//   1. the standalone dev/e2e combat fixture (combat/fixtures.ts, `?scene=combat&boss=1`) —
//      boss.name 'The Vault-Warden', one trash wisp.
//   2. the real dungeon flow (`?scene=vaults&dev=1&sim=0&auto=boss`, DungeonScene's packless
//      dev.dungeon.json) — boss.name 'The Moss-Warden' (deliberately distinct: CombatScene.ts's
//      showBossReveal name-gates its portrait cutscene to the literal 'The Vault-Warden' art it
//      has, so this fixture's differently-named boss simply skips the reveal, by design), whose
//      own regular enemy is ALSO archetype 'warden' — same fight mechanics/8hp stat block as the
//      trash enemy, but until this promotion's fixture fix (units.ts's ENEMY_LABEL) it rendered
//      under the boss's own borrowed name in every turn/strike banner. Renamed to 'Root-Husk' so
//      it reads as its own creature; this file's second test targets it by unit id ('warden-0'),
//      unaffected by the label change.
//
// Both routes' Parley CONTENT is identical regardless: CombatScene.ts's routeFixtureBossToInstalledPack
// swaps a packless fixture's placeholder boss phases for the installed vc-law pack's real
// enc.sb.boss1/2/3 phases whenever a real pack is present (it is, here) — so both tests drive the
// same 3 real phases and share driveParley/CORRECT_BRANCH_PREFIX below.
//
// The fight's rhythm (boss.ts, units.ts, CombatScene.ts, read directly): shields:3/phases:3. Each
// phase opens an automatic Parley (scenario_branch) whose authored branches[] include exactly one
// `correct:true` option. Between phases, normal turns resume and a T1 Cast ('cast', hotkey 5,
// Attestation/free_recall) against the Warden is the ONLY action that pierces a shield
// (wardenAbsorbs allows 'cast' unconditionally) and unconditionally advances phaseIndex + re-arms
// the next Parley. So: Parley0 -> Cast -> Parley1 -> Cast -> Parley2 -> (shields hit 0 mid the
// post-Parley delayedCall) -> victory. Only 2 Casts are needed — shields already reach 0 right
// after the 3rd Parley's 'good' branch.
//
// IMPORTANT (discovered empirically, then confirmed in source): encounters/engine.ts's reskin()
// seed-shuffles scenario_branch's branches[] order (Fable_SPEC §2 "Reskin on repeat" anti-staleness
// — register.ts calls it on every runEncounter). So the FIRST rendered `.fw-optlabel` is NOT
// reliably the authored correct branch — pressing hotkey "1" blindly landed a 'neutral' stalemate
// in a live run of an earlier version of this exact test. The fix, preserved here: read each
// phase's rendered `.fw-optlabel` text and click whichever one matches the pack's own authored
// correct-branch text (packs/vc-law/pack.json) — match BY OPTION TEXT CONTENT, never a
// slot/hotkey.
//
// Shared .state-e2e hygiene: each test seeds its own save.json/inventory.json precondition (the
// chain.spec.ts idiom) and restores the exact pre-test snapshot in `finally` (boot-resume.spec.ts's
// restoreSave idiom) — both tests end in an unusual scene (fixture path: 'boot'; dungeon path:
// 'hamlet' with dungeon progress + streak bumped), so leaving either behind would poison whatever
// spec runs next in this shared, serial (workers:1) suite.

const EV = 'screenshots';

type Save = {
  scene?: string;
  hp?: number;
  streak?: number;
  lastPlayed?: string;
  dungeon?: { roomIndex: number; cleared: string[] };
};
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

/** True exactly while CombatScene's boss-phase-opening portrait reveal is on screen. Only the
 *  fixture-path boss ('The Vault-Warden') has matching art — see the file header. */
async function bossRevealActive(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { bossRevealActive?(): boolean } | undefined;
    return !!s?.bossRevealActive?.();
  });
}

async function lastEncounterId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { lastEncounterId?(): string | null } | undefined;
    return s?.lastEncounterId?.() ?? null;
  });
}

async function bannerText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { bannerText?(): string } | undefined;
    return s?.bannerText?.() ?? '';
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

/** tileToScreen: ORIGIN(192,48) + c*48+24, r*48+24 (same formula combat-magic.spec.ts uses). */
async function clickTile(page: Page, c: number, r: number): Promise<void> {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const ix = 192 + c * 48 + 24;
  const iy = 48 + r * 48 + 24;
  await page.mouse.click(box.x + (ix / 960) * box.width, box.y + (iy / 540) * box.height);
}

async function waitForCombatState(page: Page, pred: (s: Snap) => boolean, timeout = 25_000): Promise<Snap> {
  const start = Date.now();
  let s = await snap(page);
  while (!pred(s) && Date.now() - start < timeout) {
    await page.waitForTimeout(150);
    s = await snap(page);
  }
  return s;
}

/** Heal via the Satchel if the party pool is getting dangerously low (fairness safety valve,
 *  not part of the kill proof itself — the fight can and does hit the party). */
async function healIfLow(page: Page): Promise<void> {
  const s = await snap(page);
  if (!s || s.partyHp > 5) return;
  await page.keyboard.press('q');
  await page.locator('.inv-overlay').waitFor({ state: 'visible', timeout: 5_000 }).catch(() => null);
  if (await page.locator('.inv-overlay').count()) {
    const useBtn = page.locator('.inv-row').getByRole('button', { name: 'Use' }).first();
    if (await useBtn.count()) {
      await useBtn.click();
      await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => null);
      await page.waitForTimeout(400);
    } else {
      await page.keyboard.press('Escape');
    }
  }
}

// The pack's own authored correct-branch text per boss phase (packs/vc-law/pack.json) — a
// distinctive prefix of each `correct:true` branch's label, matched against whichever
// `.fw-optlabel` reskin's seeded shuffle actually rendered it under (never assume position).
const CORRECT_BRANCH_PREFIX = [
  'Cite the standard',                    // enc.sb.boss1-preference-multiple
  'Counter to nonparticipating',          // enc.sb.boss2-participation-cap
  'Counter both terms',                   // enc.sb.boss3-antidilution-pool
];

/** Drive one automatic boss Parley to completion, clicking whichever rendered option's label
 *  matches the pack's authored correct-branch text (reskin() shuffles branch ORDER per seed —
 *  see the file header — so position/hotkey can't be trusted, only content). */
async function driveParley(page: Page, phaseNum: number, shotPrefix: string): Promise<void> {
  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 20_000 });
  await expect(page.locator('.fw-eyebrow'), `phase ${phaseNum} opens a Parley (scenario_branch)`).toContainText('Parley');
  await page.screenshot({ path: `${EV}/${shotPrefix}-phase${phaseNum}-parley-open.png` });

  const idBefore = await lastEncounterId(page);
  const labels = await page.locator('.fw-optlabel').allTextContents();
  const prefix = CORRECT_BRANCH_PREFIX[phaseNum - 1];
  const idx = labels.findIndex((l) => l.startsWith(prefix));
  expect(idx, `phase ${phaseNum}: found the authored correct branch ("${prefix}") among rendered options: ${JSON.stringify(labels)}`).toBeGreaterThanOrEqual(0);

  // crucible #4 fix's arming guard — every existing spec sleeps 600ms before a deliberate press.
  await page.waitForTimeout(600);
  await page.locator('.fw-opt').nth(idx).click();
  const cont = page.getByRole('button', { name: 'Onward ▸' });
  await cont.waitFor({ state: 'visible', timeout: 10_000 });
  await page.screenshot({ path: `${EV}/${shotPrefix}-phase${phaseNum}-parley-verdict.png` });
  await cont.click();
  await page.waitForTimeout(400);

  const idAfter = await lastEncounterId(page);
  expect(idAfter, `phase ${phaseNum} resolved AN encounter`).not.toBeNull();
  expect(idAfter, `phase ${phaseNum} changed from the prior encounter id`).not.toBe(idBefore);
  expect(idAfter, `phase ${phaseNum} routed to a REAL vc-law-authored phase, not a disconnected fixture id`).toMatch(/^enc\.sb\.boss/);
  // The shatter banner lands after overlay-close -> SRS record -> applyBranch, a chain whose
  // wall time balloons under CPU starvation (parallel agent fleets) — a single fixed-delay read
  // caught the stale proposal banner. Poll instead of sampling once.
  await expect
    .poll(() => bannerText(page), {
      message: `phase ${phaseNum}'s matched branch is the pack's correct/"good" branch -> a shield shatters`,
      timeout: 8_000,
    })
    .toContain('shield shatters');
  // post-Parley delayedCall(900) — let the effect (shield/heal/stagger) fully apply before
  // whatever comes next (either normal turns resume, or victory fires if shields hit 0).
  await page.waitForTimeout(1000);
}

/** Drive ONE T1 Cast (Attestation, hotkey '5') against the Warden specifically — the only action
 *  that pierces a shield and the only thing that advances phaseIndex/re-arms the next Parley.
 *  Waits for a party turn, positions for guaranteed range, targets the boss's exact tile (never
 *  `parkMobId`, the room's own regular enemy — parked out of both range and the click target),
 *  and answers the free_recall overlay (answerCast idiom from e2e/combat.spec.ts). */
async function driveCastOnWarden(page: Page, parkMobId: string): Promise<void> {
  for (let guard = 0; guard < 8; guard++) {
    await healIfLow(page);
    const s = await waitForCombatState(page, (x) => x?.state === 'playerMove', 25_000);
    expect(s?.state, 'a party turn opened for manual control').toBe('playerMove');
    const active = s!.activeId;

    await debugSetPos(page, active, 5, 3);
    await debugSetPos(page, 'warden', 6, 3); // the boss unit (isBoss:true, hardcoded id) — range 1
    await debugSetPos(page, parkMobId, 1, 1); // parked away — never the click target

    await page.keyboard.press('5'); // Cast From Memory (Attestation, T1 — rank 1 has no flyout)
    await page.waitForTimeout(150);
    const targeting = await snap(page);
    if (targeting?.state !== 'playerTarget') {
      // Shouldn't happen (Warden is always in range at (6,3)) but don't hang the run on it.
      continue;
    }

    await clickTile(page, 6, 3); // the Warden's own tile — never the mob's
    await page.locator('.fw-textarea').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
    await page.locator('.fw-textarea').fill(
      'The Warden’s terms favor the house: a 1x liquidation preference is the market standard, ' +
      'nonparticipating preferred avoids the double dip, and weighted-average antidilution with a ' +
      'right-sized option pool protects the founders’ pre-money stake.',
    );
    await page.getByRole('button', { name: 'Cast' }).click();
    const cont = page.getByRole('button', { name: 'Onward ▸' });
    try {
      await cont.waitFor({ state: 'visible', timeout: 8_000 });
      await cont.click();
    } catch { /* a full auto-resolving pass needs no continue click */ }
    await page.waitForTimeout(500);

    // Step 0c (T6 boss-cluster bisect): debugSetPos is a teleport that never spends the
    // movement leg (turnBudget.ts), so post-T2 (move·act·move, End Turn) `turnExhausted` is
    // false after this single Cast and the turn stays open ("Steps remain") instead of
    // auto-ending — advanceTurn() (the only place that consumes pendingBossPhase and opens the
    // next Parley) never runs. Press End Turn like a real player standing still with movement
    // left over would. Never touches debugSetPos itself — a teleport that also spent budget
    // would make the tests lie about the movement economy (boss-cluster-diagnosis.md).
    // The scene briefly holds `state:'resolving'` while the encounter/SRS/banner chain settles
    // (CombatScene.ts's Phase type) — a same-instant read can still catch that transitional
    // value, so wait it out before deciding whether the turn is actually still open.
    const afterCast = await waitForCombatState(page, (x) => x?.state !== 'resolving', 5_000);
    if (afterCast?.state === 'playerMove') {
      await page.keyboard.press('7'); // End Turn
      await page.waitForTimeout(400);
    }
    return;
  }
  throw new Error('driveCastOnWarden: could not land a Cast on the Warden after 8 attempts');
}

/** Snapshot-restore both shared state files these tests seed, mirroring boot-resume.spec.ts's
 *  restoreSave idiom: quiesce the page first (a live scene's own persist writes can otherwise
 *  land AFTER a bare PUT and poison whatever spec runs next in this shared, serial .state-e2e
 *  suite), then PUT-and-verify until both files actually hold the snapshot. Restores
 *  inventory.json too, not just save.json/scene — healIfLow can consume a seeded potion
 *  mid-fight, and a later spec assuming the default wallet (gold:20, stacks:{}) would otherwise
 *  inherit however many draughts this run happened to drink. */
async function restoreState(page: Page, save: Save | null, inv: Inventory | null): Promise<void> {
  const saveData: Save = save ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
  const invData: Inventory = inv ?? { version: 1, gold: 20, stacks: {} };
  await page.goto('about:blank'); // kill the app context — no more scene/inventory writes racing us
  for (let i = 0; i < 5; i++) {
    await page.request.put('/api/state/save.json', { data: saveData });
    await page.request.put('/api/state/inventory.json', { data: invData });
    await new Promise((r) => setTimeout(r, 150));
    const nowSave = (await page.request.get('/api/state/save.json').then((r) => r.json()).catch(() => undefined)) as Save | undefined;
    const nowInv = (await page.request.get('/api/state/inventory.json').then((r) => r.json()).catch(() => undefined)) as Inventory | undefined;
    if (
      nowSave?.scene === saveData.scene &&
      nowInv?.gold === invData.gold &&
      JSON.stringify(nowInv?.stacks ?? {}) === JSON.stringify(invData.stacks ?? {})
    ) {
      return;
    }
  }
  throw new Error('restoreState: save.json/inventory.json never settled on the restored snapshot');
}

test('boss-victory (fixture path): standalone Vault-Warden kill — all 3 shields via Parley + Attestation', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const beforeSave = await readState<Save>(page, 'save.json');
  const beforeInv = await readState<Inventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/save.json', { data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' } });
    await page.request.put('/api/state/inventory.json', { data: { version: 1, gold: 20, stacks: { 'embermend-draught': 2 } } });

    await page.goto('/?scene=combat&seed=7&boss=1');
    await waitReady(page, 'combat');

    // Confirm the reveal cutscene actually plays before phase 0's Parley (matches the boss's own
    // driving pattern — nothing shortens showBossReveal's ~1.17s timer-only tween).
    const revealStart = Date.now();
    let sawReveal = false;
    while (Date.now() - revealStart < 8_000) {
      if (await bossRevealActive(page)) { sawReveal = true; break; }
      if (await page.locator('.fw-overlay').count()) break;
      await page.waitForTimeout(30);
    }
    expect(sawReveal, 'the Vault-Warden reveal cutscene played before phase 0').toBe(true);

    await driveParley(page, 1, 'e2e-boss-victory-fixture'); // shields 3 -> 2
    await driveCastOnWarden(page, 'wisp-0'); // phaseIndex 0 -> 1, re-arms the next Parley

    await driveParley(page, 2, 'e2e-boss-victory-fixture'); // shields 2 -> 1
    await driveCastOnWarden(page, 'wisp-0'); // phaseIndex 1 -> 2, re-arms the next Parley

    await driveParley(page, 3, 'e2e-boss-victory-fixture'); // shields 1 -> 0 -> victory fires inside the post-Parley checkEnd

    const dead = await waitForCombatState(page, (s) => s?.state === 'over', 15_000);
    expect(dead?.state, 'combat resolved to "over" after the third shield broke (shields<=0)').toBe('over');
    await page.screenshot({ path: `${EV}/e2e-boss-victory-fixture-kill-screen.png` });

    expect(Number.isFinite(dead?.partyHp), 'partyHp is a finite number, not NaN').toBe(true);
    expect(dead!.partyHp, 'partyHp never went negative').toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(dead?.enemyHp), 'enemyHp is a finite number, not NaN').toBe(true);

    // resolveBattle's own 1600ms delayedCall transitions to the fixture's returnScene ('boot').
    const sceneStart = Date.now();
    let scene = await currentScene(page);
    while (scene === 'combat' && Date.now() - sceneStart < 8_000) {
      await page.waitForTimeout(200);
      scene = await currentScene(page);
    }

    const saveAfter = await readState<Save>(page, 'save.json');
    // no NaN/ghost state in the persisted save after a standalone (non-dungeon-wrapped) victory
    if (saveAfter) {
      expect(Number.isFinite(saveAfter.hp ?? 16), 'save.json hp is not NaN after the standalone fixture kill').toBe(true);
      expect(Number.isFinite(saveAfter.streak ?? 0), 'save.json streak is not NaN after the standalone fixture kill').toBe(true);
    }

    if (pageErrors.length) console.log('note: pageerrors during the fixture kill (tolerated):', pageErrors.slice(0, 5).join(' | '));
  } finally {
    await restoreState(page, beforeSave, beforeInv);
  }
});

test('boss-victory (real dungeon path): Vault-Warden kill via auto=boss, persistence survives reload + re-entry', async ({ page }) => {
  test.setTimeout(180_000);
  const SEED = 11; // distinct from the fixture-path test's seed=7 — no functional requirement, just variety
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  const beforeSave = await readState<Save>(page, 'save.json');
  const beforeInv = await readState<Inventory>(page, 'inventory.json');

  try {
    await page.request.put('/api/state/save.json', { data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' } });
    await page.request.put('/api/state/inventory.json', { data: { version: 1, gold: 20, stacks: { 'embermend-draught': 2 } } });

    await page.goto(`/?scene=vaults&dev=1&sim=0&auto=boss&seed=${SEED}`);
    // auto=boss's 'boss' case funnels straight into scene.start('combat') before DungeonScene
    // necessarily calls its own markReady — wait for READY generically, then poll for the combat
    // scene specifically rather than asserting an intermediate 'vaults'.
    await waitReady(page);
    const combatStart = Date.now();
    let scene = await currentScene(page);
    while (scene !== 'combat' && Date.now() - combatStart < 20_000) {
      await page.waitForTimeout(200);
      scene = await currentScene(page);
    }
    expect(scene, 'auto=boss drove straight into the real CombatScene for the boss room').toBe('combat');
    await page.screenshot({ path: `${EV}/e2e-boss-victory-dungeon-combat-launched.png` });

    await driveParley(page, 1, 'e2e-boss-victory-dungeon');
    // this room's own regular enemy is 'warden-0' (archetype 'warden', a Root-Husk — NOT the
    // boss, which is always unit id 'warden'/isBoss:true, hardcoded in units.ts's makeBoss).
    await driveCastOnWarden(page, 'warden-0');
    await driveParley(page, 2, 'e2e-boss-victory-dungeon');
    await driveCastOnWarden(page, 'warden-0');
    await driveParley(page, 3, 'e2e-boss-victory-dungeon'); // shields -> 0, victory fires in the post-Parley checkEnd

    const dead = await waitForCombatState(page, (s) => s?.state === 'over', 15_000);
    expect(dead?.state, 'combat resolved to "over" after the third shield broke').toBe('over');
    await page.screenshot({ path: `${EV}/e2e-boss-victory-dungeon-kill-screen.png` });
    expect(Number.isFinite(dead?.partyHp), 'partyHp is finite, not NaN').toBe(true);
    expect(dead!.partyHp).toBeGreaterThanOrEqual(0);

    // resolveBattle's 1600ms delayedCall hands off to returnScene:'vaults' (doCombat's launch),
    // which recovers the PENDING_KEY outcome in its next bootFlow -> resolveCombat -> bossVictory.
    const backStart = Date.now();
    let sc = await currentScene(page);
    while (sc === 'combat' && Date.now() - backStart < 10_000) {
      await page.waitForTimeout(200);
      sc = await currentScene(page);
    }
    // bossVictory's vaultOpensBeat holds ~1-2s then scene.start('hamlet') — wait it out.
    const hamletStart = Date.now();
    while (sc !== 'hamlet' && Date.now() - hamletStart < 15_000) {
      await page.waitForTimeout(200);
      sc = await currentScene(page);
    }
    expect(sc, 'bossVictory transitioned to hamlet').toBe('hamlet');
    await page.screenshot({ path: `${EV}/e2e-boss-victory-dungeon-post-victory-hamlet.png` });

    // ---- persistence verdicts ----
    const saveAfter = await readState<Save>(page, 'save.json');
    expect(saveAfter?.scene, 'save persisted scene:hamlet (bossVictory saves BEFORE scene.start)').toBe('hamlet');
    expect(saveAfter?.streak, 'streak bumped by exactly 1 (a single boss-room clear)').toBe(1);
    expect(saveAfter?.dungeon?.cleared, 'dungeon.cleared includes the boss room id').toContain('under-boss');
    expect(saveAfter?.dungeon?.cleared?.length, 'all 4 rooms (3 pre-boss + the boss room) are cleared').toBe(4);
    expect(Number.isFinite(saveAfter?.hp), 'hp is not NaN after victory').toBe(true);
    expect(saveAfter?.hp).toBeGreaterThan(0);

    // ---- reload after victory resumes sanely (no ghost state) ----
    // IMPORTANT: page.reload() would replay the EXACT current URL, including our own ?auto=boss
    // dev-harness directive — that's a test-harness artifact (re-triggering the fight again), not
    // what a real player's reload does. A real player never has auto=boss in their URL bar (it's
    // a dev/e2e-only param; the shell never pushes it during normal play). So the real-reload
    // simulation here is a bare '/' navigation plus the title-screen gesture BootScene's enter()
    // waits for — never page.reload() on a dev-harness URL. BootScene reads save.scene once
    // ready() resolves and resumes there (vaults or hamlet) on the first gesture, never instantly.
    await page.goto('/');
    await waitReady(page); // boot marks ready immediately, before any gesture
    expect(await currentScene(page), 'a bare reload lands on the title screen (boot), not an auto-resume').toBe('boot');
    await page.keyboard.press('Enter'); // the gesture BootScene's enter() waits for
    const resumeStart = Date.now();
    let sceneAfterReload = await currentScene(page);
    while (sceneAfterReload !== 'hamlet' && Date.now() - resumeStart < 10_000) {
      await page.waitForTimeout(200);
      sceneAfterReload = await currentScene(page);
    }
    expect(sceneAfterReload, 'a reload right after victory resumes at hamlet (save.scene), not a stale vaults/combat state').toBe('hamlet');
    await page.screenshot({ path: `${EV}/e2e-boss-victory-dungeon-reload-after-victory.png` });

    // ---- reload and re-enter the vaults to prove the cleared state holds ----
    await page.goto('/?scene=vaults&dev=1');
    await waitReady(page, 'vaults');
    await page.waitForTimeout(500);
    const saveAfterReenter = await readState<Save>(page, 'save.json');
    expect(saveAfterReenter?.dungeon?.cleared, 're-entering the vaults still shows the boss room cleared').toContain('under-boss');
    await page.screenshot({ path: `${EV}/e2e-boss-victory-dungeon-reenter-vaults-cleared.png` });

    if (pageErrors.length) console.log('note: pageerrors during the real-dungeon kill:', pageErrors.slice(0, 5).join(' | '));
    expect(pageErrors.length, 'no uncaught page errors during the whole real-dungeon kill run').toBe(0);
  } finally {
    await restoreState(page, beforeSave, beforeInv);
  }
});
