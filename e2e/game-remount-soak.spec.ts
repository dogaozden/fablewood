import { test, expect } from '@playwright/test';
import { waitReady } from './helpers';

// Regression for crucible v1 finding V1-5: Phaser's VisibilityHandler
// (node_modules/phaser/src/core/VisibilityHandler.js:65) unconditionally does a bare
// `document.addEventListener('visibilitychange', onChange, false)` on every
// `new Phaser.Game()`, keeps that closure nowhere reachable, and `game.destroy()`
// (Game.js:749 runDestroy) never removes it — confirmed upstream gap, not a config
// option. Left alone, every PhaserGame mount/unmount cycle (e.g. a shell tab switch
// away from "Realms" and back — App.tsx conditionally mounts <PhaserGame/> per tab)
// leaks one more document-level listener forever: the original repro showed net count
// growing 1→21 over 20 cycles with DOM node count staying flat throughout (invisible to
// visual/DOM inspection alone). The fix (PhaserGame.tsx) intercepts the one
// addEventListener call VisibilityHandler makes, captures the listener reference, and
// removes it explicitly in the effect's cleanup.
//
// getEventListeners() is DevTools-only (not scriptable), so this instruments
// document.addEventListener/removeEventListener directly via page.addInitScript —
// installed before any page script runs, so it sees every add/remove for the page's
// entire lifetime regardless of how many times PhaserGame itself mounts/unmounts and
// layers its own temporary interception on top (the two compose: PhaserGame's wrapper
// always calls through to whatever addEventListener is current, native or counting).

const COUNT_VISIBILITYCHANGE_INIT = `(() => {
  window.__fwVisibilityNet = 0;
  const nativeAdd = document.addEventListener.bind(document);
  const nativeRemove = document.removeEventListener.bind(document);
  document.addEventListener = function (type, listener, options) {
    if (type === 'visibilitychange') window.__fwVisibilityNet += 1;
    return nativeAdd(type, listener, options);
  };
  document.removeEventListener = function (type, listener, options) {
    if (type === 'visibilitychange') window.__fwVisibilityNet -= 1;
    return nativeRemove(type, listener, options);
  };
})();`;

declare global {
  interface Window {
    __fwVisibilityNet?: number;
  }
}

async function visibilityNet(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => window.__fwVisibilityNet ?? NaN);
}

test.describe('PhaserGame remount — document visibilitychange listener leak (crucible v1 V1-5)', () => {
  test('30 tab-switch cycles leave the net listener count flat, not growing', async ({ page }) => {
    test.setTimeout(180_000);

    await page.addInitScript(COUNT_VISIBILITYCHANGE_INIT);
    await page.goto('/?scene=boot&seed=7'); // cheapest real scene — this soak only cares about mount/unmount
    await waitReady(page);

    expect(await visibilityNet(page)).toBe(1); // one mounted PhaserGame → Phaser's own one listener

    for (let cycle = 0; cycle < 30; cycle++) {
      await page.getByRole('button', { name: 'The Ledger' }).click(); // unmounts PhaserGame
      await expect(page.locator('.phaser-root')).toHaveCount(0);
      expect(await visibilityNet(page), `cycle ${cycle}: net count after unmount`).toBe(0);

      await page.getByRole('button', { name: 'Realms' }).click(); // remounts PhaserGame
      await waitReady(page);
      expect(await visibilityNet(page), `cycle ${cycle}: net count after remount`).toBe(1);
    }
  });
});
