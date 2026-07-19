import { test, expect } from '@playwright/test';

test('boot scene renders the canvas and sets the title', async ({ page }) => {
  await page.goto('/?scene=boot&seed=7');

  await page.waitForFunction(() => (window as any).__FABLEWOOD_READY === true, undefined, {
    timeout: 20_000,
  });

  await expect(page.locator('canvas')).toBeVisible();

  const state = (await page.evaluate(() => (window as any).__FABLEWOOD_STATE)) as
    | { title?: string; scene?: string; seed?: number }
    | undefined;
  expect(state?.title).toBe('FABLEWOOD');
  expect(state?.scene).toBe('boot');
  expect(state?.seed).toBe(7);

  // shell chrome is present around the canvas
  await expect(page.getByRole('button', { name: 'Game' })).toBeVisible();
});
