import { test, expect, type Page } from '@playwright/test';
import { waitReady, currentScene } from './helpers';

// Phase 1 "living board" (docs/design/magic-combat-depth.md §3-4, §8, §12.3, §15 Phase 1):
// statuses, flanking/opportunity strikes/Careful Step, forced movement, brazier/mist tiles,
// enemy kits. Drives the CombatScene debug surface (combatSnapshot/unitDebug/debugApplyStatus/
// debugSetPos/layoutDebug — the same "read-only snapshot + a pilot hint" pattern combat.spec.ts
// already uses) rather than choreographing emergent AI positioning, since Phase 2's spellcasting
// UI (the only way a real player would apply most of these statuses) isn't wired yet.

const EV = 'screenshots';

type Snap = {
  state: string;
  activeTeam: string | null;
  activeId: string;
  enemyHp: number;
  partyHp: number;
  log: Array<{ action: string; dmg: number; overlay: boolean }>;
} | null;

type UnitDbg = {
  c: number; r: number; alive: boolean; hp: number; maxHp: number; attack: number;
  statuses: Array<{ id: string; turnsLeft: number; magnitude: number }>;
} | null;

type LayoutDbg = { tiles: string[][]; braziers: Array<{ c: number; r: number }>; mist: Array<{ c: number; r: number }> } | null;

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as Snap;
  });
}

async function setPilot(page: Page, kind: string | null): Promise<void> {
  await page.evaluate((k) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { setPilotPreference?(k: string | null): void } | undefined;
    s?.setPilotPreference?.(k);
  }, kind);
}

async function unitDebug(page: Page, id: string): Promise<UnitDbg> {
  return page.evaluate((uid) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { unitDebug?(id: string): unknown } | undefined;
    return (s?.unitDebug?.(uid) ?? null) as UnitDbg;
  }, id);
}

async function debugApplyStatus(page: Page, id: string, statusId: string, turns: number, magnitude = 1): Promise<void> {
  await page.evaluate(
    ({ id: uid, statusId: sid, turns: t, magnitude: m }) => {
      const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
      const s = g?.scene?.getScene?.('combat') as
        | { debugApplyStatus?(id: string, statusId: string, turns: number, magnitude?: number): void }
        | undefined;
      s?.debugApplyStatus?.(uid, sid, t, m);
    },
    { id, statusId, turns, magnitude },
  );
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

async function layoutDebug(page: Page): Promise<LayoutDbg> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { layoutDebug?(): unknown } | undefined;
    return (s?.layoutDebug?.() ?? null) as LayoutDbg;
  });
}

/** Poll until it's `id`'s turn (activeId matches), or the fight resolves first. */
async function waitForActive(page: Page, id: string, timeout = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await currentScene(page)) !== 'combat') return false;
    const s = await snap(page);
    if (s?.activeId === id) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

/** Poll until it is no longer `id`'s turn (its turn concluded), or the fight resolves first. */
async function waitForTurnEnd(page: Page, id: string, timeout = 30_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await currentScene(page)) !== 'combat') return true;
    const s = await snap(page);
    if (s?.activeId !== id) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

/** Poll the action log for the first `action` entry at/after `fromIndex`. */
async function waitForLoggedAction(
  page: Page,
  action: string,
  fromIndex: number,
  timeout = 35_000,
): Promise<{ action: string; dmg: number; overlay: boolean } | null> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await currentScene(page)) !== 'combat') return null;
    const s = await snap(page);
    const entry = s?.log.slice(fromIndex).find((l) => l.action === action);
    if (entry) return entry;
    await page.waitForTimeout(300);
  }
  return null;
}

// The default packless fixture (dev-antechamber): wisp-0 is parleyable, spawns far from the
// party (melee range needs real closing distance), giving plenty of runway for these tests.
test('Bound stops a unit moving on its own turn; the status chip renders', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=7&demo=1');
  await waitReady(page, 'combat');

  // 'strike' is the one gated-free action (no overlay, resolves synchronously) — the autopilot
  // can free-run the whole fight without anything needing to answer an encounter overlay,
  // while this test only cares about wisp-0's own turn.
  await setPilot(page, 'strike');

  const before = await unitDebug(page, 'wisp-0');
  expect(before, 'wisp-0 is tracked from spawn').not.toBeNull();

  await debugApplyStatus(page, 'wisp-0', 'bound', 2);
  const withChip = await unitDebug(page, 'wisp-0');
  expect(withChip?.statuses.some((s) => s.id === 'bound'), 'Bound applied').toBe(true);
  await page.screenshot({ path: `${EV}/e2e-combat-status-chip.png` });

  const reachedTurn = await waitForActive(page, 'wisp-0');
  expect(reachedTurn, "wisp-0's own turn arrived (round 1, 4th in initiative)").toBe(true);
  const concluded = await waitForTurnEnd(page, 'wisp-0');
  expect(concluded, "wisp-0's turn concluded").toBe(true);

  const after = await unitDebug(page, 'wisp-0');
  expect(after, 'wisp-0 still tracked after its turn').not.toBeNull();
  if (after!.alive) {
    expect(after!.c, 'Bound zeroed effective move — wisp-0 did not relocate').toBe(before!.c);
    expect(after!.r, 'Bound zeroed effective move — wisp-0 did not relocate').toBe(before!.r);
  }
});

// Parley migration regression (§3.6): good used to set skipNextTurn + PERMANENTLY decrement
// attack; now Staggered(1) + Weakened(2) via statuses. Branch-agnostic on purpose — vc-law's
// real scenario_branch content (not the generic dev fixture) resolves for combat's packless
// launch once a real pack is installed, and its branch labels/order vary — so this clicks
// whichever branch renders first and asserts the property that must hold under ALL three
// outcomes: the target's base `attack` stat is never mutated by Parley at all any more.
test('Parley: repeated outcomes never permanently touch the target\'s attack stat (regression)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?scene=combat&seed=7&demo=1');
  await waitReady(page, 'combat');
  await setPilot(page, 'parley');

  const before = await unitDebug(page, 'wisp-0');
  expect(before?.attack, "wisp-0's base attack before any parley").toBe(1);

  for (let i = 0; i < 2; i++) {
    await page.locator('.fw-opt').first().waitFor({ state: 'visible', timeout: 45_000 });
    await expect(page.locator('.fw-eyebrow')).toContainText('Parley');
    await page.locator('.fw-opt').first().click();
    await page.locator('.fw-verdict').waitFor({ state: 'visible', timeout: 10_000 });
    const cont = page.getByRole('button', { name: 'Onward ▸' });
    await cont.waitFor({ state: 'visible', timeout: 10_000 });
    await cont.click();
    await page.locator('.fw-overlay').waitFor({ state: 'detached', timeout: 10_000 });

    const after = await unitDebug(page, 'wisp-0');
    expect(after, `wisp-0 still tracked after parley #${i + 1}`).not.toBeNull();
    expect(after!.attack, `attack unchanged after parley #${i + 1} — no permanent drift`).toBe(before!.attack);
  }

  // Bonus (best-effort): whichever parley happened to land 'good', Weakened refreshed to 2
  // rather than summing across the two casts (§3 rule 1 stacking).
  const finalState = await unitDebug(page, 'wisp-0');
  const weakened = finalState?.statuses.find((s) => s.id === 'weakened');
  if (weakened) expect(weakened.magnitude, 'Weakened refreshes, never stacks additively').toBe(2);
});

// §4.4 — the kit-showcase fixture room (construct + wraith + whatever brazier/mist buildLayout
// rolls for this seed; seed=2 was verified offline to generate both). Screenshots: the room
// itself, the mist lane, and the brazier converting to a lantern on interact.
test('kit-showcase room: mist lane + brazier render; lighting the brazier converts it to a lantern', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=2&kit=1');
  await waitReady(page, 'combat');
  await page.screenshot({ path: `${EV}/e2e-combat-status-kit-room.png` });

  const layout = await layoutDebug(page);
  expect(layout?.mist.length, 'the seeded kit-showcase layout has a mist patch').toBeGreaterThan(0);
  expect(layout?.braziers.length, 'the seeded kit-showcase layout has a brazier').toBeGreaterThan(0);
  await page.screenshot({ path: `${EV}/e2e-combat-status-mist-lane.png` });

  const start = Date.now();
  let s = await snap(page);
  while (s?.state !== 'playerMove' && Date.now() - start < 20_000) {
    await page.waitForTimeout(200);
    s = await snap(page);
  }
  expect(s?.activeId, "the Keeper's first turn opened for manual control").toBe('keeper');

  const brazier = layout!.braziers[0];
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  let standAt: { c: number; r: number } | null = null;
  for (const [dc, dr] of dirs) {
    const cc = brazier.c + dc;
    const rr = brazier.r + dr;
    if (layout!.tiles[rr]?.[cc] && layout!.tiles[rr][cc] !== 'wall') { standAt = { c: cc, r: rr }; break; }
  }
  expect(standAt, 'found a non-wall tile adjacent to the brazier to stand on').not.toBeNull();

  await debugSetPos(page, 'keeper', standAt!.c, standAt!.r);
  await page.keyboard.press('e');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${EV}/e2e-combat-status-brazier-lit.png` });

  const after = await layoutDebug(page);
  expect(after?.tiles[brazier.r][brazier.c], 'the brazier became a lantern').toBe('lantern');
});

// §4.3 forced movement: a construct's Vault-Slam push, blocked by a wall, bumps for +1 damage
// instead of relocating the target — logged into actionLog so the scene-level wiring (not just
// grid.ts's pure forceMove) is exercised end to end. debugSetPos arranges the precondition
// (mirrors how the existing Satchel e2e test seeds save/inventory state directly) — the actual
// attack, push resolution, and damage all run through the real enemy-turn code path.
test('Construct Vault-Slam: a push blocked by a wall bumps for extra damage, logged in actionLog', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=2&kit=1');
  await waitReady(page, 'combat');

  const start = Date.now();
  let s = await snap(page);
  while (s?.state !== 'playerMove' && Date.now() - start < 20_000) {
    await page.waitForTimeout(200);
    s = await snap(page);
  }
  expect(s?.activeId, "the Keeper's first turn opened for manual control").toBe('keeper');

  const layout = await layoutDebug(page);
  let row = -1;
  for (let r = 1; r < layout!.tiles.length - 1; r++) {
    if (layout!.tiles[r][1] === 'floor' && layout!.tiles[r][2] === 'floor') { row = r; break; }
  }
  expect(row, 'found a floor/floor column-1/2 pair to stage the wall-bump').toBeGreaterThan(0);

  // Mira's untouched spawn can land adjacent to the construct's staged position — decideEnemy's
  // canHit prefers the LOWEST-hp foe in reach, so an unmoved, undamaged (6hp) Mira would steal
  // the construct's attack from the (10hp) Keeper it's actually staged to test. Relocate her
  // well clear so the Keeper is the construct's only reachable target.
  let miraSafe: { c: number; r: number } | null = null;
  for (let r = 1; r < layout!.tiles.length - 1 && !miraSafe; r++) {
    for (let c = 1; c < layout!.tiles[0].length - 1; c++) {
      if (layout!.tiles[r][c] !== 'wall' && Math.abs(c - 2) + Math.abs(r - row) > 3) {
        miraSafe = { c, r };
        break;
      }
    }
  }
  expect(miraSafe, "found a tile far enough to relocate Mira out of the construct's reach").not.toBeNull();

  await debugSetPos(page, 'keeper', 1, row);
  await debugSetPos(page, 'construct-0', 2, row);
  await debugSetPos(page, 'mira', miraSafe!.c, miraSafe!.r);
  const keeperBefore = await unitDebug(page, 'keeper');
  expect(keeperBefore?.c).toBe(1);

  // End the Keeper's turn, then Mira's, without moving either — enemy turns then resolve
  // automatically; the construct (already adjacent to the Keeper, and now the only party unit
  // in its reach) attacks without needing to close any distance, and the push west lands on
  // the border wall (c=0).
  await page.keyboard.press('7');
  const mirasTurn = await waitForActive(page, 'mira');
  expect(mirasTurn, "Mira's turn arrived").toBe(true);
  await page.keyboard.press('7');

  const bump = await waitForLoggedAction(page, 'bump', 0, 25_000);
  expect(bump, 'a wall-blocked push bumped for extra damage, logged').not.toBeNull();
  expect(bump!.dmg, 'the bump dealt damage').toBeGreaterThan(0);

  const keeperAfter = await unitDebug(page, 'keeper');
  expect(keeperAfter?.c, 'the push failed — the Keeper stayed put against the wall').toBe(1);
  expect(keeperAfter?.r).toBe(row);
  expect(keeperAfter!.hp, 'the Keeper took the bump damage').toBeLessThan(keeperBefore!.hp);
});
