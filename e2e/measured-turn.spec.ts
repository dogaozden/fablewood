import { test, expect, type Page } from '@playwright/test';
import { waitReady, canvasClick } from './helpers';

/** tileToScreen: ORIGIN(192,48) + c*48+24, r*48+24 (the formula every combat spec uses). */
const CELL = 48;
const ORIGIN = { x: 192, y: 48 };
function tileXY(c: number, r: number): { x: number; y: number } {
  return { x: ORIGIN.x + c * CELL + CELL / 2, y: ORIGIN.y + r * CELL + CELL / 2 };
}

type Budget = { total: number; left: number; legSpent: boolean; actionSpent: boolean };
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
  // Task 3 grew the row to 9 buttons (Press On) — narrow enough now that fitText ellipsizes
  // "End Turn" itself ("End Tu…"), same graceful-degradation the longer Art labels already
  // accept at 8. A prefix match proves the Ch. VI relabel (off 'Wait') survives without pinning
  // an exact truncation point that's Task 5's own territory to address (see brief).
  expect(menu[7]?.label, "the Wait slot reads 'End Turn…' (Ch. VI relabel)").toMatch(/^End/);

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

  const fresh = await snap(page);
  expect(fresh?.budget.total, "Keeper's fresh move budget").toBe(4);
  expect(fresh?.budget.actionSpent, 'a fresh turn has not spent its action').toBe(false);
  const menuBefore = await actionMenuDebug(page);
  expect(menuBefore[0]?.hint, 'Strike is offered on a fresh turn').not.toContain('spent');

  await page.keyboard.press('8'); // Press On hotkey (ACTIONS.press_on)
  const after = await waitForSnap(page, (s) => s?.budget.actionSpent === true, 'Press On to spend the action');
  expect(after.budget.total, 'Press On adds the full (un-halved — no Careful Step this turn) effectiveMove').toBe(8);
  expect(after.budget.left, 'the bonus extends what was left, not a refill').toBe(8);
  expect(after.state, "still the Keeper's own turn, back at the action menu").toBe('playerMove');
  expect(after.activeId).toBe('keeper');

  const menuAfter = await actionMenuDebug(page);
  expect(menuAfter[0]?.hint, "Strike reads 'spent' now the action is gone").toContain('spent');
  // 9 buttons narrows the row enough that fitText ellipsizes "End Turn" ("End Tu…") — same
  // graceful degradation the longer Art labels already show; a prefix match proves the slot,
  // not the exact truncation point (Task 5's territory — see brief).
  expect(menuAfter[7]?.label, 'the Wait/End Turn slot is still present, unmoved by the new button').toMatch(/^End/);
  expect(menuAfter[8]?.label, 'Press On is the new 9th, rightmost slot').toBe('Press On');
  expect(menuAfter[8]?.hint, 'Press On itself reads spent too — one action per turn').toContain('spent');

  // The refusal is real, not cosmetic: a Strike attempt must not open targeting or resolve.
  await page.keyboard.press('1');
  await page.waitForTimeout(300);
  const refused = await snap(page);
  expect(refused?.state, 'the refused Strike must never even enter targeting').toBe('playerMove');
  expect(refused?.log.length, 'no Strike may have resolved').toBe(0);
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
