import { defineConfig, devices } from '@playwright/test';

/**
 * Living Outline browser acceptance.
 *
 * This suite owns port 5414 and uses scratch state outside the repository. The
 * server still reads the real atlas, source corpus, lecture index, reader, and
 * checked-in Workshop publication; only mutable state is redirected.
 */
export default defineConfig({
  testDir: './secreg/tests/e2e',
  testMatch: 'living-outline.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: '/private/tmp/learning-outline-playwright-results',
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    baseURL: 'http://127.0.0.1:5414',
    colorScheme: 'light',
    trace: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'python3 secreg/serve.py --port 5414',
    url: 'http://127.0.0.1:5414/app/',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      STATE_DIR: '/private/tmp/learning-outline-e2e-state',
      WORKSHOP_DIR: '/private/tmp/learning-outline-e2e-workshop',
      JUDGE_MODE: 'stub',
      PYTHONDONTWRITEBYTECODE: '1',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
