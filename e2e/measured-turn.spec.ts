import { test, expect, type Page } from '@playwright/test';
import { waitReady, canvasClick, readState } from './helpers';

/** tileToScreen: ORIGIN(192,48) + c*48+24, r*48+24 (the formula every combat spec uses). */
const CELL = 48;
const ORIGIN = { x: 192, y: 48 };
function tileXY(c: number, r: number): { x: number; y: number } {
  return { x: ORIGIN.x + c * CELL + CELL / 2, y: ORIGIN.y + r * CELL + CELL / 2 };
}

type Budget = { total: number; left: number; legSpent: boolean; actionSpent: boolean; pressedOn: boolean };
type Snap = {
  state: string;
  activeId: string;
  log: Array<{ action: string; dmg: number; overlay: boolean }>;
  budget: Budget;
} | null;

/** Read the combat scene's DEV debug snapshot (mirrors combat.spec.ts's own snap()). */
async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as Snap;
  });
}

/** Live board position of one unit (e2e-only CombatScene.unitDebug — unmodified by this task). */
async function unitPos(page: Page, id: string): Promise<{ c: number; r: number } | null> {
  return page.evaluate((uid) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as
      | { unitDebug?(id: string): { c: number; r: number } | null }
      | undefined;
    const u = s?.unitDebug?.(uid);
    return u ? { c: u.c, r: u.r } : null;
  }, id);
}

/** Full e2e read of a unit's live hp/statuses (unlike unitPos above, which only needs c/r) —
 *  reuses CombatScene.unitDebug (e2e-only, unmodified by this task) as-is. Scenario c below
 *  needs both hp (the absorption delta) and statuses (proving the ward itself, then its
 *  consumption) from a single call. */
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

/** The rendered action-bar buttons' label/hint text (e2e-only CombatScene.actionMenuDebug,
 *  wraps hud.ts's own debug read — unmodified by this task). Index order matches
 *  `Object.keys(ACTIONS)`: strike,smite,weave,sequence,cast,parley,satchel,wait — index 7 is
 *  the Wait/End Turn slot. */
async function actionMenuDebug(page: Page): Promise<Array<{ label: string; hint: string }>> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as
      | { actionMenuDebug?(): Array<{ label: string; hint: string }> }
      | undefined;
    return s?.actionMenuDebug?.() ?? [];
  });
}

/** Teleport a living unit (e2e-only CombatScene.debugSetPos — unmodified by this task; same
 *  spirit as the crucible v1 #6 specs' own use of it for controlled pincer/geometry setup). */
async function setPos(page: Page, id: string, c: number, r: number): Promise<void> {
  await page.evaluate(
    ({ id, c, r }) => {
      const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
      const s = g?.scene?.getScene?.('combat') as
        | { debugSetPos?(id: string, c: number, r: number): void }
        | undefined;
      s?.debugSetPos?.(id, c, r);
    },
    { id, c, r },
  );
}

/** Apply a status directly (e2e-only CombatScene.debugApplyStatus — unmodified by this task).
 *  Scenario b2 uses lethal/non-lethal Kindled magnitudes to clear the fixture room down to one
 *  enemy without grinding real Strikes through units this task never touches. */
async function applyStatus(page: Page, id: string, statusId: string, turns: number, magnitude: number): Promise<void> {
  await page.evaluate(
    ({ id, statusId, turns, magnitude }) => {
      const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
      const s = g?.scene?.getScene?.('combat') as
        | { debugApplyStatus?(id: string, statusId: string, turns: number, magnitude: number): void }
        | undefined;
      s?.debugApplyStatus?.(id, statusId, turns, magnitude);
    },
    { id, statusId, turns, magnitude },
  );
}

/** Every predicate this is called with can only be satisfied by a non-null snapshot, so a
 *  successful return is always non-null in practice — asserted here once rather than a `!` at
 *  every call site (matches combat.spec.ts's own not-null-then-`!` idiom, just centralized). */
async function waitForSnap(
  page: Page,
  pred: (s: Snap) => boolean,
  label: string,
  timeout = 15_000,
): Promise<NonNullable<Snap>> {
  const start = Date.now();
  let s: Snap = null;
  while (Date.now() - start < timeout) {
    s = await snap(page);
    if (pred(s)) return s!;
    await page.waitForTimeout(150);
  }
  throw new Error(`measured-turn: timed out waiting for "${label}"; last snapshot=${JSON.stringify(s)}`);
}

async function waitForPos(
  page: Page,
  id: string,
  c: number,
  r: number,
  label: string,
  timeout = 10_000,
): Promise<void> {
  const start = Date.now();
  let last: { c: number; r: number } | null = null;
  while (Date.now() - start < timeout) {
    last = await unitPos(page, id);
    if (last?.c === c && last?.r === r) return;
    await page.waitForTimeout(150);
  }
  throw new Error(`measured-turn: timed out waiting for "${label}"; last pos=${JSON.stringify(last)}`);
}

/** Scenario b2 setup helper: advances through every OTHER party turn (Mira) and Keeper's own
 *  turns with End Turn ('7') until Keeper is active, state is 'playerMove', AND `pred` holds —
 *  enemy turns play themselves (AI moves/attacks, Kindled ticks) with no input needed. */
async function passUntilKeeper(
  page: Page,
  pred: (s: NonNullable<Snap>) => boolean,
  label: string,
  timeout = 30_000,
): Promise<NonNullable<Snap>> {
  const start = Date.now();
  let last: Snap = null;
  while (Date.now() - start < timeout) {
    last = await snap(page);
    if (last && last.state === 'playerMove') {
      if (last.activeId === 'keeper' && pred(last)) return last;
      if (last.activeId === 'keeper' || last.activeId === 'mira') await page.keyboard.press('7');
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`measured-turn: timed out waiting for "${label}"; last snapshot=${JSON.stringify(last)}`);
}

// Ch. VI, "move -> act -> move the remainder": one resolved action no longer ends the Keeper's
// turn outright — only End Turn (or an exhausted budget) does. Fully manual (no ?demo=1): the
// procedurally generated layout is sidestepped entirely by teleporting the Keeper and one enemy
// into a controlled 2-tile corridor (c:4-6, r:4) that sits outside BOTH the party spawn zone
// (c<=3, buildLayout's spawnZone) and the enemy spawn zone (c>=8) — nothing else can be
// occupying it, for any seed — via debugSetPos (e2e-only test setup, same spirit as the
// crucible v1 #6 specs already use it for).
test('measured turn: move, Strike, the turn stays open, move again, then End Turn ends it', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');

  // Keeper opens first (speed 5, highest in the fixture room — same fact combat.spec.ts's
  // Satchel test relies on).
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn to open");

  await setPos(page, 'wisp-0', 6, 4);
  await setPos(page, 'keeper', 4, 4);
  const fresh = await snap(page);
  expect(fresh?.activeId, 'still the Keeper after the debug teleport').toBe('keeper');
  expect(fresh?.budget.actionSpent, 'a fresh turn has not spent its action').toBe(false);

  // --- Leg 1: move ONE tile east, toward wisp-0 (budget remains — Keeper's move is 4, one
  // floor tile costs 1).
  await canvasClick(page, tileXY(5, 4).x, tileXY(5, 4).y);
  await waitForPos(page, 'keeper', 5, 4, 'the first leg to land');
  const afterMove1 = await waitForSnap(page, (s) => s?.state === 'playerMove', 'control back after the first leg');
  // Movement alone never ended a turn even before Ch. VI — this mainly proves the debug
  // teleport didn't desync moveField/reachable (the click actually worked).
  expect(afterMove1.activeId, "still the Keeper's own turn after moving").toBe('keeper');
  expect(afterMove1.budget.legSpent, 'a leg was recorded as spent').toBe(true);
  const leftAfterMove1 = afterMove1.budget.left;
  expect(leftAfterMove1, 'budget remains after a partial move').toBeGreaterThan(0);

  // --- Strike wisp-0 (now adjacent at (6,4)).
  await page.keyboard.press('1'); // Strike hotkey (ACTIONS.strike)
  await waitForSnap(page, (s) => s?.state === 'playerTarget', 'Strike targeting to open');
  await canvasClick(page, tileXY(6, 4).x, tileXY(6, 4).y);
  await waitForSnap(page, (s) => (s?.log.length ?? 0) > 0, 'the Strike to resolve');

  // THE RED-PROVING ASSERTION: today ANY resolved player action ends the turn outright
  // (CombatScene.runPlayerAction's strike branch unconditionally delayedCalls endPlayerTurn).
  // Ch. VI says an action taken with movement still banked must NOT — the Keeper must still be
  // the active unit, back at its own action menu, once the Strike's presentation beat settles.
  const afterStrike = await waitForSnap(page, (s) => s?.state !== 'resolving', "the post-Strike turn-end decision to settle");
  expect(afterStrike.log.at(-1)?.action, 'the Strike actually resolved').toBe('strike');
  expect(afterStrike.activeId, 'the Keeper is STILL active — Strike alone must not end the turn while movement remains').toBe('keeper');
  expect(afterStrike.state, "control returned to the action menu, not the next unit's turn").toBe('playerMove');
  expect(afterStrike.budget.actionSpent, 'the action registered as spent').toBe(true);
  expect(afterStrike.budget.left, 'move-after-act: acting must never touch the banked movement').toBe(leftAfterMove1);

  // --- Fix round 1 (C1): the turn's one action is SPENT — a second Strike attempt must be
  // refused both by the hotkey (onPickAction early-return) and by the rendered menu (showMenu
  // disables every non-Wait item once actionSpent). Before the fix, wisp-0 survived the first
  // Strike (2 hp, 1 dmg) so a second, wrongly-armed Strike would have opened targeting and
  // resolved a real second hit — this is the "three Strikes in one turn" the review proved live.
  await page.keyboard.press('1'); // Strike hotkey again
  await page.waitForTimeout(400); // long enough for a wrongly-armed Strike to fully resolve
  const afterSecondPress = await snap(page);
  expect(afterSecondPress?.state, 'the refused Strike must never even enter targeting').toBe('playerMove');
  expect(afterSecondPress?.log.length, 'a second Strike must NOT have resolved — the action is spent').toBe(afterStrike.log.length);
  expect(afterSecondPress?.budget.left, 'the refused attempt must not touch the budget either').toBe(afterStrike.budget.left);

  const menu = await actionMenuDebug(page);
  expect(menu[0]?.hint, "Strike's rendered hint shows the refusal reason, not its normal blurb").toContain('spent');
  // Task 3 grew the row to 9 buttons (Press On), then Task 4 to 10 (Brace) — narrow enough
  // that fitText used to ellipsize "End Turn" itself ("End Tu…"), same graceful-degradation
  // the longer Art labels still accept. Task 5 reworked hud.ts's shrink/fitText math so every
  // short action label (Strike/Smite/.../End Turn/Press On/Brace) renders WHOLE even at the
  // full 10-button row — exact match now, not a prefix.
  expect(menu[7]?.label, "the Wait slot reads 'End Turn' in full (Ch. VI relabel)").toBe('End Turn');

  // --- Leg 2: move again with the remainder (back to (4,4)) — proves the SAME leftover
  // budget is spendable AFTER acting, not just before.
  await canvasClick(page, tileXY(4, 4).x, tileXY(4, 4).y);
  await waitForPos(page, 'keeper', 4, 4, 'the second leg to land');
  const afterMove2 = await waitForSnap(page, (s) => s?.state === 'playerMove', 'control back after the second leg');
  expect(afterMove2.activeId, "still the Keeper's turn after the second leg").toBe('keeper');

  // --- End Turn (hotkey '7' — the Wait slot, relabeled per Ch. VI) — the only thing that ends
  // the turn now that acting no longer does.
  await page.keyboard.press('7');
  const afterEnd = await waitForSnap(page, (s) => s?.activeId !== 'keeper', 'End Turn to actually move the turn on');
  expect(afterEnd.activeId, "End Turn actually ended the Keeper's turn").not.toBe('keeper');
});

// Ch. VI Task 3, scenario b (part 1) — Careful Step's toggle used to lock on `this.moved`; the
// review asked for the lock predicate to be `budget.legSpent` directly instead of a second
// mirrored field. Proves the guard survives that collapse: once a leg is spent, a second toggle
// attempt is a silent no-op — no stance flip, no budget re-anchor (which would otherwise
// un-halve the total and silently refund the already-spent leg).
test('measured turn: Careful Step locks after the first leg — a second toggle is rejected', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn to open");

  await setPos(page, 'wisp-0', 6, 4);
  await setPos(page, 'keeper', 4, 4);
  const fresh = await snap(page);
  expect(fresh?.budget.total, "Keeper's fresh, un-halved move budget").toBe(4);

  // Toggle ON: halves the budget (Keeper's move is 4 → carefulStepMove(4) = 2).
  await page.keyboard.press('c');
  const onSnap = await waitForSnap(page, (s) => (s?.budget.total ?? -1) === 2, 'Careful Step toggling on to halve the budget');
  expect(onSnap.budget.legSpent, 'toggling stance alone spends no leg').toBe(false);

  // Leg 1 under Careful Step: move one tile — locks the stance (legSpent) at half the base move.
  await canvasClick(page, tileXY(5, 4).x, tileXY(5, 4).y);
  await waitForPos(page, 'keeper', 5, 4, 'the Careful Step leg to land');
  const afterMove = await waitForSnap(page, (s) => s?.state === 'playerMove', 'control back after the Careful Step leg');
  expect(afterMove.budget.legSpent, 'the leg locked the stance').toBe(true);
  expect(afterMove.budget.total, 'still the halved total after moving').toBe(2);
  expect(afterMove.budget.left, 'one of the two halved tiles spent').toBe(1);

  // A second toggle attempt must be rejected outright: if the lock failed, this would flip
  // carefulStepOn back off and re-anchor `total` to the FULL (un-halved) move — 4, not 2 — with
  // `left` jumping to match. Neither may happen.
  await page.keyboard.press('c');
  await page.waitForTimeout(300); // long enough for a wrongly-accepted toggle to fully resolve
  const rejected = await snap(page);
  expect(rejected?.budget.total, 'a rejected toggle must not re-anchor the total back up').toBe(2);
  expect(rejected?.budget.left, 'a rejected toggle must not touch the remaining movement either').toBe(1);
  expect(rejected?.budget.legSpent, 'still locked').toBe(true);
});

// Ch. VI Task 3, scenario b (part 2) — Press On (hotkey '8') forgoes the action for
// +moveBudgetFor(u). On a fresh turn with no Careful Step, that bonus is the full effectiveMove
// (Keeper: +4), taking the budget from 4 to 8, while the action itself is spent immediately —
// Strike and every other action grey out through the SAME `budget.actionSpent` gate the five
// gated handlers already share.
test('measured turn: Press On grants +move and spends the action — Strike is no longer offered', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn to open");
  await setPos(page, 'keeper', 4, 4);

  const fresh = await snap(page);
  expect(fresh?.budget.total, "Keeper's fresh move budget").toBe(4);
  expect(fresh?.budget.actionSpent, 'a fresh turn has not spent its action').toBe(false);
  expect(fresh?.budget.pressedOn, 'a fresh turn has not pressed on').toBe(false);
  const menuBefore = await actionMenuDebug(page);
  expect(menuBefore[0]?.hint, 'Strike is offered on a fresh turn').not.toContain('spent');

  await page.keyboard.press('8'); // Press On hotkey (ACTIONS.press_on)
  const after = await waitForSnap(page, (s) => s?.budget.actionSpent === true, 'Press On to spend the action');
  expect(after.budget.total, 'Press On adds the full (un-halved — no Careful Step this turn) effectiveMove').toBe(8);
  expect(after.budget.left, 'the bonus extends what was left, not a refill').toBe(8);
  expect(after.budget.pressedOn, 'Press On locks the stance (fix round 1)').toBe(true);
  expect(after.state, "still the Keeper's own turn, back at the action menu").toBe('playerMove');
  expect(after.activeId).toBe('keeper');

  const menuAfter = await actionMenuDebug(page);
  expect(menuAfter[0]?.hint, "Strike reads 'spent' now the action is gone").toContain('spent');
  // Task 5's hud.ts legibility rework (shrink/fitText math) keeps every short action label
  // whole through the full 10-button row — exact match now, not a prefix ("End Tu…" used to
  // be the ellipsized form here, same graceful degradation the longer Art labels still show).
  expect(menuAfter[7]?.label, 'the Wait/End Turn slot is still present, unmoved by the new button').toBe('End Turn');
  // Ch. VI Task 4 — Brace grew the row to 10 buttons. Task 5's rework keeps "Press On" whole
  // there too (it used to ellipsize to "Press…" once the row passed 8 buttons).
  expect(menuAfter[8]?.label, 'Press On is still the 9th slot').toBe('Press On');
  expect(menuAfter[8]?.hint, 'Press On itself reads spent too — one action per turn').toContain('spent');

  // Fix round 1 (Important 1) — Press On locks the stance: a Careful Step attempt ('c') right
  // after Press On, before any movement, must be refused exactly like it would be after a leg is
  // spent. Before this fix, the toggle's guard only checked legSpent (which Press On never
  // sets), so 'c' stayed live and toggling re-derived total/left from the unit's raw stats —
  // silently discarding the whole +4 bonus just granted (total would have dropped to 2, even
  // BELOW the pre-Press-On base of 4).
  await page.keyboard.press('c');
  await page.waitForTimeout(300); // long enough for a wrongly-accepted toggle to fully resolve
  const afterToggleAttempt = await snap(page);
  expect(afterToggleAttempt?.budget.total, 'a rejected toggle must not re-derive the total off raw stats').toBe(8);
  expect(afterToggleAttempt?.budget.left, 'nor touch what is left').toBe(8);
  expect(afterToggleAttempt?.budget.pressedOn, 'still locked').toBe(true);

  // The refusal is real, not cosmetic: a Strike attempt must not open targeting or resolve.
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  const refused = await snap(page);
  expect(refused?.state, 'the refused Strike must never even enter targeting').toBe('playerMove');
  expect(refused?.log.length, 'no Strike may have resolved').toBe(0);

  // "movement uses the full pressed budget": the 8 is genuinely spendable, not a number sitting
  // inert — walk one ordinary tile and confirm it draws from the pressed total, proving the
  // budget the toggle-rejection above left untouched is the SAME one movePlayerTo spends from.
  await canvasClick(page, tileXY(5, 4).x, tileXY(5, 4).y);
  await waitForPos(page, 'keeper', 5, 4, 'a leg spent out of the pressed budget to land');
  const afterMove = await waitForSnap(page, (s) => s?.state === 'playerMove', 'control back after spending from the pressed budget');
  expect(afterMove.budget.left, 'one tile spent out of the full pressed 8, not a halved/reverted total').toBe(7);
});

// Ch. VI Task 3, scenario b2 (re-review N1) — a killing blow that leaves movement banked must
// resolve the battle immediately. Pre-fix, the "steps remain" else-branch showed its banner and
// returned to the action menu unconditionally, even over an empty board — only a never-coming
// End Turn press would have moved things on. Clears the default fixture room's other two
// enemies via lethal Kindled ticks (no Keeper action spent on them — advanceTurn returns before
// a unit felled by its own turn-start tick ever gets to act) so the "kill" here is a single,
// ordinary Strike; the target is Kindled down to 1 hp first so that one Strike, after banking a
// leg of movement, is lethal.
test('measured turn: a killing blow with movement banked resolves the battle immediately (no lingering Steps-remain menu)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn to open");

  // wisp-0 (hp 2) and wraith-2 (hp 3) die at their OWN turn-start tick, before ever acting.
  // wisp-1 (hp 2) gets a non-lethal tick (magnitude 1) — one hit short of dead, left for Keeper.
  await applyStatus(page, 'wisp-0', 'kindled', 1, 2);
  await applyStatus(page, 'wraith-2', 'kindled', 1, 3);
  await applyStatus(page, 'wisp-1', 'kindled', 1, 1);

  const ready = await passUntilKeeper(page, (s) => s.enemyHp === 1, 'round 2 — wisp-1 alone left, at 1 hp');
  expect(ready.log.length, "Keeper spent no action clearing the other two — Kindled did it").toBe(0);

  await setPos(page, 'wisp-1', 6, 4);
  await setPos(page, 'keeper', 4, 4);

  // Bank a leg of movement FIRST — the scenario's whole point is that the kill below lands with
  // budget.left still > 0.
  await canvasClick(page, tileXY(5, 4).x, tileXY(5, 4).y);
  await waitForPos(page, 'keeper', 5, 4, 'the banked leg to land');
  const banked = await waitForSnap(page, (s) => s?.state === 'playerMove', 'control back after banking the leg');
  expect(banked.budget.left, 'movement is genuinely banked before the kill').toBeGreaterThan(0);

  // The killing blow: Strike wisp-1 (adjacent, 1 hp) — the last enemy standing.
  await page.keyboard.press('1');
  await waitForSnap(page, (s) => s?.state === 'playerTarget', 'Strike targeting to open');
  await canvasClick(page, tileXY(6, 4).x, tileXY(6, 4).y);
  const afterKill = await waitForSnap(page, (s) => s?.state !== 'resolving', 'the post-kill outcome to settle');

  expect(afterKill.enemyHp, 'the last enemy actually died').toBe(0);
  expect(
    afterKill.state,
    're-review N1: checkEnd runs BEFORE the steps-remain banner — a killing blow with movement banked must resolve victory immediately, not linger at the action menu',
  ).toBe('over');
});

// Ch. VI Task 4 — Brace grants a 1-point Warded through the existing status pipeline
// (status.ts's applyStatus): the next hit against the braced unit lands 1 less and consumes the
// ward outright (keep-the-larger, not a running subtraction — status.test.ts's own absorption
// suite already pins that arithmetic; this proves the LIVE wiring, scene → status.ts →
// computeHit, actually fires). Same Kindle-kill-the-other-two technique as scenario b2 above so
// exactly one enemy (wisp-1: attack 1, melee, un-flankable with no living ally left to flank
// from) survives to be the sole, deterministic attacker — a 1-point hit against a 1-point ward
// is the cleanest possible "reduced by exactly 1": 1 → 0 absorbed, then 0 → 1 full once the
// ward is gone.
test('measured turn: Brace raises a ward that softens the next hit by exactly 1, then is spent', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn to open");

  // wisp-0 (hp 2) and wraith-2 (hp 3) die at their OWN turn-start tick, before ever acting —
  // wisp-1 (hp 2) is left fully untouched as the sole survivor.
  await applyStatus(page, 'wisp-0', 'kindled', 1, 2);
  await applyStatus(page, 'wraith-2', 'kindled', 1, 3);

  const ready = await passUntilKeeper(page, (s) => s.enemyHp === 2, 'round 2 — wisp-1 alone left, untouched at 2 hp');
  expect(ready.log.length, 'no player action spent — Kindled did the clearing, not the Keeper').toBe(0);

  // Same safe corridor (c:4-6, r:4) the rest of this file uses — adjacent so wisp-1's turn
  // attacks without needing to move first (ai.ts's decideEnemy: already in range → hit in place).
  await setPos(page, 'keeper', 4, 4);
  await setPos(page, 'wisp-1', 5, 4);

  const before = await unitState(page, 'keeper');
  expect(before?.statuses.some((s) => s.id === 'warded'), 'no ward before Brace').toBe(false);

  // --- Brace (hotkey '9', ACTIONS.brace).
  await page.keyboard.press('9');
  await waitForSnap(page, (s) => s?.budget.actionSpent === true, 'Brace to spend the action');
  const braced = await snap(page);
  expect(braced?.log.at(-1)?.action, 'Brace resolved and logged').toBe('brace');
  expect(braced?.state, "still the Keeper's own turn, back at the action menu (movement was never spent)").toBe('playerMove');
  expect(braced?.activeId).toBe('keeper');

  const afterBrace = await unitState(page, 'keeper');
  const ward = afterBrace?.statuses.find((s) => s.id === 'warded');
  expect(ward?.magnitude, 'Brace grants exactly a 1-point ward').toBe(1);
  const hpBeforeFirstHit = afterBrace?.hp ?? -1;

  // End the Keeper's turn (nothing else to spend), then Mira's — no ?demo=1 pilot, so both
  // party turns need an explicit End Turn before the sole enemy's turn plays itself.
  await page.keyboard.press('7');
  await waitForSnap(page, (s) => s?.activeId === 'mira' && s?.state === 'playerMove', "Mira's turn to open");
  await page.keyboard.press('7');
  await waitForSnap(
    page,
    (s) => s?.activeId === 'keeper' && s?.state === 'playerMove',
    "round 3 — Keeper's turn again after wisp-1's first attack",
  );

  const afterFirstHit = await unitState(page, 'keeper');
  expect(afterFirstHit?.hp, 'the ward fully absorbed the 1-damage hit (reduced by exactly 1, to 0 taken)').toBe(hpBeforeFirstHit);
  expect(afterFirstHit?.statuses.some((s) => s.id === 'warded'), 'the ward is consumed by the absorption, not left standing').toBe(false);

  // --- Round 3: no Brace this time — End Turn straight away so the same wisp-1 attacks again
  // with nothing left to absorb it.
  await page.keyboard.press('7');
  await waitForSnap(page, (s) => s?.activeId === 'mira' && s?.state === 'playerMove', "Mira's second turn to open");
  await page.keyboard.press('7');
  await waitForSnap(
    page,
    (s) => s?.activeId === 'keeper' && s?.state === 'playerMove',
    "round 4 — Keeper's turn again after wisp-1's second attack",
  );

  const afterSecondHit = await unitState(page, 'keeper');
  expect(afterSecondHit?.hp, 'the second hit lands full — nothing left to absorb it').toBe((afterFirstHit?.hp ?? 0) - 1);
});

// W5-backlog M2, scenario (d) — overlay.ts's lantern disarm used to fire on ANY button click in
// the overlay, so match's chips (real <button>s, kinds.ts's leftBtns/rightBtns) killed the raise
// the instant a player started experimenting with pairings, long before any answer was
// committed. The fix (lantern-ui.ts's isCommitTarget) disarms only on a kinds.ts-marked
// `data-commit` button. Weave (hotkey '3', ACTIONS.weave.encounter === 'match' — types.ts) always
// draws a match-kind encounter, so this is deterministic unlike leaving the kind to chance; the
// packless `?scene=combat` route this file already uses throughout is safe here because
// lanternLight is threaded from save state (CombatScene.ts's heldLanternLight), never scoped by
// packId — unlike the T1 redraw-variety bug lantern-light.spec.ts's own file note describes, this
// scenario never raises the lantern, so that bug's mechanism never enters the picture.
test('measured turn: lantern-light disarm ignores match chips but fires on Seal the Weave (M2)', async ({ page }) => {
  test.setTimeout(60_000);
  const beforeSave = await readState<Record<string, unknown>>(page, 'save.json');

  try {
    await page.request.put('/api/state/save.json', {
      data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '', lanternLight: true },
    });

    await page.goto('/?scene=combat&seed=7');
    await waitReady(page, 'combat');
    await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn to open");

    // same safe corridor (c:4-6, r:4) the rest of this file uses — adjacent (distance 1) also
    // satisfies weave's own range 2 (CombatScene.ts: case 'weave' => manhattan <= 2).
    await setPos(page, 'wisp-0', 6, 4);
    await setPos(page, 'keeper', 4, 4);

    await page.keyboard.press('3'); // Weave hotkey (ACTIONS.weave) — always a match encounter
    await waitForSnap(page, (s) => s?.state === 'playerTarget', 'Weave targeting to open');
    await canvasClick(page, tileXY(6, 4).x, tileXY(6, 4).y);

    await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms arm guard

    await expect(page.locator('.fw-eyebrow'), 'the weave really opened a match encounter').toContainText('Binding Weave');
    await expect(page.locator('.fw-lantern-btn'), 'lanternLight:true shows the raise affordance').toBeVisible();

    const lefts = page.locator('.fw-col').nth(0).locator('.fw-chip');
    const rights = page.locator('.fw-col').nth(1).locator('.fw-chip');
    const n = await lefts.count();
    expect(n, 'a real match encounter offers at least one pair').toBeGreaterThan(0);

    // --- pair ONE chip: intermediate (re-pickable) WIP, not a commit — the raise must survive it.
    await lefts.nth(0).click();
    await rights.nth(0).click();
    await expect(
      page.locator('.fw-lantern-btn'),
      'M2: pairing a single chip is intermediate — the raise strip stays up',
    ).toBeVisible();

    // --- commit: pair the rest, then Seal the Weave. Sealing is the real lock-in (it grades the
    // pairing right here, before Onward even exists), so it must disarm on its own — otherwise a
    // sealed-and-graded weave could still be dodged via a lingering lantern click.
    for (let i = 1; i < n; i++) {
      await lefts.nth(i).click();
      await rights.nth(i).click();
    }
    await page.getByRole('button', { name: 'Seal the Weave' }).click();
    await expect(
      page.locator('.fw-lantern-btn'),
      'sealing the weave commits — the raise strip is gone',
    ).toHaveCount(0);
    await expect(page.locator('.fw-verdict')).toBeVisible();

    // normal flow continues unimpeded: Onward closes the overlay like any other encounter.
    const onward = page.getByRole('button', { name: 'Onward ▸' });
    await onward.waitFor({ state: 'visible', timeout: 5000 });
    await onward.click();
    await page.locator('.fw-overlay').waitFor({ state: 'detached', timeout: 10_000 });
  } finally {
    await page.request.put('/api/state/save.json', {
      data: beforeSave ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' },
    });
  }
});
