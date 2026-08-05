import { test, expect, type Page } from '@playwright/test';
import { readState, waitReady } from '../e2e/helpers';

// Wave 1 "the Draw Service" (2026-08-03-wave1-draw-service) task 9 — the dungeon-teaching leg
// of the two-pack interleave rig. Two real, schema-valid packs (fx-alpha, fx-beta) are
// installed together; fx-alpha's own dungeon room 0 (assets/fx-alpha.dungeon.json) now carries
// a `teaching: ["fx.a.one", "fx.a.two"]` field (added for this task, so the RED phase is
// meaningful — pre-conversion code reads those literal ids straight off the room, so the
// fx-beta assertion below fails genuinely, not just on rig plumbing).
//
// Before task 9, DungeonScene.teachingFacts() read room.teaching's literal ids verbatim — a
// second installed pack's facts could never be introduced by a teaching room, no matter how
// much unseen material it held. Unlike combat-mix/wellspring-mix (which seed EVERY fact due),
// teaching only ever introduces UNSEEN facts (services.draw.fresh), so this rig explicitly
// resets state/srs.json to a virgin (no-records) state — a fresh two-pack install's first
// crawl — rather than reusing whatever combat-mix/wellspring-mix left behind in this shared
// scratch STATE_DIR.

type SrsFile = { version: number; facts: Record<string, unknown> };
type Save = Record<string, unknown>;

async function resetSrs(page: Page): Promise<void> {
  const res = await page.request.put('/api/state/srs.json', { data: { version: 1, facts: {} } });
  expect(res.ok(), 'reset state/srs.json to a virgin (no-records) state through the dev bridge').toBe(true);
}

/** DungeonScene.dungeonTeachingDebug() — fact ids resolved by the most recent teachingFacts()
 *  call (test-support accessor, mirrors HamletScene.wellspringDrillDebug()/CombatScene's
 *  castSurfacedDebug() precedent). */
async function teachingSurfaced(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('vaults') as { dungeonTeachingDebug?(): string[] } | undefined;
    return s?.dungeonTeachingDebug?.() ?? [];
  });
}

test('two installed packs: a dungeon teaching room introduces from BOTH installed packs', async ({ page }) => {
  test.setTimeout(60_000);

  // Rig sanity: both fixture packs are installed, and fx-alpha owns the dungeon we enter.
  const packsRes = await page.request.get('/api/packs');
  expect(packsRes.ok(), 'the dev bridge serves /api/packs').toBe(true);
  const { packs } = (await packsRes.json()) as {
    packs: Array<{ id: string; pack?: { facts?: Array<{ id: string }> } }>;
  };
  expect(packs.map((p) => p.id).sort(), 'both fixture packs are installed').toEqual(['fx-alpha', 'fx-beta']);
  expect(packs[0].id, 'fx-alpha is packs[0], so DungeonScene resolves ITS dungeon spec').toBe('fx-alpha');

  const priorSrs = await readState<SrsFile>(page, 'srs.json');
  const priorSave = await readState<Save>(page, 'save.json');
  try {
    // Fresh two-pack state: teaching only ever introduces UNSEEN facts, so this MUST start
    // from a virgin pool, not the every-fact-due seed combat-mix/wellspring-mix leave behind.
    await resetSrs(page);
    // Fresh crawl: no cleared rooms, so auto=enter shows room 0's own entry card.
    await page.request.put('/api/state/save.json', {
      data: { scene: 'hamlet', hp: 16, dungeon: { roomIndex: 0, cleared: [] } },
    });

    // auto=enter drives straight into room 0's entry card (DungeonScene.runAuto's 'enter'
    // case) — teachingFacts() runs as part of that, no combat/overlay interaction needed.
    await page.goto('/?scene=vaults&sim=0&auto=enter&seed=7');
    await waitReady(page, 'vaults');

    const surfaced = await teachingSurfaced(page);
    const where = `surfaced=${JSON.stringify(surfaced)}`;

    // Rig sanity: the room genuinely introduced something (proves the accessor + the virgin-
    // pool reset both work) and every introduced id came from a real fixture pack.
    expect(surfaced.length, `the room introduced at least one fact (${where})`).toBeGreaterThan(0);
    expect(
      surfaced.every((id) => /^fx\.[ab]\./.test(id)),
      `every introduced fact came from a fixture pack (${where})`,
    ).toBe(true);

    // THE ASSERTION. RED before task 9: teachingFacts() read room.teaching's literal ids
    // verbatim (seeded above with two fx-alpha-only ids), so fx-beta was never introduced no
    // matter how much unseen material it held.
    expect(surfaced.some((id) => id.startsWith('fx.a.')), `fx-alpha is introduced (${where})`).toBe(true);
    expect(surfaced.some((id) => id.startsWith('fx.b.')), `fx-beta is introduced too (${where})`).toBe(true);
  } finally {
    if (priorSrs) await page.request.put('/api/state/srs.json', { data: priorSrs });
    else await page.request.put('/api/state/srs.json', { data: { version: 1, facts: {} } });
    if (priorSave) await page.request.put('/api/state/save.json', { data: priorSave });
  }
});
