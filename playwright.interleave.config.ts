import { defineConfig, devices } from '@playwright/test';

/**
 * The two-pack interleave rig (Wave 1 "the Draw Service" — 2026-08-03-wave1-draw-service
 * task 6/7). Its own everything, for the same reason playwright.amendments.config.ts keeps
 * its own: never 5173 (the author's live play server), never 5175 (the shared e2e server), never
 * 5461 (the amendments rig) — this one owns 5408. PACKS_DIR points at TWO fixture packs
 * (fx-alpha, fx-beta) so a real install with more than one pack exists for the Wellspring
 * drill to draw from; STATE_DIR is a gitignored scratch dir, so state/ is never touched.
 *
 * Separate testDir so `npm run e2e` (which runs against the real packs dir, where these
 * fixtures are not installed) never picks these specs up. JUDGE_MODE=stub (same as every
 * other e2e config here) because both fixture packs carry free_recall encounters (needed
 * to clear validate_pack.mjs's all-5-kinds threshold) and the drill could draw one.
 */
export default defineConfig({
  testDir: './e2e-interleave',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:5408', trace: 'off', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 5408 --strictPort',
    url: 'http://localhost:5408',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PACKS_DIR: 'e2e-interleave/fixture-packs',
      STATE_DIR: '.state-e2e-interleave',
      JUDGE_MODE: 'stub',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
