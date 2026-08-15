import { test, expect, type Page } from '@playwright/test';
import { waitReady } from './helpers';

// Wave 8 (the Bestiary) Task 2 — Ch. VIII's rise toll: a Toppled unit stands automatically at
// its own turn start, paying half that turn's movement base (the house floor: max(1,
// floor(base/2))) before anything else touches it, and fights that same turn with its
// opportunity latch disabled (the Staggered idiom). Debug-hook idiom mirrors every other combat
// e2e file (combatSnapshot/unitDebug/debugApplyStatus/debugSetPos) — own-file local copies,
// same convention as measured-turn.spec.ts / v1fix-board.spec.ts.

type Budget = { total: number; left: number; legSpent: boolean; actionSpent: boolean; pressedOn: boolean };
type Snap = { state: string; activeId: string; budget: Budget } | null;

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
): Promise<{ hp: number; statuses: Array<{ id: string; turnsLeft: number; magnitude: number }> } | null> {
  return page.evaluate((uid) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as
      | { unitDebug?(id: string): { hp: number; statuses: Array<{ id: string; turnsLeft: number; magnitude: number }> } | null }
      | undefined;
    return s?.unitDebug?.(uid) ?? null;
  }, id);
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

/** Apply a status directly (e2e-only CombatScene.debugApplyStatus — unmodified by this task;
 *  Task 1's own idiom for toppled's conventionally-meaningless turnsLeft: 1, magnitude: 1). */
async function applyStatus(page: Page, id: string, statusId: string, turns = 1, magnitude = 1): Promise<void> {
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

  // Following turn (next round): the toll does not repeat — full, un-tolled base again.
  await page.keyboard.press('7');
  const restored = await passUntilKeeper(page, 30_000);
  expect(restored.activeId).toBe('keeper');
  expect(restored.budget.total, 'the toll does not repeat — full base again').toBe(4);
  expect(restored.budget.left).toBe(4);
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
