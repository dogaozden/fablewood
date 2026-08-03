import { test, expect, type Page } from '@playwright/test';
import { openOverlay } from '../e2e/helpers';

/**
 * Order-kind (Ritual Sequence) drag-to-reorder — encounters/kinds.ts's renderOrder pointer-
 * events implementation. the author's live-playtest report: the row grip handles show, but arranging
 * only ever worked via the ▲▼ arrow buttons — actual drag-and-drop "either doesn't exist or
 * doesn't work." (Truth: it existed as HTML5 draggable wiring, but that API is unreliable in
 * the Tauri/WKWebView shell the game ships in, which is why it read as dead to a real player.)
 *
 * Driven with REAL page.mouse.down/move/up sequences against the pointer-event implementation —
 * deterministic, no HTML5-DnD simulation hacks. Own server (5407) + own STATE_DIR
 * (playwright.dragdrop.config.ts) — never the shared e2e port (5175) or the author's live one (5173).
 * The ▲▼ arrow-button path itself is unchanged and stays covered by e2e/encounters.spec.ts.
 */

const SCREENSHOTS = 'screenshots';
const TARGET = ['Wait for the frost-bell', 'Gather at first light', 'Dry in lantern-glow', 'Bind with reed'];

async function currentLabels(page: Page): Promise<string[]> {
  return (await page.locator('.fw-steplabel').allInnerTexts()).map((t) => t.trim());
}

/** Real mouse press-drag-release: grabs the row currently showing `label` and drops it at
 *  on-screen slot `toIndex` (0-based, read BEFORE the gesture starts — the position other
 *  rows will part to make room for). No-ops if it's already there. */
async function dragRowTo(page: Page, label: string, toIndex: number): Promise<void> {
  const labels = await currentLabels(page);
  const fromIndex = labels.indexOf(label);
  expect(fromIndex, `"${label}" must be present`).toBeGreaterThanOrEqual(0);
  if (fromIndex === toIndex) return;

  const rows = page.locator('.fw-step');
  const fromBox = await rows.nth(fromIndex).boundingBox();
  const toBox = await rows.nth(toIndex).boundingBox();
  if (!fromBox || !toBox) throw new Error(`row bounding box missing (from=${fromIndex}, to=${toIndex})`);

  const x = fromBox.x + fromBox.width / 2;
  const startY = fromBox.y + fromBox.height / 2;
  const dir = toIndex > fromIndex ? 1 : -1;
  const endY = toBox.y + toBox.height / 2 + dir * 6; // past the slot's midpoint, not short of it

  await page.mouse.move(x, startY);
  await page.mouse.down();
  await page.mouse.move(x, startY + dir * 8, { steps: 3 }); // crosses the 4px drag threshold
  await page.mouse.move(x, endY, { steps: 10 }); // travels the rest of the way in real steps
  await page.mouse.up();
  await page.waitForTimeout(220); // let the .16s shift/indicator transition + render() settle
}

test.describe('order (Ritual Sequence) — drag-to-reorder', () => {
  test('dragging rows reorders them, and submitting after a drag grades correctly', async ({ page }) => {
    await openOverlay(page, 'order');
    await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard

    // selection-sort by dragging each target label directly to its slot — unlike the
    // arrow-button e2e (encounters.spec.ts), a single drag can cross several slots at once.
    for (let i = 0; i < TARGET.length; i++) {
      await dragRowTo(page, TARGET[i], i);
    }
    expect(await currentLabels(page)).toEqual(TARGET);

    await page.getByRole('button', { name: 'Seal the Sequence' }).click();
    await expect(page.locator('.fw-verdict.pass')).toBeVisible();
  });

  test('drag shows a lifted row + live drop indicator mid-gesture, and commits on release', async ({ page }) => {
    await openOverlay(page, 'order');
    await page.waitForTimeout(450);

    const labelsBefore = await currentLabels(page);
    const targetSlot = Math.min(2, labelsBefore.length - 1);
    const rows = page.locator('.fw-step');
    const fromBox = await rows.nth(0).boundingBox();
    const toBox = await rows.nth(targetSlot).boundingBox();
    if (!fromBox || !toBox) throw new Error('row bounding box missing');
    const x = fromBox.x + fromBox.width / 2;
    const startY = fromBox.y + fromBox.height / 2;
    const midY = toBox.y + toBox.height / 2;

    await page.mouse.move(x, startY);
    await page.mouse.down();
    await page.mouse.move(x, startY + 10, { steps: 3 }); // cross the threshold
    await page.mouse.move(x, midY, { steps: 10 });
    await page.waitForTimeout(200); // let the siblings' .16s shift settle for a crisp capture (still held)

    // mid-drag: the pressed row is lifted (scale/shadow) and a drop-indicator slot is visible.
    await expect(page.locator('.fw-step.is-lifted')).toBeVisible();
    await expect(page.locator('.fw-order-drop')).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOTS}/e2e-order-drag-mid.png` });

    await page.mouse.up();
    await page.waitForTimeout(250);

    // post-drop: the lifted/indicator state is gone, and the row actually moved to the slot.
    await expect(page.locator('.fw-step.is-lifted')).toHaveCount(0);
    await expect(page.locator('.fw-order-drop')).toHaveCount(0);
    const labelsAfter = await currentLabels(page);
    expect(labelsAfter).not.toEqual(labelsBefore);
    expect(labelsAfter[targetSlot]).toBe(labelsBefore[0]);
    await page.screenshot({ path: `${SCREENSHOTS}/e2e-order-drag-post.png` });
  });

  test('a plain click (no movement) still sets the active row — drag is additive, not a takeover', async ({
    page,
  }) => {
    await openOverlay(page, 'order');
    await page.waitForTimeout(450);
    const rows = page.locator('.fw-step');
    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveClass(/is-active/);
  });

  test('a drag that lands back on its own slot is a no-op (still gradeable)', async ({ page }) => {
    await openOverlay(page, 'order');
    await page.waitForTimeout(450);
    const before = await currentLabels(page);

    const rows = page.locator('.fw-step');
    const box = await rows.nth(0).boundingBox();
    if (!box) throw new Error('row bounding box missing');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 8, { steps: 3 }); // cross the threshold, lift the row…
    await page.mouse.move(x, y, { steps: 3 }); // …then settle back to where it started
    await page.mouse.up();
    await page.waitForTimeout(220);

    expect(await currentLabels(page)).toEqual(before);
    await page.getByRole('button', { name: 'Seal the Sequence' }).click();
    await expect(page.locator('.fw-verdict')).toBeVisible();
  });
});
