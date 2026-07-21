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

/** Debug: the HUD banner's current text (e2e-only — crucible v1 #14/#19: proves the banner's
 *  wording reflects the actual outcome rather than a static template regardless of it). */
async function bannerText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { bannerText?(): string } | undefined;
    return s?.bannerText?.() ?? '';
  });
}

type UnitDbg = { c: number; r: number; alive: boolean; hp: number; maxHp: number } | null;

async function unitDebug(page: Page, id: string): Promise<UnitDbg> {
  return page.evaluate((uid) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { unitDebug?(id: string): unknown } | undefined;
    return (s?.unitDebug?.(uid) ?? null) as UnitDbg;
  }, id);
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
  await page.setViewportSize({ width: 1280, height: 800 });
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

  // The game's internal 960x540 canvas is Scale.FIT (viewport-independent geometry), but the
  // verification brief calls for evidence at the 960x600 minimum window too — re-check the
  // same still-open Binding flyout there.
  await page.setViewportSize({ width: 960, height: 600 });
  await page.waitForTimeout(150);
  const banner3 = await bannerBounds(page);
  const flyout3 = await flyoutBounds(page);
  expect(flyout3).not.toBeNull();
  await page.screenshot({ path: `${EV}/v1fix10-banner-flyout-binding-rank3-960x600.png` });
  expect(rectsOverlap(banner3, flyout3!), `at 960x600: banner ${JSON.stringify(banner3)} must not overlap flyout ${JSON.stringify(flyout3)}`).toBe(false);
});

// ---------------------------------------------------------------------------------------
// crucible v1 #14: Lantern-Brand (+2 Glow) at exactly 1 pip below the 3-cap clamps to +1 and
// fully consumes the item, but the banner used to read the same static "the wick brightens"
// regardless — no disclosure that only half the item's value landed. The sibling heal branch
// (combat.spec.ts's own Satchel test) already discloses a clamped amount dynamically; this
// mirrors that pattern for Glow.
// ---------------------------------------------------------------------------------------
test('crucible v1 #14: Lantern-Brand discloses a CLAMPED Glow gain instead of a static full-success banner', async ({ page }) => {
  test.setTimeout(60_000);
  await page.request.put('/api/state/save.json', { data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' } });
  await page.request.put('/api/state/inventory.json', { data: { version: 1, gold: 20, stacks: { 'lantern-brand': 2 } } });

  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');

  const opened = await waitForKeeperTurn(page);
  expect(opened?.state).toBe('playerMove');
  await debugSetGlow(page, 2); // 1 pip shy of the 3-cap — Lantern-Brand's nominal +2 would overshoot it

  await page.keyboard.press('q'); // Satchel
  await page.locator('.inv-overlay').waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('.inv-row').getByRole('button', { name: 'Use' }).first().click();
  await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(250); // let useSatchelItem's glow branch land + the banner render

  const after = await snap(page);
  expect(after?.glow, 'clamped at the 3-pip cap, not the nominal +2 (which would read 4)').toBe(3);

  const banner = await bannerText(page);
  await page.screenshot({ path: `${EV}/v1fix14-lantern-brand-clamped.png` });
  expect(banner, `banner "${banner}" must disclose the actual clamped amount (+1), not a blanket success line`).toContain('+1');
});

test('crucible v1 #14 control: Lantern-Brand at ample headroom still reads as an undisclosed-amount-free full success', async ({ page }) => {
  test.setTimeout(60_000);
  await page.request.put('/api/state/save.json', { data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' } });
  await page.request.put('/api/state/inventory.json', { data: { version: 1, gold: 20, stacks: { 'lantern-brand': 1 } } });

  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');

  const opened = await waitForKeeperTurn(page);
  expect(opened?.state).toBe('playerMove');
  expect(opened?.glow, 'Glow starts at 0 — full headroom for a +2 gain').toBe(0);

  await page.keyboard.press('q');
  await page.locator('.inv-overlay').waitFor({ state: 'visible', timeout: 5_000 });
  await page.locator('.inv-row').getByRole('button', { name: 'Use' }).first().click();
  await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(250);

  const after = await snap(page);
  expect(after?.glow, 'the full nominal +2 landed, uncapped').toBe(2);
  const banner = await bannerText(page);
  expect(banner, 'a genuine full gain keeps the plain, undisclosed-amount banner').toBe('Lantern-Brand — the wick brightens.');
});

// ---------------------------------------------------------------------------------------
// crucible v1 #19: while the Vault-Warden is shielded, only Attestation ('cast') pierces
// (boss.ts wardenAbsorbs) — every other Art's tier flyout used to offer no greying/reason at
// all, letting a T2/T3 cast spend Glow up front against a target it could never actually
// damage (banner still read as a full success alongside the "shielded" float-text). The
// standalone boss fixture (?boss=1) spawns exactly one trash mob (wisp-0) alongside the
// Warden — parked out of range here so Binding's ONLY reachable target is the shielded boss.
// ---------------------------------------------------------------------------------------
test('crucible v1 #19: a shielded boss greys a non-Attestation tier row instead of wasting Glow on cast', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=7&boss=1&rank=3');
  await waitReady(page, 'combat');

  // Resolve phase 0 (any branch) — shields start at 3 (fixtures.ts), so even 'good' (-1) leaves 2.
  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(600); // boss-reveal input-arming guard settle (combat.spec.ts's own idiom)
  await page.keyboard.press('1');
  const cont = page.getByRole('button', { name: 'Onward ▸' });
  await cont.waitFor({ state: 'visible', timeout: 10_000 });
  await cont.click();
  await page.waitForTimeout(500);

  // waitForKeeperTurn just polls state==='playerMove' — works for whichever party unit's turn
  // opens next (Keeper or Mira; both can open a tier flyout identically).
  const opened = await waitForKeeperTurn(page);
  expect(opened?.state, 'a party turn opened for manual control').toBe('playerMove');
  const active = opened?.activeId;
  expect(active, 'an active party unit id is readable').toBeTruthy();

  await debugSetPos(page, active!, 5, 3);
  await debugSetPos(page, 'warden', 6, 3); // range 1 — within every Binding tier's reach (max 3)
  await debugSetPos(page, 'wisp-0', 1, 1); // distance 6 from (5,3) — beyond even Binding's widest tier (range 3)
  await debugSetGlow(page, 2); // covers every Binding tier's own cost (0/1/2), isolating the shield gate

  const bossBefore = await unitDebug(page, 'warden');
  expect(bossBefore?.hp).toBeGreaterThan(0);

  await page.keyboard.press('3'); // Binding (Weave) — a non-Attestation Art
  await page.waitForTimeout(150);
  expect((await snap(page))?.state).toBe('playerTier');
  const fd = await flyoutDebug(page);
  await page.screenshot({ path: `${EV}/v1fix19-boss-shield-greyed.png` });
  for (const row of fd?.rows ?? []) {
    expect(row, `tier ${row.tier} must grey with a shield-specific reason, not silently offer a doomed cast`).toMatchObject({
      enabled: false, reason: 'shielded',
    });
  }
  expect(fd?.rows.length, 'all 3 Binding tiers rendered').toBe(3);

  // Pressing a tier's own hotkey on a greyed row must be a no-op: no Glow spent, no HP change.
  const beforeGlow = (await snap(page))?.glow;
  await page.keyboard.press('1');
  await page.waitForTimeout(400);
  const afterGlow = (await snap(page))?.glow;
  const bossAfter = await unitDebug(page, 'warden');
  expect(afterGlow, 'Glow stays untouched — never spent against a target it can never damage').toBe(beforeGlow);
  expect(bossAfter?.hp, "the Warden's hp is unaffected").toBe(bossBefore?.hp);
});
