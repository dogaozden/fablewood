import { test, expect, type Page } from '@playwright/test';
import { waitReady, currentScene, readState, waitForState } from './helpers';

type Save = { scene?: string; hp?: number; dungeon?: { roomIndex: number; cleared: string[] } };

// Restoring the snapshot with a bare PUT races the live scene's own persist writes
// (vaults persists on entry; last-writer-wins on disk) — under full-suite load the
// app's write can land AFTER the restore and poison the next spec's boot target.
// Quiesce the page first, then put-and-verify until the file actually holds the
// snapshot's scene pointer.
async function restoreSave(page: Page, snapshot: Save | undefined): Promise<void> {
  const data = snapshot ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
  await page.goto('about:blank'); // kill the app context — no more scene writes
  for (let i = 0; i < 5; i++) {
    await page.request.put('/api/state/save.json', { data });
    await new Promise((r) => setTimeout(r, 150));
    const now = (await page.request
      .get('/api/state/save.json')
      .then((r) => r.json())
      .catch(() => undefined)) as Save | undefined;
    if (now?.scene === data.scene) return;
  }
  throw new Error('restoreSave: save.json never settled on the restored snapshot');
}

// Regression for crucible finding #14: a hard reload with no ?scene= URL override always
// hard-coded to the hamlet, ignoring the saved scene pointer (BootScene.ts's enter() used
// to call `this.scene.start('hamlet', ...)` unconditionally). BootScene now reads
// save.scene once services.save is ready and resumes there — 'vaults' is the only other
// value ever persisted (DungeonScene/HamletScene never write 'combat'; combat state is
// deliberately never persisted), so anything else, including no save yet, still falls
// back to 'hamlet' unchanged.
//
// This spec seeds save.scene:'vaults' via the existing ?auto=camp dev driver
// (DungeonScene.onCamp({persist:true}) -> services.save.save({ scene: 'vaults', ... })) —
// far cheaper than replaying the full hamlet -> South Gate -> vaults walk — then does a
// bare '/' reload (no ?scene=) and asserts the vaults resume.
//
// e2e specs share one on-disk state dir (playwright.config.ts: workers:1, STATE_DIR:
// .state-e2e), and OTHER specs (e.g. chain.spec.ts) assume a fresh '/' boot defaults to
// the hamlet. This spec snapshots save.json before it seeds vaults and restores that
// exact snapshot in a `finally`, so it never leaks state to specs that run after it —
// alphabetically, this file sorts before every existing spec.
test('hard reload resumes the saved scene pointer (vaults), not a hard-coded hamlet', async ({
  page,
}) => {
  test.setTimeout(150_000); // headroom for CI's cold first-compile (see helpers.waitReady)

  const before = await readState<Save>(page, 'save.json');

  try {
    // Seed scene:'vaults' via the dev auto-driver's camp branch.
    await page.goto('/?scene=vaults&seed=7&auto=camp');
    await waitReady(page, 'vaults');
    await waitForState<Save>(page, 'save.json', (s) => s?.scene === 'vaults');

    // The true hard-reload path: bare '/', no ?scene= override — BootScene must read
    // save.scene once ready() resolves and route enter() there instead of the hamlet.
    await page.goto('/?seed=7');
    await waitReady(page, 'boot');
    await page.keyboard.press('Enter');
    await waitReady(page, 'vaults');
    expect(await currentScene(page)).toBe('vaults');
  } finally {
    // Leave shared e2e state exactly as found (or a safe default if there was none yet).
    await restoreSave(page, before);
  }
});

// The unchanged half of the contract: with no saved scene pointer (or an unrecognized
// one), a hard reload still defaults to the hamlet — same assertion chain.spec.ts's own
// first step already relies on, made explicit and self-contained here.
test('hard reload with no saved scene pointer still defaults to the hamlet', async ({ page }) => {
  test.setTimeout(150_000);

  const before = await readState<Save>(page, 'save.json');

  try {
    await page.request.put('/api/state/save.json', {
      data: { scene: 'nonsense', hp: 16, streak: 0, lastPlayed: '' },
    });

    await page.goto('/?seed=7');
    await waitReady(page, 'boot');
    await page.keyboard.press('Enter');
    await waitReady(page, 'hamlet');
    expect(await currentScene(page)).toBe('hamlet');
  } finally {
    await restoreSave(page, before);
  }
});
