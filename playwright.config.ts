import { defineConfig, devices } from '@playwright/test';

// e2e drives the real dev server. STATE_DIR is redirected to a gitignored dir so tests
// never touch the precious state/ tree; JUDGE_MODE=stub makes the Laconic Clerk deterministic
// (no live claude -p in tests). Serial (workers:1) so specs that write shared state/*.json
// don't race, and retries:0 so the flake gate is honest.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'on-first-retry', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { STATE_DIR: '.state-e2e', JUDGE_MODE: 'stub' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
