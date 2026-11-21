import { defineConfig, devices } from '@playwright/test';

// Plays the bundled demo pack end to end (hamlet → gate → dungeon → combat) with a stub judge
// and isolated state. DEMO_SHOTS sets the screenshot directory.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'demo-quest.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5176',
    ...devices['Desktop Chrome'],
    launchOptions: process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {},
  },
  webServer: {
    command: 'npm run dev -- --port 5176 --strictPort',
    url: 'http://localhost:5176',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PACKS_DIR: 'packs', STATE_DIR: '.state-demo', JUDGE_MODE: 'stub' },
  },
});
