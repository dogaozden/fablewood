import { test, expect, type Page } from '@playwright/test';
import { waitReady, currentScene, waitForState, readState } from './helpers';

// "The Night's Ledger" (fun-review.md §3.2) — the run-harvest overlay DungeonScene shows when a
// run ENDS (boss victory / retreat), NOT after a mid-crawl room clear. Proves: run-end-only firing,
// the exit-specific subtitle, "Held against the Fade" always present, zero-row suppression.
// It's a DOM overlay (document.body child) so it's queryable directly.

const EV = 'screenshots';

interface LedgerSnap {
  title: string;
  sub: string;
  rows: Array<{ label: string; val: string }>;
  signoff: string;
}

/** Wait for the ledger, screenshot it, then grab it in one atomic read — the auto-drive path
 *  dismisses it after a beat, so capture the visual first, then read all the text at once. */
async function captureLedger(page: Page, shotPath: string): Promise<LedgerSnap | null> {
  await page.locator('.fw-overlay .fw-ledger-title').waitFor({ state: 'visible', timeout: 30_000 });
  // Read the load-bearing data FIRST (one atomic evaluate) — under fleet CPU load a slow
  // screenshot must never let the auto-advance dismiss the ledger before we've captured it.
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
  await page.screenshot({ path: shotPath });
  return data;
}

// The retreat test wipes the pool to 0; reset HP afterwards so the shared STATE_DIR never
// strands a downstream combat spec at a near-death party (they rely on the default full pool).
test.afterEach(async ({ request }) => {
  await request.put('/api/state/save.json', { data: { hp: 16 } });
});

async function combatState(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): { state: string } } | undefined;
    return s?.combatSnapshot?.()?.state ?? null;
  });
}

type SrsEntry = {
  box: number;
  next_due: number;
  history: Array<{ ts: string; quality: 0 | 0.5 | 1; encounter_id: string }>;
};

/** Exactly three known vc-law facts, each with a genuinely correct, terse free_recall answer —
 *  deaths-door.spec.ts's REVIVE_FACT/REVIVE_ANSWER idiom, extended to three. Each answer was
 *  verified (not guessed) against its encounter's actual rubric in packs/vc-law/pack.json by
 *  replicating judge/stub.ts's exact scoring algorithm: every one scores overlap 1.0 / pass —
 *  genuinely on-topic and terse, the same legitimate shape as combat.spec.ts's own canonical
 *  "Economics and control." (stub.ts's own doc: terse-but-correct answers are BY DESIGN able to
 *  reach pass without repeating the rubric's prose — this is the judge working as intended, not
 *  gamed). All three are free_recall-ONLY facts in the pack (no competing mcq encounter shares
 *  their fact_id), so DD_KINDS's ['free_recall', 'mcq'] filter (CombatScene.ts:99) can only ever
 *  land on the free_recall renderer for them — no kind ambiguity to resolve at runtime. */
const STABILIZE_FACTS: ReadonlyArray<{ factId: string; answer: string }> = [
  { factId: 'vc.econ.liqpref.preference-plus-participation', answer: 'Preference and participation.' },
  { factId: 'vc.econ.paytoplay.ubiquitous-after-dotcom', answer: "It converts to common stock, losing its preferred rights." },
  { factId: 'vc.econ.antidilution.purpose', answer: 'A down round: the company issuing new equity at a lower price.' },
];

/** Seed exactly the three facts above at box 1 (safely below REVIVE_BOX=4 — deathsdoor.ts:6)
 *  with strictly decreasing next_due (most overdue first), so the door's due-first ddDraw
 *  (CombatScene.ts:2770-2784, services.draw.due()) deals them in this EXACT order, one fact per
 *  stabilize round. After each correct answer, leitner.ts's record() promotes the fact's box and
 *  pushes next_due 3 days out (BOX_INTERVALS[2]), dropping it out of due() range for the rest of
 *  the run — so the next round deterministically deals the NEXT entry, never a repeat. Every
 *  other installed fact is left untouched (absent from srs.json): "fresh," but never reached,
 *  since due() never empties before all three seeded entries are spent. The drive-to-zero phase
 *  above answers nothing (Wait-grind only, no Cast), so nothing can consume these before the
 *  door itself opens. */
async function seedStabilizeFacts(page: Page): Promise<void> {
  const now = Date.now();
  const facts: Record<string, SrsEntry> = {};
  STABILIZE_FACTS.forEach(({ factId }, i) => {
    facts[factId] = { box: 1, next_due: now - (500_000 - i * 100_000), history: [] };
  });
  const res = await page.request.put('/api/state/srs.json', { data: { version: 1, facts } });
  expect(res.ok(), 'seeded the three known stabilize facts').toBe(true);
}

/** Answer one stabilize round with the KNOWN correct text for round `i`'s fact — deaths-door.
 *  spec.ts's answerDeathSaveCorrect idiom (fill, Cast, wait the verdict, Onward), but not
 *  tolerant/best-effort like that pre-mechanic original: the door is live now, so a missing
 *  drill here is a real failure, not an expected no-op. */
async function answerStabilizeRound(page: Page, i: number): Promise<void> {
  const ta = page.locator('.fw-overlay .fw-textarea');
  await ta.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(450); // overlay.ts's paint-anchored answer guard (shared idiom)
  await ta.fill(STABILIZE_FACTS[i].answer);
  await page.getByRole('button', { name: 'Cast' }).click();
  const onward = page.getByRole('button', { name: 'Onward ▸' });
  await onward.waitFor({ state: 'visible', timeout: 15_000 });
  await onward.click();
}

test('no Night\'s Ledger after a mid-run room clear — only at run end', async ({ page }) => {
  test.setTimeout(60_000);
  // auto=win sim-clears a single normal room mid-crawl; the ledger must NOT fire here (§3.2 rescope).
  await page.goto('/?scene=vaults&dev=1&auto=win&seed=7');
  await waitReady(page, 'vaults');
  // wait until the room-clear has settled (persisted) — a ledger WOULD have shown by now if it fired
  await waitForState(page, 'save.json', (s: { dungeon?: { cleared?: string[] } } | null) =>
    !!s?.dungeon?.cleared?.includes('under-1'),
  );
  await expect(
    page.locator('.fw-overlay .fw-ledger-title'),
    'no run-end ledger mid-crawl',
  ).toHaveCount(0);
});

test('Night\'s Ledger at boss victory (run end): title, "vault stands cleared", Held always shown, zero rows suppressed', async ({ page }) => {
  test.setTimeout(60_000);
  // auto=boss sim-clears to the Vault-Warden → bossVictory → vaultOpensBeat → the run-end ledger.
  await page.goto('/?scene=vaults&dev=1&auto=boss&seed=7');

  const led = await captureLedger(page, `${EV}/e2e-nights-ledger-victory.png`);
  expect(led, 'the ledger rendered').not.toBeNull();

  expect(led!.title).toBe("The Night's Ledger");
  expect(led!.sub).toContain('the vault stands cleared');

  const labels = led!.rows.map((r) => r.label);
  // "Held against the Fade" always shows, even at zero.
  expect(labels).toContain('Held against the Fade');
  // sim victory answered nothing → these stats are 0 → their rows are suppressed.
  expect(labels, 'Newly welded row suppressed at zero').not.toContain('Newly welded');
  expect(labels, 'Reclaimed row suppressed at zero').not.toContain('Reclaimed from the Fade');
  // a cleared room bumps the streak, so that row renders as "N nights".
  const streak = led!.rows.find((r) => r.label === 'Vigil');
  expect(streak, 'Vigil row present after a victory').toBeTruthy();
  expect(streak!.val).toMatch(/\d+ nights?$/);
});

test('Night\'s Ledger on retreat: "a wise withdrawal" subtitle after stabilizing at death\'s door', async ({ page }) => {
  test.setTimeout(90_000);
  // near-death party → the pool hits 0 fast; real combat (sim=0) so it flows through Death's
  // Door (Wave 2: 0 HP no longer retreats instantly — it opens the hold-the-line drill,
  // CombatScene.ts's enterDeathsDoor). Three correctly-answered drills stabilize the door, which
  // resolves through the SAME CombatScene.resolveBattle('retreat') → DungeonScene.resolveCombat
  // retreat branch this test asserted on pre-Wave-2 — deathsdoor.ts's stabilizeAtDoor calls it
  // "the pre-door retreat, byte-for-byte".
  // srs.json isn't this test's to permanently rewrite — capture whatever it held before
  // seeding (deaths-door.spec.ts's tests leave their own seeded facts behind for downstream
  // specs in the shared, serial suite, so this may well be non-empty) and restore it in
  // `finally`, mirroring this file's own hp:16 afterEach discipline above.
  const beforeSrs = await readState<{ version: number; facts: Record<string, unknown> }>(page, 'srs.json');
  try {
    await page.request.put('/api/state/save.json', { data: { hp: 2 } });
    await seedStabilizeFacts(page);
    await page.goto('/?scene=vaults&dev=1&sim=0&auto=win&seed=7');
    await waitReady(page, 'combat');

    // Only ever Wait — the party never fights back, so the wisps close in and the pool wipes.
    const start = Date.now();
    while (Date.now() - start < 75_000) {
      if ((await currentScene(page)) !== 'combat') break;
      const st = await combatState(page);
      if (st === null || st === 'over' || st === 'deathsdoor') break;
      if (st === 'playerMove') await page.keyboard.press('7'); // Wait
      await page.waitForTimeout(150);
    }

    // The door opened: drive through it via the stabilize path. The three seeded facts sit at
    // box 1, safely below REVIVE_BOX=4 (deathsdoor.ts:6), so each correct answer increments
    // `successes` rather than tripping the revive preempt — three successes is 'stabilized'
    // (deathsdoor.ts's SUCCESS_NEED), dealt in STABILIZE_FACTS order (see seedStabilizeFacts).
    if ((await combatState(page)) === 'deathsdoor') {
      for (let i = 0; i < STABILIZE_FACTS.length; i++) {
        await answerStabilizeRound(page, i);
      }
    }

    const led = await captureLedger(page, `${EV}/e2e-nights-ledger-retreat.png`);
    expect(led, 'the ledger rendered on retreat').not.toBeNull();
    expect(led!.title).toBe("The Night's Ledger");
    expect(led!.sub).toContain('a wise withdrawal');
    // "Held against the Fade" shows even on a thin retreat page.
    expect(led!.rows.map((r) => r.label)).toContain('Held against the Fade');
  } finally {
    await page.request.put('/api/state/srs.json', { data: beforeSrs ?? { version: 1, facts: {} } });
  }
});
