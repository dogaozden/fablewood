// Original 2D regression coverage uses renderer=classic; fablewood3d.spec.ts covers the new default entry.
import { test, expect } from '@playwright/test';
import { waitReady, waitForState } from './helpers';

const EV = 'screenshots';
const DAY = 86_400_000;

// Real vc-law facts (packs/vc-law/pack.json has 42) so statements/box-counts are
// genuine, not fixture strings — same seeding style as combat.spec.ts's Satchel
// test (a direct PUT to state/*.json before navigating; wellspring-srs.spec.ts
// plays for real instead, it doesn't actually seed a fixture).
test.describe('Dashboard + Settings', () => {
  test('Dashboard renders seeded mastery, due forecast, streak/history, and weakest bindings', async ({ page }) => {
    test.setTimeout(60_000);
    const now = Date.now();
    const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

    await page.request.put('/api/state/srs.json', {
      data: {
        version: 1,
        facts: {
          // box 3, overdue → "today"; 3 consecutive full passes (most recent globally) → streak 3
          'vc.econ.overview.economics-vs-control': {
            box: 3,
            next_due: now - 1000,
            history: [
              { ts: iso(30_000), quality: 1, encounter_id: 'e1' },
              { ts: iso(20_000), quality: 1, encounter_id: 'e2' },
              { ts: iso(10_000), quality: 1, encounter_id: 'e3' },
            ],
          },
          // box 2, due in 20 days → excluded from the 7-day forecast entirely
          'vc.econ.overview.preferred-vs-common': {
            box: 2,
            next_due: now + 20 * DAY,
            history: [
              { ts: iso(9 * DAY), quality: 1, encounter_id: 'e4' },
              { ts: iso(8 * DAY), quality: 1, encounter_id: 'e5' },
            ],
          },
          // box 1, overdue, latest (only) answer is a MISS 40s ago → weakest binding #1 (most recent)
          'vc.econ.valuation.pre-vs-post-money': {
            box: 1,
            next_due: now - 5000,
            history: [{ ts: iso(40_000), quality: 0, encounter_id: 'e6' }],
          },
          // box 1, overdue, latest (only) answer is a MISS 50s ago → weakest binding #2 (older miss)
          'vc.econ.valuation.pre-post-ambiguity-trap': {
            box: 1,
            next_due: now - 2000,
            history: [{ ts: iso(50_000), quality: 0, encounter_id: 'e7' }],
          },
          // 'vc.econ.valuation.clarify-pre-money-presumptively' deliberately left unseeded (box 0)
        },
      },
    });
    await page.request.put('/api/state/save.json', {
      data: { scene: 'hamlet', hp: 16, streak: 5, lastPlayed: iso(10 * 60 * 1000) },
    });

    await page.goto('/?renderer=classic');
    await waitReady(page);
    await page.getByRole('button', { name: 'The Ledger' }).click();
    await page.locator('.dash').waitFor({ state: 'visible' });

    // Mastery by province: 4 of the pack's 42 facts have been seen (welded).
    await expect(page.locator('.dash-domain-count')).toContainText('4 / 42');

    // Due forecast: all 3 seeded-due facts are overdue → always bucket "today"
    // regardless of what time of day the suite runs (robust to wall-clock timing).
    const forecastNums = page.locator('.dash-forecast strong');
    await expect(forecastNums.nth(0)).toHaveText('3'); // today
    await expect(forecastNums.nth(1)).toHaveText('0'); // tomorrow
    await expect(forecastNums.nth(2)).toHaveText('0'); // week (the 20-day fact is excluded)
    await expect(page.locator('.dash-card', { hasText: 'Due forecast' })).toContainText('the Ledger stirs');

    // Casting streak (from SRS history, NOT the save.json milestone counter): 3
    // consecutive full passes before the miss; 7 total casts; 5 passes / 7 = 71%.
    const castingCard = page.locator('.dash-card', { hasText: 'Casting streak' });
    await expect(castingCard.locator('.dash-stat')).toContainText('3');
    await expect(castingCard).toContainText('7 casts graded');
    await expect(castingCard).toContainText('71% pass rate (last 7)');

    // Vigil (existing, unrelated milestone counter — W6 rename off "Hearth streak") +
    // last-played still work.
    await expect(page.locator('.dash-card', { hasText: 'Vigil' }).locator('.dash-stat')).toContainText('5');
    await expect(page.locator('.dash-card', { hasText: 'Last Ledger entry' })).toContainText('min ago');

    // Weakest bindings: the two facts whose LATEST answer was a miss, most-recent
    // miss first, statement text only — never an answer/rubric.
    const weak = page.locator('.dash-weak-list li');
    await expect(weak).toHaveCount(2);
    await expect(weak.nth(0)).toContainText('Pre-money valuation is what the investor values');
    await expect(weak.nth(1)).toContainText("Do not assume a quoted 'valuation of $X'");

    await page.screenshot({ path: `${EV}/e2e-dashboard-seeded.png` });
  });

  test('Dashboard shows a warm invitation, not zeros, for a pack with zero history', async ({ page }) => {
    await page.request.put('/api/state/srs.json', { data: { version: 1, facts: {} } });
    await page.request.put('/api/state/save.json', {
      data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' },
    });

    await page.goto('/?renderer=classic');
    await waitReady(page);
    await page.getByRole('button', { name: 'The Ledger' }).click();
    await page.locator('.dash').waitFor({ state: 'visible' });

    await expect(page.locator('.dash-domain-count')).toContainText('0 / 42');
    await expect(page.locator('.dash-invite')).toContainText('The Ledger is freshly bound');
    // The zero-filled due-forecast/streak/pass-rate grid must NOT render here.
    await expect(page.locator('.dash-card', { hasText: 'Due forecast' })).toHaveCount(0);
  });

  test('Settings: volume slider persists across reload; mute stays consistent with the tab bar', async ({ page }) => {
    test.setTimeout(60_000);
    // Seed a known starting state — settings.json persists in .state-e2e across
    // separate `playwright test` invocations (unlike a fresh per-test page), so
    // this must not assume muted:false the way an untouched fresh run would have.
    await page.request.put('/api/state/settings.json', { data: { muted: false, volume: 100 } });

    await page.goto('/?renderer=classic');
    await waitReady(page);
    await page.getByRole('button', { name: /The Study/ }).click();
    await page.locator('.settings').waitFor({ state: 'visible' });

    // Judge latency section renders its empty state (no encounter has run yet).
    await expect(page.locator('.settings-judge')).toContainText('No verdict yet');

    // Move the slider via real keyboard interaction — range inputs have ambiguous
    // .fill() support, but Home/ArrowRight is native, deterministic, and fully
    // React-compatible (a genuine trusted input event, not a scripted value set).
    const slider = page.locator('.settings input[type="range"]');
    await expect(slider).toBeEnabled();
    await slider.focus();
    await page.keyboard.press('Home'); // → 0
    for (let i = 0; i < 42; i++) await page.keyboard.press('ArrowRight'); // → 42
    await expect(page.locator('.settings-value')).toHaveText('42');

    // Persistence is debounced (300ms) — poll state/settings.json until it lands.
    await waitForState(page, 'settings.json', (s) => (s as { volume?: number } | null)?.volume === 42);

    // Mute: toggle via the tab-bar button; Settings reflects the SAME state because
    // both are driven by one `muted` boolean lifted to App.tsx (never two sources
    // of truth to drift out of sync).
    // exact:true matters here — "Mute music" is a case-insensitive SUBSTRING of
    // "Unmute music", so a loose match could silently click the wrong toggle state.
    await page.getByRole('button', { name: 'Mute music', exact: true }).click();
    await expect(page.locator('.settings-music')).toContainText('Hushed');
    await expect(page.getByRole('button', { name: 'Unmute music', exact: true })).toBeVisible();

    await page.screenshot({ path: `${EV}/e2e-settings.png` });

    // Reload: the persisted volume must survive independent of React state.
    await page.goto('/?renderer=classic');
    await waitReady(page);
    await page.getByRole('button', { name: /The Study/ }).click();
    await page.locator('.settings').waitFor({ state: 'visible' });
    await expect(page.locator('.settings input[type="range"]')).toHaveValue('42');
  });
});
