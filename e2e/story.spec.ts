import { test, expect } from '@playwright/test';
import { waitReady, tapKey, warpHamletTo, waitHamletPlayer, readState, waitForState } from './helpers';

/** A save with the first vault fully cleared — the author's real post-victory situation. */
const CLEARED_SAVE = {
  scene: 'hamlet',
  hp: 16,
  streak: 0,
  lastPlayed: '2026-08-14T00:00:00.000Z',
  dungeon: {
    roomIndex: 5,
    cleared: ['room.threshold', 'room.option-shuffle', 'room.waterfall', 'room.wraiths', 'room.gauntlet', 'room.warden'],
  },
};

async function bootToHamlet(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?seed=7');
  await waitReady(page);
  await tapKey(page, 'Enter'); // title → hamlet
  await waitReady(page, 'hamlet');
  await waitHamletPlayer(page);
}

test('the hook: a cleared-vault save is greeted by The Dark Answers, exactly once', async ({ page }) => {
  await page.request.put('/api/state/save.json', { data: CLEARED_SAVE });
  await page.request.put('/api/state/story.json', { data: { version: 1, seenBeats: {}, completedArcs: {}, threadFragments: {} } });

  await bootToHamlet(page);
  const card = page.locator('.fw-story-card');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toHaveAttribute('data-beat', 'onward-01.dark-answers');
  await expect(card).toContainText('The gate was answered');
  await tapKey(page, 'Enter');
  await expect(card).toHaveCount(0);

  // seen persisted (stamped before dismiss resolves)
  await waitForState(page, 'story.json', (s: { seenBeats?: Record<string, string> } | null) =>
    typeof s?.seenBeats?.['onward-01.dark-answers'] === 'string');

  // reload → never refires
  await bootToHamlet(page);
  await page.waitForTimeout(1500);
  await expect(page.locator('.fw-story-card')).toHaveCount(0);
});

test('gate then tavern: the barred road precedes Alder; the fable precedes Berry', async ({ page }) => {
  await page.request.put('/api/state/save.json', { data: CLEARED_SAVE });
  await page.request.put('/api/state/story.json', {
    data: { version: 1, seenBeats: { 'onward-01.dark-answers': '2026-08-21T00:00:00.000Z' }, completedArcs: {}, threadFragments: {} },
  });

  await bootToHamlet(page);
  expect(await warpHamletTo(page, 'gate')).toBe(true);
  await tapKey(page, 'e');
  const card = page.locator('.fw-story-card');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toHaveAttribute('data-beat', 'onward-01.barred-road');
  await tapKey(page, 'Enter'); // dismiss card → Alder's normal conversation follows
  await expect(card).toHaveCount(0);
  await tapKey(page, 'Escape'); // leave Alder without riding out (choice list tolerates Escape-close via dialogue's own handling; if not, tap e through pages and pick 'Not yet')

  expect(await warpHamletTo(page, 'tavern')).toBe(true);
  await tapKey(page, 'e');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toHaveAttribute('data-beat', 'onward-01.fable-waywright');
  await expect(card).toContainText('A gate asks who goes. A stone remembers where.');
  await tapKey(page, 'Enter');

  const story = await readState<{ seenBeats: Record<string, string> }>(page, 'story.json');
  expect(Object.keys(story?.seenBeats ?? {}).sort()).toEqual([
    'onward-01.barred-road',
    'onward-01.dark-answers',
    'onward-01.fable-waywright',
  ]);
});

test('a fresh save hears nothing — the story never fires early', async ({ page }) => {
  await page.request.put('/api/state/save.json', { data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' } });
  await page.request.put('/api/state/story.json', { data: { version: 1, seenBeats: {}, completedArcs: {}, threadFragments: {} } });
  await bootToHamlet(page);
  await page.waitForTimeout(1500);
  await expect(page.locator('.fw-story-card')).toHaveCount(0);
});
