import { test, expect, type Page } from '@playwright/test';
import { waitReady, currentScene, readState } from './helpers';

// Night's Ledger (fun-review.md §3.2) on a GATE-EXHAUSTION retreat — distinct from
// nights-ledger.spec.ts's combat-wipe retreat test. A free_recall gate (DungeonScene.runGate)
// drains HP 1 per miss with an immediate retry (never real combat); hitting 0 HP mid-gate used
// to end the run silently (scene.start('hamlet'), no ledger at all) — unlike resolveCombat's own
// top-level retreat branch, which already ledgers. Fixed by threading this room's already-won
// combat `outcome` into runGate so an HP-out there can fold it in and fire the ledger too.
//
// Deterministic drive: ?auto=full sim-clears under-1/under-2 (no gate, no HP cost — doCombat's
// sim branch always reports hpLost:0), then under-3's REAL free_recall gate pauses runGate
// awaiting a real overlay answer. ESC in a 'drill' context (overlay.ts's ESC policy) always
// grades quality:0 regardless of judge/content, so 16 ESCs (PARTY_MAX_HP=16, GATE_FAIL_HP=1)
// drain the pool to exactly 0 without depending on the stub judge's keyword heuristic at all
// (still run under JUDGE_MODE=stub, per house convention for every dev/e2e server).

const EV = 'screenshots';

type Save = {
  scene?: string;
  hp?: number;
  streak?: number;
  lastPlayed?: string;
  dungeon?: { roomIndex: number; cleared: string[]; gatePending?: string };
};

interface LedgerSnap {
  title: string;
  sub: string;
  rows: Array<{ label: string; val: string }>;
  signoff: string;
}

/** Same atomic-read-then-screenshot idiom as nights-ledger.spec.ts's captureLedger — driving via
 *  ?auto=full passes {auto:true} to showNightLedger, which auto-dismisses after a 2s beat, so
 *  grab the load-bearing text FIRST, then settle-poll opacity before the screenshot (waitChipSettled
 *  idiom, redemption-bell.spec.ts): the overlay fades in over .22s (styles.ts's fw-fade), and a
 *  screenshot mid-fade reads as washed out. */
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

async function restoreSave(page: Page, save: Save | null): Promise<void> {
  const data: Save = save ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
  await page.request.put('/api/state/save.json', { data });
}

test("gate HP-out (free_recall drill drains the pool) fires the Night's Ledger retreat card", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const beforeSave = await readState<Save>(page, 'save.json');

  try {
    await page.request.put('/api/state/save.json', {
      data: { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '', dungeon: { roomIndex: 0, cleared: [] } },
    });

    await page.goto('/?scene=vaults&dev=1&auto=full&seed=7');
    // auto=full's own runAuto doesn't call markReadyOnce() until it COMPLETES — which here
    // blocks on the gate below — so READY only arrives via create()'s 8s fallback timer.
    // boss-victory.spec.ts's dungeon-path test hits the identical situation; same fix: wait
    // generically, don't assert an intermediate scene.
    await waitReady(page);

    // Drive the free_recall gate to exhaustion. The loop watches for the Night's Ledger
    // overlay specifically (a DIFFERENT overlay, mounted only after HP hits 0) so it never
    // presses Escape past the moment it should stop and capture instead.
    let ledgerUp = false;
    for (let attempt = 0; attempt < 20 && !ledgerUp; attempt++) {
      await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
      if (await page.locator('.fw-ledger-title').count()) {
        ledgerUp = true;
        break;
      }
      await page.waitForTimeout(500); // past the overlay's 400ms arm guard (shared idiom)
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250); // let applyHp + toast + the next mount settle
    }
    expect(ledgerUp, 'the gate drained to 0 HP within 20 attempts and the ledger mounted').toBe(true);

    const led = await captureLedger(page, `${EV}/e2e-gate-retreat-ledger.png`);
    expect(led, 'the ledger rendered').not.toBeNull();
    expect(led!.title).toBe("The Night's Ledger");
    // same retreat subtitle as a combat wipe (LEDGER_SUBTITLE.retreat) — a gate HP-out is
    // run-ending exactly the same way, which is the whole point of this fix.
    expect(led!.sub).toContain('a wise withdrawal');
    expect(led!.rows.map((r) => r.label), '"Held against the Fade" always shows').toContain(
      'Held against the Fade',
    );

    // the ledger blocks scene.start('hamlet') until it closes (runGate awaits runNightLedger
    // before scene.start) — confirm the walk home actually completes afterward.
    await expect.poll(() => currentScene(page), { timeout: 10_000 }).toBe('hamlet');

    const saveAfter = await readState<Save>(page, 'save.json');
    expect(saveAfter?.hp, 'HP bottomed out at exactly 0').toBe(0);
    expect(saveAfter?.scene, 'persisted scene:hamlet (V1-3 pattern: saved before scene.start)').toBe(
      'hamlet',
    );
    // the retreat itself never bumps the streak — but under-1/under-2 are normal (non-gated,
    // non-boss) rooms, and resolveCombat's own normal-clear path bumps streak on EVERY such
    // room, not just a full dungeon clear — so it's 2 (one per room), not 0, entering the gate.
    expect(saveAfter?.streak, 'streak reflects under-1/under-2s clears; the gate retreat adds none').toBe(
      2,
    );
    // rooms 1+2 (no gate) cleared; the gate room's OWN combat is credited too, but as a
    // pending ward rather than a clear (V1-12 as amended by crucible-2: an unopened ward is
    // not a passed vault, yet its won fight must never be re-litigated). That pending id is
    // what proves this run genuinely threaded through the real gate room, not some other
    // retreat path.
    expect(saveAfter?.dungeon?.cleared, 'the non-gated rooms cleared, in order').toEqual([
      'under-1',
      'under-2',
    ]);
    expect(saveAfter?.dungeon?.gatePending, "the gate room's won combat is banked, not cleared").toBe(
      'under-3',
    );
  } finally {
    await restoreSave(page, beforeSave);
  }
});
