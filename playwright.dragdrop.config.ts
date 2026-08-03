import { defineConfig, devices } from '@playwright/test';

/**
 * Order-kind drag-to-reorder e2e (encounters/kinds.ts renderOrder's pointer-events drag).
 *
 * Its own everything, for the same reason playwright.config.ts / playwright.amendments.config.ts
 * keep their own: never 5173 (the author's live play server), never 5175 (the shared e2e server),
 * never 5461 (amendments) — this one owns 5407. STATE_DIR is a gitignored scratch dir, so
 * state/ is never touched; JUDGE_MODE=stub keeps the Clerk deterministic. No PACKS_DIR override
 * is needed — the ?overlay=order dev harness (register.ts) opens the packless fixture encounter
 * directly, same as playwright.config.ts's own e2e/encounters.spec.ts.
 */
export default defineConfig({
  testDir: './e2e-dragdrop',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5407', trace: 'on-first-retry', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 5407 --strictPort',
    url: 'http://localhost:5407',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { STATE_DIR: '.state-e2e-dragdrop', JUDGE_MODE: 'stub' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
