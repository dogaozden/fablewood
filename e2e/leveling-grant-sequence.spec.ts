import { test, expect, type Page } from '@playwright/test';
import { waitForState, readState } from './helpers';

// Wave 4 final review, C1 — the mainline path that lost the most XP, pinned end to end.
//
// A boss victory is the one beat that grants TWICE in a single synchronous block:
// DungeonScene.bossVictory fires grantXp('boss') (+150) and then, with only a pure rewardXp()
// call between them, grantXp('quest', { amount }) for the pack's own reward. Before the fix both
// grants read the same pre-first-grant save cache (ObjectStore.save assigns this.cache only after
// its awaited round trip; grantXp fires the write without awaiting), both built an ABSOLUTE xp
// patch, and the second write overwrote the first — 150 XP destroyed on every boss kill, and the
// ceremony card announcing "Level 2" twice with an overstated pool line.
//
// The drive: `?scene=vaults&sim=1&auto=boss&seed=7` — deliberately WITHOUT `dev=1`. That matters.
// dev=1 forces DungeonScene.useFixture(), which sets `this.pack = null`, and bossVictory's
// `this.pack ? bossQuest(this.pack) : undefined` then makes questXp undefined — one grant, not
// two, so the packless dev path cannot reproduce this at all. Without dev=1 the scene loads the
// installed pack (packs/vc-law), whose bossQuest resolves to q.vaults.warden (reward.xp 500 —
// its title "The Vault-Warden's Term Sheet" matches specResolve.ts's /warden|boss|term.?sheet/i
// before any earlier quest does) and whose boss room `room.warden` carries no gate. `sim=1`
// synthesizes the victory inline (doCombat's sim branch) so no fight has to be driven, and
// `auto=boss` marks the five pre-boss rooms cleared WITHOUT entering them — so the boss+quest
// pair is the ONLY XP granted in the whole run, and the arithmetic is exact: 0 → 150 → 650,
// levels [2, 3], pool 16 → 18 → 20.
//
// The ceremony card is captured by an init-script MutationObserver rather than a locator poll:
// the auto-drive dismisses the card after 2000ms (overlay.ts's presentLevelUp), and this pin's
// whole point is "exactly ONE card, no duplicated level row" — a locator that arrives late would
// turn the very defect it guards into a silent skip. The observer also counts card ELEMENTS, so
// "one card" is asserted on identity, not on text that a second identical card would share.

const EV = 'screenshots';

type Save = {
  scene?: string;
  hp?: number;
  streak?: number;
  lastPlayed?: string;
  xp?: number;
  level?: number;
  dungeon?: { roomIndex: number; cleared: string[] };
};
type Inventory = { version: number; gold: number; stacks: Record<string, number> };

type Card = { title: string; rows: string[] };

declare global {
  interface Window {
    __fwLevelUpCards?: Card[];
  }
}

/** Record every level-up ceremony card the run ever renders, as it renders — see the file header.
 *  Runs before any page script on every navigation. Each overlay element is recorded at most
 *  once (WeakSet), and only once its title is filled in, since buildOverlay() inserts the root
 *  before presentLevelUp populates the body. */
async function recordCeremonyCards(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const cards: Card[] = [];
    window.__fwLevelUpCards = cards;
    const seen = new WeakSet<Element>();
    const scan = (): void => {
      for (const root of Array.from(document.querySelectorAll('.fw-overlay'))) {
        if (seen.has(root)) continue;
        const title = root.querySelector('.fw-ledger-title')?.textContent ?? '';
        if (title !== 'The Lantern Burns Brighter') continue; // ceremony.ts's LEVEL_UP_TITLE
        seen.add(root);
        cards.push({
          title,
          rows: Array.from(root.querySelectorAll('.fw-ledger-row')).map((r) => r.textContent ?? ''),
        });
      }
    };
    // `document`, not `document.documentElement`: an init script runs before the document
    // element exists, and observe() rejects a null target outright.
    new MutationObserver(scan).observe(document, { childList: true, subtree: true });
  });
}

async function ceremonyCards(page: Page): Promise<Card[]> {
  return page.evaluate(() => window.__fwLevelUpCards ?? []);
}

/** boss-victory.spec.ts's restoreState idiom, verbatim in shape: quiesce the page first (a live
 *  scene's own persist writes can otherwise land AFTER a bare PUT and poison whatever spec runs
 *  next in this shared, serial suite), then PUT-and-verify. Inventory too, not just save — a boss
 *  victory pays gold, the Warden Signet and a boss-weighted trinket. */
async function restoreState(page: Page, save: Save | null, inv: Inventory | null): Promise<void> {
  const saveData: Save = save ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
  const invData: Inventory = inv ?? { version: 1, gold: 20, stacks: {} };
  await page.goto('about:blank');
  for (let i = 0; i < 5; i++) {
    await page.request.put('/api/state/save.json', { data: saveData });
    await page.request.put('/api/state/inventory.json', { data: invData });
    await new Promise((r) => setTimeout(r, 150));
    const nowSave = (await page.request
      .get('/api/state/save.json')
      .then((r) => r.json())
      .catch(() => undefined)) as Save | undefined;
    if (nowSave?.scene === saveData.scene && (nowSave?.xp ?? 0) === (saveData.xp ?? 0)) return;
  }
  throw new Error('restoreState: save.json never settled on the restored snapshot');
}

test('a boss victory banks BOTH the boss and quest grants, and shows ONE ceremony card', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const beforeSave = await readState<Save>(page, 'save.json');
  const beforeInv = await readState<Inventory>(page, 'inventory.json');

  try {
    // Fresh, explicit baseline: xp 0 at level 1 with a full L1 pool, and no dungeon progress —
    // so every number below is fixed by the pack, not inherited from whatever ran before.
    await page.request.put('/api/state/save.json', {
      data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '', xp: 0, level: 1 },
    });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 20, stacks: {} },
    });

    await recordCeremonyCards(page);
    await page.goto('/?scene=vaults&sim=1&auto=boss&seed=7');

    // ---- the persistence verdict (the half that costs the player) ----
    // waitForState, never a bare read after an in-page marker: it polls the real file and fails
    // loudly with the last state dumped. xp===650 IS the pin — 500 alone is the C1 failure.
    const save = await waitForState<Save>(page, 'save.json', (s) => s?.xp === 650, 60_000);
    expect(save?.level, '650 xp is Level 3 (thresholds 100 / 300 / 700)').toBe(3);
    expect(
      save?.hp,
      'each level bumps the pool from the previous bump: 16 → 18 (L2 cap) → 20 (L3 cap)',
    ).toBe(20);

    // ---- the ceremony verdict (the half the player sees) ----
    await expect
      .poll(async () => (await ceremonyCards(page)).length, {
        message: 'the level-up ceremony card rendered',
        timeout: 30_000,
      })
      .toBe(1);

    const cards = await ceremonyCards(page);
    await page.screenshot({ path: `${EV}/e2e-leveling-boss-quest-ceremony.png` });
    const rows = cards[0].rows;
    expect(rows.filter((r) => r.startsWith('Level 2')), `Level 2 listed once: ${JSON.stringify(rows)}`).toHaveLength(1);
    expect(rows.filter((r) => r.startsWith('Level 3')), `Level 3 listed once: ${JSON.stringify(rows)}`).toHaveLength(1);
    expect(rows, 'the pool line counts the two levels actually gained, not three').toContain(
      "The party's pool deepens: +4.",
    );
  } finally {
    await restoreState(page, beforeSave, beforeInv);
  }
});
