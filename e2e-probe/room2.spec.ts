/**
 * TRANSIENT PROBE — never committed. Room-2 re-entrancy evidence run.
 *
 * Plays the REAL player path from a clean boot: title → hamlet → South Gate →
 * Preference Vaults → room 1 (The Threshold Ledger) combat to victory on free
 * Strikes → gate door (free_recall, stub-passing answer) → room 2 (The
 * Option-Pool Shuffle) → combat. Then INSTRUMENTS the second combat: unit roster,
 * duplicate ids, initiative order, and whether actions still resolve (liveness).
 * It never hard-fails on the metrics — it is an instrument; the run label
 * (PROBE_LABEL=bug|fixed) names the screenshot + log lines for the report.
 */
import { test, expect, type Page } from '@playwright/test';
import { waitReady, currentScene, walkHamletTo, enterVaultsViaGate, canvasClick } from '../e2e/helpers';

const SHOT = 'screenshots/polish';
const CAST_ANSWER =
  'Economics and control are the two things that matter in a term sheet. Economics is the investor return in a liquidity event and the terms that drive it; control is the mechanisms letting investors direct or veto company decisions.';

type CombatRead = {
  units: Array<{ id: string; team: string; alive: boolean; hp: number }>;
  state: string;
  activeId: string;
  order: string[];
  log: Array<{ action: string; dmg: number; overlay: boolean }>;
} | null;

function readCombat(page: Page): Promise<CombatRead> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as Record<string, unknown> | undefined;
    if (!s || !Array.isArray(s.units)) return null;
    return {
      units: (s.units as Array<Record<string, unknown>>).map((u) => ({
        id: String(u.id), team: String(u.team), alive: !!u.alive, hp: Number(u.hp),
      })),
      state: String(s.state),
      activeId: String(s.activeId),
      order: ((s.order as string[]) ?? []).slice(),
      log: (((s.actionLog as unknown[]) ?? []) as Array<{ action: string; dmg: number; overlay: boolean }>).slice(),
    };
  });
}

async function setPilot(page: Page, kind: string | null): Promise<void> {
  await page.evaluate((k) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { setPilotPreference?(k: string | null): void } | undefined;
    s?.setPilotPreference?.(k);
  }, kind);
}

async function closeTeaching(page: Page): Promise<void> {
  const tbtn = page.locator('.fw-footer .fw-btn-primary');
  for (let i = 0; i < 10; i++) {
    if (!(await page.locator('.fw-doc').count())) break;
    const label = (await tbtn.innerText().catch(() => '')) || '';
    if (!label) break;
    await tbtn.click();
    if (label.includes('Close')) break;
    await page.waitForTimeout(160);
  }
}

test('room-2 probe: two real dungeon combats in one clean session', async ({ page }) => {
  const label = process.env.PROBE_LABEL ?? 'probe';
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // clean boot → hamlet → vaults (real input; helper has a sanctioned warp fallback)
  await page.goto('/?seed=7&demo=1');
  await waitReady(page, 'boot');
  await page.keyboard.press('Enter');
  await waitReady(page, 'hamlet');
  await walkHamletTo(page, 248, 204, 14);
  expect(await enterVaultsViaGate(page), 'entered the Preference Vaults').toBe(true);
  await waitReady(page, 'vaults');

  // ---- room 1: The Threshold Ledger ----
  await canvasClick(page, 226, 300);
  await page.waitForTimeout(650);
  await canvasClick(page, 478, 365); // "Descend"
  await page.locator('.fw-doc').waitFor({ state: 'visible', timeout: 10_000 });
  await closeTeaching(page);
  await page.waitForFunction(() => window.__FABLEWOOD_STATE?.scene === 'combat', undefined, { timeout: 20_000 });
  await setPilot(page, 'strike'); // free strikes only — combat 1 must finish with zero overlays
  await page.waitForFunction(() => window.__FABLEWOOD_STATE?.scene === 'vaults', undefined, { timeout: 120_000 });
  console.log(`[${label}] combat 1 resolved (free strikes only)`);

  // ---- gate door (free_recall): known stub-passing answer ----
  await page.locator('.fw-textarea').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.fw-textarea').fill(CAST_ANSWER);
  await page.getByRole('button', { name: 'Cast' }).click();
  const cont = page.getByRole('button', { name: 'Continue' });
  await cont.waitFor({ state: 'visible', timeout: 15_000 });
  await cont.click();
  await page.waitForTimeout(1600); // loot + node advance

  // ---- room 2: The Option-Pool Shuffle ----
  await canvasClick(page, 355, 300);
  await page.waitForTimeout(650);
  await canvasClick(page, 478, 365); // "Descend"
  const hasDoc = await page.locator('.fw-doc').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
  if (hasDoc) await closeTeaching(page);
  await page.waitForFunction(() => window.__FABLEWOOD_STATE?.scene === 'combat', undefined, { timeout: 20_000 });
  await page.waitForTimeout(1500); // create() + first turn settle

  const snap = await readCombat(page);
  const party = snap?.units.filter((u) => u.team === 'party') ?? [];
  const dupIds = (snap?.units ?? []).map((u) => u.id).filter((id, i, a) => a.indexOf(id) !== i);
  await page.screenshot({ path: `${SHOT}/cycle-strike-room2-${label}.png` });

  // liveness: with the strike pilot, does the action log grow?
  await setPilot(page, 'strike');
  const startLen = snap?.log.length ?? 0;
  let liveness = 'locked-or-idle';
  const t0 = Date.now();
  while (Date.now() - t0 < 25_000) {
    if ((await currentScene(page)) !== 'combat') { liveness = 'combat-resolved'; break; }
    const s2 = await readCombat(page);
    if ((s2?.log.length ?? 0) > startLen) { liveness = 'actions-resolving'; break; }
    await page.waitForTimeout(400);
  }

  console.log(`[${label}] ROOM2 VERDICT: ${JSON.stringify({
    partyCount: party.length,
    totalUnits: snap?.units.length ?? -1,
    dupIds,
    order: snap?.order,
    state: snap?.state,
    liveness,
    pageErrors: pageErrors.slice(0, 3),
  })}`);
  console.log(`[${label}] ROOM2 UNITS: ${JSON.stringify(snap?.units)}`);
});
