import { test, expect, type Page } from '@playwright/test';
import { waitReady, readState } from './helpers';

// crucible-2 fix wave, the two findings whose defect lives in CombatScene WIRING rather than
// in a pure module — the others (weld q1 gate, T1 weld reachability, reclaimed tally) are
// pinned by unit tests in spells/combat/redemption. These two need the real scene:
//
//   1. attestation-phase-skip [HIGH] — a T2/T3 Attestation at the Warden must be the same
//      negotiation beat as a T1 Cast: draw the CURRENT phase's recallTags, then advance the
//      phase. Before the fix, castGatedSpell had neither half, so a Rank-3 player casting
//      Verbatim Decree stripped shields while phases 2 and 3 never re-armed — winning having
//      answered one of three mandatory branches.
//   2. rank1-shielded-noop — at Rank 1 a T1 Art aimed at the shielded Warden armed targeting,
//      spent the turn AND the question, and bounced. Rank 2+ has refused this since crucible
//      v1 #19; Rank 1 never opened a flyout so it never got the filter.
//
// Route: the standalone combat fixture (?scene=combat&boss=1), JUDGE_MODE=stub, on a private
// scratch server (port 5401, STATE_DIR outside the repo).

type Save = { scene?: string; hp?: number; streak?: number; lastPlayed?: string };
type Inventory = { version: number; gold: number; stacks: Record<string, number> };

type Snap = {
  state: string; activeId: string; enemyHp: number; partyHp: number;
  log: Array<{ action: string; dmg: number; overlay: boolean }>;
  rank: number; glow: number;
} | null;

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as Snap;
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
  await page.evaluate(({ id: uid, c: cc, r: rr }) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { debugSetPos?(id: string, c: number, r: number): void } | undefined;
    s?.debugSetPos?.(uid, cc, rr);
  }, { id, c, r });
}

/** The tier flyout's rendered rows + their grey-out reasons (the Phaser flyout has no DOM). */
async function flyoutDebug(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { flyoutDebug?(): unknown } | undefined;
    return s?.flyoutDebug?.() ?? null;
  });
}

async function debugSetGlow(page: Page, pips: number): Promise<void> {
  await page.evaluate((p) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { debugSetGlow?(p: number): void } | undefined;
    s?.debugSetGlow?.(p);
  }, pips);
}

/** tileToScreen: ORIGIN(192,48) + c*48+24, r*48+24 (the formula every combat spec uses). */
async function clickTile(page: Page, c: number, r: number): Promise<void> {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + ((192 + c * 48 + 24) / 960) * box.width, box.y + ((48 + r * 48 + 24) / 540) * box.height);
}

async function waitForCombat(page: Page, pred: (s: Snap) => boolean, message: string, timeout = 40_000): Promise<Snap> {
  await expect.poll(async () => (pred(await snap(page)) ? 'yes' : 'no'), { message, timeout }).toBe('yes');
  return snap(page);
}

// The pack's authored correct-branch text per phase (packs/vc-law/pack.json). reskin() shuffles
// branch ORDER, so options are matched BY TEXT, never by slot (boss-victory.spec.ts's header).
const CORRECT_BRANCH_PREFIX = [
  'Cite the standard',
  'Counter to nonparticipating',
  'Counter both terms',
];

async function driveParley(page: Page, phaseNum: number): Promise<void> {
  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 40_000 });
  const labels = await page.locator('.fw-optlabel').allTextContents();
  const idx = labels.findIndex((l) => l.startsWith(CORRECT_BRANCH_PREFIX[phaseNum - 1]));
  expect(idx, `phase ${phaseNum}: found the authored correct branch among ${JSON.stringify(labels)}`)
    .toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(600); // deliberate input arming (the existing specs' pre-press guard)
  await page.locator('.fw-opt').nth(idx).click();
  const cont = page.getByRole('button', { name: 'Onward ▸' });
  await cont.waitFor({ state: 'visible', timeout: 20_000 });
  await cont.click();
  await waitForCombat(page, (s) => s?.state === 'playerMove' || s?.state === 'over',
    `phase ${phaseNum} handed control back`);
}

async function seed(page: Page): Promise<void> {
  await page.request.put('/api/state/save.json', { data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' } });
  await page.request.put('/api/state/inventory.json', { data: { version: 1, gold: 20, stacks: {} } });
}

async function restoreState(page: Page, save: Save | null, inv: Inventory | null): Promise<void> {
  const saveData: Save = save ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
  const invData: Inventory = inv ?? { version: 1, gold: 20, stacks: {} };
  await page.goto('about:blank');
  for (let i = 0; i < 5; i++) {
    await page.request.put('/api/state/save.json', { data: saveData });
    await page.request.put('/api/state/inventory.json', { data: invData });
    const now = (await page.request.get('/api/state/save.json').then((r) => r.json()).catch(() => undefined)) as Save | undefined;
    if (now?.scene === saveData.scene) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

// ---------------------------------------------------------------------------------------
test('attestation-phase-skip: a T3 Verbatim Decree at the Warden advances the boss phase', async ({ page }) => {
  test.setTimeout(240_000);
  const beforeSave = await readState<Save>(page, 'save.json');
  const beforeInv = await readState<Inventory>(page, 'inventory.json');

  try {
    await seed(page);
    // Rank 3 unlocks the tier flyout's T3 row; debugSetGlow pays Verbatim Decree's ◈2.
    await page.goto('/?scene=combat&seed=7&boss=1&rank=3');
    await waitReady(page, 'combat');

    await driveParley(page, 1); // phase 1's automatic Parley; phaseIndex is now 0

    const s = await waitForCombat(page, (x) => x?.state === 'playerMove', 'a party turn opened');
    expect(s!.rank, '?rank=3 took effect, so the T3 row is reachable').toBe(3);
    const active = s!.activeId;

    await debugSetGlow(page, 3);
    await debugSetPos(page, active, 5, 3);
    await debugSetPos(page, 'warden', 6, 3); // inside Verbatim Decree's range 3
    await debugSetPos(page, 'wisp-0', 1, 1); // parked far away

    // Attestation button ('5') opens the tier flyout at Rank 3; '3' picks the T3 row. The
    // 150ms settle after each press is the shipped idiom (combat-magic.spec.ts:180): a bare
    // .press() can race Phaser's own frame-tick handling.
    await page.keyboard.press('5');
    await page.waitForTimeout(150);
    expect((await snap(page))?.state, 'the tier flyout opened').toBe('playerTier');
    const rows = await flyoutDebug(page);

    await page.keyboard.press('3');
    await page.waitForTimeout(150);
    expect((await snap(page))?.state, `Verbatim Decree entered targeting; flyout was ${JSON.stringify(rows)}`)
      .toBe('playerTarget');
    await clickTile(page, 6, 3);

    // Answer the free_recall the Decree fires.
    await page.locator('.fw-textarea').waitFor({ state: 'visible', timeout: 20_000 });
    await page.waitForTimeout(450); // overlay.ts's paint-anchored answer guard
    await page.locator('.fw-textarea').fill(
      'The Warden’s terms favor the house: a 1x liquidation preference is the market standard, ' +
      'nonparticipating preferred avoids the double dip, and weighted-average antidilution with a ' +
      'right-sized option pool protects the founders’ pre-money stake.',
    );
    await page.getByRole('button', { name: 'Cast' }).click();
    const cont = page.getByRole('button', { name: 'Onward ▸' });
    try {
      await cont.waitFor({ state: 'visible', timeout: 15_000 });
      await cont.click();
    } catch { /* a fully auto-resolving pass needs no continue click */ }
    await page.locator('.fw-textarea').waitFor({ state: 'detached', timeout: 20_000 });

    // Step 0c (T6 boss-cluster bisect): debugSetPos never spends the movement leg, so post-T2
    // (move·act·move, End Turn) the turn stays open ("Steps remain") after this single Cast —
    // advanceTurn() (the only place that consumes pendingBossPhase and opens the next Parley)
    // never runs otherwise. Press End Turn like a real player standing still with movement left
    // over would (boss-cluster-diagnosis.md) — never touches debugSetPos itself. The scene
    // briefly holds `state:'resolving'` while the encounter/SRS/banner chain settles
    // (CombatScene.ts's Phase type) — wait it out before deciding whether the turn is open.
    const afterCast = await waitForCombat(page, (s) => s?.state !== 'resolving',
      'the post-Cast state settled (left "resolving")', 5_000);
    if (afterCast?.state === 'playerMove') {
      await page.keyboard.press('7'); // End Turn
      await page.waitForTimeout(400);
    }

    // THE VERDICT: the T3 cast re-armed the next boss phase, so phase 2's Parley opens on its
    // own. Before the fix castGatedSpell never touched phaseIndex and this never appeared —
    // ordinary turns simply resumed and the negotiation stalled at phase 1 forever.
    await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 40_000 });
    await expect(page.locator('.fw-eyebrow'), 'phase 2 opened a Parley after the T3 Attestation')
      .toContainText('Parley');
    const labels = await page.locator('.fw-optlabel').allTextContents();
    expect(
      labels.some((l) => l.startsWith(CORRECT_BRANCH_PREFIX[1])),
      `the phase that opened is phase TWO (its authored branch), not a repeat of phase one: ${JSON.stringify(labels)}`,
    ).toBe(true);
    await page.screenshot({ path: 'screenshots/e2e-fixwave-attestation-phase-advance.png' });
  } finally {
    await restoreState(page, beforeSave, beforeInv);
  }
});

// ---------------------------------------------------------------------------------------
test('rank1-shielded-noop: a Rank-1 Art refuses a shielded Warden instead of eating the turn', async ({ page }) => {
  test.setTimeout(180_000);
  const beforeSave = await readState<Save>(page, 'save.json');
  const beforeInv = await readState<Inventory>(page, 'inventory.json');

  try {
    await seed(page);
    await page.goto('/?scene=combat&seed=7&boss=1'); // no ?rank= → Rank 1, no flyout
    await waitReady(page, 'combat');

    await driveParley(page, 1);
    const s = await waitForCombat(page, (x) => x?.state === 'playerMove', 'a party turn opened');
    expect(s!.rank, 'this is the Rank-1 path — no flyout exists to grey the row').toBe(1);
    const active = s!.activeId;

    // The shielded Warden is the ONLY thing in Smite's range.
    await debugSetPos(page, active, 5, 3);
    await debugSetPos(page, 'warden', 6, 3);
    await debugSetPos(page, 'wisp-0', 1, 1);

    await page.keyboard.press('2'); // Smite (Kindling T1) — no bossRider, always absorbed

    // THE VERDICT: targeting never arms, and the banner names the real reason. Before the fix
    // this entered playerTarget, and clicking the Warden spent the turn AND a question for a
    // guaranteed 'shielded' bounce.
    await expect
      .poll(() => bannerText(page), { message: 'Smite refuses the shielded Warden, and says why', timeout: 10_000 })
      .toContain('shielded');
    expect((await snap(page))!.state, 'no targeting was armed — the turn is still the player’s').toBe('playerMove');
    await page.screenshot({ path: 'screenshots/e2e-fixwave-rank1-shielded-reason.png' });

    // …and the free Strike is deliberately still allowed at the same target: it costs no
    // question, and §9.3's Objection is its feedback. (Guards against over-filtering.)
    await page.keyboard.press('1');
    await expect.poll(async () => (await snap(page))?.state, { message: 'free Strike still targets the Warden', timeout: 10_000 })
      .toBe('playerTarget');
  } finally {
    await restoreState(page, beforeSave, beforeInv);
  }
});
