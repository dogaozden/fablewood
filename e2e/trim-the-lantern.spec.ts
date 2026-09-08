import { test, expect, type Page } from '@playwright/test';
import { waitReady, canvasClick, readState, waitForState } from './helpers';
import { TRIM_HEAL_CORRECT } from '../app/src/game/rest/embers';

const EV = 'screenshots';

// Wave 3 (Rests) Task 5 — Trim the Lantern, the between-rooms Ember-spend drill. Fix round 1:
// the ratified spec (Concordance Ch. II, docs/superpowers/specs/2026-08-02-concordance.md:33)
// places this "between rooms in a crawl (at the room-node map)" — the button now lives on the
// persistent status line, beside the Ember pips it spends, not on the Camp card (onCamp's own
// unconditional full heal there, the author's kept-as-is gentler-hybrid pick, made it unreachable).
// Every ACTION below is a genuine click through VaultView's real, rendered button — no
// private-method backdoor anywhere the real surface can reach, including the packless-refund
// case (dev=1 disables the draw index, not clicking). trimDebug()/trimButtonBounds() are
// read-only OBSERVATION accessors (same class as tooltipDebug()/bannerBounds() elsewhere in
// this repo's e2e suite), not action-firing — reading them isn't "driving" the scene.

type Save = {
  scene?: string;
  hp?: number;
  embers?: number;
  streak?: number;
  lastPlayed?: string;
};

type TrimDebug = { lastQuality: number | null; embersSpent: number };
type Rect = { top: number; bottom: number; left: number; right: number };
type SrsEntry = { box: number; next_due: number; history: unknown[] };

// A known-good, verified-correct free_recall fact — nights-ledger.spec.ts's own STABILIZE_FACTS
// idiom (the answer scores overlap 1.0 / pass against packs/vc-law/pack.json's real rubric,
// replicating judge/stub.ts's scoring algorithm; also confirmed free_recall-ONLY there, so
// trimDraw's own `kinds: ['free_recall']` filter can only ever land on this renderer for it).
const CORRECT_FACT_ID = 'vc.econ.liqpref.preference-plus-participation';
const CORRECT_ANSWER = 'Preference and participation.';

/** Seed exactly one known, overdue, free_recall-only fact so trimDraw's due() (the only
 *  "has a record" candidate in srs.json) deterministically hands it to the drill, regardless
 *  of the scene's own seed — same PUT-wholesale idiom as nights-ledger.spec.ts's
 *  seedStabilizeFacts / lantern-light.spec.ts's seedDoorFacts. */
async function seedCorrectFact(page: Page): Promise<void> {
  const facts: Record<string, SrsEntry> = {
    [CORRECT_FACT_ID]: { box: 1, next_due: Date.now() - 500_000, history: [] },
  };
  const res = await page.request.put('/api/state/srs.json', { data: { version: 1, facts } });
  expect(res.ok(), 'seeded the one known-correct fact').toBe(true);
}

async function restoreSave(page: Page, save: Save | null): Promise<void> {
  const data: Save = save ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
  await page.request.put('/api/state/save.json', { data });
}

/** trimDebug()'s live value off the running DungeonScene (e2e-only accessor — DungeonScene.ts). */
async function trimDebugRead(page: Page): Promise<TrimDebug | null> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const scene = g?.scene?.getScene?.('vaults') as { trimDebug?(): TrimDebug } | undefined;
    return scene?.trimDebug?.() ?? null;
  });
}

/** trimButtonBounds()'s live value (e2e-only — VaultView.ts, mirrors combat hud's
 *  bannerBounds()/flyoutBounds() precedent). The button's x shifts with statusText's own
 *  width (hp/streak digit counts), so a spec must read this rather than hardcode a pixel guess. */
async function trimButtonBoundsRead(page: Page): Promise<Rect | null> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const scene = g?.scene?.getScene?.('vaults') as { trimButtonBounds?(): Rect | null } | undefined;
    return scene?.trimButtonBounds?.() ?? null;
  });
}

/** The one real interaction every test below uses: read the button's live bounds, click its
 *  center. Bounds are in the game's internal 960x540 space (Scale.FIT — v1fix-arts.spec.ts's
 *  own documented precedent), the same space canvasClick expects. */
async function clickTrimButton(page: Page): Promise<void> {
  const b = await trimButtonBoundsRead(page);
  expect(b, 'the Trim button is rendered on the status line').not.toBeNull();
  await canvasClick(page, (b!.left + b!.right) / 2, (b!.top + b!.bottom) / 2);
}

test.describe('Trim the Lantern (W3 T5, fix round 1)', () => {
  test('zero Embers refuses: a real click spends nothing', async ({ page }) => {
    test.setTimeout(60_000);
    const beforeSave = await readState<Save>(page, 'save.json');

    try {
      await page.request.put('/api/state/save.json', {
        data: { scene: 'vaults', hp: 10, embers: 0, streak: 0, lastPlayed: '' },
      });

      await page.goto('/?scene=vaults&seed=7');
      await waitReady(page, 'vaults');

      await clickTrimButton(page);
      await page.waitForTimeout(300);

      const after = await readState<Save>(page, 'save.json');
      expect(after?.embers, 'zero Embers refuses — nothing to spend').toBe(0);
      expect(after?.hp, 'no draw, no encounter, no heal').toBe(10);
    } finally {
      await restoreSave(page, beforeSave);
    }
  });

  test('full HP refuses: a real click spends nothing', async ({ page }) => {
    test.setTimeout(60_000);
    const beforeSave = await readState<Save>(page, 'save.json');

    try {
      await page.request.put('/api/state/save.json', {
        data: { scene: 'vaults', hp: 16, embers: 2, streak: 0, lastPlayed: '' },
      });

      await page.goto('/?scene=vaults&seed=7');
      await waitReady(page, 'vaults');

      await page.screenshot({ path: `${EV}/e2e-trim-lantern-status-line.png` });
      await clickTrimButton(page);
      await page.waitForTimeout(300);

      const after = await readState<Save>(page, 'save.json');
      expect(after?.embers, 'a full party needs no trimming — no Ember spent').toBe(2);
      expect(after?.hp).toBe(16);
    } finally {
      await restoreSave(page, beforeSave);
    }
  });

  test('an empty draw (packless dev edge) refunds the Ember and bails clean', async ({ page }) => {
    test.setTimeout(60_000);
    const beforeSave = await readState<Save>(page, 'save.json');

    try {
      await page.request.put('/api/state/save.json', {
        data: { scene: 'vaults', hp: 10, embers: 2, streak: 0, lastPlayed: '' },
      });

      // dev=1 disables the draw index (loadSpecAndFacts short-circuits to the fixture before
      // dungeonDrawReady()) — it does NOT disable rendering or clicking. The button is real;
      // only the ladder behind it is guaranteed empty, exactly the "packless edge" the brief
      // names. No overlay ever opens on this path, so the click settles on its own.
      await page.goto('/?scene=vaults&dev=1&seed=7');
      await waitReady(page, 'vaults');

      // Task 5 review (Minor 1): final-state equality alone can't tell "spent then refunded"
      // from "the click did nothing" — both read embers net-2. Passively collecting every PUT
      // the click causes disambiguates with no timing dependency (unlike polling for the
      // mid-flight value, which an empirical timing probe showed is a genuine sub-100ms race):
      // an inert click writes zero saves; the real spend-then-refund path writes exactly two.
      const saveWrites: Array<string | null> = [];
      page.on('request', (req) => {
        if (req.method() === 'PUT' && req.url().includes('/api/state/save.json')) {
          saveWrites.push(req.postData());
        }
      });

      await clickTrimButton(page);

      // Playwright delivers passive request events asynchronously. Await the observable write
      // sequence itself instead of assuming 300ms is enough for two serialized GET+PUT saves
      // and the test-runner event channel under machine load.
      await expect
        .poll(() => saveWrites.length, {
          message: 'exactly two save writes arrive: the spend, then the refund',
          timeout: 10_000,
        })
        .toBe(2);

      const [spendBody, refundBody] = saveWrites.map((b) => JSON.parse(b ?? '{}') as Save);
      expect(spendBody.embers, 'write 1 is the spend, embers 2→1').toBe(1);
      expect(refundBody.embers, 'write 2 is the refund, embers 1→2').toBe(2);

      // pip transition, half 2: spent then refunded — net unchanged, never left one short.
      const after = await waitForState<Save>(
        page,
        'save.json',
        (s) => s?.embers === 2 && s?.hp === 10,
      );
      expect(after?.embers, 'spent then refunded — net unchanged').toBe(2);
      expect(after?.hp, 'no fact anywhere to ask — no encounter, no heal').toBe(10);
      expect(await trimDebugRead(page)).toEqual({ lastQuality: null, embersSpent: 0 });
    } finally {
      await restoreSave(page, beforeSave);
    }
  });

  test('a real drill spends the Ember and the spend PERSISTS through a MISS (ESC)', async ({ page }) => {
    test.setTimeout(60_000);
    const beforeSave = await readState<Save>(page, 'save.json');

    try {
      await page.request.put('/api/state/save.json', {
        data: { scene: 'vaults', hp: 10, embers: 2, streak: 0, lastPlayed: '' },
      });

      // Real pack (no dev=1) — chain.spec.ts's own vaults precedent confirms this e2e server
      // has real packs installed, so services.draw's due()/fresh() ladder has real content.
      await page.goto('/?scene=vaults&seed=7');
      await waitReady(page, 'vaults');

      await clickTrimButton(page);

      await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(450); // past overlay.ts's 400ms answer guard (shared idiom)
      // ESC in a 'drill' context always grades quality:0 regardless of judge/content
      // (gate-retreat-ledger.spec.ts's own documented convention) — a deterministic MISS.
      await page.keyboard.press('Escape');

      await expect
        .poll(async () => (await trimDebugRead(page))?.lastQuality, { timeout: 10_000 })
        .toBe(0);

      // pip transition, half 1: the Ember stays spent — a miss is not a refund.
      // Wait for the heal to round-trip to disk before reading the full shape (task-8-red-
      // rootcause.md: a bare read here can race the save's GET+PUT and catch a pre-heal hp).
      const after = await waitForState<Save>(page, 'save.json', (s) => s?.hp === 11);
      expect(after?.embers, 'the Ember stays spent through a miss').toBe(1);
      expect(after?.hp, 'a miss heals +1 (TRIM_HEAL_MISS)').toBe(11);
      expect(await trimDebugRead(page)).toEqual({ lastQuality: 0, embersSpent: 1 });

      await page.screenshot({ path: `${EV}/e2e-trim-lantern-miss.png` });
    } finally {
      await restoreSave(page, beforeSave);
    }
  });

  test('a real drill spends the Ember and heals +4 on a CORRECT answer (TRIM_HEAL_CORRECT)', async ({ page }) => {
    test.setTimeout(60_000);
    const beforeSave = await readState<Save>(page, 'save.json');
    const beforeSrs = await readState<{ version: number; facts: Record<string, SrsEntry> }>(page, 'srs.json');

    try {
      await page.request.put('/api/state/save.json', {
        data: { scene: 'vaults', hp: 10, embers: 2, streak: 0, lastPlayed: '' },
      });
      await seedCorrectFact(page);

      // Real pack (no dev=1) — chain.spec.ts's own vaults precedent confirms this e2e server
      // has real packs installed, so services.draw's due()/fresh() ladder has real content.
      await page.goto('/?scene=vaults&seed=7');
      await waitReady(page, 'vaults');

      await clickTrimButton(page);

      await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(450); // past overlay.ts's 400ms answer guard (shared idiom)
      await page.locator('.fw-overlay .fw-textarea').fill(CORRECT_ANSWER);
      await page.getByRole('button', { name: 'Cast' }).click();

      const onward = page.getByRole('button', { name: 'Onward ▸' });
      await onward.waitFor({ state: 'visible', timeout: 15_000 });
      await onward.click();

      await expect
        .poll(async () => (await trimDebugRead(page))?.lastQuality, { timeout: 10_000 })
        .toBe(1);

      // Wait for the heal to round-trip to disk before reading the full shape (task-8-red-
      // rootcause.md idiom, mirrored from the MISS test above: a bare read here can race the
      // save's GET+PUT and catch a pre-heal hp).
      const after = await waitForState<Save>(page, 'save.json', (s) => s?.hp === 10 + TRIM_HEAL_CORRECT);
      expect(after?.embers, 'the Ember stays spent — a correct answer is not a refund').toBe(1);
      expect(after?.hp, 'a correct answer heals by exactly TRIM_HEAL_CORRECT (+4)').toBe(10 + TRIM_HEAL_CORRECT);
      expect(await trimDebugRead(page)).toEqual({ lastQuality: 1, embersSpent: 1 });
    } finally {
      await restoreSave(page, beforeSave);
      await page.request.put('/api/state/srs.json', { data: beforeSrs ?? { version: 1, facts: {} } });
    }
  });
});
