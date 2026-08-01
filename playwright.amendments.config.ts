import { defineConfig, devices } from '@playwright/test';

/**
 * "The Ledger Amended" e2e (docs/design/supersession-reteach.md §9).
 *
 * Its own everything, for the same reason playwright.config.ts keeps its own: never 5173
 * (the author's live play server) and never 5175 (the shared e2e server) — this one owns 5461.
 * PACKS_DIR points at the FIXTURE pack carrying the superseded pairs, so vc-law needs zero
 * content changes and the real packs are never loaded here; STATE_DIR is a gitignored
 * scratch dir, so state/ is never touched; JUDGE_MODE=stub keeps the Clerk deterministic.
 *
 * Separate testDir so `npm run e2e` (which runs against the real packs dir, where these
 * fixtures are not installed) never picks these specs up.
 */
export default defineConfig({
  testDir: './e2e-amendments',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:5461', trace: 'off', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 5461 --strictPort',
    url: 'http://localhost:5461',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PACKS_DIR: 'e2e/fixtures/packs',
      STATE_DIR: '.state-e2e-amendments',
      JUDGE_MODE: 'stub',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
