import { test, expect, type Page } from '@playwright/test';
import { waitReady } from './helpers';

// Crucible v1 #11 — combat action-menu labels/hints cut off with no ellipsis. New file
// (v1-fix-b owns hud.ts exclusively for this pass). The action row is drawn at a FIXED
// internal canvas resolution (960x540, Phaser Scale.FIT — see PhaserGame.tsx) regardless of
// the outer browser window, so the fix's geometry can't actually depend on viewport size; this
// file still verifies + screenshots at both a comfortable size and the game's stated 960x600
// minimum window, per the verification brief.

const EV = '/tmp/fablewood-scratch';

type Snap = { state: string } | null;
type MenuItem = { label: string; labelWidth: number; hint: string; hintWidth: number; buttonWidth: number };

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as Snap;
  });
}

async function actionMenuDebug(page: Page): Promise<MenuItem[]> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { actionMenuDebug?(): unknown } | undefined;
    return (s?.actionMenuDebug?.() ?? []) as MenuItem[];
  });
}

/** Poll until the Keeper's own turn opens (state==='playerMove'), so the 8-button action menu
 *  has actually been drawn (showMenu is only called there). */
async function waitForKeeperTurn(page: Page, timeout = 20_000): Promise<Snap> {
  const start = Date.now();
  let s = await snap(page);
  while (s?.state !== 'playerMove' && Date.now() - start < timeout) {
    await page.waitForTimeout(150);
    s = await snap(page);
  }
  return s;
}

/** The exact inner-width budget hud.ts's fix clamps text to: label/hint both start at local x
 *  `-bw/2+40` and stop 6px short of the button's right edge (`bw/2-6`) — availW = bw-46.
 *  A small epsilon tolerates Phaser's own sub-pixel text-metric rounding. */
function fitsButton(widthPx: number, buttonWidth: number): boolean {
  return widthPx <= buttonWidth - 46 + 0.5;
}

async function checkMenuFits(page: Page): Promise<MenuItem[]> {
  const items = await actionMenuDebug(page);
  expect(items.length, 'all 8 ActionKinds render as buttons (post-Satchel row)').toBe(8);
  for (const item of items) {
    expect(fitsButton(item.labelWidth, item.buttonWidth), `label "${item.label}" (${item.labelWidth}px) must fit its ${item.buttonWidth}px button`).toBe(true);
    expect(fitsButton(item.hintWidth, item.buttonWidth), `hint "${item.hint}" (${item.hintWidth}px) must fit its ${item.buttonWidth}px button`).toBe(true);
  }
  return items;
}

test('crucible v1 #11: all 8 action-menu labels/hints fit their button, ellipsizing rather than overflowing — at 1280x800', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  const opened = await waitForKeeperTurn(page);
  expect(opened?.state).toBe('playerMove');

  const items = await checkMenuFits(page);
  await page.screenshot({ path: `${EV}/v1fix11-actionmenu-1280x800.png` });

  // The 3 labels the finding specifically named as overflowing at 8 buttons/112px must now
  // show a trailing ellipsis — proof of a VISIBLE truncation, not merely "happens to fit now".
  const weave = items.find((i) => i.label.startsWith('Binding'));
  const sequence = items.find((i) => i.label.startsWith('Ritual'));
  const cast = items.find((i) => i.label.startsWith('Cast'));
  for (const it of [weave, sequence, cast]) {
    expect(it, 'the named long label renders on the 8-button row').toBeTruthy();
    expect(it!.label.endsWith('…'), `"${it!.label}" must be visibly truncated, not silently cut`).toBe(true);
  }
});

test('crucible v1 #11: the same fit invariant holds at the 960x600 minimum window', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 960, height: 600 });
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');
  const opened = await waitForKeeperTurn(page);
  expect(opened?.state).toBe('playerMove');

  await checkMenuFits(page);
  await page.screenshot({ path: `${EV}/v1fix11-actionmenu-960x600.png` });
});
