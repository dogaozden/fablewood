import { defineConfig, devices } from '@playwright/test';

// e2e always spawns ITS OWN dev server on a dedicated port (5175), never the real one on
// 5173: reusing a live play server would silently bypass this env block and point tests at
// the REAL Laconic Clerk and the precious state/ tree (it happened once — a test run flipped
// a live save's scene pointer). STATE_DIR is redirected to a gitignored dir and JUDGE_MODE=stub
// makes the Clerk deterministic. Serial (workers:1) so specs that write shared state *.json
// don't race, and retries:0 so the flake gate is honest.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5175', trace: 'on-first-retry', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 5175 --strictPort',
    url: 'http://localhost:5175',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { STATE_DIR: '.state-e2e', JUDGE_MODE: 'stub' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
