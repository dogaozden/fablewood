import { defineConfig, devices } from '@playwright/test';

/**
 * Task 1b (2026-09-04-program, Pack #2 secreg) item 1.4 — the real proof that
 * vc-law + secreg interleave. playwright.interleave.config.ts's rig (own file,
 * same comment) proves the draw service's cross-pack spread against two small
 * FIXTURE packs; this config proves the same mechanism against the REAL,
 * installed `packs/` directory (vc-law + secreg) instead. Own port —
 * never 5173 (the author's live play server), never 5175 (the shared e2e server),
 * never 5407 (dragdrop), never 5408 (the fixture interleave rig), never 5461
 * (amendments), never 5599 (Of Counsel) — this one owns 5412. STATE_DIR is a
 * gitignored in-repo scratch dir, so state/ is never touched.
 *
 * Separate testDir so `npm run e2e:interleave` (which points PACKS_DIR at the
 * fixture packs) never picks this spec up, and this config never picks up the
 * fixture-pack specs. JUDGE_MODE=stub matches every other e2e config here —
 * secreg's free_recall encounters could be drawn, and the drill must stay
 * deterministic.
 */
export default defineConfig({
  testDir: './e2e-real-packs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:5412', trace: 'off', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev -- --port 5412 --strictPort',
    url: 'http://localhost:5412',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PACKS_DIR: 'packs',
      STATE_DIR: '.state-e2e-real-packs',
      JUDGE_MODE: 'stub',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
