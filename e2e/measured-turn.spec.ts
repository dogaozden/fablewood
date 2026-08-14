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
