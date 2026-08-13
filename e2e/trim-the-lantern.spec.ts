import { test, expect, type Page } from '@playwright/test';
import { waitReady, canvasClick, readState } from './helpers';

const EV = 'screenshots';

// Wave 3 (Rests) Task 5 — Trim the Lantern, the between-rooms Ember-spend drill on the Camp
// card. onCamp() (V1, 2026-07-19, unrelated to Wave 3) unconditionally heals the party to full
// BEFORE it ever shows the card that hosts this button — so a real click can only ever land on
// the full-HP refusal branch (pin 1 below). The spend/heal/refund branches are reached the same
// way hearth-rest.spec.ts reaches HamletScene's dialogue box: a private-method backdoor through
// window.__FABLEWOOD_GAME (TS `private` is erased at runtime; neither onTrim() nor a Phaser
// toast has a DOM locator a spec could otherwise drive). See task-5-report.md's concern note.

type Save = {
  scene?: string;
  hp?: number;
  embers?: number;
  streak?: number;
  lastPlayed?: string;
};

type TrimDebug = { lastQuality: number | null; embersSpent: number };

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

test.describe('Trim the Lantern (W3 T5)', () => {
  test('the real button: a genuine click only ever reaches the full-HP refusal', async ({ page }) => {
    test.setTimeout(60_000);
    const beforeSave = await readState<Save>(page, 'save.json');

    try {
      // hp:5 on purpose — proves that even an injured party can't reach Trim's spend path via
      // the real camp card, because onCamp() heals to full before the card (and this button)
      // ever render. embers:2 isolates this from the OTHER refusal (zero Embers).
      await page.request.put('/api/state/save.json', {
        data: { scene: 'vaults', hp: 5, embers: 2, streak: 0, lastPlayed: '' },
      });

      await page.goto('/?scene=vaults&auto=camp&seed=7');
      await waitReady(page, 'vaults');
      await page.waitForTimeout(300); // past showCampCard's 220ms fade-in (openPanel)

      await page.screenshot({ path: `${EV}/e2e-trim-lantern-camp-card.png` });
      await canvasClick(page, 480, 325); // Trim button center — VaultView.showCampCard (cx, top+202)
      await page.waitForTimeout(300);

      const after = await readState<Save>(page, 'save.json');
      expect(after?.embers, 'full HP refuses — no Ember spent').toBe(2);
      expect(after?.hp, "onCamp's own unconditional heal, already full before the click").toBe(16);
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

      await page.goto('/?scene=vaults&dev=1&seed=7');
      await waitReady(page, 'vaults');

      // dev/packless: services.draw's index was never built (loadSpecAndFacts short-circuits to
      // the fixture before dungeonDrawReady()), so the ladder resolves to null synchronously —
      // no encounter overlay ever opens, so awaiting onTrim() directly here is safe.
      await page.evaluate(() => {
        const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
        const scene = g?.scene?.getScene?.('vaults') as { onTrim?(): Promise<void> } | undefined;
        return scene?.onTrim?.();
      });

      // pip transition, half 2: spent then refunded — net unchanged, never left one short.
      const after = await readState<Save>(page, 'save.json');
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

      // Fire-and-forget: a real drill's onTrim() blocks on a real answer overlay, so the outer
      // evaluate must NOT await its returned promise — this only STARTS it.
      await page.evaluate(() => {
        const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
        const scene = g?.scene?.getScene?.('vaults') as { onTrim?(): Promise<void> } | undefined;
        void scene?.onTrim?.();
      });

      await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
      await page.waitForTimeout(450); // past overlay.ts's 400ms answer guard (shared idiom)
      // ESC in a 'drill' context always grades quality:0 regardless of judge/content
      // (gate-retreat-ledger.spec.ts's own documented convention) — a deterministic MISS.
      await page.keyboard.press('Escape');

      await expect
        .poll(async () => (await trimDebugRead(page))?.lastQuality, { timeout: 10_000 })
        .toBe(0);

      // pip transition, half 1: the Ember stays spent — a miss is not a refund.
      const after = await readState<Save>(page, 'save.json');
      expect(after?.embers, 'the Ember stays spent through a miss').toBe(1);
      expect(after?.hp, 'a miss heals +1 (TRIM_HEAL_MISS)').toBe(11);
      expect(await trimDebugRead(page)).toEqual({ lastQuality: 0, embersSpent: 1 });

      await page.screenshot({ path: `${EV}/e2e-trim-lantern-miss.png` });
    } finally {
      await restoreSave(page, beforeSave);
    }
  });
});
