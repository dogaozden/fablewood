import { test, expect, type Page } from '@playwright/test';
import { waitReady, currentScene, readState } from './helpers';

// Death's Door ("The Ledger Holds Your Line", Concordance Ch. I) — RED e2e pins, written
// BEFORE the mechanic exists (wave-2 plan, Task 4). Tasks 5/6 flip these green: CombatScene
// grows a 'deathsdoor' Phase that intercepts the 0-HP `checkEnd() -> 'retreat'` chokepoint
// instead of retreating instantly, and DungeonScene grows a sibling 'wipe' branch on the
// Night's Ledger.
//
// TODAY's baseline (what every pin below is RED against): 0 HP -> checkEnd() returns
// 'retreat' -> CombatScene.resolveBattle('retreat') fires INSTANTLY — a toast, a 1600ms
// delayedCall scene.start, then DungeonScene's existing retreat branch (toast, Night's
// Ledger card, scene.start('hamlet')). Same path nights-ledger.spec.ts's retreat test and
// gate-retreat-ledger.spec.ts already exercise.
//
// Model: e2e/boss-victory.spec.ts (drive real combat; scene debug hooks via
// window.__FABLEWOOD_GAME.scene.getScene('combat'); restoreState idiom) + e2e/gate-retreat-
// ledger.spec.ts (captureLedger card-reading helper, fade-settle polling) + e2e/nights-
// ledger.spec.ts's retreat test (the hp:2 + Wait-spam damage-path idiom, reused verbatim
// below as driveToZeroHp) + e2e/redemption-bell.spec.ts (seedSrs pattern, /api/packs fact
// enumeration).
//
// All three pins drive the SAME real-combat wipe: the packless dev dungeon's first room
// (under-1, dev.dungeon.json — two wisps, no gate/boss) via `?dev=1&sim=0&auto=win`.
// splitPooledHp(2) puts the Keeper in with 2 pool hp and Mira at 0, so a single connecting
// enemy hit ends the party (CombatScene.ts:149-153, same math nights-ledger.spec.ts's
// retreat test relies on). Facts are seeded against the REAL installed pack (vc-law): dev=1
// only packs the DUNGEON's own room/boss structure from the fixture — CombatScene's own
// combat-internal draws always go through the global services.draw index, which prefers a
// real installed pack when one exists (boss-victory.spec.ts's file header documents the same
// routeFixtureBossToInstalledPack behavior for boss phases; DungeonScene.loadSpecAndFacts's
// dev-branch only swaps the room/teaching-fact source, never CombatScene's own draw calls).

const EV = 'screenshots';

type Save = {
  scene?: string;
  hp?: number;
  streak?: number;
  lastPlayed?: string;
  dungeon?: { roomIndex: number; cleared: string[]; gatePending?: string };
};
type Inventory = { version: number; gold: number; stacks: Record<string, number> };
type SrsEntry = {
  box: number;
  next_due: number;
  history: Array<{ ts: string; quality: 0 | 0.5 | 1; encounter_id: string }>;
};

type CombatSnap = {
  state: string;
  partyHp: number;
} | null;

type DoorSnap = { active: boolean; successes: number; failures: number; revivedUsed: boolean } | null;

interface LedgerSnap {
  title: string;
  sub: string;
  rows: Array<{ label: string; val: string }>;
  signoff: string;
}

// A known catalog trinket (sellable, keepsake-eligible) and THE catalog relic (protected —
// pickKeepsake, Task 2, never selects type:'relic'). catalog.ts:78-111.
const KEEPSAKE_TRINKET = 'faded-coin-cache';
const PROTECTED_RELIC = 'warden-signet-of-terms';

// Pin C's welded/most-overdue fact. Chosen deliberately: packs/vc-law/pack.json shows it has
// TWO encounters (enc.fr.economics-vs-control · free_recall, enc.match.foundational-terms ·
// match) — either satisfies a plausible DD_KINDS filter, so the FACT is reliably selected as
// most-overdue regardless of Task 5's exact kind list. Which of the two ENCOUNTERS gets
// presented is Task 5's call, not this pin's — see answerDeathSaveCorrect's note below.
const REVIVE_FACT = 'vc.econ.overview.economics-vs-control';
// Proven stub-judge PASS for this exact fact/encounter — reused verbatim from
// redemption-bell.spec.ts:123 ("a terse, correct answer clears the stub judge's keyword bar").
const REVIVE_ANSWER = 'Economics and control.';

async function seedSave(page: Page, patch: Partial<Save> = {}): Promise<void> {
  const data: Save = {
    scene: 'hamlet',
    hp: 2,
    streak: 0,
    lastPlayed: '',
    dungeon: { roomIndex: 0, cleared: [] },
    ...patch,
  };
  const res = await page.request.put('/api/state/save.json', { data });
  expect(res.ok(), 'seeded state/save.json (hp:2 — one connecting hit ends the party)').toBe(true);
}

async function seedInventory(page: Page, stacks: Record<string, number>): Promise<void> {
  const res = await page.request.put('/api/state/inventory.json', {
    data: { version: 1, gold: 20, stacks },
  });
  expect(res.ok(), 'seeded state/inventory.json').toBe(true);
}

/** Every real installed fact id (redemption-bell.spec.ts's combat-test idiom, verbatim) — the
 *  death's-door draw is a global services.draw read, same pool as any other combat cast. */
async function installedFactIds(page: Page): Promise<string[]> {
  const res = await page.request.get('/api/packs');
  expect(res.ok(), 'read installed packs').toBe(true);
  const { packs } = (await res.json()) as { packs: Array<{ pack?: { facts?: Array<{ id: string }> } }> };
  const ids: string[] = [];
  for (const entry of packs) for (const f of entry.pack?.facts ?? []) ids.push(f.id);
  expect(ids.length, 'the installed pack has facts to seed').toBeGreaterThan(0);
  return ids;
}

/** Seed EVERY installed fact at box 1 (due, no revive possible — REVIVE_BOX is 4), optionally
 *  overriding one fact to a specific box/overdue-ness (Pin C's welded, most-overdue revive
 *  fact). box/next_due are stored fields (leitner.ts's dueQueue reads them directly, never
 *  history) — no fabricated history is needed for either "box 1" or "box 5" to be real.
 *  Sort order is exact-ms (leitner.ts:188 `a.due - b.due`); the day-bucket tiebreak in
 *  draw/index.ts's sourceSpread only activates with 2+ installed packs (index.packIds.length
 *  <= 1 short-circuits it) — the e2e server installs exactly one (vc-law), so the override's
 *  next_due alone deterministically decides "most overdue", no same-day noise to dodge. */
async function seedSrsBaseline(
  page: Page,
  override?: { factId: string; box: number; overdueMs: number },
): Promise<void> {
  const ids = await installedFactIds(page);
  const now = Date.now();
  const facts: Record<string, SrsEntry> = {};
  for (const id of ids) facts[id] = { box: 1, next_due: now - 5_000, history: [] };
  if (override) {
    facts[override.factId] = { box: override.box, next_due: now - override.overdueMs, history: [] };
  }
  const res = await page.request.put('/api/state/srs.json', { data: { version: 1, facts } });
  expect(res.ok(), 'seeded state/srs.json through the dev bridge').toBe(true);
}

/** Snapshot-restore save+inventory (boss-victory.spec.ts's restoreState idiom, verbatim):
 *  quiesce the page first (a live scene's own persist writes can otherwise land AFTER a bare
 *  PUT and poison whatever spec runs next in this shared, serial .state-e2e suite), then
 *  PUT-and-verify until both files actually hold the snapshot. srs.json is deliberately NOT
 *  restored here — same precedent as redemption-bell.spec.ts's combat test, which also seeds
 *  every installed fact and leaves srs.json seeded afterward. */
async function restoreState(page: Page, save: Save | null, inv: Inventory | null): Promise<void> {
  const saveData: Save = save ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
  const invData: Inventory = inv ?? { version: 1, gold: 20, stacks: {} };
  await page.goto('about:blank');
  for (let i = 0; i < 5; i++) {
    await page.request.put('/api/state/save.json', { data: saveData });
    await page.request.put('/api/state/inventory.json', { data: invData });
    await new Promise((r) => setTimeout(r, 150));
    const nowSave = (await page.request.get('/api/state/save.json').then((r) => r.json()).catch(() => undefined)) as
      | Save
      | undefined;
    const nowInv = (await page.request
      .get('/api/state/inventory.json')
      .then((r) => r.json())
      .catch(() => undefined)) as Inventory | undefined;
    if (
      nowSave?.scene === saveData.scene &&
      nowInv?.gold === invData.gold &&
      JSON.stringify(nowInv?.stacks ?? {}) === JSON.stringify(invData.stacks ?? {})
    ) {
      return;
    }
  }
  throw new Error('restoreState: save.json/inventory.json never settled on the restored snapshot');
}

async function snap(page: Page): Promise<CombatSnap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as CombatSnap;
  });
}

/** Task 5's debug-hook consumption contract (task-4-brief.md): { active, successes, failures,
 *  revivedUsed } on the combat scene, same family as combatSnapshot()/bossRevealActive() in
 *  boss-victory.spec.ts. Does not exist yet — `?.()` resolves to null until Task 5 lands. */
async function ddSnap(page: Page): Promise<DoorSnap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { deathsDoorSnapshot?(): unknown } | undefined;
    return (s?.deathsDoorSnapshot?.() ?? null) as DoorSnap;
  });
}

/** Wait-spam damage-path idiom (nights-ledger.spec.ts's retreat test, verbatim): the party
 *  never fights back, so enemy turns whittle the seeded-low pool to 0. Stops on 'over'
 *  (today's instant retreat) or 'deathsdoor' (Task 5's future hold-the-line phase) or once
 *  the scene itself has moved on — safe to call both before and after Task 5 lands. */
async function driveToZeroHp(page: Page, timeoutMs = 75_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await currentScene(page)) !== 'combat') return;
    const s = await snap(page);
    if (!s || s.state === 'over' || s.state === 'deathsdoor') return;
    if (s.state === 'playerMove') await page.keyboard.press('7'); // Wait
    await page.waitForTimeout(150);
  }
}

/** Let today's instant-retreat pipeline (1600ms combat delayedCall -> DungeonScene's own
 *  1000ms toast wait -> auto-dismissed Night's Ledger -> scene.start('hamlet')) fully settle,
 *  OR — once Task 5/6 land — let the door hold combat open. Bounded either way: never hangs
 *  waiting for a transition that (today) never comes on the door's schedule, only on the old
 *  retreat's. */
async function settleAfterZeroHp(page: Page, timeoutMs = 20_000): Promise<string | undefined> {
  const start = Date.now();
  let scene = await currentScene(page);
  while ((scene === 'combat' || scene === 'vaults') && Date.now() - start < timeoutMs) {
    await page.waitForTimeout(400);
    scene = await currentScene(page);
  }
  return scene;
}

/** captureLedger (gate-retreat-ledger.spec.ts / nights-ledger.spec.ts, verbatim): read the
 *  load-bearing text FIRST (one atomic evaluate — the auto-drive path dismisses the ledger
 *  after a beat), then fade-settle-poll opacity before the screenshot. */
async function captureLedger(page: Page, shotPath: string): Promise<LedgerSnap | null> {
  await page.locator('.fw-overlay .fw-ledger-title').waitFor({ state: 'visible', timeout: 30_000 });
  const data = await page.evaluate(() => {
    const root = document.querySelector('.fw-overlay');
    if (!root) return null;
    return {
      title: root.querySelector('.fw-ledger-title')?.textContent ?? '',
      sub: root.querySelector('.fw-ledger-sub')?.textContent ?? '',
      rows: Array.from(root.querySelectorAll('.fw-ledger-row')).map((r) => ({
        label: r.querySelector('.fw-ledger-label')?.textContent ?? '',
        val: r.querySelector('.fw-ledger-val')?.textContent ?? '',
      })),
      signoff: root.querySelector('.fw-ledger-signoff')?.textContent ?? '',
    } as LedgerSnap;
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.querySelector('.fw-overlay');
          return el ? parseFloat(getComputedStyle(el).opacity) : 0;
        }),
      { timeout: 3000 },
    )
    .toBeGreaterThan(0.98);
  await page.screenshot({ path: shotPath });
  return data;
}

/** Best-effort: answer a death-save drill correctly if one is up. Assumes the free_recall
 *  presentation of REVIVE_FACT's own enc.fr.economics-vs-control encounter (kind-agnostic ESC
 *  is used for the WRONG-answer pins instead, since a correct answer can't be kind-agnostic).
 *  KNOWN RISK (flagged in the task report, not a rig error): REVIVE_FACT also carries an
 *  enc.match.foundational-terms encounter — if Task 5's DD_KINDS admits 'match' and the picker
 *  lands there instead, no .fw-textarea ever appears and this is a tolerant no-op. Today (pre-
 *  Task-5) it is ALWAYS a no-op: no door, so no drill ever opens. */
async function answerDeathSaveCorrect(page: Page): Promise<void> {
  const ta = page.locator('.fw-overlay .fw-textarea');
  const appeared = await ta
    .waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;
  await page.waitForTimeout(450); // overlay.ts's paint-anchored answer guard (shared idiom)
  await ta.fill(REVIVE_ANSWER);
  await page.getByRole('button', { name: 'Cast' }).click();
  await page.waitForTimeout(400);
  // Casting only produces the VERDICT. kinds.ts's free_recall renderer (continueButton,
  // :230-237) resolves the encounter promise on the verdict's own "Onward ▸" continuation, so
  // the death save is not scored — and the door cannot close — until this is clicked. Every
  // sibling spec that answers a GRADED encounter takes the same explicit step
  // (redemption-bell.spec.ts:132, boss-victory.spec.ts:175, combat.spec.ts:62);
  // answerDrillsWrong below needs no equivalent only because overlay.ts's ESC policy resolves
  // on the spot. Tolerant like the rest of this helper: pre-Task-5 no verdict ever appears.
  const onward = page.getByRole('button', { name: 'Onward ▸' });
  const graded = await onward
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!graded) return;
  await onward.click();
  await page.waitForTimeout(400);
}

/** Best-effort: answer up to THREE death-save drills WRONG via ESC. overlay.ts:236's ESC
 *  policy fires `if (ctx.context === 'drill')` regardless of encounter kind — registered
 *  BEFORE the kind-specific renderer's own keys and independent of them (Overlay.onKey: several
 *  handlers coexist, all fire) — so this is kind-agnostic, unlike answerDeathSaveCorrect.
 *  Today (pre-Task-5) each iteration finds nothing and is a tolerant no-op — no door, so no
 *  drill ever opens three times in a row. */
async function answerDrillsWrong(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const drill = page.locator('.fw-overlay .fw-textarea, .fw-overlay .fw-opt').first();
    const appeared = await drill
      .waitFor({ state: 'visible', timeout: 4_000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) return; // no door today — nothing left to answer wrong
    await page.waitForTimeout(600); // arming guard (shared idiom, boss-victory.spec.ts's driveParley)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
}

test.describe("death's door — the Ledger Holds Your Line (RED pins, pre-mechanic)", () => {
  test('Pin A — the door opens: the hold-the-line card shows, combat does not resolve instantly', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const beforeSave = await readState<Save>(page, 'save.json');
    const beforeInv = await readState<Inventory>(page, 'inventory.json');

    try {
      await seedSave(page);
      await seedSrsBaseline(page);

      await page.goto('/?scene=vaults&dev=1&sim=0&auto=win&seed=7');
      await waitReady(page, 'combat');

      await driveToZeroHp(page);
      await page.screenshot({ path: `${EV}/e2e-deaths-door-pin-a-at-zero-hp.png` });

      const doorCard = page.locator('.fw-overlay', { hasText: /Ledger Holds Your Line/ });
      await expect(
        doorCard,
        'EXPECTED NOW: fails — today 0 HP resolves an instant retreat (toast + a 1600ms ' +
          'delayedCall scene.start), so the hold-the-line card never renders',
      ).toBeVisible({ timeout: 8_000 });

      // Reinforcing (unreached today, since the assertion above already throws): once the
      // card exists, combat must still hold past the old retreat window.
      expect(
        await currentScene(page),
        'still in combat — the door has not let the scene move on',
      ).toBe('combat');
    } finally {
      await restoreState(page, beforeSave, beforeInv);
    }
  });

  test('Pin B — true wipe takes a keepsake: trinket stripped, relic protected, wipe signoff shown', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const beforeSave = await readState<Save>(page, 'save.json');
    const beforeInv = await readState<Inventory>(page, 'inventory.json');

    try {
      await seedSave(page);
      await seedInventory(page, { [KEEPSAKE_TRINKET]: 1, [PROTECTED_RELIC]: 1 });
      await seedSrsBaseline(page); // every installed fact at box 1 -- no revive possible

      await page.goto('/?scene=vaults&dev=1&sim=0&auto=win&seed=7');
      await waitReady(page, 'combat');

      await driveToZeroHp(page);
      await answerDrillsWrong(page, 3); // tolerant no-op today (see helper doc)

      const led = await captureLedger(page, `${EV}/e2e-deaths-door-pin-b-ledger.png`);
      expect(led, 'a Night\'s Ledger card rendered (rig-sanity: today\'s plain retreat shows one too)').not.toBeNull();

      // Hamlet arrival holds true today too (a plain retreat also ends at hamlet) — not itself
      // a red signal, but confirms the rig reached a real terminal state before the state
      // assertions below.
      await expect.poll(() => currentScene(page), { timeout: 15_000 }).toBe('hamlet');

      const invAfter = await readState<Inventory>(page, 'inventory.json');
      expect(
        invAfter?.stacks?.[KEEPSAKE_TRINKET] ?? 0,
        'EXPECTED NOW: fails — no wipe mechanic exists yet, so the seeded trinket is never stripped',
      ).toBe(0);
      expect(
        invAfter?.stacks?.[PROTECTED_RELIC] ?? 0,
        'the relic is never touched (protected control — true both before and after Task 5/6)',
      ).toBe(1);

      expect(
        led?.signoff,
        'EXPECTED NOW: fails — today\'s retreat signoff is the generic empty-harvest line ' +
          '("A thin page is still a page. The Ledger keeps it.", overlay.ts:351-353), never ' +
          'Task 6\'s wipe-specific sign-off',
      ).toBe('The Fade took its due. The Ledger holds what matters.');
    } finally {
      await restoreState(page, beforeSave, beforeInv);
    }
  });

  test('Pin C — welded recall stands you back up: a box>=4 correct answer revives at 1 pool hp', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const beforeSave = await readState<Save>(page, 'save.json');
    const beforeInv = await readState<Inventory>(page, 'inventory.json');

    try {
      await seedSave(page);
      await seedInventory(page, {});
      // one welded (box 5, >= REVIVE_BOX=4), most-overdue fact -- the rest at box 1, less
      // overdue -- so the door's count-1 deal surfaces REVIVE_FACT first (dueQueue: most
      // overdue first, exact-ms — see seedSrsBaseline's doc for why no day-bucket noise
      // applies with one installed pack).
      await seedSrsBaseline(page, { factId: REVIVE_FACT, box: 5, overdueMs: 500_000 });

      await page.goto('/?scene=vaults&dev=1&sim=0&auto=win&seed=7');
      await waitReady(page, 'combat');

      await driveToZeroHp(page);
      await answerDeathSaveCorrect(page); // tolerant no-op today (see helper doc)

      const settled = await settleAfterZeroHp(page);
      await page.screenshot({ path: `${EV}/e2e-deaths-door-pin-c-settled-${settled ?? 'unknown'}.png` });

      expect(
        settled,
        'EXPECTED NOW: fails — today 0 HP retreats instantly, ending at hamlet instead of reviving mid-fight',
      ).not.toBe('hamlet');

      const dd = await ddSnap(page);
      expect(
        dd?.active,
        'the door has closed after the revive (deathsDoorSnapshot() does not exist yet today, so this reads undefined)',
      ).toBe(false);

      const s = await snap(page);
      expect(s?.state, 'the fight resumed under manual control').toBe('playerMove');
      expect(s?.partyHp, 'the pool stands at exactly 1 after the welded revive').toBe(1);
    } finally {
      await restoreState(page, beforeSave, beforeInv);
    }
  });
});
