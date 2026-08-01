import { test, expect, type Page } from '@playwright/test';
import { waitReady } from './helpers';

// fun-review §3.6a: "Let the map be a place… names visible on hover everywhere, one line of
// flavor per node." VaultView already always shows a room's name under its node; this proves
// the NEW hover/focus tooltip additionally surfaces the pack-provided blurb (rooms[].blurb in
// packs/vc-law/assets/preference-vaults.dungeon.json) — read through the same DungeonSpec the
// engine already loads, not duplicated. Node coordinates (225,300 = room 0; 96,300 = camp)
// match chain.spec.ts's own established canvas-click math for this map.

const EV = 'screenshots';

type TipDebug = { alpha: number; name: string; blurb: string } | null;

async function tooltip(page: Page): Promise<TipDebug> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as
      | { scene?: { getScene?(k: string): unknown } }
      | undefined;
    const s = g?.scene?.getScene?.('vaults') as { tooltipDebug?(): TipDebug } | undefined;
    return s?.tooltipDebug?.() ?? null;
  });
}

async function hoverCanvas(page: Page, ix: number, iy: number): Promise<void> {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.move(box.x + (ix / 960) * box.width, box.y + (iy / 540) * box.height);
}

test.describe('vault map node hover tooltip (fun-review §3.6a)', () => {
  test('hovering the first room node shows its real pack name + blurb; unhover hides it', async ({
    page,
  }) => {
    // direct scene load of the REAL installed vc-law pack (no dev=1 fixture) — same idiom
    // chain.spec.ts's own reload-check step uses (`/?scene=vaults&seed=7`).
    await page.goto('/?scene=vaults&seed=7');
    await waitReady(page, 'vaults');

    await expect.poll(async () => (await tooltip(page))?.alpha ?? 1, { timeout: 5000 }).toBeLessThan(0.02);

    await hoverCanvas(page, 225, 300); // room 0's node — "The Threshold Ledger"
    await expect.poll(async () => (await tooltip(page))?.alpha ?? 0, { timeout: 3000 }).toBeGreaterThan(0.98);

    const t = await tooltip(page);
    expect(t?.name).toBe('The Threshold Ledger');
    expect(t?.blurb).toBe(
      'A lantern-lit antechamber of ledgers. The Clerk asks what truly moves a term sheet before the vault will open.',
    );
    await page.screenshot({ path: `${EV}/e2e-vault-node-tooltip.png` });

    // move off the node entirely — the tooltip fades back out
    await hoverCanvas(page, 480, 30);
    await expect.poll(async () => (await tooltip(page))?.alpha ?? 1, { timeout: 3000 }).toBeLessThan(0.02);
  });

  test('hovering the camp node shows its name with no blurb (Camp is not a pack room)', async ({
    page,
  }) => {
    await page.goto('/?scene=vaults&seed=7');
    await waitReady(page, 'vaults');

    await hoverCanvas(page, 96, 300); // camp node, leftmost on the strip
    await expect.poll(async () => (await tooltip(page))?.alpha ?? 0, { timeout: 3000 }).toBeGreaterThan(0.98);

    const t = await tooltip(page);
    expect(t?.name).toBe('The Camp');
    expect(t?.blurb).toBe('');
  });
});
