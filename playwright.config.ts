import { defineConfig, devices } from '@playwright/test';

// e2e drives the real dev server. STATE_DIR is redirected to a gitignored dir
// so tests never touch the precious state/ tree.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'on-first-retry' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { STATE_DIR: '.state-e2e' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
