import { test, expect, type Page } from '@playwright/test';
import { openOverlay, waitReady } from './helpers';

// "Reclaimed from the Fade" (fun-review.md §3.1), end to end through the real SRS store.
// The rule is exhaustively unit-tested (app/src/srs/redemption.test.ts, 30 cases); this proves
// the VERDICT-MOMENT beat renders — the chip + a Clerk line — and that combat tallies it.
// Deterministic: seed a fact's PRIOR history straight through the dev bridge, then answer.

const EV = 'screenshots';

// The three Clerk lines, verbatim (one is chosen per fact by a stable hash — see redemption.ts).
const CLERK_LINES = [
  'The Fade held this one, once. It holds it no longer.',
  "Struck from the Fade's column. Entered in yours.",
  'Lost once. Kept now. The Ledger remembers both.',
];

type Entry = { box: number; next_due: number; history: Array<{ ts: string; quality: 0 | 0.5 | 1; encounter_id: string }> };

function hist(qualities: Array<0 | 0.5 | 1>): Entry {
  const now = Date.now();
  return {
    box: 1,
    next_due: now - 5_000, // due, so combat's picker will prefer it
    history: qualities.map((q, i) => ({
      ts: new Date(now - (qualities.length - i) * 10_000).toISOString(),
      quality: q,
      encounter_id: `seed-${i}`,
    })),
  };
}

async function seedSrs(page: Page, facts: Record<string, Entry>): Promise<void> {
  const res = await page.request.put('/api/state/srs.json', { data: { version: 1, facts } });
  expect(res.ok(), 'seeded state/srs.json through the dev bridge').toBe(true);
}

/** Wait for the chip's bloom-in animation to REST at full opacity before capturing evidence —
 *  a screenshot mid-fade reads as a washed-out, half-legible chip. */
async function waitChipSettled(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.querySelector('.fw-reclaim');
          return el ? parseFloat(getComputedStyle(el).opacity) : 0;
        }),
      { timeout: 3000 },
    )
    .toBeGreaterThan(0.98);
}

type Snap = { state: string; reclaimed: number; newWelds: number } | null;
async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as Snap;
  });
}

test.describe('reclaimed from the fade — the redemption bell', () => {
  test('mcq: answering a once-missed fact q1 rings the bell with a Clerk line', async ({ page }) => {
    // mf-glow carries an uncleared miss; the fixture fx-mcq asks it, correct answer "The third week".
    await seedSrs(page, { 'mf-glow': hist([0]) });
    await openOverlay(page, 'mcq');
    await expect(page.locator('.fw-eyebrow')).toContainText('Smite');
    await page.waitForTimeout(600); // past the 400ms arm guard + margin for srs.ready() to load the seed

    await page.locator('.fw-opt', { hasText: 'The third week' }).click();

    const chip = page.locator('.fw-reclaim');
    await expect(chip, 'the redemption chip renders at the verdict').toBeVisible();
    await expect(chip.locator('.fw-reclaim-label')).toHaveText('Reclaimed from the Fade');
    const line = ((await chip.locator('.fw-reclaim-line').textContent()) ?? '').trim();
    expect(CLERK_LINES, 'the bell shows one of the three verbatim Clerk lines').toContain(line);
    await waitChipSettled(page);
    await page.screenshot({ path: `${EV}/e2e-redemption-chip.png` });
  });

  test('no bell when the miss was already cleared (self-retired watermark)', async ({ page }) => {
    // [0,1] — missed, then already reclaimed; the q1 is the watermark, so a fresh pass must NOT bell.
    await seedSrs(page, { 'mf-glow': hist([0, 1]) });
    await openOverlay(page, 'mcq');
    await page.waitForTimeout(600);

    await page.locator('.fw-opt', { hasText: 'The third week' }).click();
    await expect(page.locator('.fw-verdict.pass')).toBeVisible();
    // the chip (if any) is inserted synchronously with the verdict; assert its absence retryably.
    await expect(page.locator('.fw-reclaim'), 'no bell without a pending miss').toHaveCount(0);
  });

  test('combat: a redeemed Cast rings the bell and increments the run reclaimed tally', async ({ page }) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    // Seed EVERY installed fact with an uncleared miss (content-agnostic), so whichever fact the
    // first Cast draws is a redemption. Then answer it correctly (stub-judge pass = q1).
    const packsRes = await page.request.get('/api/packs');
    expect(packsRes.ok()).toBe(true);
    const { packs } = (await packsRes.json()) as { packs: Array<{ pack?: { facts?: Array<{ id: string }> } }> };
    const facts: Record<string, Entry> = {};
    for (const entry of packs) for (const f of entry.pack?.facts ?? []) facts[f.id] = hist([0]);
    expect(Object.keys(facts).length, 'the installed pack has facts to seed').toBeGreaterThan(0);
    await seedSrs(page, facts);
    // Full pool so the party survives long enough to Cast (the shared STATE_DIR may carry a
    // near-death HP left by a prior spec's wipe).
    await page.request.put('/api/state/save.json', { data: { hp: 16 } });

    await page.goto('/?scene=combat&seed=7&demo=1');
    await waitReady(page, 'combat');
    await setPilot(page, 'cast');

    // ?demo autopilot pilots grid movement/targeting; setPilot('cast') makes it open a Cast.
    try {
      await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 45_000 });
    } catch {
      const st = await snap(page);
      throw new Error(`cast overlay never opened; combat=${JSON.stringify(st)} pageerrors=${pageErrors.slice(0, 3).join(' | ')}`);
    }
    await page.waitForTimeout(450);
    // A terse, correct answer clears the stub judge's keyword bar → a real PASS (see combat.spec).
    await page.locator('.fw-textarea').fill('Economics and control.');
    await page.getByRole('button', { name: 'Cast' }).click();

    const chip = page.locator('.fw-reclaim');
    await expect(chip, 'the bell rings on the Cast verdict').toBeVisible({ timeout: 15_000 });
    await expect(chip.locator('.fw-reclaim-label')).toHaveText('Reclaimed from the Fade');
    await waitChipSettled(page);
    await page.screenshot({ path: `${EV}/e2e-redemption-chip-combat.png` });

    await page.getByRole('button', { name: 'Onward ▸' }).click();
    // the per-run tally increments once the answer is recorded (read via the combat debug snapshot).
    await expect
      .poll(async () => (await snap(page))?.reclaimed ?? 0, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1);
  });
});

/** Force the ?demo autopilot to prefer one action kind (so the test drives WHICH move fires). */
async function setPilot(page: Page, kind: string | null): Promise<void> {
  await page.evaluate((k) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { setPilotPreference?(k: string | null): void } | undefined;
    s?.setPilotPreference?.(k);
  }, kind);
}
