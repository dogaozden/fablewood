import { test, expect, type Page } from '@playwright/test';
import { waitReady, waitHamletPlayer, warpHamletTo } from './helpers';

// fun-review §3.6b: hover name + one line of Fable-written flavor for the six named hamlet
// locations. Independent of the existing walk-proximity name label (untouched) — a real mouse
// hover over a location's world-space zone reveals name+flavor regardless of where the Keeper
// stands. Two of the six source lines named their location differently before the em-dash than
// this codebase's own display name; per the brief, the in-code name wins — asserted explicitly
// below (cottage, factor) and flagged in the task report.

const EV = 'screenshots';

type LocId = 'cottage' | 'tavern' | 'records' | 'wellspring' | 'gate' | 'factor';
type TipDebug = { alpha: number; name: string; blurb: string };
type ScreenPos = { x: number; y: number } | null;

// Expected on-screen text: in-code `name` (unchanged) + the flavor half of each fun-review line,
// verbatim. cottage/factor deliberately do NOT reuse the given lines' pre-em-dash names
// ("The Keeper's Cottage", "Mira's Post") — see worldmap.ts's BUILDINGS comment.
const EXPECT: Record<LocId, { name: string; blurb: string }> = {
  tavern: { name: 'The Gilded Acorn', blurb: "ale, rumor, and the day's third-best advice." },
  records: { name: 'The Records Office', blurb: 'where the Clerk keeps what the Realm forgets.' },
  wellspring: { name: 'The Wellspring', blurb: 'old light rises where the first Oath was written.' },
  gate: { name: 'The South Gate', blurb: 'the road answers, if you brought some.' },
  cottage: { name: "Keeper's Cottage", blurb: 'a small door, a warm lamp, the flame well tended.' },
  factor: { name: 'Mira the Factor', blurb: 'the Factor weighs your gold, and now and then your judgment.' },
};

async function screenPos(page: Page, id: LocId): Promise<ScreenPos> {
  return page.evaluate((locId) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('hamlet') as { locationScreenPos?(id: string): ScreenPos } | undefined;
    return s?.locationScreenPos?.(locId) ?? null;
  }, id);
}

async function hoverTip(page: Page): Promise<TipDebug | null> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('hamlet') as { hoverTipDebug?(): TipDebug } | undefined;
    return s?.hoverTipDebug?.() ?? null;
  });
}

async function moveToCanvasPoint(page: Page, ix: number, iy: number): Promise<void> {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.move(box.x + (ix / 960) * box.width, box.y + (iy / 540) * box.height);
}

test.describe('hamlet location hover tooltip (fun-review §3.6b)', () => {
  for (const id of Object.keys(EXPECT) as LocId[]) {
    test(`hovering ${id} shows its name + flavor line, verbatim`, async ({ page }) => {
      await page.goto('/?seed=7');
      await waitReady(page, 'boot');
      await page.keyboard.press('Enter');
      await waitReady(page, 'hamlet');
      await waitHamletPlayer(page);

      const warped = await warpHamletTo(page, id);
      expect(warped, `dev warp hook found location '${id}'`).toBe(true);
      // let the follow-camera's lerp settle at the warped position before projecting world→screen
      await page.waitForTimeout(400);

      const pos = await screenPos(page, id);
      expect(pos, `${id} has a computed on-screen position`).toBeTruthy();
      await moveToCanvasPoint(page, pos!.x, pos!.y);

      await expect.poll(async () => (await hoverTip(page))?.alpha ?? 0, { timeout: 3000 }).toBeGreaterThan(0.98);
      const tip = await hoverTip(page);
      expect(tip?.name, `${id} tooltip name`).toBe(EXPECT[id].name);
      expect(tip?.blurb, `${id} tooltip blurb`).toBe(EXPECT[id].blurb);

      if (id === 'tavern') await page.screenshot({ path: `${EV}/e2e-hamlet-hover-tavern.png` });

      // move off the location — the tooltip fades back out
      await moveToCanvasPoint(page, 10, 10);
      await expect.poll(async () => (await hoverTip(page))?.alpha ?? 1, { timeout: 3000 }).toBeLessThan(0.02);
    });
  }
});
