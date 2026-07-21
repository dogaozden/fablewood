import { test, expect, type Page } from '@playwright/test';
import { waitReady } from './helpers';

// Crucible v1 fixes — Five Arts / Glow economy / boss-shield honesty (Overglow post-cost
// gating, the tier-choose banner's overlap with the flyout, Lantern-Brand's clamped-gain
// banner, a shielded boss silently absorbing a Glow-spending cast). New file (v1-fix-b owns
// CombatScene.ts/hud.ts/arts.ts exclusively for this pass) — mirrors combat-magic.spec.ts's
// own debug-hook idiom (combatSnapshot/debugSetPos/debugSetGlow/flyoutDebug), since the
// flyout is Phaser-drawn (not DOM) and can't be inspected via a locator.

const EV = '/tmp/fablewood-scratch';

type Snap = {
  state: string; activeTeam: string | null; activeId: string; enemyHp: number; partyHp: number;
  log: Array<{ action: string; dmg: number; overlay: boolean }>;
  rank: number; welded3: number; welded4: number; glow: number;
} | null;

type TierRow = { tier: 1 | 2 | 3; label: string; costText: string; enabled: boolean; reason?: string };
type FlyoutDbg = { rows: TierRow[]; overglow: { enabled: boolean; on: boolean; reason?: string } | null } | null;

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

type Rect = { top: number; bottom: number; left: number; right: number };

async function bannerBounds(page: Page): Promise<Rect> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { bannerBounds?(): Rect } | undefined;
    return s?.bannerBounds?.() ?? { top: 0, bottom: 0, left: 0, right: 0 };
  });
}

async function flyoutBounds(page: Page): Promise<Rect | null> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { flyoutBounds?(): Rect | null } | undefined;
    return s?.flyoutBounds?.() ?? null;
  });
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
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

// Own boot precondition (combat-magic.spec.ts's own pattern) — the shared cross-run state dir
// means a prior spec's save.json could otherwise leak an unexpected hp/scene into this file's battles.
async function seedFreshSave(page: Page): Promise<void> {
  await page.request.put('/api/state/save.json', { data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' } });
}

// ---------------------------------------------------------------------------------------
// crucible v1 #9: canOverglow's render/toggle gates checked Glow's WHOLESALE total, while
// castGatedSpell rechecks against the POST-tier-cost remainder — the two disagree exactly
// when total === tier cost. The flyout used to arm Overglow anyway; casting then silently
// dropped the bonus (base damage only, no warning). Fixed by gating render/toggle on the
// same post-cost remainder castGatedSpell already used — the row must not even appear.
// ---------------------------------------------------------------------------------------
test("crucible v1 #9: Overglow does not arm when a tier's own cost would exhaust Glow (remainder 0)", async ({ page }) => {
  test.setTimeout(60_000);
  await seedFreshSave(page);
  await page.goto('/?scene=combat&seed=7&rank=2');
  await waitReady(page, 'combat');

  const opened = await waitForKeeperTurn(page);
  expect(opened?.state).toBe('playerMove');
  expect(opened?.rank, '?rank=2 override took effect').toBe(2);

  await debugSetPos(page, 'keeper', 5, 3);
  await debugSetPos(page, 'wisp-0', 6, 3);
  await debugSetGlow(page, 1); // exactly Cinder-Rebuke's (tier 2) own cost of ◈1 — nothing left over

  await page.keyboard.press('2'); // open the Kindling flyout — Rank 2 default-focuses tier 2 (Cinder-Rebuke)
  await page.waitForTimeout(150);
  expect((await snap(page))?.state).toBe('playerTier');
  await page.screenshot({ path: `${EV}/v1fix9-overglow-not-offered.png` });

  const fd = await flyoutDebug(page);
  expect(fd?.rows[1], 'Cinder-Rebuke (tier 2) itself is castable — a real pip is banked for its cost').toMatchObject({ tier: 2, enabled: true });
  expect(
    fd?.overglow,
    "Overglow must not be offered at all — paying the focus tier's own cost leaves a remainder of 0",
  ).toBeNull();

  // Control: ONE extra pip above the tier's cost DOES offer it (proves this is a remainder
  // check, not an accidental blanket suppression).
  await debugSetGlow(page, 2);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('2');
  await page.waitForTimeout(150);
  const fd2 = await flyoutDebug(page);
  expect(fd2?.overglow?.enabled, 'a genuine spare pip above the tier cost still offers Overglow').toBe(true);
});

// ---------------------------------------------------------------------------------------
// crucible v1 #10: the fixed screen-centre "choose a tier" banner (depth 60, y=446) drew over
// the button-anchored, dynamically-sized flyout (depth 56) on 4 of 5 Arts — worst on
// Ritecraft/Attestation (T3 label invisible). Attestation (hotkey '5') sits closest to
// screen-centre of any Art button, and Rank 3 + a banked pip maximizes the flyout to its
// tallest (4 rows: 3 tiers + Overglow) — the worst-case geometry the finding names.
// ---------------------------------------------------------------------------------------
test('crucible v1 #10: the tier-choose banner never overlaps the flyout (worst case: Attestation, Rank 3, Overglow offered)', async ({ page }) => {
  test.setTimeout(60_000);
  await seedFreshSave(page);
  await page.goto('/?scene=combat&seed=7&rank=3');
  await waitReady(page, 'combat');

  const opened = await waitForKeeperTurn(page);
  expect(opened?.state).toBe('playerMove');
  expect(opened?.rank).toBe(3);

  await debugSetPos(page, 'keeper', 5, 3);
  await debugSetPos(page, 'wisp-0', 6, 3);
  await debugSetGlow(page, 3); // enough to bank a spare pip above Attestation T3's own cost

  await page.keyboard.press('5'); // Attestation (Cast) — closest button to screen-centre
  await page.waitForTimeout(200); // let the banner's own open tween settle
  expect((await snap(page))?.state).toBe('playerTier');

  const fd = await flyoutDebug(page);
  expect(fd?.overglow, 'Overglow renders (maximizing the flyout to 4 rows, the tallest/worst case)').not.toBeNull();

  const banner = await bannerBounds(page);
  const flyout = await flyoutBounds(page);
  expect(flyout, 'the flyout is open').not.toBeNull();
  await page.screenshot({ path: `${EV}/v1fix10-banner-flyout-attestation-rank3.png` });
  expect(rectsOverlap(banner, flyout!), `banner ${JSON.stringify(banner)} must not overlap flyout ${JSON.stringify(flyout)}`).toBe(false);

  // Also check Binding (hotkey '3') — the finding's other named example ("clips mid-word").
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.press('3');
  await page.waitForTimeout(200);
  expect((await snap(page))?.state).toBe('playerTier');
  const banner2 = await bannerBounds(page);
  const flyout2 = await flyoutBounds(page);
  expect(flyout2).not.toBeNull();
  await page.screenshot({ path: `${EV}/v1fix10-banner-flyout-binding-rank3.png` });
  expect(rectsOverlap(banner2, flyout2!), `banner ${JSON.stringify(banner2)} must not overlap flyout ${JSON.stringify(flyout2)}`).toBe(false);
});
