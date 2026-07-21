import { test, expect, type Page } from '@playwright/test';
import { waitReady } from './helpers';

// Crucible v1 fixes — "living board" mechanics (opportunity-strike flank, status decay under
// Staggered, HUD status-chip offset). New file (v1-fix-b owns CombatScene.ts/hud.ts/status.ts
// exclusively for this pass) — mirrors combat-status.spec.ts's own debug-hook idiom
// (combatSnapshot/unitDebug/debugApplyStatus/debugSetPos), since Phase 2's spellcasting UI is
// not what these bugs live in.

const EV = '/tmp/fablewood-scratch';

type UnitDbg = {
  c: number; r: number; alive: boolean; hp: number; maxHp: number; attack: number;
  statuses: Array<{ id: string; turnsLeft: number; magnitude: number }>;
} | null;

type Snap = {
  state: string; activeTeam: string | null; activeId: string; enemyHp: number; partyHp: number;
  log: Array<{ action: string; dmg: number; overlay: boolean }>;
} | null;

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as Snap;
  });
}

async function unitDebug(page: Page, id: string): Promise<UnitDbg> {
  return page.evaluate((uid) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { unitDebug?(id: string): unknown } | undefined;
    return (s?.unitDebug?.(uid) ?? null) as UnitDbg;
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

async function layoutDebug(page: Page): Promise<{ tiles: string[][] } | null> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { layoutDebug?(): unknown } | undefined;
    return (s?.layoutDebug?.() ?? null) as { tiles: string[][] } | null;
  });
}

/** Poll until it's `id`'s turn, or the fight resolves first. */
async function waitForActive(page: Page, id: string, timeout = 20_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const s = await snap(page);
    if (s?.activeId === id) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

const CELL = 48;
const ORIGIN = { x: (960 - 12 * CELL) / 2, y: 48 };
function tileScreen(c: number, r: number): { x: number; y: number } {
  return { x: ORIGIN.x + c * CELL + CELL / 2, y: ORIGIN.y + r * CELL + CELL / 2 };
}
async function clickTile(page: Page, c: number, r: number): Promise<void> {
  const p = tileScreen(c, r);
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + (p.x / 960) * box.width, box.y + (p.y / 540) * box.height);
}

// ---------------------------------------------------------------------------------------
// crucible v1 #6: opportunity-strike flank bonus was keyed to the mover's LANDING tile
// (unit.c/r already mutated before resolveOpportunityStrikes ran) instead of the tile it is
// VACATING. Pincer the Keeper between wisp-0 (south, the striker) and wisp-1 (north, the
// flanking ally) and retreat one tile east: opposite-of-vacated = north (wisp-1's tile) →
// flanked (+1); opposite-of-landing would be empty → unflanked. Mira and the third enemy are
// parked far away so nothing else can strike or confuse the reading.
// ---------------------------------------------------------------------------------------
test('crucible v1 #6: an opportunity strike flanks off the VACATED tile, not the landing tile', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');

  const reached = await waitForActive(page, 'keeper');
  expect(reached, "the Keeper's first turn opened for manual control").toBe(true);
  expect((await snap(page))?.state).toBe('playerMove');

  // Find a horizontal run of 2 floor tiles (vacated, landing) with room for a pincer ally
  // directly above/below the vacated tile — any seeded interior row/col works.
  const layout = await layoutDebug(page);
  expect(layout, 'layout readable').not.toBeNull();
  let vc = -1, vr = -1;
  for (let r = 2; r <= 5 && vr < 0; r++) {
    for (let c = 1; c <= 9; c++) {
      if (layout!.tiles[r][c] === 'floor' && layout!.tiles[r][c + 1] === 'floor') { vc = c; vr = r; break; }
    }
  }
  expect(vr, 'found a floor/floor pair to stage the retreat').toBeGreaterThan(0);
  const landing = { c: vc + 1, r: vr };

  // Park Mira and the third enemy well clear so only wisp-0/wisp-1 can ever strike.
  await debugSetPos(page, 'mira', 1, 1);
  await debugSetPos(page, 'wraith-2', 10, 6);

  await debugSetPos(page, 'keeper', vc, vr); // the Keeper's own turn is open — safe to reposition
  await debugSetPos(page, 'wisp-0', vc, vr + 1); // striker: adjacent to the VACATED tile
  await debugSetPos(page, 'wisp-1', vc, vr - 1); // flanking ally: opposite the vacated tile from wisp-0

  const before = await unitDebug(page, 'keeper');
  expect(before?.hp).toBeGreaterThan(0);

  await clickTile(page, landing.c, landing.r);
  await page.waitForTimeout(500); // opportunity strikes resolve before the move tween starts

  const after = await unitDebug(page, 'keeper');
  expect(after, 'Keeper still tracked').not.toBeNull();
  expect([after!.c, after!.r], 'the Keeper actually completed the retreat').toEqual([landing.c, landing.r]);

  const dmg = before!.hp - after!.hp;
  // Flanked: 1 base + 1 flank = 2 per striker × 2 strikers = 4. Unflanked (the bug): 1×2 = 2.
  expect(dmg, 'both pincering strikes landed flanked (2 each, 4 total) — not unflanked (1 each, 2 total)').toBe(4);
});
