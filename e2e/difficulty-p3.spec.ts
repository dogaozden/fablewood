import { test, expect, type Page } from '@playwright/test';
import { waitReady } from './helpers';

// difficulty-rewards.md P3 (§10) — the pipeline pass is only real if the player can SEE it.
// Two proofs:
//   1. the §7 overlay eyebrow renders each tier's own glyph + in-world name;
//   2. the §4 reward rider actually fires in a real battle against real classified content,
//      printing "The truth burns brighter. (+1)" — the banner §4.2's list plumbing exists for.
// Proof 2 uses NO debug hook: it drives a genuine combat draw end to end, so it fails if the
// §5 gate, the sidecar loader merge, stampDifficulty, or the banner plumbing regress.

const EV = 'screenshots';

const RIDER_LINE = 'The truth burns brighter. (+1)';

/** §1's three tiers, exactly as overlay.ts composes them: `· ${glyph} ${name}`. */
const TIERS = [
  { tier: 1, text: '· ▫ Ember', ink: 'rgb(143, 74, 12)' },
  { tier: 2, text: '· ◧ Lantern', ink: 'rgb(122, 86, 16)' },
  { tier: 3, text: '· ■ Beacon', ink: 'rgb(124, 46, 23)' },
] as const;

for (const { tier, text, ink } of TIERS) {
  test(`overlay eyebrow renders tier ${tier} as "${text}"`, async ({ page }) => {
    // `&difficulty=` is the dev-only override (register.ts): the fixture encounters carry no
    // difficulty of their own, so without it every dev overlay would render Lantern via
    // difficultyOf's `?? 2` and only one of these three tiers could ever be shot.
    await page.goto(`/?overlay=mcq&seed=7&difficulty=${tier}`);
    await waitReady(page);
    await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 30_000 });

    const eyebrow = page.locator('.fw-difficulty');
    await expect(eyebrow).toHaveText(text);
    // The tier is colour-coded too — and specifically with `panelInk`, the parchment-ground
    // colour, NOT the bright `tint` the Phaser canvas uses. Painting the badge with the tint
    // put Lantern's gold at 1.1:1 on the cream panel; engine.test.ts owns the contrast floor,
    // this owns the plumbing that actually delivers the right colour to the DOM.
    await expect(eyebrow).toHaveCSS('color', ink);

    // Settle: the overlay fades in, so an immediate shot catches a half-transparent card over
    // the boot screen. Wait for the fade to finish before capturing evidence.
    await expect
      .poll(() => page.locator('.fw-overlay').evaluate((n) => getComputedStyle(n).opacity), { timeout: 10_000 })
      .toBe('1');
    await page.locator('.fw-overlay').screenshot({ path: `${EV}/e2e-difficulty-eyebrow-tier${tier}.png` });
  });
}

/** Every mcq answer string in the installed vc-law pack, read through the SAME bridge route the
 *  engine loads from — so the difficulties here are the sidecar-merged ones the board will use. */
async function vcLawMcqs(page: Page): Promise<Array<{ id: string; answer: string; difficulty?: number }>> {
  return page.evaluate(async () => {
    const r = await fetch('/api/packs');
    const body = (await r.json()) as {
      packs: Array<{ id: string; pack: { encounters: Array<{ id: string; kind: string; answer?: unknown; difficulty?: number }> } }>;
    };
    const vc = body.packs.find((p) => p.id === 'vc-law');
    if (!vc) return [];
    return vc.pack.encounters
      .filter((e) => e.kind === 'mcq' && typeof e.answer === 'string')
      .map((e) => ({ id: e.id, answer: e.answer as string, difficulty: e.difficulty }));
  });
}

/**
 * Launch a real battle and drive a T1 Smite until its mcq overlay is open and answerable.
 * rank=1 pins the T1 direct-cast path (castGatedSpell only runs for tier > 1) — the path §10's
 * P1 note called unreachable until it was wired, so this guards that wiring too.
 */
async function openSmiteDraw(page: Page) {
  await page.goto('/?scene=combat&seed=7&rank=1&demo=1');
  await waitReady(page, 'combat');

  const answers = await vcLawMcqs(page);
  test.skip(answers.length === 0, 'vc-law is not installed in this checkout');

  // Every mcq the draw could land on must be classified — otherwise a green run would prove
  // nothing about the gate (an unclassified pack keeps the rider dormant by design, §5).
  expect(
    answers.filter((a) => a.difficulty === undefined).map((a) => a.id),
    'the installed vc-law pack is fully classified',
  ).toEqual([]);

  await setPilot(page, 'smite');
  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 60_000 });

  // The eyebrow proves REAL classified content reached the board (not the packless fixture).
  await expect(page.locator('.fw-difficulty'), 'the drawn encounter carries a difficulty eyebrow')
    .toBeVisible();

  // Answer correctly by matching the rendered option against the pack's own answer strings.
  const known = new Set(answers.map((a) => a.answer));
  const opts = page.locator('.fw-opt');
  await expect.poll(() => opts.count(), { timeout: 15_000 }).toBeGreaterThan(0);
  const labels = await opts.allTextContents();
  const correctIndex = labels.findIndex((l) => known.has(l.trim()) || [...known].some((k) => l.includes(k)));
  expect(correctIndex, `one rendered option matched a vc-law answer (saw: ${JSON.stringify(labels)})`)
    .toBeGreaterThanOrEqual(0);

  // The draw must be Lantern-or-harder, or a T1 Smite cannot punch up at all (§4).
  const drawn = answers.find((a) => labels.some((l) => l.includes(a.answer)));
  expect(drawn?.difficulty ?? 0, `the draw (${drawn?.id}) is Lantern-or-harder`).toBeGreaterThan(1);

  return { opts, correctIndex, drawn };
}

/** Commit the chosen option and wait for the overlay to tear itself down (a correct mcq
 *  auto-resolves — no continue click). */
async function answerAndResolve(page: Page, opts: ReturnType<Page['locator']>, index: number) {
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored answer guard
  await opts.nth(index).click();
  await page.locator('.fw-overlay').waitFor({ state: 'detached', timeout: 20_000 });
}

test('a real vc-law draw lights the §4 rider banner on a q1 T1 Smite', async ({ page }) => {
  test.setTimeout(120_000);
  const { opts, correctIndex } = await openSmiteDraw(page);
  await answerAndResolve(page, opts, correctIndex);

  // THE PROOF: the rider's own banner line, stacked under the spell's base banner (§4.2).
  await expect
    .poll(() => bannerText(page), { timeout: 20_000, message: 'the rider banner line appeared' })
    .toContain(RIDER_LINE);

  await page.screenshot({ path: `${EV}/e2e-difficulty-rider-banner.png` });
});

test('the same draw stays dormant when the §5 gate is off', async ({ page }) => {
  test.setTimeout(120_000);
  const { opts, correctIndex } = await openSmiteDraw(page);

  // Force the classification gate off AFTER loadContent() has settled (the overlay being open
  // proves it has), so this measures the gate alone — same encounter, same tier, same q1.
  // Without this counter-proof the test above could pass for reasons unrelated to §5.
  await page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { debugSetPackReady?(r: boolean): void } | undefined;
    s?.debugSetPackReady?.(false);
  });

  await answerAndResolve(page, opts, correctIndex);

  // The hit still lands and still banners — only the rider line is gone (§6's honesty
  // principle: the banner never claims a reward the player did not earn).
  await expect.poll(() => bannerText(page), { timeout: 20_000 }).not.toBe('');
  expect(await bannerText(page), 'no rider line with the gate off').not.toContain(RIDER_LINE);
});

/** Force the ?demo autopilot to prefer one action kind (mirrors combat.spec.ts's own helper). */
async function setPilot(page: Page, kind: string | null): Promise<void> {
  await page.evaluate((k) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { setPilotPreference?(k: string | null): void } | undefined;
    s?.setPilotPreference?.(k);
  }, kind);
}

/** The HUD banner's current text (CombatScene's e2e-only debug read). */
async function bannerText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { bannerText?(): string } | undefined;
    return s?.bannerText?.() ?? '';
  });
}
