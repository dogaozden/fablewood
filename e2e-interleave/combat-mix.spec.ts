import { test, expect, type Page } from '@playwright/test';
import { currentScene, readState } from '../e2e/helpers';

// Wave 1 "the Draw Service" (2026-08-03-wave1-draw-service) task 8 — the combat leg of the
// two-pack interleave rig. Two real, schema-valid packs (fx-alpha, fx-beta) are installed
// together and EVERY fact in BOTH is seeded due; the crawl then enters fx-alpha's own dungeon
// room (assets/fx-alpha.dungeon.json, added for this task: one trivial two-wisp fight, NO
// enemy tags, no gate, no boss) and lets the ?demo=1 autopilot cast.
//
// Before task 8 that was single-pack by construction: CombatScene.loadContent() resolved ONE
// pack entry (packs.find(id === this.launch.packId)) into allFactIds and dueFactIds() drew only
// from that set, so a second installed pack was silently never asked in combat — exactly the
// starvation the Wellspring had before task 7. Run against pre-conversion code this file fails
// on its fx-beta assertion alone, with both rig-sanity assertions passing.
//
// The room deliberately carries no enemy tags (fx-alpha's facts carry none either): draws no
// longer scope by tags at all, so a tagless room proves the questions are coming from the
// global draw index rather than from a tag lookup that happened to widen.

type Entry = { box: number; next_due: number; history: Array<{ ts: string; quality: 0 | 0.5 | 1; encounter_id: string }> };
type Save = Record<string, unknown>;

/** Verbatim from wellspring-mix.spec.ts (per this repo's per-spec-file duplication convention):
 *  a fact seeded with next_due in the past is due, so the picker prefers it over anything unseen. */
function hist(): Entry {
  const now = Date.now();
  return {
    box: 1,
    next_due: now - 5_000,
    history: [{ ts: new Date(now - 10_000).toISOString(), quality: 1, encounter_id: 'seed-0' }],
  };
}

async function seedSrs(page: Page, facts: Record<string, Entry>): Promise<void> {
  const res = await page.request.put('/api/state/srs.json', { data: { version: 1, facts } });
  expect(res.ok(), 'seeded state/srs.json through the dev bridge').toBe(true);
}

/** Answer whichever kind the overlay shows (wellspring-mix.spec.ts's helper, plus the
 *  free_recall answer text combat's own e2e uses — JUDGE_MODE=stub grades it). */
async function answerAnyOverlay(page: Page): Promise<void> {
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
  if (await page.locator('.fw-textarea').count()) {
    await page.locator('.fw-textarea').fill('the preferred shares convert at the stated ratio');
    await page.getByRole('button', { name: 'Cast' }).click();
  } else if (await page.locator('.fw-chip').count()) {
    const lefts = page.locator('.fw-col').nth(0).locator('.fw-chip');
    const rights = page.locator('.fw-col').nth(1).locator('.fw-chip');
    const n = await lefts.count();
    for (let i = 0; i < n; i++) {
      await lefts.nth(i).click();
      await rights.nth(i).click();
    }
    await page.getByRole('button', { name: /Seal the Weave/ }).click();
  } else if (await page.locator('.fw-step').count()) {
    await page.getByRole('button', { name: /Seal the Sequence/ }).click();
  } else {
    await page.locator('.fw-opt').first().click(); // mcq or scenario
  }
  await page.waitForTimeout(300);
  const cont = page.getByRole('button', { name: 'Onward ▸' });
  if (await cont.count()) await cont.click();
  await page.waitForTimeout(250);
}

/** Fact ids this battle's encounters have surfaced so far (CombatScene.castSurfacedDebug()). */
async function surfaced(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { castSurfacedDebug?(): string[] } | undefined;
    return s?.castSurfacedDebug?.() ?? [];
  });
}

test('two installed packs: combat casts reach BOTH installed packs, not just the launch pack', async ({ page }) => {
  test.setTimeout(120_000);

  // Rig sanity: both fixture packs are installed, and fx-alpha owns the dungeon we enter.
  const packsRes = await page.request.get('/api/packs');
  expect(packsRes.ok(), 'the dev bridge serves /api/packs').toBe(true);
  const { packs } = (await packsRes.json()) as {
    packs: Array<{ id: string; pack?: { facts?: Array<{ id: string }> } }>;
  };
  expect(packs.map((p) => p.id).sort(), 'both fixture packs are installed').toEqual(['fx-alpha', 'fx-beta']);
  expect(packs[0].id, 'fx-alpha is packs[0], so DungeonScene resolves ITS dungeon spec').toBe('fx-alpha');

  // Seed EVERY fact in BOTH packs as due, so whichever pack the cast draws from has plenty
  // due — this isolates the assertion to "which pack", not "was anything due".
  const facts: Record<string, Entry> = {};
  for (const entry of packs) for (const f of entry.pack?.facts ?? []) facts[f.id] = hist();
  expect(Object.keys(facts).length, 'both packs contributed facts to seed').toBeGreaterThan(60);
  await seedSrs(page, facts);

  // This rig's STATE_DIR is a shared scratch dir across its specs — restore whatever save
  // was there so a later spec never inherits this one's dungeon progress (boss-victory.spec.ts's
  // restoreSave idiom).
  const priorSave = await readState<Save>(page, 'save.json');
  try {
    // Fresh crawl: no cleared rooms, so auto=win enters room 0 (the two-wisp fixture chamber).
    await page.request.put('/api/state/save.json', {
      data: { scene: 'hamlet', hp: 10, dungeon: { roomIndex: 0, cleared: [] } },
    });

    // The real dungeon flow (boss-victory.spec.ts's route): sim=0 launches the REAL CombatScene
    // with launch.packId = 'fx-alpha'; demo=1 hands the fight to the autopilot, which prefers
    // 'cast' (free_recall) — both fixture packs carry free_recall encounters.
    await page.goto('/?scene=vaults&sim=0&auto=win&demo=1&seed=7');

    // auto=win drives straight through the blurb card into combat.
    await expect
      .poll(() => currentScene(page), { timeout: 45_000, message: 'the crawl reached the real CombatScene' })
      .toBe('combat');

    // Answer every cast the fight offers, to the end of the battle or the budget.
    for (let n = 0; n < 10; n++) {
      if ((await currentScene(page)) !== 'combat') break; // fight resolved
      if (!(await page.locator('.fw-overlay').count())) {
        await page.waitForTimeout(1200); // autopilot is still moving into range
        continue;
      }
      await answerAnyOverlay(page);
      await page.waitForTimeout(500);
    }
    const seen = await surfaced(page);
    const where = `surfaced=${JSON.stringify(seen)}`;

    // Rig sanity: the battle genuinely asked questions from the REAL fixture packs — proves the
    // new fx-alpha.dungeon.json resolved and the accessor reads live ids. The packless combat
    // fixture would surface moss.* instead, and a wrong-pack launch would surface neither.
    expect(seen.length, `the battle surfaced at least one fact id (${where})`).toBeGreaterThan(0);
    expect(seen.every((id) => /^fx\.[ab]\./.test(id)), `every surfaced fact came from a fixture pack (${where})`).toBe(true);

    // THE ASSERTION. RED before task 8: loadContent() pinned allFactIds to the ONE launch pack
    // (fx-alpha), so fx-beta was never asked in combat no matter how overdue its facts were.
    // Which pack leads any single cast rotates by seed (draw/index.ts's sourceSpread, reseeded
    // per cast off encSeed), so this asserts fx-beta is REACHABLE across the battle rather than
    // that it wins a particular draw — the latter would be a coin-flip on the spread's rotation.
    expect(seen.some((id) => id.startsWith('fx.b.')), `the other installed pack fx-beta is drawn from too (${where})`).toBe(true);
  } finally {
    if (priorSave) await page.request.put('/api/state/save.json', { data: priorSave });
  }
});
