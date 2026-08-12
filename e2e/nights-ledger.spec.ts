import { test, expect, type Page } from '@playwright/test';
import { waitReady, currentScene, waitForState } from './helpers';

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

type DoorSnap = { active: boolean; successes: number; failures: number; revivedUsed: boolean } | null;

/** Death's door's live state (deaths-door.spec.ts's ddSnap, verbatim) — paces the stabilize
 *  loop below: waits for a round to actually resolve before driving the next one. */
async function ddSnap(page: Page): Promise<DoorSnap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { deathsDoorSnapshot?(): unknown } | undefined;
    return (s?.deathsDoorSnapshot?.() ?? null) as DoorSnap;
  });
}

type DoorEncounter = { kind: string; options?: string[]; answer?: string; rubric?: string };

/** Every installed encounter (deaths-door.spec.ts's installedFactIds idiom, widened from fact
 *  ids to full encounters). Needed because, unlike deaths-door.spec.ts's Pin C, this test seeds
 *  no srs.json: every fact starts at box 0 (no history), so a correctly-answered fact is
 *  promoted (leitner.ts's BOX_INTERVALS[2] = 3 days) out of due()/fresh() range for the rest of
 *  the run — each of the three stabilize rounds below can land on a DIFFERENT, a priori unknown
 *  fact. No single hardcoded fact/answer pair (à la deaths-door.spec.ts's REVIVE_FACT/
 *  REVIVE_ANSWER) covers all three, so this reads the whole pack once instead. */
async function installedEncounters(page: Page): Promise<DoorEncounter[]> {
  const res = await page.request.get('/api/packs');
  expect(res.ok(), 'read installed packs').toBe(true);
  const { packs } = (await res.json()) as { packs: Array<{ pack?: { encounters?: DoorEncounter[] } }> };
  const out: DoorEncounter[] = [];
  for (const entry of packs) for (const e of entry.pack?.encounters ?? []) out.push(e);
  return out;
}

/** A free_recall answer that clears the stub judge (judge/stub.ts) for ANY of the pack's
 *  free_recall rubrics, not just one it was written against: the judge's overlap denominator is
 *  max(2, min(|rubric keys|, |answer words|)), so an answer that's a strict superset of a
 *  rubric's own keywords always scores hit=|keys|, denom=|keys| → overlap 1.0 → pass, no matter
 *  which rubric is being graded (verified against every free_recall rubric in packs/vc-law/
 *  pack.json before writing this — none carry {{template_vars}}, so the literal rubric text
 *  always matches verbatim, unlike prompts). */
function freeRecallAnswerBlob(encounters: DoorEncounter[]): string {
  return encounters
    .filter((e) => e.kind === 'free_recall' && typeof e.rubric === 'string')
    .map((e) => e.rubric)
    .join(' ');
}

function sameOptionSet(packOptions: string[] | undefined, rendered: string[]): boolean {
  if (!packOptions || packOptions.length !== rendered.length) return false;
  const a = [...packOptions].sort();
  const b = [...rendered].sort();
  return a.every((v, i) => v === b[i]);
}

/** One death-save round, answered correctly regardless of which fact/kind Death's Door drew
 *  (DD_KINDS is ['free_recall', 'mcq'] — CombatScene.ts:99): free_recall gets the blanket
 *  rubric-superset answer above; mcq gets whichever rendered `.fw-optlabel` matches the pack
 *  encounter (identified by its option SET, since option text carries no template vars either)
 *  own authored `answer` — boss-victory.spec.ts's "match by option TEXT, never position" idiom.
 *  Every installed fact sits at box 0 here (REVIVE_BOX is 4), so a correct answer always lands
 *  recordAnswer's `successes` branch, never the revive preempt. Polls deathsDoorSnapshot()
 *  afterward rather than sleeping a fixed beat: a correct mcq pick auto-advances with NO Onward
 *  click (renderMcq's own setTimeout), and its now-disabled .fw-opt cards stay mounted, so the
 *  next round's drill-wait could otherwise resolve instantly against the STALE round. */
async function answerDoorRoundCorrect(
  page: Page,
  encounters: DoorEncounter[],
  freeRecallBlob: string,
): Promise<void> {
  const before = await ddSnap(page);
  const beforeRounds = (before?.successes ?? 0) + (before?.failures ?? 0);

  const drill = page.locator('.fw-overlay .fw-textarea, .fw-overlay .fw-opt').first();
  await drill.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(450); // overlay.ts's paint-anchored answer guard (shared idiom)

  const ta = page.locator('.fw-overlay .fw-textarea');
  if (await ta.count()) {
    await ta.fill(freeRecallBlob);
    await page.getByRole('button', { name: 'Cast' }).click();
    const onward = page.getByRole('button', { name: 'Onward ▸' });
    await onward.waitFor({ state: 'visible', timeout: 15_000 });
    await onward.click();
  } else {
    const labels = await page.locator('.fw-optlabel').allTextContents();
    const enc = encounters.find((e) => e.kind === 'mcq' && sameOptionSet(e.options, labels));
    if (!enc?.answer) {
      throw new Error(`answerDoorRoundCorrect: no pack mcq matches rendered options ${JSON.stringify(labels)}`);
    }
    const idx = labels.indexOf(enc.answer);
    expect(idx, `the pack's authored answer is among the rendered options: ${JSON.stringify(labels)}`).toBeGreaterThanOrEqual(0);
    await page.locator('.fw-opt').nth(idx).click();
  }

  await expect
    .poll(async () => {
      const s = await ddSnap(page);
      if (!s?.active) return true; // door closed: stabilized (or wiped/revived) — round resolved
      return s.successes + s.failures > beforeRounds; // still open: moved on to the next round
    }, { timeout: 5_000 })
    .toBe(true);
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
  const streak = led!.rows.find((r) => r.label === 'Streak');
  expect(streak, 'Streak row present after a victory').toBeTruthy();
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
  await page.request.put('/api/state/save.json', { data: { hp: 2 } });
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

  // The door opened: drive through it via the stabilize path. Every fact here sits at box 0
  // (this test seeds no srs.json), safely below REVIVE_BOX=4 (deathsdoor.ts:6), so each correct
  // answer increments `successes` rather than tripping the revive preempt — three successes is
  // 'stabilized' (deathsdoor.ts's SUCCESS_NEED).
  if ((await combatState(page)) === 'deathsdoor') {
    const encounters = await installedEncounters(page);
    const freeRecallBlob = freeRecallAnswerBlob(encounters);
    for (let i = 0; i < 3; i++) {
      await answerDoorRoundCorrect(page, encounters, freeRecallBlob);
    }
  }

  const led = await captureLedger(page, `${EV}/e2e-nights-ledger-retreat.png`);
  expect(led, 'the ledger rendered on retreat').not.toBeNull();
  expect(led!.title).toBe("The Night's Ledger");
  expect(led!.sub).toContain('a wise withdrawal');
  // "Held against the Fade" shows even on a thin retreat page.
  expect(led!.rows.map((r) => r.label)).toContain('Held against the Fade');
});
