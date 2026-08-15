import { test, expect, type Page } from '@playwright/test';
import { waitReady, canvasClick, readState, waitForState } from './helpers';

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
  carefulStepOn: boolean;
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

/** The party panel's rendered raw text (e2e-only CombatScene.hudPartyText, wrapping
 *  CombatHud.partyPanelText — unmodified by this task; same debug surface crucible #10's own
 *  drift specs already use). Final review I1 — the chapter's "Move N/M" remainder readout
 *  lives here. */
async function partyPanelText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { hudPartyText?(): string } | undefined;
    return s?.hudPartyText?.() ?? '';
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

/** The real (non-fixture) room's layout is generated per seed/room id — unlike the packless
 *  fixture's proven-safe (5,3)/(6,3), it can't be hardcoded. Scan for a horizontally-adjacent
 *  non-wall pair instead (lantern-light.spec.ts's own brazier-adjacency idiom, ported verbatim —
 *  own-file convention). Scenario e below is the only one in this file that needs a real launch. */
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

  // Final review I1 — the chapter's ratified HUD readout ("the HUD shows the remainder
  // ('Move 3/5') beside the action menu") lives in the party panel text.
  expect(await partyPanelText(page), 'the party panel shows the move remainder in the chapter\'s "Move N/M" format').toContain(
    `Move ${leftAfterMove1}/${afterMove1.budget.total}`,
  );

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
// un-halve the total and silently refund the already-spent leg). Extended (final review) with a
// turn-boundary check (C1) and a live Careful-Step-under-Dimmed Press On check (C2) — both need
// a second turn/round, hence the longer timeout and the passUntilKeeper round-cycle below.
test('measured turn: Careful Step locks after the first leg — a second toggle is rejected', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's turn to open");

  // The extension below (final review C1/C2) needs a clean turn boundary with nothing else able
  // to touch Keeper's or Mira's statuses — a live enemy landing an unrelated hit (e.g. a
  // wraith's own Dimmed) would contaminate the effectiveMove-driven assertions below with a
  // confound that has nothing to do with either bug. wisp-0 and wraith-2 (the ranged threat) die
  // at their OWN turn-start tick, before ever acting (same lethal-Kindled technique scenario b2
  // uses); wisp-1 is exiled to the far corner (checkEnd needs at least one living enemy, or the
  // battle resolves outright mid-test) — melee-only (range 1) and 9+ tiles away, it cannot close
  // the distance in the one enemy turn this scenario spans.
  await applyStatus(page, 'wisp-0', 'kindled', 1, 2);
  await applyStatus(page, 'wraith-2', 'kindled', 1, 3);
  await setPos(page, 'wisp-1', 11, 7);

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

  // Final review C1 — `carefulStepOn` is a single SCENE-WIDE flag, not per-unit, and
  // beginPlayerTurn built the budget (moveBudgetFor, reading carefulStepOn) BEFORE clearing it.
  // So the leak isn't "the same unit's next turn" — it's the very NEXT beginPlayerTurn call,
  // whoever that belongs to. That's Mira's turn here (enemy turns never call beginPlayerTurn, so
  // they can't clear or launder the stale flag): checking Keeper's own following turn would be
  // a weaker proof, since Mira's turn in between ALSO reads-then-clears the same flag as an
  // unwitting side effect, silently healing the bug before Keeper ever sees it again. Mira's
  // base move (4, same as Keeper's) makes this a byte-identical assertion.
  await page.keyboard.press('7'); // End Turn
  const mirasTurn = await waitForSnap(page, (s) => s?.activeId === 'mira' && s?.state === 'playerMove', "Mira's turn to open");
  expect(mirasTurn.budget.total, "C1: Mira's turn must NOT inherit the previous turn's halved stance").toBe(4);
  expect(mirasTurn.budget.left, 'left must match the full total, not a stale halved one').toBe(4);

  // Advance through Mira's turn and the sole (exiled, harmless) survivor's turn until the
  // Keeper's own turn opens again, for the C2 check below.
  await page.keyboard.press('7');
  const round2 = await passUntilKeeper(page, () => true, "round 2 — the Keeper's own turn again");
  expect(round2.budget.total, "round 2 also opens un-halved (carefulStepOn was cleared by Mira's turn above)").toBe(4);
  expect(round2.carefulStepOn, 'and the stance flag itself reads false, not just the derived total').toBe(false);
  // Let the round-cycle's own keydown traffic (passUntilKeeper's polled '7' presses) fully drain
  // before sending more input — Phaser's keyboard plugin can otherwise coalesce/replay a rapid
  // trailing keypress against a still-settling prior one (an input-timing artifact, not a game
  // bug: confirmed by direct experiment — instrumenting the keydown handler showed a genuine
  // extra 'c' keydown appearing on its own after the real one, with no source in this test).
  await page.waitForTimeout(400);

  // Final review C2 — Press On under Careful Step must halve the COMBINED total ONCE, not halve
  // each grant independently and sum. Live case straight from the review: a wraith's Dimmed(1)
  // drops Keeper's effectiveMove from 4 to 3 (status.ts's floor). The chapter's own identity
  // ("Careful Step + Press On = normal distance") demands the dimmed Keeper land back on 3 — not
  // the 2 the old per-grant-halving formula produced.
  await applyStatus(page, 'keeper', 'dimmed', 1, 1);
  await page.keyboard.press('c'); // Careful Step on — carefulStepMove(3) = 1
  const dimmedCS = await waitForSnap(page, (s) => (s?.budget.total ?? -1) === 1, 'Careful Step to halve the dimmed effectiveMove (3) down to 1');
  expect(dimmedCS.budget.legSpent, 'toggling alone spends no leg').toBe(false);
  expect(dimmedCS.carefulStepOn, 'the stance flag itself is on, not just the derived total').toBe(true);
  await page.waitForTimeout(400); // let this keydown fully settle before the next one

  await page.keyboard.press('8'); // Press On
  const dimmedPressOn = await waitForSnap(page, (s) => s?.budget.actionSpent === true, 'Press On to fire');
  expect(dimmedPressOn.carefulStepOn, 'Press On must not have seen the stance flip back off').toBe(true);
  expect(
    dimmedPressOn.budget.total,
    'C2: one halving over the COMBINED total (3+3=6, halved once = 3 — the chapter\'s "normal distance") — NOT two independent halvings summed (1+1=2)',
  ).toBe(3);
  expect(dimmedPressOn.budget.left, 'left matches the corrected total').toBe(3);
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

// W5-backlog M3, scenario (e) — the previewPick re-present guard (engine.ts). planRedraw's own
// check ("any fact ids left in the pool after removing the shown one?") is naive: it says
// consume whenever the remainder is non-empty, even when EVERY remaining fact would still
// resolve back to the identical fallback encounter (pick()'s candidates[0] — position-
// independent of which fact ids are passed). previewPick reuses pick()'s own resolution to
// catch that case and route to fate-holds instead of spending the light for nothing.
//
// Root-cause note (mirrors lantern-light.spec.ts's own file note for the identical reason): the
// packless `?scene=combat` launch always forces FIXTURE_PACK_ID, which combatDrawReady()
// deliberately reads as drawGlobal=false with an empty fact pool (no installed pack matches
// 'dev-mosslore') — so planRedraw's remainder is trivially [] before previewPick ever runs, and
// this scenario could never be observed there. It needs a REAL combat launch, same
// vaults→room.threshold route as lantern-light.spec.ts's own mcq scenario.
//
// srs.json fixture: services.draw.fresh() (kind-blind, prereq-clear, unseen) is the ONLY tier
// that can produce a mixed-eligibility pool — due() pre-filters by kind (draw/index.ts), so
// every fact it returns already has a matching encounter; only fresh() can hand back a pool
// where most facts DON'T. Rather than lean on the pack's natural declaration order (fragile: an
// earlier version of this fixture marked just one vesting fact already-seen to remove it from
// the pool, but that fact turned out to be a PREREQ for two others — cliff-definition and
// single-vs-double-trigger-acceleration, both mcq — so marking it seen UNLOCKED them into the
// pool instead of shrinking it, and the guard correctly declined to fire against a genuinely
// different question), mark EVERY vc-law fact already-seen EXCEPT three hand-picked ones. That
// closes off cascades entirely: the draw pool is bounded by what's unseen, and nothing outside
// the three targets is, regardless of anyone's prereqs. The three: economics-vs-control and
// preferred-vs-common (no mcq encounter, prereqs: []) and pre-vs-post-money (mcq, via
// enc.mcq.pre-post-money — ALSO candidates[0], the pack's first mcq-kind encounter; prereqs:
// []). The due queue matches pre-vs-post-money directly on the original draw; after planRedraw
// strips it, the remaining two (mcq-blind) match nothing, so the remainder falls through to the
// SAME candidates[0].
const ALREADY_SEEN_VC_LAW_FACT_IDS = [
  'vc.econ.valuation.pre-post-ambiguity-trap', 'vc.econ.valuation.clarify-pre-money-presumptively',
  'vc.econ.valuation.fully-diluted', 'vc.econ.optionpool.comes-from-premoney',
  'vc.econ.optionpool.typical-range-10-to-20', 'vc.econ.optionpool.negotiate-with-option-budget',
  'vc.econ.valuation.competition-raises-price', 'vc.econ.liqpref.definition',
  'vc.econ.liqpref.preference-plus-participation', 'vc.econ.liqpref.1x-multiple-standard',
  'vc.econ.liqpref.2001-bubble-10x', 'vc.econ.liqpref.conversion-ratio',
  'vc.econ.liqpref.nonparticipating', 'vc.econ.liqpref.nonparticipating-head-fake',
  'vc.econ.liqpref.full-participation', 'vc.econ.liqpref.capped-participation',
  'vc.econ.liqpref.participation-cap-multiple-meaning', 'vc.econ.liqpref.stacked-vs-pari-passu',
  'vc.econ.liqpref.keep-simple-in-early-rounds', 'vc.econ.liqpref.liquidation-event-definition',
  'vc.econ.paytoplay.definition', 'vc.econ.paytoplay.reduces-liqpref-for-nonparticipants',
  'vc.econ.paytoplay.ubiquitous-after-dotcom', 'vc.econ.paytoplay.watch-forced-recapitalization',
  'vc.econ.vesting.four-year-one-year-cliff', 'vc.econ.vesting.cliff-definition',
  'vc.econ.vesting.single-vs-double-trigger-acceleration', 'vc.econ.antidilution.purpose',
  'vc.econ.antidilution.full-ratchet', 'vc.econ.antidilution.weighted-average',
  'vc.econ.antidilution.broad-vs-narrow-weighted-average', 'vc.econ.antidilution.dont-fight-to-eliminate',
  'vc.econ.convdebt.definition', 'vc.econ.convdebt.discount-range-10-to-30',
  'vc.econ.convdebt.valuation-cap', 'vc.econ.convdebt.address-acquisition-in-docs',
  'vc.econ.captable.definition', 'vc.econ.captable.pool-dilutes-founders',
  'vc.econ.overview.dec-doriot-first-term-sheet',
];

test('measured turn: raising the lantern on a cast whose remainder still resolves to the SAME encounter holds fate instead of spending (M3)', async ({ page }) => {
  test.setTimeout(60_000);
  const beforeSave = await readState<Record<string, unknown>>(page, 'save.json');
  const beforeSrs = await readState<Record<string, unknown>>(page, 'srs.json');

  try {
    await page.request.put('/api/state/save.json', {
      data: { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '', lanternLight: true },
    });
    const farFuture = Date.now() + 365 * 86_400_000;
    const seededFacts: Record<string, { box: number; next_due: number; history: unknown[] }> = {};
    for (const id of ALREADY_SEEN_VC_LAW_FACT_IDS) seededFacts[id] = { box: 5, next_due: farFuture, history: [] };
    await page.request.put('/api/state/srs.json', {
      data: { version: 1, facts: seededFacts },
    });

    // Direct-to-vaults boot — real vc-law pack (lantern-light.spec.ts's own route: chain.spec.ts
    // / trim-the-lantern.spec.ts / vault-hover.spec.ts all use it too). rank=1 so Smite goes
    // straight to targeting (no T2/T3 flyout — this scenario only needs the T1 direct branch;
    // castGatedSpell's own guard insertion is byte-identical and covered by the unit suite).
    await page.goto('/?scene=vaults&seed=7&rank=1');
    await waitReady(page, 'vaults');

    // Enter room.threshold ("The Threshold Ledger") — same node/blurb coordinates as
    // lantern-light.spec.ts's own mcq scenario for this seed's map layout.
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

    await page.waitForFunction(() => (window as Window).__FABLEWOOD_STATE?.scene === 'combat', undefined, {
      timeout: 15_000,
    });
    await waitForSnap(page, (s) => s?.state === 'playerMove' && s?.activeId === 'keeper', "the Keeper's first turn to open");

    const [keeperTile, targetTile] = await findAdjacentFloorPair(page);
    await setPos(page, 'keeper', keeperTile.c, keeperTile.r);
    await setPos(page, 'wisp-0', targetTile.c, targetTile.r); // room.threshold's first enemy

    await page.keyboard.press('2'); // Smite (T1 Kindling, mcq — ACTIONS.smite)
    await page.waitForTimeout(150); // a bare `.press()` can race Phaser's own frame-tick handling
    await waitForSnap(page, (s) => s?.state === 'playerTarget', 'Smite targeting to open');
    await canvasClick(page, tileXY(targetTile.c, targetTile.r).x, tileXY(targetTile.c, targetTile.r).y);

    await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms arm guard

    await expect(page.locator('.fw-lantern-btn'), 'lanternLight:true shows the raise affordance').toBeVisible();
    const firstPrompt = (await page.locator('.fw-prompt').textContent())?.trim();

    await page.locator('.fw-lantern-btn').click();

    // Settle: the old overlay closes, the guard runs BETWEEN planRedraw and the consume save,
    // then a fresh runEncounter re-presents. Both branches (consume or fate-holds) pass
    // lanternLight:false to the re-present request, so the strip disappears either way — this
    // is the settle signal, not the regression check itself (that's assert 1 below).
    await expect.poll(() => page.locator('.fw-lantern-btn').count(), { timeout: 15_000 }).toBe(0);
    await expect(page.locator('.fw-overlay')).toBeVisible();
    await page.waitForTimeout(450); // the re-presented overlay's OWN 400ms arm guard

    // assert 1: previewPick caught the identical fallback — the SAME question re-presents.
    const secondPrompt = (await page.locator('.fw-prompt').textContent())?.trim();
    expect(secondPrompt, 'M3: the remainder resolves to the same encounter, so the SAME question re-presents').toBe(firstPrompt);

    // assert 2: the fate-holds notice line rendered (verbatim copy — lantern.ts's FATE_HOLDS_LINE).
    await expect(
      page.locator('.fw-notice'),
      'the fate-holds notice line is shown',
    ).toHaveText('The lantern flickers — fate holds this memory fast. Your light is not spent.');

    // assert 3 (persistence law): the light was never spent — the guard skips the consume save
    // entirely, it doesn't just delay it, so this is already true by the time the overlay
    // resettled above; waitForState still polls (Global Constraint 4 / M3's whole point).
    await waitForState<{ lanternLight?: boolean }>(page, 'save.json', (s) => s?.lanternLight === true, 5000);

    // answer the re-presented question so the battle continues cleanly.
    await page.locator('.fw-opt').first().click();
    const onward2 = page.getByRole('button', { name: 'Onward ▸' });
    try {
      await onward2.waitFor({ state: 'visible', timeout: 1500 });
      await onward2.click();
    } catch { /* correct answer auto-resolves without a continue button (kinds.ts renderMcq) */ }
    await page.locator('.fw-overlay').waitFor({ state: 'detached', timeout: 10_000 });
  } finally {
    await page.request.put('/api/state/save.json', {
      data: beforeSave ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' },
    });
    await page.request.put('/api/state/srs.json', { data: beforeSrs ?? { version: 1, facts: {} } });
  }
});
