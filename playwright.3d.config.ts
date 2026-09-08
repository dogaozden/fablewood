import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'fablewood3d.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chromium',
    baseURL: 'http://127.0.0.1:5420',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5420 --strictPort',
    url: 'http://127.0.0.1:5420',
    reuseExistingServer: false,
    env: { PACKS_DIR: 'e2e/fixtures/packs-vc-law', STATE_DIR: '.state-e2e-3d', JUDGE_MODE: 'stub' },
  },
});
