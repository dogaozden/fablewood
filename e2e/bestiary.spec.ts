import { test, expect, type Page } from '@playwright/test';
import { waitReady, canvasClick } from './helpers';

/** tileToScreen: ORIGIN(192,48) + c*48+24, r*48+24 (the formula every combat spec uses —
 *  measured-turn.spec.ts's own tileXY, ported verbatim for Task 3's scenario b). */
const CELL = 48;
const ORIGIN = { x: 192, y: 48 };
function tileXY(c: number, r: number): { x: number; y: number } {
  return { x: ORIGIN.x + c * CELL + CELL / 2, y: ORIGIN.y + r * CELL + CELL / 2 };
}

// Wave 8 (the Bestiary) Task 2 — Ch. VIII's rise toll: a Toppled unit stands automatically at
// its own turn start, paying half that turn's movement base (the house floor: max(1,
// floor(base/2))) before anything else touches it, and fights that same turn with its
// opportunity latch disabled (the Staggered idiom). Debug-hook idiom mirrors every other combat
// e2e file (combatSnapshot/unitDebug/debugApplyStatus/debugSetPos) — own-file local copies,
// same convention as measured-turn.spec.ts / v1fix-board.spec.ts.
//
// Task 3 (below, scenario b) — Shove: a free-lane push beside Strike/Brace that never damages,
// and, against a toppleable entry, knocks it Toppled on a landed push. Its second test closes
// Task 2's own deferral: a NON-FIRST unit's (speed < the Keeper's 5) mid-rise window, proven to
// actually span a round wrap (the per-unit clear fires at the unit's own next turn start, not in
// bulk at round-wrap — task-2-report.md's fix round 1).

type Budget = { total: number; left: number; legSpent: boolean; actionSpent: boolean; pressedOn: boolean };
type Snap = { state: string; activeId: string; budget: Budget; log: Array<{ action: string; dmg: number; overlay: boolean }> } | null;

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as Snap;
  });
}

async function unitPos(page: Page, id: string): Promise<{ c: number; r: number } | null> {
  return page.evaluate((uid) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { unitDebug?(id: string): { c: number; r: number } | null } | undefined;
    const u = s?.unitDebug?.(uid);
    return u ? { c: u.c, r: u.r } : null;
  }, id);
}

async function unitState(
  page: Page,
  id: string,
): Promise<{ hp: number; alive: boolean; statuses: Array<{ id: string; turnsLeft: number; magnitude: number; sourceId?: string }> } | null> {
  return page.evaluate((uid) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as
      | { unitDebug?(id: string): { hp: number; alive: boolean; statuses: Array<{ id: string; turnsLeft: number; magnitude: number; sourceId?: string }> } | null }
      | undefined;
    return s?.unitDebug?.(uid) ?? null;
  }, id);
}

/** Ch. VIII Task 4 — the ACTIVE unit's live move-field reachable tiles (CombatScene.
 *  reachableDebug, new this task): the only way to observe the Daunted move-field filter's
 *  effect without fighting pixel-perfect click geometry for every excluded tile. */
async function reachable(page: Page): Promise<Array<{ c: number; r: number }>> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { reachableDebug?(): Array<{ c: number; r: number }> } | undefined;
    return s?.reachableDebug?.() ?? [];
  });
}

function hasTile(tiles: Array<{ c: number; r: number }>, c: number, r: number): boolean {
  return tiles.some((t) => t.c === c && t.r === r);
}

/** Ch. VIII Task 5 — valid target ids for `action` from the ACTIVE unit (CombatScene.
 *  validTargetsDebug, new this task): the only way to observe the Unwritten exclusion on
 *  Strike/Shove's own validTargets branches (and its absence on a spell's) without fighting
 *  menu-click geometry for every case — same read-only debug-surface spirit as reachable above. */
async function validTargets(page: Page, action: string): Promise<string[]> {
  return page.evaluate((a) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { validTargetsDebug?(action: string): string[] } | undefined;
    return s?.validTargetsDebug?.(a) ?? [];
  }, action);
}

async function setPos(page: Page, id: string, c: number, r: number): Promise<void> {
  await page.evaluate(
    ({ id, c, r }) => {
      const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
      const s = g?.scene?.getScene?.('combat') as { debugSetPos?(id: string, c: number, r: number): void } | undefined;
      s?.debugSetPos?.(id, c, r);
    },
    { id, c, r },
  );
}

/** Apply a status directly (e2e-only CombatScene.debugApplyStatus). Task 1's own idiom for
 *  toppled's conventionally-meaningless turnsLeft: 1, magnitude: 1. Ch. VIII Task 4 —
 *  `sourceId` is additive-optional (only Daunted reads it), threaded through to
 *  debugApplyStatus's own new param of the same name — this task's stand-in for the Pall's
 *  real touch (T6's Pall now supplies it in scenario e; this stays for hermetic single-mechanic setup). */
async function applyStatus(
  page: Page, id: string, statusId: string, turns = 1, magnitude = 1, sourceId?: string,
): Promise<void> {
  await page.evaluate(
    ({ id, statusId, turns, magnitude, sourceId }) => {
      const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
      const s = g?.scene?.getScene?.('combat') as
        | { debugApplyStatus?(id: string, statusId: string, turns: number, magnitude?: number, sourceId?: string): void }
        | undefined;
      s?.debugApplyStatus?.(id, statusId, turns, magnitude, sourceId);
    },
    { id, statusId, turns, magnitude, sourceId },
  );
}

/** The HUD banner's current raw text (CombatScene.bannerText — boss-reforged.spec.ts's idiom). */
async function bannerText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { bannerText?(): string } | undefined;
    return s?.bannerText?.() ?? '';
  });
}

/** Move the pointer over a board tile (same 960x540 -> canvas mapping canvasClick uses). The
 *  §12.3 status-hover listener debounces on the hovered unit id, so a test that wants two reads
 *  of the SAME unit must hover something else in between — hence the explicit tile arg. */
async function hoverTile(page: Page, c: number, r: number): Promise<void> {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const p = tileXY(c, r);
  await page.mouse.move(box.x + (p.x / 960) * box.width, box.y + (p.y / 540) * box.height);
  await page.waitForTimeout(120);
}

/** Ch. VIII Task 6 — pin the demo pilot to one free-lane action (CombatScene.setPilotPreference,
 *  crucible-combat.spec.ts's own idiom) so no encounter overlay opens during the termination
 *  gate: this test is about the pilot never running out of legal moves, not about grading. */
async function setPilotPreference(page: Page, kind: string | null): Promise<void> {
  await page.evaluate((k) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { setPilotPreference?(k: string | null): void } | undefined;
    s?.setPilotPreference?.(k);
  }, kind);
}

async function waitForSnap(
  page: Page,
  pred: (s: Snap) => boolean,
  label: string,
  timeout = 20_000,
): Promise<NonNullable<Snap>> {
  const start = Date.now();
  let s: Snap = null;
  while (Date.now() - start < timeout) {
    s = await snap(page);
    if (pred(s)) return s!;
    await page.waitForTimeout(150);
  }
  throw new Error(`bestiary: timed out waiting for "${label}"; last snapshot=${JSON.stringify(s)}`);
}

/** Presses End Turn for Mira whenever she's up and otherwise just waits — enemy turns play
 *  themselves (AI moves/attacks, ticks) with no input needed — until it is the Keeper's own
 *  turn again (measured-turn.spec.ts's own passUntilKeeper idiom, ported verbatim). */
async function passUntilKeeper(page: Page, timeout = 30_000): Promise<NonNullable<Snap>> {
  const start = Date.now();
  let last: Snap = null;
  while (Date.now() - start < timeout) {
    last = await snap(page);
    if (last && last.state === 'playerMove') {
      if (last.activeId === 'keeper') return last;
      if (last.activeId === 'mira') await page.keyboard.press('7');
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`bestiary: timed out waiting for the Keeper's turn; last snapshot=${JSON.stringify(last)}`);
}

/** Same idiom, but stops once `id` reaches (c, r) instead of waiting for the Keeper — used to
 *  observe an enemy's own AI-driven move resolve mid-round without needing it to be anyone's
 *  "turn" from the harness's point of view. Still presses Mira's End Turn if she comes up first. */
async function passUntilUnitAt(page: Page, id: string, c: number, r: number, timeout = 20_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const p = await unitPos(page, id);
    if (p?.c === c && p?.r === r) return true;
    const s = await snap(page);
    if (s?.state === 'playerMove' && s.activeId === 'mira') await page.keyboard.press('7');
    await page.waitForTimeout(150);
  }
  return false;
}

/** Same idiom again, but watches `id`'s OWN status list instead of position or whose turn it
 *  is — used to catch the moment a status is consumed at that unit's turn-start tick even
 *  though the unit never becomes the harness-visible ACTIVE unit that turn (Ch. VIII fix round,
 *  I2: a Staggered turn is skipped entirely — tickTurnStart clears it and advanceTurn returns
 *  before ever calling beginPlayerTurn, so `state`/`activeId` never reflect it). Still presses
 *  Mira's End Turn if she comes up first, same as passUntilUnitAt. */
async function passUntilStatusGone(page: Page, id: string, statusId: string, timeout = 20_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const st = await unitState(page, id);
    if (st && !st.statuses.some((s) => s.id === statusId)) return true;
    const s = await snap(page);
    if (s?.state === 'playerMove' && s.activeId === 'mira') await page.keyboard.press('7');
    await page.waitForTimeout(150);
  }
  return false;
}

// ---------------------------------------------------------------------------------------
// Scenario a (toll + consumption + restoration): fixture a Toppled Keeper. The rise doesn't
// fire until the Keeper's OWN next turn start (applying it mid-turn-1 lands it on turn 2).
// wisp-0/wraith-2 are lethally Kindled — they die at their own turn-start tick, before ever
// acting (measured-turn.spec.ts's own scenario-b2 technique) — and wisp-1 is exiled out of
// reach, so the round loop spins cleanly across two full rounds with nothing else touching the
// Keeper's budget or statuses.
// ---------------------------------------------------------------------------------------
test('bestiary scenario a: the rise toll — a Toppled Keeper stands at a price, then rearms next round', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  await applyStatus(page, 'wisp-0', 'kindled', 1, 2); // dies at its own turn-start tick (hp 2)
  await applyStatus(page, 'wraith-2', 'kindled', 1, 3); // dies at its own turn-start tick (hp 3)
  await setPos(page, 'wisp-1', 11, 7); // exiled — melee-only, can't close the distance in time

  const fresh = await snap(page);
  expect(fresh?.budget.total, "sanity: the Keeper's fresh, un-tolled move budget").toBe(4);

  // Fixture the Toppled Keeper.
  await applyStatus(page, 'keeper', 'toppled', 1, 1);

  // End turn 1 (Keeper), then Mira's, then let the (dying/exiled) enemy turns resolve — lands
  // on the Keeper's turn 2, where the rise fires.
  await page.keyboard.press('7');
  const risen = await passUntilKeeper(page);
  expect(risen.activeId).toBe('keeper');

  // Move shows tolled/tolled: raw move 4, tollRise(4) = max(1, floor(4/2)) = 2.
  expect(risen.budget.total, 'the rise-tolled total').toBe(2);
  expect(risen.budget.left, 'a fresh tolled turn has spent nothing yet').toBe(2);

  // Rise happened: Toppled is consumed, not lingering.
  const afterRise = await unitState(page, 'keeper');
  expect(afterRise?.statuses.some((st) => st.id === 'toppled'), 'Toppled is consumed by the rise').toBe(false);

  // Fix round 1 (I2) — Press On must compose off the TOLLED base too, not just moveBudgetFor:
  // CombatScene.pressOn()'s own tolled-base swap-in was previously proven only by code symmetry
  // with moveBudgetFor's (identical) line, never actually executed by a test. No Careful Step is
  // active this turn, so Press On grants the full tolled eff again (2+2) — landing the Keeper
  // back on the RAW un-tolled distance (4) for this one turn, at the cost of the action (the
  // same "Careful Step + Press On = normal distance" identity turnBudget.test.ts's compose-law
  // pin already proves at the pure level, exercised here through the real scene wiring instead).
  await page.keyboard.press('8'); // Press On hotkey (measured-turn.spec.ts's own idiom)
  const pressed = await waitForSnap(page, (s) => s?.budget.actionSpent === true, 'Press On to spend the action');
  expect(pressed.budget.total, 'Press On composes off the TOLLED base (2), not the raw stat (4): 2+2').toBe(4);
  expect(pressed.budget.left, 'the bonus extends what was left (2), not a refill to the new total').toBe(4);
  expect(pressed.budget.pressedOn, 'Press On locks the stance').toBe(true);

  // Following turn (next round): the toll does not repeat — full, un-tolled base again.
  await page.keyboard.press('7');
  const restored = await passUntilKeeper(page, 30_000);
  expect(restored.activeId).toBe('keeper');
  expect(restored.budget.total, 'the toll does not repeat — full base again').toBe(4);
  expect(restored.budget.left).toBe(4);
});

// ---------------------------------------------------------------------------------------
// Task 8 sweep — "rise+stance compose in e2e?": the fix-round-1 test above already proves Press
// On composes off the TOLLED base through the real CombatScene wiring (pressOn()'s own
// `tolledMoveBase` read). Careful Step reads the SAME `tolledMoveBase` field but through a
// SEPARATE call site (moveBudgetFor, invoked by toggleCarefulStep) that no e2e test had ever
// exercised on a rising turn. turnBudget.test.ts's own compose-law describe block ("Mirrors the
// Ch. VI describe block above exactly, substituting tollRise(eff) for eff") already proves the
// PURE math identity at every base; this proves the real scene wiring reads the live
// `tolledMoveBase` CombatScene.advanceTurn sets, not a stale or re-derived value — the same class
// of wiring bug the Press On fix-round-1 pin above was written to catch.
// ---------------------------------------------------------------------------------------
test('bestiary scenario a: Careful Step also composes off the TOLLED base — a mid-turn stance toggle survives the rise', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  await applyStatus(page, 'wisp-0', 'kindled', 1, 2); // dies at its own turn-start tick (hp 2)
  await applyStatus(page, 'wraith-2', 'kindled', 1, 3); // dies at its own turn-start tick (hp 3)
  await setPos(page, 'wisp-1', 11, 7); // exiled

  await applyStatus(page, 'keeper', 'toppled', 1, 1);
  await page.keyboard.press('7'); // end turn 1
  const risen = await passUntilKeeper(page);
  expect(risen.activeId).toBe('keeper');
  expect(risen.budget.total, "sanity: the rise fired — tollRise(4) = 2 (scenario a's own proof, above)").toBe(2);

  await page.keyboard.press('c'); // Careful Step toggle (measured-turn.spec.ts's own idiom)
  const stanced = await waitForSnap(page, (s) => s?.budget.total === 1, 'Careful Step to compose off the tolled base');
  expect(stanced.budget.total, 'Careful Step over the TOLLED base: carefulStepMove(2) = max(1, floor(2/2)) = 1').toBe(1);
  expect(stanced.budget.left, 'a fresh toggle re-anchors left to the new total — nothing spent yet').toBe(1);
  expect(stanced.budget.legSpent, 'toggling the stance alone spends no leg').toBe(false);
});

// ---------------------------------------------------------------------------------------
// Scenario a, fix round (I1) — the rise toll's house floor must never override a zero another
// law already made. A unit that is both Bound (effectiveMove forces move to 0, status.ts:188)
// and Toppled rises at its own turn start into that same zero: tollRise(0) must stay 0, not
// resurrect a phantom tile via the min-1 floor meant to guard a MOBILE unit's halving. Same
// drive pattern as scenario a's own rise-toll test above (seed=7, wisp-0/wraith-2 lethally
// Kindled so they die at their own turn-start tick before ever acting, wisp-1 exiled out of
// reach) — only the Keeper's own fixture differs. Bound is applied with turns=2, not scenario
// a's own turns=1 idiom for Toppled: Bound is a real duration status (decays at the OWNER's
// turn end — status.ts's NO_TURN_END_DECAY does NOT cover it, unlike Toppled's event-consumed
// lifecycle), so turns=1 would decay to 0 and vanish at the end of the Keeper's own turn 1,
// before ever reaching the turn-2 rise this test is about.
// ---------------------------------------------------------------------------------------
test('bestiary scenario a: a Bound-and-Toppled unit rises with ZERO movement — the house floor never overrides a zero another law already made (fix round, I1)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  await applyStatus(page, 'wisp-0', 'kindled', 1, 2); // dies at its own turn-start tick (hp 2)
  await applyStatus(page, 'wraith-2', 'kindled', 1, 3); // dies at its own turn-start tick (hp 3)
  await setPos(page, 'wisp-1', 11, 7); // exiled — melee-only, can't close the distance in time

  const fresh = await snap(page);
  expect(fresh?.budget.total, "sanity: the Keeper's fresh, un-tolled move budget").toBe(4);

  // Fixture the Keeper Bound (turns=2 — survives one turn-end decay, see header note) AND Toppled.
  await applyStatus(page, 'keeper', 'bound', 2);
  await applyStatus(page, 'keeper', 'toppled', 1, 1);

  await page.keyboard.press('7'); // end turn 1
  const risen = await passUntilKeeper(page);
  expect(risen.activeId).toBe('keeper');

  // The rise still fires (Toppled is consumed either way), but the toll must land on ZERO:
  // Bound's effectiveMove is 0 before tollRise ever runs, and the house floor must not
  // resurrect it.
  expect(risen.budget.total, 'a Bound-and-Toppled rise: tollRise(effectiveMove) must stay 0').toBe(0);
  expect(risen.budget.left, 'nothing spent yet, and nothing TO spend').toBe(0);

  const afterRise = await unitState(page, 'keeper');
  expect(afterRise?.statuses.some((st) => st.id === 'toppled'), 'Toppled is consumed by the rise regardless').toBe(false);
  expect(afterRise?.statuses.some((st) => st.id === 'bound'), 'sanity: Bound is still live — it is why move is 0').toBe(true);

  const tiles = await reachable(page);
  expect(tiles, 'no legal move tile exists at budget 0').toEqual([]);
});

// ---------------------------------------------------------------------------------------
// Scenario a, fix round (I2) — "Staggered defers the rise" is a stated chapter law
// (docs/superpowers/specs/2026-08-02-concordance.md Ch. VIII) that held only by statement
// ordering inside advanceTurn (the staggered branch `return`s before the toppled-rise block)
// with zero test coverage: nothing anywhere put `toppled` and `staggered` on the same unit.
// A unit both Toppled and Staggered must lose its NEXT turn to the stagger with Toppled
// untouched — not consumed, no toll paid — and then rise normally, toll and all, the turn
// after that. Same hermetic seed=7/Kindled-kill/exile fixture as scenario a's own rise test
// above. The Keeper's staggered turn never becomes the harness-visible ACTIVE unit (advanceTurn
// returns before beginPlayerTurn), so this drives on the Keeper's own status list via
// passUntilStatusGone rather than waiting on `state`/`activeId`.
//
// Staggered is fixtured with turns=2, not the real game's own turns=1 grant (Parley-good's own
// Staggered(1)): unlike Toppled, Staggered is a REAL duration status (decays at the OWNER's own
// turn end, status.ts's NO_TURN_END_DECAY does not cover it), and this harness applies it while
// the Keeper's turn 1 is already active, immediately followed by ending that SAME turn — in
// normal play a unit is staggered by an opposing action mid-round, never by itself the instant
// before its own turn ends, so this same-turn ordering is a debug-harness artifact, not a live
// case. turns=1 would decay to 0 at that same end-of-turn-1 decay and be gone before turn 2's
// tick ever ran, silently testing "Staggered already expired" instead of "Staggered defers the
// rise" (caught by temporarily hoisting the rise block before the stagger check and observing
// this test still passed at turns=1 — the mutation never surfaced, proving the fixture, not the
// law, was untested).
// ---------------------------------------------------------------------------------------
test('bestiary scenario a: Staggered defers the rise — Toppled survives a stagger-skipped turn untouched, then rises normally the turn after (fix round, I2)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  await applyStatus(page, 'wisp-0', 'kindled', 1, 2); // dies at its own turn-start tick (hp 2)
  await applyStatus(page, 'wraith-2', 'kindled', 1, 3); // dies at its own turn-start tick (hp 3)
  await setPos(page, 'wisp-1', 11, 7); // exiled — melee-only, can't close the distance in time

  // Fixture the Toppled-and-Staggered Keeper. Applying mid-turn-1 lands both effects on turn 2
  // (scenario a's own "applying it mid-turn-1 lands it on turn 2" idiom, above). Staggered's
  // turns=2 (not the real game's turns=1) survives the Keeper's own turn-1-end decay — see the
  // header note.
  await applyStatus(page, 'keeper', 'toppled', 1, 1);
  await applyStatus(page, 'keeper', 'staggered', 2);

  await page.keyboard.press('7'); // end turn 1

  // Turn 2: the stagger consumes at tick and the turn ends there — wait for THAT (not for the
  // Keeper to become ACTIVE, which never happens this turn) — then check Toppled mid-skip.
  const clearedInTime = await passUntilStatusGone(page, 'keeper', 'staggered');
  expect(clearedInTime, "the Keeper's own turn 2 tick to consume Staggered").toBe(true);

  const midSkip = await unitState(page, 'keeper');
  expect(
    midSkip?.statuses.some((st) => st.id === 'toppled'),
    'Ch. VIII: Staggered defers the rise — Toppled survives the skipped turn untouched (not consumed, no toll paid), because the staggered branch returns before the toppled-rise block ever runs',
  ).toBe(true);

  // Turn 3 (the Keeper's real next active turn): the rise now fires normally, toll and all.
  const risen = await passUntilKeeper(page);
  expect(risen.activeId).toBe('keeper');
  expect(risen.budget.total, 'the deferred rise pays its toll on the turn it actually gets: tollRise(4) = 2').toBe(2);

  const afterRise = await unitState(page, 'keeper');
  expect(afterRise?.statuses.some((st) => st.id === 'toppled'), 'Toppled is now consumed by the (deferred) rise').toBe(false);
});

// ---------------------------------------------------------------------------------------
// Scenario g (Task 8b) — Ch. VIII's own text: "Damage vs a Toppled unit: adjacent attackers +1,
// non-adjacent −1 (the ±1 idiom, both directions)." Task 8's completeness sweep found the term
// was never wired into computeHit (the engine's own documented single damage-modifier pipeline)
// — this pin was originally written RED, against HEAD, as that finding. Task 8b implemented the
// term in status.ts and threaded computed adjacency (manhattan 1) through every computeHit call
// site; this pin now proves the law rather than reporting its absence. This is the adjacent
// (+1) half, via Strike — the non-adjacent (−1) half follows below.
//
// Fix round 1 (review C1, preserved): the modified leg must NOT reuse the control leg's own
// target. `damageUnit` (CombatScene.ts) floors HP at `Math.max(0, hp - amount)`, and the logged
// `dmg` is a pool-wide before/after delta (`enemyHpSum()`), not raw computeHit output — so a
// target that's already down to its last HP point can only ever LOG a delta of however much HP
// it had left, regardless of how much real damage the engine computes. wisp-0 (2 max HP) loses 1
// HP in the control leg, leaving exactly 1 HP of headroom — not enough to show a genuine +1
// (needs 2). Reusing it would misreport a real +1 as a clamp artifact. The modified leg strikes a
// FRESH target (wraith-2, 3 max HP, untouched all test long) instead — same Strike shape
// (adjacent, no other modifiers, same relative tile), only the target and its Toppled status
// differ. The headroom itself is asserted explicitly below, not just assumed, so this can never
// silently regress back into the clamp trap.
// ---------------------------------------------------------------------------------------
test('bestiary scenario g: an adjacent Strike deals +1 against a Toppled target (Ch. VIII\'s ±1 idiom)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  await setPos(page, 'wisp-1', 10, 6); // exiled — scenario b/c's own spot
  await setPos(page, 'wraith-2', 8, 6); // exiled for now — kept FRESH (0 damage) for the modified leg below
  await setPos(page, 'keeper', 5, 1);
  await setPos(page, 'wisp-0', 6, 1); // adjacent — the CONTROL leg's target only

  // --- control: an undaunted, un-toppled Strike (scenario c's own control idiom).
  await page.keyboard.press('1'); // Strike hotkey
  await waitForSnap(page, (s) => s?.state === 'playerTarget', 'Strike targeting to open');
  await canvasClick(page, tileXY(6, 1).x, tileXY(6, 1).y);
  const afterControl = await waitForSnap(page, (s) => s?.state !== 'resolving', 'the control Strike to resolve');
  const controlDealt = afterControl.log.at(-1)?.dmg ?? -1;
  expect(controlDealt, 'sanity: the plain base, no modifiers in this fixture').toBe(1);

  await page.keyboard.press('7'); // end turn 1

  // --- test: the SAME Strike shape, now against a Toppled FRESH target — wraith-2, never hit
  // this test, standing on the SAME relative tile wisp-0 held for the control leg (only the
  // target identity and its Toppled status differ). wisp-0 (spent, 1 HP left) is exiled out of
  // the way so it can't be targeted or confound anything.
  const turn2 = await passUntilKeeper(page);
  expect(turn2.activeId).toBe('keeper');
  await setPos(page, 'wisp-0', 8, 6); // exile the spent control target
  await setPos(page, 'wraith-2', 6, 1); // the modified leg's target, on wisp-0's old tile
  await setPos(page, 'keeper', 5, 1);
  await applyStatus(page, 'wraith-2', 'toppled', 1, 1);

  // Headroom check (fix round 1, load-bearing): the modified-leg target must hold enough HP to
  // show a genuine control+1 without damageUnit's floor(0) clamp masking it. wraith-2 is fresh
  // (3 max HP) against a control of 1, so this holds with zero slack (3 >= 1+2) — if a future
  // change to this fixture ever narrows that margin, this assertion fails loudly instead of the
  // pin quietly rotting back into the C1 clamp trap.
  const beforeModified = await unitState(page, 'wraith-2');
  expect(
    beforeModified?.hp,
    "headroom check: the modified-leg target needs enough HP that a real control+1 hit can't clamp — otherwise this pin would misreport a missing engine term as a clamp artifact",
  ).toBeGreaterThanOrEqual(controlDealt + 2);

  await page.keyboard.press('1'); // Strike hotkey
  await waitForSnap(page, (s) => s?.state === 'playerTarget', 'Strike targeting to open');
  await canvasClick(page, tileXY(6, 1).x, tileXY(6, 1).y);
  const afterToppled = await waitForSnap(page, (s) => s?.state !== 'resolving', 'the Strike-vs-Toppled to resolve');
  const toppledDealt = afterToppled.log.at(-1)?.dmg ?? -1;
  expect(toppledDealt, "Ch. VIII: an adjacent attacker deals +1 against a Toppled target").toBe(controlDealt + 1);
});

// ---------------------------------------------------------------------------------------
// Scenario g, the ranged half (Task 8b) — Ch. VIII's own text: "...non-adjacent −1". Every
// player-side ranged action (Smite, Cinder-Rebuke, Weave, Sequence, Cast) requires resolving a
// real MCQ/trivia encounter, and there is no debug hook to force a specific quality bucket (one
// existed for T3's toppleable fixture, debugForceToppleable, and was deliberately removed once
// real content covered the need — CombatScene.ts's own comment on its removal). Driving a real
// MCQ cast to a KNOWN quality deterministically would mean borrowing difficulty-p3.spec.ts's
// pattern (fetch /api/packs, match rendered option text against the installed pack's real answer
// strings) — the ONLY test in this file that would depend on real pack content, where every
// other test here (including the Strike pin above) is fully hermetic via debug hooks. So this
// proves the ranged half through a different real attacker instead: enemyStrike (CombatScene.ts)
// already resolves the wraith's own ranged reach (ranged:true, range 3) with a flat
// `attacker.attack` base, AI-driven, no encounter involved at all — the SAME computeHit
// call-site family as the Strike test above, just the enemy-attacker direction the chapter's own
// text treats identically ("enemy blows... alike; symmetric by construction").
//
// Geometry (verified against seed=7's real layout via CombatScene.layoutDebug, not hand-derived
// — scenario a's own history warned that guessing here isn't reliable): row 1 is clear floor
// across columns 1-10, no gold/lantern/wall. wraith-2 sits at (7,1), two tiles from the Keeper
// (5,1) along that same row — hasLineOfFire (grid.ts) clears at distance 2 (≤ its range of 3),
// and ai.ts's own "already in range from where we stand? hit without moving" branch fires
// deterministically, so there's no AI-scoring uncertainty to derive. wisp-0/wisp-1 are exiled to
// row 6, far beyond their own move(3)+range(1) reach of the Keeper; mira sits at distance 4 from
// the wraith — one tile beyond its range 3 — so she never enters its target pool. The wraith is
// the only thing that can act on the Keeper either round.
//
// Emboldened(+1) is applied to the wraith once, for the whole test, so neither leg's delta rests
// on a bare 0 — the control leg alone (delta 2, not 1) already proves the wraith reliably
// attacks the Keeper in this exact geometry, so the modified leg's delta of 1 can only read as
// the −1 term, never as "nothing happened" (the Strike pin's own C1 headroom fix guards against
// the identical ambiguity from the other direction).
// ---------------------------------------------------------------------------------------
test("bestiary scenario g: a non-adjacent wraith deals −1 against a Toppled party member (Ch. VIII's ±1 idiom, the ranged half)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  await setPos(page, 'wisp-0', 10, 6); // exiled — beyond move(3)+range(1) of the Keeper
  await setPos(page, 'wisp-1', 9, 6); // exiled — same reasoning
  await setPos(page, 'wraith-2', 7, 1); // distance 2 from the Keeper, same row — non-adjacent, in LoF/range
  await setPos(page, 'keeper', 5, 1);

  // Emboldened(+1) on the wraith for the whole test — see the header note above (keeps both
  // legs' deltas unambiguously nonzero-and-different: control 2, modified 1).
  await applyStatus(page, 'wraith-2', 'emboldened', 5, 1);

  // --- Round 1 control: Keeper NOT toppled — the non-adjacent wraith hits for base(1) + emboldened(1).
  const keeperBeforeR1 = await unitState(page, 'keeper');
  await page.keyboard.press('7'); // End the Keeper's turn 1.
  const turn2 = await passUntilKeeper(page);
  expect(turn2.activeId).toBe('keeper');

  const keeperAfterR1 = await unitState(page, 'keeper');
  const controlDelta = (keeperBeforeR1?.hp ?? 0) - (keeperAfterR1?.hp ?? 0);
  expect(controlDelta, 'sanity: the non-adjacent wraith hits for base(1) + emboldened(1), Keeper un-toppled').toBe(2);

  // --- Round 2 modified: re-pin geometry (this file's own "re-teleport everyone back" idiom —
  // nothing should actually have moved, since the wraith's own "already in range" branch never
  // relocates it, but this stays explicit rather than assumed), then Topple the Keeper — same
  // wraith, same distance, now −1.
  await setPos(page, 'wisp-0', 10, 6);
  await setPos(page, 'wisp-1', 9, 6);
  await setPos(page, 'wraith-2', 7, 1);
  await setPos(page, 'keeper', 5, 1);
  await applyStatus(page, 'keeper', 'toppled', 1, 1);

  const keeperBeforeR2 = await unitState(page, 'keeper');
  await page.keyboard.press('7'); // End the Keeper's turn 2.
  const turn3 = await passUntilKeeper(page);
  expect(turn3.activeId).toBe('keeper');

  const keeperAfterR2 = await unitState(page, 'keeper');
  const toppledDelta = (keeperBeforeR2?.hp ?? 0) - (keeperAfterR2?.hp ?? 0);
  expect(toppledDelta, "Ch. VIII: a non-adjacent attacker deals −1 against a Toppled target").toBe(controlDelta - 1);
});

// ---------------------------------------------------------------------------------------
// Scenario a (latch): the same Toppled-Keeper rise, now proving its opportunity latch is
// disabled for the rest of that round. Geometry (empirically verified against seed=7's actual
// floor/wall/gold layout — hand-derived coordinates alone were not reliable here; see
// task-2-report.md for the full derivation and the two dead ends it ruled out): Keeper(5,1)
// sits with the top wall at its back (row 0). wraith-2 (the mover) starts at (3,2), out of
// range/LoF (hasLineOfFire only fires along a shared row or column — grid.ts). Its own scoring
// (ai.ts's §8 wraith directive: +50 if the landing tile stays adjacent to ANY foe, -3 if it
// keeps line of fire) prefers the non-adjacent, column-aligned (5,3) over any adjacent tile —
// but ONLY once wisp-1 blocks the cheap direct-row escape at (3,1) and wisp-0 blocks the (4,3)
// waypoint that the two OTHER equally-short paths to (5,3) would otherwise take: with both
// blocked, wraith-2's sole remaining length-3 path is (3,2)->(4,2)->(5,2)->(5,3), and (5,2) IS
// adjacent to Keeper and IS vacated (not landed on) along the way — Ch. VI's opportunity-strike
// shape. Round 1 (Keeper NOT toppled) is the control, empirically proving this exact geometry
// provokes a real OA (wraith-2 loses exactly 1 hp). Round 3 re-stages the identical approach
// with the Keeper mid-rise (Toppled applied turn 2, rises turn 3) and proves the OA is
// suppressed (wraith-2's hp is unchanged across the same move) — the differential proof that
// mid-rise, not the geometry, is what changed. Round 2 in between is unavoidable scaffolding
// (the rise cannot fire on the same turn Toppled is applied) — the enemies' own round-2 turns
// wander off the staged positions, so every actor is re-teleported back before round 3's move.
// ---------------------------------------------------------------------------------------
test('bestiary scenario a: mid-rise disables the opportunity latch for the rest of that round', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  await setPos(page, 'mira', 1, 4);
  await setPos(page, 'keeper', 5, 1);
  await setPos(page, 'wisp-1', 3, 1); // blocker: cuts off the cheap direct-row escape tile
  await setPos(page, 'wisp-0', 4, 3); // blocker: kills the two alternate equal-length routes
  await setPos(page, 'wraith-2', 3, 2); // the mover

  // --- Round 1 control: Keeper NOT toppled — the OA should fire normally.
  const wraithBefore1 = await unitState(page, 'wraith-2');
  expect(wraithBefore1?.hp, 'sanity: wraith-2 starts at full hp').toBe(3);

  await page.keyboard.press('7'); // End Keeper's turn 1 without moving
  const reached1 = await passUntilUnitAt(page, 'wraith-2', 5, 3);
  expect(reached1, 'control: wraith-2 reached the predicted standoff tile').toBe(true);
  const wraithAfter1 = await unitState(page, 'wraith-2');
  expect(wraithAfter1?.hp, "control: Keeper's OA landed — wraith-2 lost exactly 1 hp").toBe(2);

  // --- Round 2 (scaffolding): apply Toppled now — the rise cannot fire on this same turn, so
  // it lands on the Keeper's turn 3 (round 3), which is where the re-staged test proof lives.
  const turn2 = await passUntilKeeper(page);
  expect(turn2.activeId).toBe('keeper');
  await applyStatus(page, 'keeper', 'toppled', 1, 1);
  // Task 8b — wraith-2 lands its own round-2 attack from the same non-adjacent standoff tile
  // (5,3) it always takes (distance 2 from the Keeper, confirmed by DIAG evidence during this
  // fix). Now that the Keeper is genuinely Toppled, that attack alone floors to 0 (base 1 − the
  // new non-adjacent −1 term, Ch. VIII's ±1 idiom) — a real, correct consequence of the law, not
  // a bug in it — which would silently skip refreshing Dimmed (CombatScene.ts's enemyStrike
  // gates the Dimmed apply on hpDamage > 0) and break this test's own Dimmed-vs-raw-stat
  // cross-check below. Emboldened(+1) keeps that one hit's damage positive (1+1−1=1) so Dimmed
  // still refreshes exactly as this test always intended; it does not touch anything this test
  // asserts about wraith-2's OWN incoming hp (only its outgoing damage).
  await applyStatus(page, 'wraith-2', 'emboldened', 2, 1);
  await page.keyboard.press('7'); // end turn 2 without moving

  // --- Round 3 test: the rise fires; re-stage the identical approach (the enemies' own round-2
  // turns wandered off their staged spots — re-teleport everyone back before re-checking).
  const turn3 = await passUntilKeeper(page);
  expect(turn3.activeId).toBe('keeper');
  // Sanity: the rise fired. NOT tollRise(4)=2 — wraith-2's own attack (the exact "wraith's
  // Dimmed(1) drops effectiveMove from 4 to 3" fact turnBudget.test.ts's compose-law pin
  // already documents) has been refreshing Dimmed(1) on the Keeper every round it's in range,
  // so the toll composes off the DIMMED effectiveMove (3), not the raw stat: tollRise(3) = 1.
  // This is the toll seam working correctly, not a bug — a live cross-check that Ch. VIII's
  // "half THIS turn's movement base" really does read the same effectiveMove Ch. VI's §3
  // Bound/Dimmed already produces, not the raw unit.move stat.
  expect(turn3.budget.total, 'sanity: the rise fired, tolled off the Dimmed effectiveMove (3), not the raw stat (4)').toBe(1);

  await setPos(page, 'wisp-1', 3, 1);
  await setPos(page, 'wisp-0', 4, 3);
  await setPos(page, 'wraith-2', 3, 2);
  const wraithBefore2 = await unitState(page, 'wraith-2');

  await page.keyboard.press('7'); // end the Keeper's risen turn without moving
  const reached2 = await passUntilUnitAt(page, 'wraith-2', 5, 3);
  expect(reached2, 'test: wraith-2 re-took the identical approach').toBe(true);
  const wraithAfter2 = await unitState(page, 'wraith-2');
  expect(wraithAfter2?.hp, "test: mid-rise disabled the Keeper's latch — wraith-2 took NO opportunity damage").toBe(wraithBefore2?.hp);
});

// ---------------------------------------------------------------------------------------
// Scenario b (Task 3 — Shove): a free-lane push beside Strike/Brace that never deals damage.
// Landed: the target moves 1 tile away, takes zero damage, the action is spent, and movement may
// continue (the steps-remain shape every gated action shares — Strike/Brace/etc.). Blocked (a
// wall behind the target): no move, still zero damage, the action is STILL spent (Ch. VIII: "you
// committed the shoulder"). Both sub-cases play out across the Keeper's own two consecutive
// turns, since Shove spends the turn's one action — a second Shove in the SAME turn is simply
// unavailable (budget.actionSpent gates it, same as Strike/Brace), matching how every other
// gated action in this file is exercised turn-by-turn.
// ---------------------------------------------------------------------------------------
test('bestiary scenario b: Shove pushes 1 tile and never damages; a blocked Shove still spends the action', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  // Keep the other two enemies out of the way for both sub-cases below — Shove's own mechanics
  // are the only thing under test here, not incidental AI interference (scenario a's own "exile"
  // idiom).
  await setPos(page, 'wisp-1', 10, 6);
  await setPos(page, 'wraith-2', 10, 1);

  // --- Turn 1: a landed push. Keeper(5,1), wisp-0(6,1) adjacent to its right, (7,1) clear floor
  // (row 1 is a fully-floor row across cols 1-10 — task-2-report.md's own fixture dump).
  await setPos(page, 'keeper', 5, 1);
  await setPos(page, 'wisp-0', 6, 1);
  const before = await unitState(page, 'wisp-0');
  expect(before?.hp, 'sanity: wisp-0 starts at full hp').toBe(2);

  await page.keyboard.press('0'); // Shove hotkey
  await canvasClick(page, tileXY(6, 1).x, tileXY(6, 1).y); // target wisp-0's tile

  const landed = await waitForSnap(page, (s) => s?.budget.actionSpent === true, 'the landed Shove to spend the action');
  expect(landed.state, 'movement may continue — the steps-remain shape, same as Strike/Brace').toBe('playerMove');
  expect(landed.log[landed.log.length - 1]?.action, 'the action log records the shove').toBe('shove');
  expect(landed.log[landed.log.length - 1]?.dmg, "Shove deals ZERO damage — the chapter's own law").toBe(0);

  const afterPushPos = await unitPos(page, 'wisp-0');
  expect(afterPushPos, 'wisp-0 moved exactly 1 tile away — the push landed').toEqual({ c: 7, r: 1 });
  const afterPushHp = await unitState(page, 'wisp-0');
  expect(afterPushHp?.hp, 'still zero damage after landing — no bump on a landed push regardless').toBe(2);
  expect(afterPushHp?.statuses.some((st) => st.id === 'toppled'), 'wisp-0 is NOT toppleable by default (all four shipped archetypes are false)').toBe(false);

  await page.keyboard.press('7'); // End Turn 1

  // --- Turn 2: a wall-blocked push. Col 0 is the wall border (task-2-report.md's own fixture
  // dump), so wisp-0 AT (1,1), pushed further west by a Keeper standing at (2,1), has nowhere to
  // go — (0,1) is a wall.
  const turn2 = await passUntilKeeper(page);
  expect(turn2.activeId).toBe('keeper');
  await setPos(page, 'keeper', 2, 1);
  await setPos(page, 'wisp-0', 1, 1); // between the Keeper and the west wall
  const beforeBlocked = await unitState(page, 'wisp-0');

  await page.keyboard.press('0'); // Shove hotkey
  await canvasClick(page, tileXY(1, 1).x, tileXY(1, 1).y);

  const blocked = await waitForSnap(page, (s) => s?.budget.actionSpent === true, 'the blocked Shove to still spend the action');
  expect(blocked.log[blocked.log.length - 1]?.action, 'the blocked Shove still logs').toBe('shove');
  expect(blocked.log[blocked.log.length - 1]?.dmg, 'the blocked Shove still deals ZERO damage').toBe(0);

  const afterBlockedPos = await unitPos(page, 'wisp-0');
  expect(afterBlockedPos, 'wisp-0 did not move — blocked by the west wall').toEqual({ c: 1, r: 1 });
  const afterBlockedHp = await unitState(page, 'wisp-0');
  expect(afterBlockedHp?.hp, 'still zero damage on a blocked push — the bump is suppressed for Shove, always').toBe(beforeBlocked?.hp ?? 2);
});

// ---------------------------------------------------------------------------------------
// Scenario b (Task 3 — Shove, the T2-deferral closer): Shove knocks a toppleable target Toppled
// on a landed push, and the rise/mid-rise machinery Task 2 built behaves correctly for a
// NON-FIRST unit (every enemy has speed < the Keeper's 5) — the exact case Task 2 could not
// construct itself (nothing in the shipped game could topple anything before this task).
//
// Task 6 RE-POINTED: this scenario used to fake its toppleable target with the e2e-only
// debugForceToppleable hook, because nothing in the shipped game was toppleable yet. The Husk is
// now the real toppleable:true entry, so the room is selected with ?enemies=husk,wisp,wraith
// (Task 6's packless archetype param) and the hook is gone entirely — the test now proves the
// SHIPPED stat rather than a test-only override.
//
// Geometry: husk-0 sits beside the Keeper on row 1. The Keeper Shoves it in round 1 — a landed
// push against a toppleable entry, so it knocks Toppled. husk-0 is not first in initiative
// (speed 1, the slowest line on the board, vs the Keeper's 5), so unlike scenario a's Keeper-only
// rise (which lands on the very next round because the Keeper always opens the round), husk-0's
// own next turn is STILL later in round 1 itself — that's where the rise actually fires. Its
// mid-rise mark then persists (per Task 2's fix round 1: cleared PER-UNIT, at husk-0's own next
// turn start, not in bulk at round-wrap) all the way through the rest of round 1 AND through the
// opening of round 2 — including the Keeper's own round-2 turn, which comes BEFORE husk-0's own
// round-2 turn. Round 2 proves the latch is still suppressed there (the Keeper walks past husk-0
// and takes no opportunity damage); round 3 proves it has re-armed by then (the identical walk
// now costs the Keeper exactly 1 hp) — the brief's own two-part ask: suppressed in the
// intervening window, live again after the stub's own next turn.
//
// Every position is pinned via debugSetPos immediately before each check (scenario a's own
// "re-teleport everyone back" idiom), so husk-0's own AI-driven rise/act turns — which this test
// does not otherwise control — can never contaminate the geometry.
// ---------------------------------------------------------------------------------------
test('bestiary scenario b: a landed Shove knocks Toppled, and a non-first unit\'s mid-rise latch survives the round wrap to its own next turn', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?scene=combat&seed=7&enemies=husk,wisp,wraith');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  await setPos(page, 'wisp-1', 10, 6);
  await setPos(page, 'wraith-2', 10, 1);
  await setPos(page, 'keeper', 5, 1);
  await setPos(page, 'husk-0', 6, 1);

  // --- Round 1 (Keeper's turn): Shove the stub. Landed (7,1 is clear floor) + toppleable → Toppled.
  await page.keyboard.press('0'); // Shove hotkey
  await canvasClick(page, tileXY(6, 1).x, tileXY(6, 1).y);
  await waitForSnap(page, (s) => s?.budget.actionSpent === true, 'the topple Shove to resolve');
  const toppled = await unitState(page, 'husk-0');
  expect(toppled?.statuses.some((st) => st.id === 'toppled'), 'the landed Shove knocked husk-0 Toppled').toBe(true);

  await page.keyboard.press('7'); // End the Keeper's round-1 turn.

  // --- Let round 1 finish (Mira, then husk-0's OWN turn — where the rise actually fires, since
  // husk-0 is not first in initiative and its own round-1 turn hasn't happened yet — then wisp-1/
  // wraith-2) and land back on the Keeper's round-2 turn.
  const turn2 = await passUntilKeeper(page);
  expect(turn2.activeId).toBe('keeper');
  const afterRise = await unitState(page, 'husk-0');
  expect(afterRise?.statuses.some((st) => st.id === 'toppled'), "husk-0's rise consumed Toppled during round 1").toBe(false);

  // --- Round 2 test: the Keeper walks past the still-mid-rise husk-0 — no OA should land.
  await setPos(page, 'wisp-1', 10, 6);
  await setPos(page, 'wraith-2', 10, 1);
  await setPos(page, 'husk-0', 6, 1);
  await setPos(page, 'keeper', 5, 1);
  const keeperHpBeforeR2 = await unitState(page, 'keeper');

  await canvasClick(page, tileXY(4, 1).x, tileXY(4, 1).y); // vacates (5,1), adjacent to husk-0
  const reached2 = await passUntilUnitAt(page, 'keeper', 4, 1);
  expect(reached2, 'round 2: the Keeper reached the retreat tile').toBe(true);
  await page.waitForTimeout(250); // let any (suppressed) OA resolution settle before reading hp
  const keeperHpAfterR2 = await unitState(page, 'keeper');
  expect(keeperHpAfterR2?.hp, "round 2: husk-0's latch is still disabled — the Keeper took NO opportunity damage").toBe(keeperHpBeforeR2?.hp);

  await page.keyboard.press('7'); // End the Keeper's round-2 turn.

  // --- Let round 2 finish (Mira, wraith-2, wisp-1, then husk-0's OWN round-2 turn — where the
  // per-unit clear fires, per Task 2's fix round 1) and land on the Keeper's round-3 turn.
  const turn3 = await passUntilKeeper(page);
  expect(turn3.activeId).toBe('keeper');

  // --- Round 3 test: the identical walk now costs the Keeper exactly 1 hp — the latch is live
  // again, proving the clear fired at husk-0's own next turn start (not a stale suppression).
  await setPos(page, 'wisp-1', 10, 6);
  await setPos(page, 'wraith-2', 10, 1);
  await setPos(page, 'husk-0', 6, 1);
  await setPos(page, 'keeper', 5, 1);
  const keeperHpBeforeR3 = await unitState(page, 'keeper');

  await canvasClick(page, tileXY(4, 1).x, tileXY(4, 1).y);
  const reached3 = await passUntilUnitAt(page, 'keeper', 4, 1);
  expect(reached3, 'round 3: the Keeper reached the retreat tile').toBe(true);
  await page.waitForTimeout(250);
  const keeperHpAfterR3 = await unitState(page, 'keeper');
  expect(keeperHpAfterR3?.hp, "round 3: husk-0's latch has re-armed — the Keeper takes the opportunity strike").toBe((keeperHpBeforeR3?.hp ?? 0) - 1);
});

// ---------------------------------------------------------------------------------------
// Task 8 sweep — "blocked-Shove-no-damage on all three block causes?": forceMove (grid.ts) has
// three distinct block branches — !inBounds, a wall/mist tile, and an OCCUPIED landing tile —
// and only the wall branch (scenario b's own second test, above) had e2e coverage. The true
// out-of-bounds branch is structurally unreachable through any legally-positioned unit: every
// room's border ring is unconditionally wall-typed (grid.ts's buildLayout), so a push that would
// leave the grid always fails the wall check first for anything that could legally stand adjacent
// to it — covered in effect by the wall case, not a separate reachable law. This closes the
// remaining REACHABLE gap: a push blocked by another unit already standing on the landing tile.
// ---------------------------------------------------------------------------------------
test('bestiary scenario b: a Shove blocked by an OCCUPIED landing tile also spends the action with zero damage', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  await setPos(page, 'wisp-1', 10, 6); // exiled — scenario b's own idiom

  // Keeper(5,1) shoves wisp-0(6,1) east — the landing tile (7,1) is occupied by wraith-2, not a
  // wall (row 1 is fully floor across cols 1-10, task-2-report.md's own fixture dump, reused
  // verbatim by scenario b/c above).
  await setPos(page, 'keeper', 5, 1);
  await setPos(page, 'wisp-0', 6, 1);
  await setPos(page, 'wraith-2', 7, 1); // occupies the landing tile
  const before = await unitState(page, 'wisp-0');
  expect(before?.hp, 'sanity: wisp-0 starts at full hp').toBe(2);

  await page.keyboard.press('0'); // Shove hotkey
  await canvasClick(page, tileXY(6, 1).x, tileXY(6, 1).y);

  const blocked = await waitForSnap(page, (s) => s?.budget.actionSpent === true, 'the occupied-blocked Shove to still spend the action');
  expect(blocked.log[blocked.log.length - 1]?.action, 'the blocked Shove still logs').toBe('shove');
  expect(blocked.log[blocked.log.length - 1]?.dmg, 'the occupied-blocked Shove still deals ZERO damage').toBe(0);

  const afterPos = await unitPos(page, 'wisp-0');
  expect(afterPos, 'wisp-0 did not move — the landing tile was occupied').toEqual({ c: 6, r: 1 });
  const afterHp = await unitState(page, 'wisp-0');
  expect(afterHp?.hp, 'still zero damage — the bump is suppressed for Shove, always, even on an occupied block').toBe(before?.hp ?? 2);
});

// ---------------------------------------------------------------------------------------
// Scenario c (Task 4 — Daunted): wisp-0 stands in for the Pall (via debugApplyStatus's new
// sourceId param, the same "debug seam stands in for the later real archetype" spirit as
// Task 3's debugForceToppleable standing in for the Husk). Geometry: row 1 is a fully-floor
// row across cols 1-10 (task-2-report.md's own fixture dump, reused verbatim by scenario b) —
// Keeper(5,1), source wisp-0(2,1) three tiles west, damage-target wraith-2(5,2) adjacent
// south (off the row-1 corridor entirely, so it never blocks the east-west move-field check).
// wisp-1 and (between turns) wraith-2 are exiled far east so their own AI turns can't wander
// into the staged geometry or land a hit that would Dimmed the Keeper and desync the move
// budget the tile math below assumes.
//
// Three turns: (1) an undaunted control Strike records the baseline damage; (2) Daunted
// applied (sourceId=wisp-0) proves the move field excludes the two tiles strictly closer to
// wisp-0 than the Keeper's own tile while keeping the equal/farther ones, AND the SAME Strike
// now deals exactly 1 less than the control — then wisp-0 is fixtured to die at ITS OWN next
// turn-start tick (scenario a's own lethal-Kindled technique, the only clean way to fell a
// unit without the Keeper's own attack ALSO being the thing under test); (3) on the Keeper's
// very next turn, with wisp-0 confirmed dead, the excluded tiles are reachable again and the
// Strike deals full (control-equal) damage again — proving the lift is a live read of
// `alive`, not a decayed counter that would need an extra turn to catch up.
// ---------------------------------------------------------------------------------------
test('bestiary scenario c: Daunted — the move field excludes closer tiles, damage is −1, and a felled source lifts both immediately', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  await setPos(page, 'wisp-1', 10, 6); // exiled — out of reach all test long
  // Mira's default fixture spawn is (3,1) — squarely inside the row-1 corridor this scenario
  // measures reachability along. She never moves for the rest of this test (this file's own
  // passUntilKeeper idiom just presses her End Turn hotkey immediately, every round), so one
  // reposition here is enough — no need to re-stage her at every later restage block.
  await setPos(page, 'mira', 1, 6);
  await setPos(page, 'wraith-2', 5, 2); // adjacent south of the Keeper — the damage-target/control
  await setPos(page, 'wisp-0', 2, 1); // the Daunted source stand-in, 3 tiles west along row 1
  await setPos(page, 'keeper', 5, 1);

  const fresh = await snap(page);
  expect(fresh?.budget.total, "sanity: the Keeper's fresh, un-tolled move budget").toBe(4);

  // --- Turn 1: undaunted control Strike on wraith-2.
  await page.keyboard.press('1'); // Strike hotkey
  await waitForSnap(page, (s) => s?.state === 'playerTarget', 'Strike targeting to open');
  await canvasClick(page, tileXY(5, 2).x, tileXY(5, 2).y);
  const afterControl = await waitForSnap(page, (s) => s?.state !== 'resolving', 'the control Strike to resolve');
  const controlDealt = afterControl.log.at(-1)?.dmg ?? -1;
  expect(controlDealt, 'sanity: the undaunted control Strike deals the plain base (no flank/level bonus in this fixture)').toBe(1);

  // Exile wraith-2 off row 1 entirely before ending the turn: (10,1) (scenario a/b's own exile
  // spot) shares the Keeper's ROW, and wraith's range(3)+move(3) easily closes that gap and
  // fires down the row — this fixture needs a spot with neither shared row NOR shared column
  // within reach, so its own AI turn this round can't get a shot off, Dimmed the Keeper, and
  // desync the move-budget math below.
  await setPos(page, 'wraith-2', 8, 6);
  await page.keyboard.press('7'); // End turn 1.

  // --- Turn 2: apply Daunted (sourceId=wisp-0, still alive), re-stage, and prove both effects.
  const turn2 = await passUntilKeeper(page);
  expect(turn2.activeId).toBe('keeper');
  expect(turn2.budget.total, 'sanity: no Dimmed picked up in the interim — still the raw base').toBe(4);

  // debugSetPos only refreshes the move field when repositioning the ACTIVE unit, off
  // whatever occupancy exists AT THAT MOMENT — so the Keeper's own setPos must come LAST,
  // after wisp-0/wraith-2 are already at their final spots, or the refresh reads stale
  // (pre-restage) blocking data.
  await setPos(page, 'wisp-0', 2, 1);
  await setPos(page, 'wraith-2', 5, 2);
  await setPos(page, 'keeper', 5, 1);

  const beforeDaunt = await reachable(page);
  expect(hasTile(beforeDaunt, 3, 1), 'sanity: (3,1) is reachable before Daunted applies').toBe(true);
  expect(hasTile(beforeDaunt, 4, 1), 'sanity: (4,1) is reachable before Daunted applies').toBe(true);

  await applyStatus(page, 'keeper', 'daunted', -1, 1, 'wisp-0'); // battle-long, magnitude 1 (the −1 law)

  // debugApplyStatus doesn't itself touch position/move state, so re-set the Keeper's own tile
  // to force the exact same "reposition the active unit" refresh debugSetPos already uses —
  // the move field must reflect the freshly-applied Daunted on its very next recompute.
  await setPos(page, 'keeper', 5, 1);
  const afterDaunt = await reachable(page);
  expect(hasTile(afterDaunt, 3, 1), '(3,1) is 1 tile closer to wisp-0(2,1) than the Keeper(5,1) — excluded').toBe(false);
  expect(hasTile(afterDaunt, 4, 1), '(4,1) is 2 tiles closer to wisp-0 than the Keeper — excluded').toBe(false);
  expect(hasTile(afterDaunt, 6, 1), '(6,1) is FARTHER from wisp-0 than the Keeper — kept').toBe(true);
  expect(hasTile(afterDaunt, 9, 1), '(9,1) is farther still — kept').toBe(true);

  await page.keyboard.press('1'); // Strike hotkey
  await waitForSnap(page, (s) => s?.state === 'playerTarget', 'Strike targeting to open');
  await canvasClick(page, tileXY(5, 2).x, tileXY(5, 2).y);
  const afterDauntedStrike = await waitForSnap(page, (s) => s?.state !== 'resolving', 'the Daunted Strike to resolve');
  const dauntedDealt = afterDauntedStrike.log.at(-1)?.dmg ?? -1;
  expect(dauntedDealt, "Daunted deals exactly 1 LESS than the undaunted control — the chapter's −1 law").toBe(controlDealt - 1);

  // Fixture wisp-0 to die at ITS OWN next turn-start tick (scenario a's own lethal-Kindled
  // technique) — the cleanest way to fell the source without the Keeper's own (now-weakened)
  // Strike being the thing that has to do it.
  await applyStatus(page, 'wisp-0', 'kindled', 1, 2); // wisp-0's hp is 2 — this kills it outright

  await setPos(page, 'wraith-2', 8, 6); // exile again (off row AND column — see turn 1's own note)
  await page.keyboard.press('7'); // End turn 2.

  // --- Turn 3: wisp-0 is dead — both effects must already be gone, with no extra turn's delay.
  const turn3 = await passUntilKeeper(page);
  expect(turn3.activeId).toBe('keeper');

  const wisp0Dead = await unitState(page, 'wisp-0');
  expect(wisp0Dead?.alive, "sanity: wisp-0 fell at its own turn-start tick, before ever acting").toBe(false);

  await setPos(page, 'wraith-2', 5, 2);
  await setPos(page, 'keeper', 5, 1); // re-set to force the move-field refresh, same as turn 2

  const afterFall = await reachable(page);
  expect(hasTile(afterFall, 3, 1), 'the source is gone — (3,1) is reachable again, same turn its death is first observed').toBe(true);
  expect(hasTile(afterFall, 4, 1), '(4,1) likewise reachable again').toBe(true);

  await page.keyboard.press('1'); // Strike hotkey
  await waitForSnap(page, (s) => s?.state === 'playerTarget', 'Strike targeting to open');
  await canvasClick(page, tileXY(5, 2).x, tileXY(5, 2).y);
  const afterRestoredStrike = await waitForSnap(page, (s) => s?.state !== 'resolving', 'the restored Strike to resolve');
  const restoredDealt = afterRestoredStrike.log.at(-1)?.dmg ?? -1;
  expect(restoredDealt, 'full damage is restored — identical to the original undaunted control').toBe(controlDealt);
});

// ---------------------------------------------------------------------------------------
// Scenario d (Task 5 — Unwritten): "what is not yet written cannot be struck." wisp-0 stands in
// for the Lurker (via debugApplyStatus, the same "debug seam stands in for the later real
// archetype" spirit as Task 3's debugForceToppleable / Task 4's sourceId param) — Task 6 lands
// the real archetype that begins combat this way.
//
// Geometry across both tests below reuses scenario b's exact known-good layout: Keeper(5,1),
// wisp-0(6,1) adjacent. wisp-1 exiles to (10,6) (scenario b/c's own spot — melee-only, can't
// close in time). wraith-2 exiles to (8,6), NOT (10,1) — scenario c's own fix note applies
// here too: (10,1) shares the Keeper's row, and wraith's range(3)+move(3) closes it and fires
// down the row, contaminating any hp measurement; (8,6) shares neither row nor column.
//
// This first test proves the TARGETING half: Strike (and Shove — T3's own predicate, wired
// but never end-to-end tested until an Unwritten unit existed to test it against) exclude an
// Unwritten enemy; a spell's own validTargets does not (the chapter's own distinction). Then it
// proves clear trigger 2 (damage taken) IN ISOLATION from trigger 1 (own action): a non-lethal
// Kindled tick stands in for "a spell hits it" — a deterministic, non-Strike/Shove damage
// source that travels the SAME damageUnit choke a real cast would, without fighting a live
// MCQ's fact-dependent content (this file's own established lethal/non-lethal-Kindled-tick
// substitution idiom, scenario a/c). Both party units are moved OUT of wisp-0's move+range
// reach (4) before its own turn opens: left adjacent, wisp-0 would ALSO attack post-tick
// (trigger 1 firing in the same turn), which would clear Unwritten too and silently mask a
// broken trigger 2 — a mutation check on this exact test caught precisely that confound before
// this geometry was added, so isolating the two triggers here is load-bearing, not decorative.
// ---------------------------------------------------------------------------------------
test('bestiary scenario d: Strike (and Shove) exclude an Unwritten enemy; a spell still reaches it; taking damage reveals it', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  await setPos(page, 'wisp-1', 10, 6);
  await setPos(page, 'wraith-2', 8, 6);
  await setPos(page, 'keeper', 5, 1);
  await setPos(page, 'wisp-0', 6, 1);

  // --- Sanity (pre-Unwritten): adjacency alone already makes wisp-0 a valid Strike target.
  const before = await validTargets(page, 'strike');
  expect(before, 'sanity: wisp-0 is Strike-targetable before Unwritten applies').toContain('wisp-0');

  await applyStatus(page, 'wisp-0', 'unwritten', -1, 0);
  const marked = await unitState(page, 'wisp-0');
  expect(marked?.statuses.some((st) => st.id === 'unwritten'), 'sanity: the debug-apply landed').toBe(true);

  // --- Targeting: Strike AND Shove exclude it; a spell (Smite) does not.
  const strikeTargets = await validTargets(page, 'strike');
  expect(strikeTargets, "Strike's own validTargets skips the Unwritten enemy").not.toContain('wisp-0');
  const shoveTargets = await validTargets(page, 'shove');
  expect(shoveTargets, "Shove excludes it too — T3's own predicate, now actually exercised end-to-end").not.toContain('wisp-0');
  const smiteTargets = await validTargets(page, 'smite');
  expect(smiteTargets, "a spell's own validTargets reaches it fine — the chapter's own distinction").toContain('wisp-0');

  // --- Trigger 2 (damage taken), isolated: a non-lethal Kindled tick (wisp-0's hp is 2) — see
  // the header note above for why this stands in for a real spell hit. Move BOTH party units
  // beyond wisp-0's move(3)+range(1)=4 reach first, so its own turn (right after the tick) has
  // no valid attack target and cannot ALSO clear the status via trigger 1 — isolating trigger 2
  // as the only possible cause of what this test checks next.
  await applyStatus(page, 'wisp-0', 'kindled', 1, 1);
  await setPos(page, 'mira', 1, 6); // scenario c's own proven-safe far tile
  await setPos(page, 'keeper', 1, 1); // same row, far column — distance 5 > wisp-0's reach of 4
  await page.keyboard.press('7'); // End the Keeper's turn 1.
  const turn2 = await passUntilKeeper(page);
  expect(turn2.activeId).toBe('keeper');

  const revealed = await unitState(page, 'wisp-0');
  expect(revealed?.hp, 'sanity: the Kindled tick dealt exactly 1, non-lethal').toBe(1);
  expect(revealed?.statuses.some((st) => st.id === 'unwritten'), 'taking damage revealed it — Unwritten is gone, with no target in reach to have acted on instead').toBe(false);

  // Re-pin adjacency (wisp-0's own turn moved it toward the now-distant party; the Keeper's own
  // setPos must come LAST to force the reachable/moveField refresh, scenario c's own rule) so
  // the final targeting check re-exercises the exact geometry the earlier exclusion check used.
  await setPos(page, 'wisp-0', 6, 1);
  await setPos(page, 'keeper', 5, 1);
  const afterTargets = await validTargets(page, 'strike');
  expect(afterTargets, 'revealed: Strike-targetable again').toContain('wisp-0');
});

// ---------------------------------------------------------------------------------------
// Scenario d (Task 5 — Unwritten), the act-variant: proves clear trigger 1 (own action) and the
// +1 opening-tempo bonus, exactly once. wisp-0 (attack 1, per units.ts's ENEMY_STATS) is kept
// adjacent to the Keeper across two full rounds and never takes damage first — so its OWN first
// act is unambiguously the reveal trigger, not trigger 2. Since the Keeper is already in range
// 1 the instant wisp-0's turn opens, decideEnemy's own "already in range from where we stand?
// hit without moving" branch (ai.ts) fires deterministically every round — no AI-scoring
// uncertainty to derive, unlike scenario a's own deflected-path geometry. No flank (the other
// two enemies stay exiled off both the Keeper/wisp-0 row and the opposite-tile column), so the
// Keeper's hp delta reads the modifier pipeline directly: base 1 +1 while still unwritten
// (round 1), then plain base 1 once already revealed (round 2) — the exactly-once pin. The
// exiled pair are re-pinned before round 2 (this file's own "re-teleport everyone back" idiom,
// scenario a/b) since their own AI could otherwise wander back into relevance between rounds.
// ---------------------------------------------------------------------------------------
test("bestiary scenario d: an Unwritten enemy's own first act deals +1 and reveals it; its next act is plain base — exactly once", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  await setPos(page, 'wisp-1', 10, 6);
  await setPos(page, 'wraith-2', 8, 6);
  await setPos(page, 'keeper', 5, 1);
  await setPos(page, 'wisp-0', 6, 1);
  await applyStatus(page, 'wisp-0', 'unwritten', -1, 0);

  const wisp0 = await unitState(page, 'wisp-0');
  expect(wisp0?.hp, "sanity: wisp-0 hasn't been damaged — its own act will be the FIRST reveal").toBe(2);

  // --- Round 1: the Keeper ends its turn without attacking wisp-0 — wisp-0's own turn (later
  // in the same round, per its lower speed) is the first thing that can reveal it.
  const keeperBeforeR1 = await unitState(page, 'keeper');
  await page.keyboard.press('7');
  const turn2 = await passUntilKeeper(page);
  expect(turn2.activeId).toBe('keeper');

  const keeperAfterR1 = await unitState(page, 'keeper');
  expect(
    (keeperBeforeR1?.hp ?? 0) - (keeperAfterR1?.hp ?? 0),
    "round 1: wisp-0's opening act carried the +1 tempo bonus (base 1 + 1)",
  ).toBe(2);
  const wisp0AfterR1 = await unitState(page, 'wisp-0');
  expect(wisp0AfterR1?.statuses.some((st) => st.id === 'unwritten'), "wisp-0's own act revealed it").toBe(false);
  expect(wisp0AfterR1?.hp, 'wisp-0 itself took no damage this round — the reveal came from ITS act, not trigger 2').toBe(2);

  // --- Round 2: re-pin geometry, then let wisp-0 act again — now plain base, never a repeat.
  await setPos(page, 'wisp-1', 10, 6);
  await setPos(page, 'wraith-2', 8, 6);
  await setPos(page, 'wisp-0', 6, 1);
  await setPos(page, 'keeper', 5, 1);
  const keeperBeforeR2 = await unitState(page, 'keeper');

  await page.keyboard.press('7');
  const turn3 = await passUntilKeeper(page);
  expect(turn3.activeId).toBe('keeper');

  const keeperAfterR2 = await unitState(page, 'keeper');
  expect(
    (keeperBeforeR2?.hp ?? 0) - (keeperAfterR2?.hp ?? 0),
    "round 2: wisp-0's SECOND act is plain base — the +1 does not repeat",
  ).toBe(1);
});

// ---------------------------------------------------------------------------------------
// Scenario d, Fix round 2 (T5 review finding): the OA-vs-Unwritten interaction needs no AI
// choice from the striker to test — opportunityStrikers (ai.ts) is a purely reactive/positional
// check fired by the MOVER, not a decision the Unwritten unit makes. A stationary Unwritten
// enemy adjacent to a tile the Keeper walks away from is enough, today, with the same debug
// hooks scenario d already uses plus one ordinary click-driven move — the reviewer's own proven
// probe recipe and geometry, reused verbatim here (Keeper 10→8, wisp-0's Unwritten consumed).
// ---------------------------------------------------------------------------------------
test('bestiary scenario d: an Unwritten enemy\'s opportunity strike also carries +1 and consumes it — the ambush writes the striker', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  await setPos(page, 'wisp-1', 10, 6);
  await setPos(page, 'wraith-2', 8, 6);
  await setPos(page, 'keeper', 5, 1);
  await setPos(page, 'wisp-0', 6, 1);
  await applyStatus(page, 'wisp-0', 'unwritten', -1, 0);

  const keeperBefore = await unitState(page, 'keeper');
  expect(keeperBefore?.hp, 'sanity: full hp before the OA').toBe(10);

  await canvasClick(page, tileXY(4, 1).x, tileXY(4, 1).y); // walk away — vacates (5,1), adjacent to wisp-0
  const reached = await passUntilUnitAt(page, 'keeper', 4, 1);
  expect(reached, 'the Keeper reached the retreat tile').toBe(true);
  await page.waitForTimeout(250); // let the (expected) OA resolution settle before reading hp

  const keeperAfter = await unitState(page, 'keeper');
  expect(keeperAfter?.hp, "the Unwritten striker's OA landed base(1) + the +1 opening tempo").toBe(8);

  const wisp0After = await unitState(page, 'wisp-0');
  expect(wisp0After?.statuses.some((st) => st.id === 'unwritten'), 'the ambush wrote the striker — Unwritten is consumed').toBe(false);

  // "Then targetable": re-pin adjacency (the Keeper's own setPos must come last, scenario c's
  // rule) and confirm the reveal actually reopened Strike targeting, not just cleared the flag.
  await setPos(page, 'keeper', 5, 1);
  const strikeTargets = await validTargets(page, 'strike');
  expect(strikeTargets, 'revealed by its own ambush — Strike-targetable now').toContain('wisp-0');
});

// ---------------------------------------------------------------------------------------
// Scenario e (Task 6 — the three entries, integrated): the wave's mechanics have each been
// proven in isolation against debug stand-ins (scenarios a-d). This is the room those stand-ins
// were standing in FOR: the real Lurker, Husk and Pall on one board, selected with Task 6's
// ?enemies= param, each driving the shipped mechanic it owns.
//
//   Lurker — spawns Unwritten (a spawn-time rider, not a first-turn action), holds, and is
//     revealed by its own opening act. Proven by the status AND by Strike targeting reopening.
//   Husk   — the only toppleable entry, and symmetric: its heave topples the RETINUE, and the
//     Keeper then pays Task 2's rise toll at its own next turn start.
//   Pall   — its touch Daunts with sourceId = itself, and felling it lifts the daunt: observed
//     through the move field, which stops being filtered the moment the source is off the board.
//
// Enemies are lethally Kindled when they need to die on cue (scenario a's own technique — they
// expire at their own turn-start tick, before acting), and every position is pinned via
// debugSetPos immediately before the beat that reads it, so AI-driven moves between beats can
// never contaminate the geometry.
// ---------------------------------------------------------------------------------------
test('bestiary scenario e: the mixed room — the Lurker is written, the Husk floors the retinue, the Pall daunts until it falls', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?scene=combat&seed=7&enemies=lurker,husk,pall');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  // --- The Lurker begins Unwritten. A SPAWN-time rider: nothing has taken a turn yet.
  const lurkerAtSpawn = await unitState(page, 'lurker-0');
  expect(lurkerAtSpawn?.statuses.some((s) => s.id === 'unwritten'), 'the Lurker begins combat Unwritten').toBe(true);

  // Park Mira and the Pall out of the way; stand the Keeper beside the Lurker so its opening
  // act has a target. The Husk is left where it spawned for now.
  await setPos(page, 'mira', 1, 7);
  await setPos(page, 'pall-2', 11, 7);
  await setPos(page, 'husk-1', 11, 0);
  await setPos(page, 'keeper', 5, 3);
  await setPos(page, 'lurker-0', 6, 3);

  // Unwritten cannot be Struck while it holds — the shipped exclusion, now driven by a real entry.
  expect(await validTargets(page, 'strike'), 'an Unwritten Lurker is not a legal Strike target')
    .not.toContain('lurker-0');

  // Let the Lurker take its own turn: it opens from the unseen, which consumes Unwritten.
  await page.keyboard.press('7'); // end the Keeper's turn
  const revealed = await (async () => {
    const start = Date.now();
    while (Date.now() - start < 30_000) {
      const st = await unitState(page, 'lurker-0');
      if (st && !st.statuses.some((s) => s.id === 'unwritten')) return st;
      const s = await snap(page);
      if (s?.state === 'playerMove' && s.activeId !== 'lurker-0') await page.keyboard.press('7');
      await page.waitForTimeout(150);
    }
    return null;
  })();
  expect(revealed, 'the Lurker acted and was written into the Ledger').not.toBeNull();

  await passUntilKeeper(page);
  await setPos(page, 'keeper', 5, 3);
  await setPos(page, 'lurker-0', 6, 3);
  expect(await validTargets(page, 'strike'), 'once written, the Lurker is Strike-targetable like anything else')
    .toContain('lurker-0');

  // --- The Husk's heave topples the RETINUE (the chapter's symmetry clause), and the Keeper
  // pays the rise toll at its own next turn start. Clear the Lurker off the board so only the
  // Husk can act on the Keeper, and stand the Keeper with open floor behind it so the push LANDS
  // (a blocked heave bumps but never topples).
  await applyStatus(page, 'lurker-0', 'kindled', 5, 5); // lethal at its own turn-start tick
  await setPos(page, 'pall-2', 11, 7); // and keep the Pall out of this beat
  await setPos(page, 'keeper', 6, 3);
  await setPos(page, 'husk-1', 5, 3); // heave pushes the Keeper east, onto open floor at (7,3)

  const keeperBeforeHeave = await unitState(page, 'keeper');
  await page.keyboard.press('7');
  const heaved = await (async () => {
    const start = Date.now();
    while (Date.now() - start < 40_000) {
      const st = await unitState(page, 'keeper');
      if (st?.statuses.some((s) => s.id === 'toppled')) return st;
      const s = await snap(page);
      if (s?.state === 'playerMove' && s.activeId !== 'keeper') await page.keyboard.press('7');
      await page.waitForTimeout(150);
    }
    return null;
  })();
  expect(heaved, "the Husk's heave knocked the Keeper Toppled — the retinue is toppleable too").not.toBeNull();
  expect(heaved!.hp, 'the heave dealt its ordinary damage as well — the no-damage law is Shove\'s alone')
    .toBeLessThan(keeperBeforeHeave?.hp ?? 10);

  // The rise: automatic at the Keeper's own next turn start, and it consumes the condition.
  const afterRise = await passUntilKeeper(page);
  expect(afterRise.activeId).toBe('keeper');
  const keeperRisen = await unitState(page, 'keeper');
  expect(keeperRisen?.statuses.some((s) => s.id === 'toppled'), "the Keeper's rise consumed Toppled").toBe(false);
  expect(afterRise.budget.total, 'the rise was paid for: half the movement base, house floor max(1, floor(4/2))').toBe(2);

  // --- The Pall's touch Daunts, carrying itself as the source; felling it lifts the daunt.
  // The Husk is EXILED here rather than killed. It and the Pall are the last two enemies, so
  // felling both would END THE BATTLE the instant the Pall dies — and a finished battle has no
  // move field left to read the lift from. Parked in the far corner it is speed 1 / move 2 and
  // cannot close on the Keeper before the test re-parks it.
  await setPos(page, 'husk-1', 11, 7);
  await setPos(page, 'keeper', 6, 3);
  await setPos(page, 'pall-2', 5, 3);
  await page.keyboard.press('7');
  const daunted = await (async () => {
    const start = Date.now();
    while (Date.now() - start < 40_000) {
      const st = await unitState(page, 'keeper');
      const d = st?.statuses.find((s) => s.id === 'daunted');
      if (d) return d;
      const s = await snap(page);
      if (s?.state === 'playerMove' && s.activeId !== 'keeper') await page.keyboard.press('7');
      await page.waitForTimeout(150);
    }
    return null;
  })();
  expect(daunted, "the Pall's touch Daunted the Keeper").not.toBeNull();
  expect(daunted!.sourceId, 'the daunt names the Pall itself as its source').toBe('pall-2');

  // While the Pall stands, the move field is filtered: the Keeper cannot willingly END a move
  // closer to the source than it began. Asserted on ONE named tile rather than on a reachable
  // COUNT — the count also moves with whatever movement budget is left on the turn being read,
  // so comparing counts across two different turns compares two things at once and proves
  // neither. (7,3) is one step toward the Pall at (5,3) from the Keeper's (8,3).
  await passUntilKeeper(page);
  await setPos(page, 'husk-1', 11, 7);
  await setPos(page, 'pall-2', 5, 3);
  await setPos(page, 'keeper', 8, 3);
  expect(hasTile(await reachable(page), 7, 3), 'while the Pall stands, the Keeper cannot step toward it')
    .toBe(false);

  // Fell it. END THE KEEPER'S TURN FIRST: Kindled ticks at its OWNER's turn start, and
  // passUntilKeeper called while the Keeper's own turn is already open returns immediately,
  // handing the Pall no turn in which to burn.
  await applyStatus(page, 'pall-2', 'kindled', 9, 9);
  await page.keyboard.press('7');
  await passUntilKeeper(page);
  const pallGone = await unitState(page, 'pall-2');
  expect(pallGone?.alive, 'the Pall fell').toBe(false);
  const keeperAlive = await unitState(page, 'keeper');
  expect(keeperAlive?.alive, 'the Keeper is still standing to observe the lift').toBe(true);
  await setPos(page, 'keeper', 8, 3);
  expect(hasTile(await reachable(page), 7, 3), 'source off the board — the daunt no longer filters the move field')
    .toBe(true);
});

// ---------------------------------------------------------------------------------------
// Scenario e, part 2 (the C2-W6 regression gate): the demo pilot must still drive a fight to
// RESOLUTION with the three new archetypes in the loop. C2-W6 was a freeze class — the pilot
// reaching a board state it had no legal action for and spinning forever — and every new
// archetype is a fresh chance to resurrect it: the Lurker is untargetable by Strike while it
// holds, the Pall walks AWAY once its daunt lands, and the Husk moves the pilot's own units
// around underneath it. Any of those could strand a pilot that assumed a reachable target.
//
// Deliberately asserts the poll REACHED a terminal state — 'over' OR 'deathsdoor' — rather than
// falling out of the loop on the time budget (Step 0/T2's own lesson: a stalled fight passes a
// bare truthiness check silently). Either state means the turn loop ENDED, which is the whole
// claim; a frozen pilot reaches neither. Demanding 'over' specifically would assert a balance
// outcome under the name of a freeze gate — see the in-body note.
// ---------------------------------------------------------------------------------------
test('bestiary scenario e: the demo pilot drives the mixed room to resolution — the freeze class stays dead', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?scene=combat&seed=7&demo=1&enemies=lurker,husk,pall');
  await waitReady(page, 'combat');
  await setPilotPreference(page, 'strike'); // keep it in the free lane; no encounter overlay opens

  // RESOLUTION, not victory. The mixed room reliably beats a level-1 retinue — the Pall's −1
  // plus the Husk's 2-and-a-topple is more than the starting kit answers — so the honest
  // terminal state here is Death's Door, and demanding 'over' would be asserting a balance
  // outcome while pretending to assert a freeze. What the freeze class is actually about is
  // whether the pilot ever STOPS: both 'over' and 'deathsdoor' are the turn loop reaching an
  // end, and a frozen pilot reaches neither.
  const TERMINAL = ['over', 'deathsdoor'];
  const start = Date.now();
  let last: Snap = null;
  while (Date.now() - start < 150_000) {
    last = await snap(page);
    if (last && TERMINAL.includes(last.state)) break;
    await page.waitForTimeout(200);
  }
  expect(
    last && TERMINAL.includes(last.state),
    `the pilot drove the mixed room to an end rather than spinning; last state=${last?.state}`,
  ).toBe(true);
});

// ---------------------------------------------------------------------------------------
// Scenario f (Task 6 fix round 1 — the stale-Daunted cosmetic, second surface): an INERT Daunted
// must not be ANNOUNCED any more than it is drawn. The chip row was filtered first; the §12.3
// status hover banner was not, and it read worse than the bug it was meant to close — hovering a
// unit whose only status was a lifted daunt announced "Keeper — Daunted 1" over a chip row
// showing nothing at all. Both surfaces now read one shared `visibleStatuses` list.
//
// Two claims, because the defect had two halves:
//   1. the LINE (and its tint) omit a lifted daunt while still naming the unit's real statuses;
//   2. the GATE does not fire the banner at all when a lifted daunt is the ONLY status.
// The daunt is applied through the debug seam with sourceId, and the source is felled with a
// lethal Kindled — scenario a's technique — so nothing here depends on the Pall's own AI.
// ---------------------------------------------------------------------------------------
test('bestiary scenario f: a lifted Daunted is neither drawn nor announced — the hover line drops it, and never fires alone', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?scene=combat&seed=7&enemies=pall,wisp,wraith');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn 1 to open");

  // Park every enemy away from the retinue; the Pall is only ever a NAMED SOURCE here.
  await setPos(page, 'pall-0', 11, 7);
  await setPos(page, 'wisp-1', 11, 0);
  await setPos(page, 'wraith-2', 10, 0);
  await setPos(page, 'keeper', 5, 3);
  await setPos(page, 'mira', 5, 5);

  // The Keeper carries a real status AND a daunt sourced to the (still standing) Pall.
  await applyStatus(page, 'keeper', 'inked', 9, 1);
  await applyStatus(page, 'keeper', 'daunted', 1, 1, 'pall-0');

  await hoverTile(page, 0, 0); // somewhere empty, so the next hover is a fresh unit id
  await hoverTile(page, 5, 3);
  const whileSourceStands = await bannerText(page);
  expect(whileSourceStands, 'while the Pall stands the daunt is real, so the line names it').toContain('Daunted');
  expect(whileSourceStands, "and the unit's other conditions are named too").toContain('Inked');

  // Fell the source. End the turn first so the Pall reaches its own turn-start Kindled tick.
  await applyStatus(page, 'pall-0', 'kindled', 9, 9);
  await page.keyboard.press('7');
  await passUntilKeeper(page);
  expect((await unitState(page, 'pall-0'))?.alive, 'the source fell').toBe(false);

  // Claim 1: the line drops the lifted daunt and keeps everything else.
  await setPos(page, 'keeper', 5, 3);
  await hoverTile(page, 0, 0);
  await hoverTile(page, 5, 3);
  const afterSourceFell = await bannerText(page);
  expect(afterSourceFell, 'the lifted daunt is no longer announced').not.toContain('Daunted');
  expect(afterSourceFell, 'the real condition is still announced — the filter is not a blanket mute').toContain('Inked');

  // Claim 2: with a lifted daunt as its ONLY status, hovering fires no banner at all — the gate
  // reads the visible list too. Mira's banner would have to overwrite the Keeper's line to fail
  // this, so an unchanged banner is the proof.
  await applyStatus(page, 'mira', 'daunted', 1, 1, 'pall-0');
  await setPos(page, 'mira', 5, 5);
  const beforeHoveringMira = await bannerText(page);
  await hoverTile(page, 0, 0);
  await hoverTile(page, 5, 5);
  expect(await bannerText(page), 'a lone lifted daunt fires no hover banner — the banner is untouched')
    .toBe(beforeHoveringMira);
});
