import { test, expect, type Page } from '@playwright/test';
import { waitReady } from './helpers';

// Phase 2 "the Five Arts & Glow" (docs/design/magic-combat-depth.md §2, §5, §6, §11.1, §12.2-
// 12.4): the tier flyout, Glow sources/sinks + pips UI, overlay flair, and the two Satchel
// glow items. Drives the CombatScene debug surface (combatSnapshot/debugSetPos/debugSetGlow/
// flyoutDebug — same "read-only snapshot + a pilot hint" pattern combat.spec.ts and
// combat-status.spec.ts already use), since the flyout itself is Phaser-drawn (not DOM) and
// can't be inspected via a locator.

const EV = 'screenshots';

type Snap = {
  state: string;
  activeTeam: string | null;
  activeId: string;
  enemyHp: number;
  partyHp: number;
  log: Array<{ action: string; dmg: number; overlay: boolean }>;
  rank: number;
  welded3: number;
  welded4: number;
  glow: number;
} | null;

type TierRow = { tier: 1 | 2 | 3; label: string; costText: string; enabled: boolean; reason?: string };
type FlyoutDbg = { rows: TierRow[]; overglow: { enabled: boolean; on: boolean; reason?: string } | null } | null;
type LayoutDbg = { tiles: string[][]; braziers: Array<{ c: number; r: number }>; mist: Array<{ c: number; r: number }> } | null;

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as Snap;
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

async function debugSetGlow(page: Page, pips: number): Promise<void> {
  await page.evaluate((p) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { debugSetGlow?(pips: number): void } | undefined;
    s?.debugSetGlow?.(p);
  }, pips);
}

async function flyoutDebug(page: Page): Promise<FlyoutDbg> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { flyoutDebug?(): unknown } | undefined;
    return (s?.flyoutDebug?.() ?? null) as FlyoutDbg;
  });
}

async function layoutDebug(page: Page): Promise<LayoutDbg> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { layoutDebug?(): unknown } | undefined;
    return (s?.layoutDebug?.() ?? null) as LayoutDbg;
  });
}

/** Poll until the Keeper's own turn opens for manual control (no ?demo, so nothing else drives it). */
async function waitForKeeperTurn(page: Page, timeout = 20_000): Promise<Snap> {
  const start = Date.now();
  let s = await snap(page);
  while (s?.state !== 'playerMove' && Date.now() - start < timeout) {
    await page.waitForTimeout(150);
    s = await snap(page);
  }
  return s;
}

/** Poll the action log for the first `action` entry (combat.spec.ts's own idiom) — the real
 *  sync point for an async satchel use: the pane's close promise resolves BEFORE
 *  useSatchelItem's own awaits (removeItem/useItem) finish, so waiting on '.inv-overlay'
 *  detaching alone would race the Glow-gain/actionLog write that follows it. */
async function waitForLoggedAction(page: Page, action: string, timeout = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const s = await snap(page);
    if (s?.log.some((l) => l.action === action)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

// Own boot precondition (chain.spec.ts's pattern) — the shared cross-run .state-e2e means a
// prior spec's save.json could otherwise leak an unexpected hp/scene into this file's battles.
async function seedFreshSave(page: Page): Promise<void> {
  await page.request.put('/api/state/save.json', { data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' } });
}

test('Rank 1: the tier flyout never appears — Smite casts directly (zero regression)', async ({ page }) => {
  test.setTimeout(60_000);
  await seedFreshSave(page);
  await page.goto('/?scene=combat&seed=7&rank=1');
  await waitReady(page, 'combat');

  const opened = await waitForKeeperTurn(page);
  expect(opened?.state, "the Keeper's first turn opened for manual control").toBe('playerMove');
  expect(opened?.rank, 'rank computes to 1 with no ?rank override needed (packless fixture caps at 6 facts, RANK2_NEED=8)').toBe(1);

  // dev-antechamber spawns its enemies far from the party (combat-status.spec.ts's own note) —
  // put one within Smite's range so pressing it has a target to go straight to.
  await debugSetPos(page, 'keeper', 5, 3);
  await debugSetPos(page, 'wisp-0', 6, 3);

  await page.keyboard.press('2'); // Smite
  await page.waitForTimeout(150); // a bare `.press()` can race Phaser's own frame-tick handling (helpers.ts's tapKey doc)
  const after = await snap(page);
  expect(after?.state, 'Rank 1 goes straight to targeting — no flyout state').toBe('playerTarget');
  expect(await flyoutDebug(page), 'the flyout never opens at Rank 1').toBeNull();
});

test('Rank 2+: pressing an Art opens the tier flyout with correct per-row greying; Esc closes it', async ({ page }) => {
  test.setTimeout(60_000);
  await seedFreshSave(page);
  await page.goto('/?scene=combat&seed=7&rank=2');
  await waitReady(page, 'combat');

  const opened = await waitForKeeperTurn(page);
  expect(opened?.state).toBe('playerMove');
  expect(opened?.rank, '?rank=2 override took effect').toBe(2);

  // Within Smite/Cinder-Rebuke's range 2 so tier 1/2's greying is about Rank/Glow, not range.
  await debugSetPos(page, 'keeper', 5, 3);
  await debugSetPos(page, 'wisp-0', 6, 3);

  await page.keyboard.press('2'); // Smite (Kindling) — Rank 2 opens the flyout instead of casting T1 directly
  await page.waitForTimeout(150); // a bare `.press()` can race Phaser's own frame-tick handling (helpers.ts's tapKey doc)
  const mid = await snap(page);
  expect(mid?.state, 'the flyout opens instead of targeting').toBe('playerTier');
  await page.screenshot({ path: `${EV}/e2e-magic-flyout-rank2.png` });

  const fd = await flyoutDebug(page);
  expect(fd?.rows).toHaveLength(3);
  expect(fd?.rows[0], 'tier 1 (Smite) is always free and enabled').toMatchObject({ tier: 1, label: 'Smite', costText: 'free', enabled: true });
  expect(fd?.rows[1], 'tier 2 (Cinder-Rebuke) costs a pip; no Glow yet → greyed').toMatchObject({ tier: 2, label: 'Cinder-Rebuke', costText: '◈1', enabled: false, reason: 'needs 1 glow' });
  expect(fd?.rows[2], 'tier 3 (Lanternfall) needs Rank 3 — greyed at Rank 2').toMatchObject({ tier: 3, label: 'Lanternfall', costText: '◈2', enabled: false, reason: 'needs Rank 3' });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const closed = await snap(page);
  expect(closed?.state, 'Esc returns to the action menu, not targeting').toBe('playerMove');
  expect(await flyoutDebug(page)).toBeNull();
});

test('T2 cast (Cinder-Rebuke) spends a Glow pip and passes flair to the overlay eyebrow', async ({ page }) => {
  test.setTimeout(60_000);
  await seedFreshSave(page);
  await page.goto('/?scene=combat&seed=7&rank=2');
  await waitReady(page, 'combat');

  const opened = await waitForKeeperTurn(page);
  expect(opened?.state).toBe('playerMove');

  // Deterministic geometry (mirrors crucible-combat.spec.ts's own debugSetPos idiom) —
  // wisp-0 within Smite/Cinder-Rebuke's range 2, regardless of the seeded spawn layout.
  await debugSetPos(page, 'keeper', 5, 3);
  await debugSetPos(page, 'wisp-0', 6, 3);
  await debugSetGlow(page, 1);

  await page.keyboard.press('2'); // open the Kindling flyout
  await page.waitForTimeout(150); // a bare `.press()` can race Phaser's own frame-tick handling (helpers.ts's tapKey doc)
  expect((await snap(page))?.state).toBe('playerTier');
  const fd = await flyoutDebug(page);
  expect(fd?.rows[1], 'Cinder-Rebuke is enabled now that a pip is in hand and a target is in range').toMatchObject({ tier: 2, enabled: true });

  await page.keyboard.press('2'); // pick tier 2 — Cinder-Rebuke
  await page.waitForTimeout(150);
  const targeting = await snap(page);
  expect(targeting?.state, 'picking an enabled tier enters targeting').toBe('playerTarget');

  // Click wisp-0's tile (6,3) — tileToScreen: ORIGIN(192,48) + c*48+24, r*48+24.
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const ix = 192 + 6 * 48 + 24;
  const iy = 48 + 3 * 48 + 24;
  await page.mouse.click(box.x + (ix / 960) * box.width, box.y + (iy / 540) * box.height);

  await page.locator('.fw-opt').first().waitFor({ state: 'visible', timeout: 15_000 });
  // §12.4 — the flair replaces the default action name in the eyebrow, kind name unchanged.
  await expect(page.locator('.fw-eyebrow'), 'flair renders the spell label, not the generic action name').toContainText('Cinder-Rebuke');
  await expect(page.locator('.fw-eyebrow'), 'the encounter-kind name still shows').toContainText('Multiple Choice');
  await expect(page.locator('.fw-eyebrow'), 'the T1 label never appears once flair is set').not.toContainText('Smite');
  await page.screenshot({ path: `${EV}/e2e-magic-flair-eyebrow.png` });

  // Glow is spent UP FRONT (before the question resolves) — already reflected here.
  const spent = await snap(page);
  expect(spent?.glow, 'the pip was spent on cast, win or lose the question').toBe(0);
  await page.screenshot({ path: `${EV}/e2e-magic-pips-spent.png` });

  // Resolve the encounter (either branch) so the turn concludes cleanly.
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
  await page.locator('.fw-opt').first().click();
  const onward = page.getByRole('button', { name: 'Onward ▸' });
  try {
    await onward.waitFor({ state: 'visible', timeout: 1500 });
    await onward.click();
  } catch { /* correct answer auto-resolves without a continue button (kinds.ts renderMcq) */ }
  await page.locator('.fw-overlay').waitFor({ state: 'detached', timeout: 10_000 });
});

// §4.4/§5.1 — the kit-showcase room guarantees a brazier (combat-status.spec.ts's own fixture).
test('lighting a brazier grants +1 Glow (pip UI updates)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=2&kit=1');
  await waitReady(page, 'combat');

  const opened = await waitForKeeperTurn(page);
  expect(opened?.state).toBe('playerMove');
  expect(opened?.glow, 'Glow starts at 0 (create()s reset block)').toBe(0);

  const layout = await layoutDebug(page);
  expect(layout?.braziers.length, 'the seeded kit-showcase layout has a brazier').toBeGreaterThan(0);
  const brazier = layout!.braziers[0];
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  let standAt: { c: number; r: number } | null = null;
  for (const [dc, dr] of dirs) {
    const cc = brazier.c + dc;
    const rr = brazier.r + dr;
    if (layout!.tiles[rr]?.[cc] && layout!.tiles[rr][cc] !== 'wall') { standAt = { c: cc, r: rr }; break; }
  }
  expect(standAt, 'found a non-wall tile adjacent to the brazier').not.toBeNull();

  await debugSetPos(page, 'keeper', standAt!.c, standAt!.r);
  await page.keyboard.press('e');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${EV}/e2e-magic-pips-brazier.png` });

  const after = await snap(page);
  expect(after?.glow, 'lighting the brazier granted +1 Glow').toBe(1);
});

test('Overglow toggle greys for Lanternfall at Rank 3 (burst spells cannot be upcast)', async ({ page }) => {
  test.setTimeout(60_000);
  await seedFreshSave(page);
  await page.goto('/?scene=combat&seed=7&rank=3');
  await waitReady(page, 'combat');

  const opened = await waitForKeeperTurn(page);
  expect(opened?.state).toBe('playerMove');
  expect(opened?.rank).toBe(3);

  // Lanternfall (burst1) needs a LIVING ADJACENT enemy to be targetable at all — place one
  // next to the Keeper so tier 3's own row reads enabled (isolating the assertion to Overglow).
  await debugSetPos(page, 'keeper', 5, 3);
  await debugSetPos(page, 'wisp-0', 6, 3);
  await debugSetGlow(page, 3); // Lanternfall costs ◈2; since V1-9 the Overglow row only renders when
  // the POST-cost remainder can fund it (2+1=3 in hand) — at exactly-cost Glow the row is absent by
  // design (no silent fizzle), which would make this burst-greying assertion vacuous.
  await page.keyboard.press('2'); // open the Kindling flyout — Rank 3 default-focuses tier 3 (Lanternfall)
  await page.waitForTimeout(150); // a bare `.press()` can race Phaser's own frame-tick handling (helpers.ts's tapKey doc)
  expect((await snap(page))?.state).toBe('playerTier');
  await page.screenshot({ path: `${EV}/e2e-magic-overglow-greyed.png` });

  const fd = await flyoutDebug(page);
  expect(fd?.rows[2], 'Lanternfall itself is castable at Rank 3 with a pip in hand').toMatchObject({ tier: 3, enabled: true });
  expect(fd?.overglow, 'the Overglow row renders (canOverglow holds) but is greyed for a burst spell').not.toBeNull();
  expect(fd?.overglow?.enabled, "won't multiply a burst — greyed").toBe(false);

  // Pressing 'o' on a greyed row is a no-op (still closed to toggling).
  await page.keyboard.press('o');
  await page.waitForTimeout(150);
  const stillOff = await flyoutDebug(page);
  expect(stillOff?.overglow?.on).toBe(false);
});

// §11.1 — the two Glow items are combat-only; using one through the Satchel grants Glow and
// spends the turn, mirroring the existing heal-item Satchel e2e (combat.spec.ts).
test('Satchel: using a Wick-Tallow in battle grants +1 Glow and consumes it from the persistent satchel', async ({ page }) => {
  test.setTimeout(60_000);
  await page.request.put('/api/state/save.json', { data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' } });
  await page.request.put('/api/state/inventory.json', {
    data: { version: 1, gold: 20, stacks: { 'wick-tallow': 2 } },
  });

  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');

  const opened = await waitForKeeperTurn(page);
  expect(opened?.state).toBe('playerMove');
  expect(opened?.glow).toBe(0);

  await page.keyboard.press('q'); // Satchel
  await page.locator('.inv-overlay').waitFor({ state: 'visible', timeout: 5_000 });
  await page.screenshot({ path: `${EV}/e2e-magic-satchel-glow-item.png` });

  await page.locator('.inv-row').getByRole('button', { name: 'Use' }).first().click();
  await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });

  const logged = await waitForLoggedAction(page, 'satchel');
  expect(logged, 'the satchel use resolved (spent the turn)').toBe(true);
  const after = await snap(page);
  expect(after?.glow, 'the Wick-Tallow granted +1 Glow').toBe(1);

  const inv = await page.request.get('/api/state/inventory.json');
  const invData = (await inv.json()) as { stacks?: Record<string, number> };
  expect(invData.stacks?.['wick-tallow'] ?? 0, 'exactly one Wick-Tallow was consumed').toBe(1);
});

// §5.1 source 1 — a Strike that deals damage grants +1 Glow. The T1 strike path itself is
// untouched (CombatScene.ts just observes the same before/after enemy-hp delta the action
// log already computes, post-flank and post-absorption).
test('a Strike that deals damage grants +1 Glow', async ({ page }) => {
  test.setTimeout(60_000);
  await seedFreshSave(page);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');

  const opened = await waitForKeeperTurn(page);
  expect(opened?.state).toBe('playerMove');
  expect(opened?.glow, 'Glow starts at 0 (create()s reset block)').toBe(0);

  // Deterministic geometry ("Rank 1"/"T2 cast" tests' own idiom) — wisp-0 within Strike's range 1.
  await debugSetPos(page, 'keeper', 5, 3);
  await debugSetPos(page, 'wisp-0', 6, 3);

  await page.keyboard.press('1'); // Strike
  await page.waitForTimeout(150); // a bare `.press()` can race Phaser's own frame-tick handling (helpers.ts's tapKey doc)
  expect((await snap(page))?.state, 'Strike enters targeting like any T1 action').toBe('playerTarget');

  // Click wisp-0's tile (6,3) — tileToScreen: ORIGIN(192,48) + c*48+24, r*48+24 ("T2 cast" test's own formula).
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const ix = 192 + 6 * 48 + 24;
  const iy = 48 + 3 * 48 + 24;
  await page.mouse.click(box.x + (ix / 960) * box.width, box.y + (iy / 540) * box.height);

  const logged = await waitForLoggedAction(page, 'strike');
  expect(logged, 'the strike resolved').toBe(true);
  const after = await snap(page);
  expect(
    after?.log.find((l) => l.action === 'strike')?.dmg,
    'the strike actually dealt damage — the precondition for the Glow grant',
  ).toBeGreaterThan(0);
  await page.screenshot({ path: `${EV}/e2e-magic-pips-strike.png` });
  expect(after?.glow, 'a damage-dealing Strike granted +1 Glow').toBe(1);
});

// §5.1 source 2 — a party unit starting ITS turn on a lantern tile grants +1 Glow. buildLayout
// always seeds ≥1 lantern tile (grid.ts's lanternN = 1 + floor(rng()*2)), so no brazier/kit
// precondition is needed here. Initiative is speed-sorted with ties→party-first (initiative.ts):
// keeper(5) > mira(4) === wraith(4) → the tie goes to the party → mira(4) > wisp(3) — so Mira is
// guaranteed to act immediately after the Keeper, with zero enemy turns (and zero extra polling)
// needed in between (units.ts's own speed table: KEEPER 5, MIRA 4, wisp 3, wraith 4).
test('a party unit starting its turn on a lantern tile grants +1 Glow', async ({ page }) => {
  test.setTimeout(60_000);
  await seedFreshSave(page);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');

  const opened = await waitForKeeperTurn(page);
  expect(opened?.state).toBe('playerMove');
  expect(opened?.glow, 'Glow starts at 0 (create()s reset block)').toBe(0);

  const layout = await layoutDebug(page);
  let lantern: { c: number; r: number } | null = null;
  for (let r = 0; r < (layout?.tiles.length ?? 0) && !lantern; r++) {
    for (let c = 0; c < layout!.tiles[r].length; c++) {
      if (layout!.tiles[r][c] === 'lantern') { lantern = { c, r }; break; }
    }
  }
  expect(lantern, 'buildLayout always seeds at least one lantern tile').not.toBeNull();

  // Park Mira on the lantern NOW, while it's still the Keeper's turn — nothing moves her
  // afterward, so she is standing on it the instant her own turn begins next.
  await debugSetPos(page, 'mira', lantern!.c, lantern!.r);

  await page.keyboard.press('7'); // Keeper Waits — ends the turn with no damage/no encounter,
  await page.waitForTimeout(150); // so this can't be confused with the Strike source above.

  const afterWait = await snap(page);
  expect(
    afterWait?.activeId,
    "Mira's turn opens immediately — a party-to-party handoff is synchronous (no enemy turn in between)",
  ).toBe('mira');
  expect(afterWait?.state).toBe('playerMove');
  await page.screenshot({ path: `${EV}/e2e-magic-pips-lantern-turnstart.png` });
  expect(afterWait?.glow, 'Mira started her turn standing on a lantern tile — +1 Glow').toBe(1);
});
