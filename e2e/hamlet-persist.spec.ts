import { test, expect } from '@playwright/test';
import { waitReady, waitHamletPlayer, hamletPlayer, holdKey, waitForState } from './helpers';

type Save = { scene?: string; pos?: { x: number; y: number } };

// Regression: HamletScene persisted position/scene pointer on Phaser's SHUTDOWN event
// (fired when the scene transitions away, e.g. hamlet -> vaults) but NOT on DESTROY.
// Phaser's SceneManager.destroy() — run when the whole Game instance is torn down
// (PhaserGame.tsx's unmount cleanup calls game.destroy(true), e.g. when the shell
// switches away from the "Game" tab) — calls every scene's Systems.destroy() DIRECTLY,
// never shutdown(). So if the Keeper was still standing in the hamlet (never
// transitioned to another scene) when the shell unmounts the game, the position/scene
// pointer was silently dropped: SHUTDOWN never fired, only DESTROY did.
test('hamlet persists position when the whole game tears down mid-visit, not just on scene switch', async ({
  page,
}) => {
  await page.goto('/?scene=hamlet&seed=7');
  await waitReady(page, 'hamlet');
  await waitHamletPlayer(page);

  // Move off wherever the scene placed the player, with real input, well under the
  // 10s periodic autosave — the only thing that can persist THIS position is the
  // teardown path itself.
  await holdKey(page, 'ArrowDown', 220);
  const moved = await hamletPlayer(page);
  expect(moved, 'the hamlet player exists after moving').not.toBeNull();

  // Tear the WHOLE game down without ever switching scenes first (React unmounts
  // PhaserGame -> game.destroy(true) -> hamlet's DESTROY fires; SHUTDOWN never does).
  await page.getByRole('button', { name: 'The Ledger' }).click();
  await expect(page.locator('.phaser-root')).toHaveCount(0);

  const save = await waitForState<Save>(
    page,
    'save.json',
    (s) =>
      s?.scene === 'hamlet' &&
      Math.abs((s?.pos?.x ?? -9999) - moved!.x) <= 2 &&
      Math.abs((s?.pos?.y ?? -9999) - moved!.y) <= 2,
  );
  expect(save?.scene, 'scene pointer persisted on full game teardown').toBe('hamlet');
  expect(save?.pos, 'position persisted on full game teardown').toBeTruthy();
});
