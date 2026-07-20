/**
 * TRANSIENT probe config (combat-finisher agent) — NEVER COMMITTED.
 * Own dev server on 5176 (the shared e2e port 5175 and the author's live 5173 are untouched),
 * scratch STATE_DIR outside the repo, deterministic stub judge.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e-probe',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 240_000,
  use: { baseURL: 'http://localhost:5176', trace: 'off', screenshot: 'off' },
  webServer: {
    command: 'npm run dev -- --port 5176 --strictPort',
    url: 'http://localhost:5176',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      STATE_DIR: '/tmp/fablewood-scratch',
      JUDGE_MODE: 'stub',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
