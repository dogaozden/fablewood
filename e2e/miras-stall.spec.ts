import { test, expect, type Page } from '@playwright/test';
import {
  waitReady,
  currentScene,
  readState,
  waitForState,
  canvasClick,
  waitHamletPlayer,
  warpHamletTo,
  tapKey,
} from './helpers';
// Fix round 1 (task-4-review.md M1) — pure, no-Phaser module (CombatScene.ts's own header calls
// grid/initiative/damage/boss/ai "the pure logic modules"), safe to import directly in a node
// test process. Used once below to assert the damage pin's grace-exclusion precondition
// structurally, the same computation the reviewer ran standalone to verify it by hand.
import { buildLayout } from '../app/src/game/combat/grid';

const EV = 'screenshots';

type Snap = {
  state: string;
  activeId: string;
  log: Array<{ action: string; dmg: number; overlay: boolean }>;
  /** Ch. VII Mira's Stall — e2e-only debug read (combatSnapshot's `armedAid` field, Task 2). */
  armedAid: { itemId: string; kind: string } | null;
  /** Ch. VI — W6's turn budget (combatSnapshot's own field). The rebase round reads
   *  `actionSpent` in two places: to drive turns like a player, and to pin the Satchel's
   *  action cost at the budget itself rather than at an actionLog entry that gets pushed
   *  either way (final review C1). */
  budget: { total: number; left: number; legSpent: boolean; actionSpent: boolean; pressedOn: boolean };
} | null;

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as Snap;
  });
}

/** Debug: the HUD banner's current text (e2e-only — same forwarding method combat-magic.spec.ts/
 *  v1fix-arts.spec.ts already use to assert dynamic banner copy). */
async function bannerText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { bannerText?(): string } | undefined;
    return s?.bannerText?.() ?? '';
  });
}

/** Wait for the Keeper's own OPEN turn — open meaning the turn's one action is still unspent.
 *
 *  Mira (speed 4, right behind the Keeper's 5 in this fixture's fixed initiative —
 *  initiative.ts sorts by speed desc, party before enemy on a tie) gets her own manual
 *  playerMove turn too, so a plain "any playerMove" wait (fine for existing single-turn specs)
 *  would stop on HER turn the second time this is called. End Turn ('7') waits her out.
 *
 *  W6 rebase — the same key now also closes a Keeper turn that has already acted. Pre-W6 every
 *  action ended the turn outright, so "the Keeper is at playerMove" and "the Keeper can act"
 *  were the same statement. Post-W6 they are not: Ch. VI's move·act·move economy returns the
 *  actor to its own action menu with banked movement and a "Steps remain" banner, and every
 *  further action is refused at the source (CombatScene's `if (this.budget.actionSpent)
 *  return`). Without this, every drive below that acts twice returned instantly on the SAME
 *  spent turn and then silently stalled — the pane never opening, or the cast key doing
 *  nothing. A drive that wants another action has to close the turn like a real player would;
 *  boss-victory.spec.ts:251 set that precedent for W6's own boss drives. The press is
 *  conditional on actionSpent, so a turn W6's gate already ended is never double-pressed. */
async function waitForKeeperTurn(page: Page, timeout = 30_000): Promise<Snap> {
  const start = Date.now();
  let s = await snap(page);
  while (Date.now() - start < timeout) {
    if ((await currentScene(page)) !== 'combat') return null; // fight resolved early
    s = await snap(page);
    if (s?.state === 'playerMove') {
      if (s.activeId === 'keeper' && !s.budget?.actionSpent) return s;
      await page.keyboard.press('7'); // End Turn — waits Mira out, or closes a spent Keeper turn
    }
    await page.waitForTimeout(150);
  }
  return s;
}

/** combat-magic.spec.ts / lantern-light.spec.ts's own debug-positioning idiom (own-file
 *  convention — each e2e spec clones the helpers it needs rather than importing across files). */
async function debugSetPos(page: Page, id: string, c: number, r: number): Promise<void> {
  await page.evaluate(
    ({ id: uid, c: cc, r: rr }) => {
      const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
      const s = g?.scene?.getScene?.('combat') as { debugSetPos?(id: string, c: number, r: number): void } | undefined;
      s?.debugSetPos?.(uid, cc, rr);
    },
    { id, c, r },
  );
}

/** Arm the Hint via the Satchel (Task 2's own flow) — shared setup for the fire scenarios below.
 *  Must be called on the Keeper's own open turn; spends it (same turn-cost shape as heal/glow). */
async function armHint(page: Page): Promise<void> {
  await page.keyboard.press('q');
  await page.locator('.inv-overlay').waitFor({ state: 'visible', timeout: 5_000 });
  const hintRow = page.locator('.inv-row', { hasText: "Scrivener's Hint" });
  await hintRow.getByRole('button', { name: 'Use' }).click();
  await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(250); // let useSatchelItem's arm branch land + the banner render
}

/** Arm the Second Wind Seal via the Satchel — mirrors armHint exactly, targeting the other
 *  trial tool's row. Shared setup for Task 4's fire scenario below. */
async function armSeal(page: Page): Promise<void> {
  await page.keyboard.press('q');
  await page.locator('.inv-overlay').waitFor({ state: 'visible', timeout: 5_000 });
  const sealRow = page.locator('.inv-row', { hasText: 'Second Wind Seal' });
  await sealRow.getByRole('button', { name: 'Use' }).click();
  await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(250); // let useSatchelItem's arm branch land + the banner render
}

type Srs = {
  facts?: Record<string, { box: number; next_due: number; history?: Array<{ ts: string; quality: 0 | 0.5 | 1; encounter_id: string }> }>;
};

// Ch. VII Mira's Stall, Task 4 — a known fact/answer pair for a deterministic Second Wind Seal
// retry, reused verbatim from e2e/deaths-door.spec.ts's own Pin C precedent: REVIVE_FACT carries
// a free_recall encounter (enc.fr.economics-vs-control) and REVIVE_ANSWER is a proven stub-judge
// PASS for it (redemption-bell.spec.ts:123, "a terse, correct answer clears the stub judge's
// keyword bar"). The wrong answer is the generic stub-judge FAIL trick (crucible-v1-package-a.
// spec.ts's answerGateWrong): near-zero keyword overlap fails against ANY rubric, so unlike the
// correct answer it doesn't need to be fact-specific.
const REVIVE_FACT = 'vc.econ.overview.economics-vs-control';
const REVIVE_ANSWER = 'Economics and control.';
const WRONG_ANSWER = 'zzz completely unrelated nonsense zzz qqq';

/** Every real installed fact id (deaths-door.spec.ts/redemption-bell.spec.ts's own idiom) — the
 *  combat draw is a global services.draw read, same pool as any other combat cast. */
async function installedFactIds(page: Page): Promise<string[]> {
  const res = await page.request.get('/api/packs');
  expect(res.ok(), 'read installed packs').toBe(true);
  const { packs } = (await res.json()) as { packs: Array<{ pack?: { facts?: Array<{ id: string }> } }> };
  const ids: string[] = [];
  for (const entry of packs) for (const f of entry.pack?.facts ?? []) ids.push(f.id);
  expect(ids.length, 'the installed pack has facts to seed').toBeGreaterThan(0);
  return ids;
}

/** Seed EVERY installed fact at box 1 (due, empty history), overriding REVIVE_FACT to be far
 *  MORE overdue — deaths-door.spec.ts's own seedSrsBaseline, verbatim technique: due()'s sort is
 *  exact-ms, and the e2e server installs exactly one pack (vc-law), so the override's next_due
 *  alone deterministically wins "most overdue" for a free_recall-kind combat draw, no same-day
 *  noise to dodge. Fresh empty history also sidesteps the shared .state-e2e directory's cross-run
 *  accumulation (the Hint scenarios above don't need this — they never assert an exact history
 *  length). */
async function seedSrsBaseline(page: Page): Promise<void> {
  const ids = await installedFactIds(page);
  const now = Date.now();
  const facts: NonNullable<Srs['facts']> = {};
  for (const id of ids) facts[id] = { box: 1, next_due: now - 5_000, history: [] };
  facts[REVIVE_FACT] = { box: 1, next_due: now - 999_999_999, history: [] };
  const res = await page.request.put('/api/state/srs.json', { data: { version: 1, facts } });
  expect(res.ok(), 'seeded state/srs.json through the dev bridge').toBe(true);
}

// Ch. VII Mira's Stall, Task 5 (Vigil break law + Ward of Focus) — hearth territory. Clones
// hearth-rest.spec.ts's own Save type + Cottage conversation choreography (dialogueBodyText/
// runCottageConversation/restoreSave) rather than importing across files: the established
// own-file helper-clone convention (combat-magic.spec.ts / lantern-light.spec.ts precedent).
type Save = {
  scene?: string;
  hp?: number;
  streak?: number;
  lastPlayed?: string;
  embers?: number;
  lastHearthAt?: string;
};

async function restoreSave(page: Page, save: Save | null): Promise<void> {
  const data: Save = save ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
  await page.request.put('/api/state/save.json', { data });
}

/** Read the live DialogueBox's currently-rendered page text (hearth-rest.spec.ts's own
 *  backdoor — TS `private` is erased at runtime; no purpose-built e2e getter exists). */
async function dialogueBodyText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const h = g?.scene?.getScene?.('hamlet') as
      | { dialogue?: { bodyText?: { text?: string } } }
      | undefined;
    return h?.dialogue?.bodyText?.text ?? '';
  });
}

/** Open the Cottage conversation, skip every page's typewriter, and close it —
 *  hearth-rest.spec.ts's own choreography verbatim (2N+1 taps for an N-page, no-choice
 *  dialogue). Returns the last page's fully-shown text, read right before the closing tap. */
async function runCottageConversation(page: Page, pageCount: number): Promise<string> {
  await tapKey(page, 'e'); // open (page 1 starts typing)
  await page.waitForTimeout(250);
  await tapKey(page, 'e'); // skip page 1's typewriter
  await page.waitForTimeout(200);
  for (let p = 1; p < pageCount; p++) {
    await tapKey(page, 'e'); // advance to the next page (starts typing)
    await page.waitForTimeout(250);
    await tapKey(page, 'e'); // skip its typewriter
    await page.waitForTimeout(200);
  }
  const lastPageText = await dialogueBodyText(page);
  await tapKey(page, 'e'); // the closing tap
  await page.waitForTimeout(200);
  return lastPageText;
}

/** A fixture lastHearthAt exactly N calendar days before today (LOCAL setDate arithmetic —
 *  the same calendar-day technique the break law itself reuses from canRestTonight, so the
 *  fixture and the implementation can never disagree about what "N days ago" means). */
function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// Ch. VII Mira's Stall, Task 2 (arming-model amendment): the combat Satchel used to filter
// usableSatchelItems down to heal|glow only — the trial tools (Scrivener's Hint/Second Wind
// Seal) stayed catalog/shop-only, with the encounter-surface hookup explicitly deferred
// (satchel.ts's own SCOPE comment, pre-this-task). This proves the Satchel now admits them,
// that using one ARMS it rather than consuming it on the spot (defer-removal law — the item
// count never drops), and that a second arm REPLACES the first (one live arm at a time).
test('combat Satchel admits trial tools; arming defers removal and a second arm replaces the first', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.request.put('/api/state/save.json', { data: { hp: 16 } });
  await page.request.put('/api/state/inventory.json', {
    data: { version: 1, gold: 20, stacks: { 'scriveners-hint': 1, 'second-wind-seal': 1 } },
  });

  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');

  let s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's first turn opened for manual control").toBe('playerMove');

  // ---- open the Satchel: the Hint tool row is present and clickable. Today (pre-fix)
  // usableSatchelItems filters reveal_option/retry_cast out entirely, so this row never
  // renders and this assertion is the RED signal.
  await page.keyboard.press('q');
  await page.locator('.inv-overlay').waitFor({ state: 'visible', timeout: 5_000 });
  const hintRow = page.locator('.inv-row', { hasText: "Scrivener's Hint" });
  await expect(hintRow.getByRole('button', { name: 'Use' })).toBeVisible({ timeout: 5_000 });
  await page.screenshot({ path: `${EV}/miras-stall-satchel-tools-admitted.png` });

  // ---- arm the Hint: verbatim banner, no consumption (defer-removal), turn spent (same
  // 560ms delayedCall -> endPlayerTurn shape heal/glow already use on this branch).
  await hintRow.getByRole('button', { name: 'Use' }).click();
  await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(250); // let useSatchelItem's new branch land + the banner render

  expect(await bannerText(page), 'Hint arm banner is the verbatim amendment copy').toBe(
    'The nib gleams — your next casting shows a false line struck.',
  );
  const armedAfterHint = (await snap(page))?.armedAid;
  expect(armedAfterHint, 'the Hint is armed').toEqual({ itemId: 'scriveners-hint', kind: 'reveal_option' });

  const invAfterHint = await readState<{ stacks?: Record<string, number> }>(page, 'inventory.json');
  expect(invAfterHint?.stacks?.['scriveners-hint'] ?? 0, 'arming does NOT consume the item (defer-removal law)').toBe(1);

  const used = await snap(page);
  expect(used?.log.at(-1)?.action, 'the arm resolved as a satchel action (spent the turn)').toBe('satchel');

  // ---- second Keeper turn: arm the Seal instead. This REPLACES the standing Hint arm —
  // one live arm at a time, old arm dissolved (item retained, no refund bookkeeping).
  s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's second turn opened").toBe('playerMove');

  await page.keyboard.press('q');
  await page.locator('.inv-overlay').waitFor({ state: 'visible', timeout: 5_000 });
  const sealRow = page.locator('.inv-row', { hasText: 'Second Wind Seal' });
  await expect(sealRow.getByRole('button', { name: 'Use' })).toBeVisible({ timeout: 5_000 });
  await sealRow.getByRole('button', { name: 'Use' }).click();
  await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(250);

  expect(await bannerText(page), 'Seal arm banner is the verbatim amendment copy').toBe(
    'The seal warms — a failed casting may be tried again, once.',
  );

  const finalArmed = (await snap(page))?.armedAid;
  expect(finalArmed, 'arming the Seal REPLACED the standing Hint arm — only the Seal is live now').toEqual({
    itemId: 'second-wind-seal',
    kind: 'retry_cast',
  });

  const invFinal = await readState<{ stacks?: Record<string, number> }>(page, 'inventory.json');
  expect(invFinal?.stacks?.['scriveners-hint'] ?? 0, 'the dissolved Hint arm cost nothing — item retained').toBe(1);
  expect(invFinal?.stacks?.['second-wind-seal'] ?? 0, 'the Seal is armed, not consumed').toBe(1);

  await page.screenshot({ path: `${EV}/miras-stall-arm-over-arm-replace.png` });
});

// Ch. VII Mira's Stall, Task 3 (Scrivener's Hint fires): an armed Hint strikes exactly one
// WRONG option on the next COMBAT cast — deterministic (first wrong option in presentation
// order, no rng anywhere near answers), never the correct one, inert (disabled, not clickable,
// no data-commit), and fires (consumes the item, clears the arm) only once genuinely answered.
test("armed Scrivener's Hint strikes one wrong MCQ option and fires on the answered cast", async ({ page }) => {
  test.setTimeout(90_000);
  await page.request.put('/api/state/save.json', { data: { hp: 16 } });
  await page.request.put('/api/state/inventory.json', {
    data: { version: 1, gold: 20, stacks: { 'scriveners-hint': 1 } },
  });

  // ?rank=1: the shared .state-e2e directory accumulates real SRS history across the suite's
  // runs, so the computed rank isn't stable — force Rank 1 so Smite casts T1 directly (no
  // tier flyout), same idiom as combat-magic.spec.ts's own Rank-1 tests.
  await page.goto('/?scene=combat&seed=7&rank=1');
  await waitReady(page, 'combat');

  let s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's first turn opened for manual control").toBe('playerMove');

  await armHint(page);
  expect((await snap(page))?.armedAid, 'the Hint is armed going into the cast').toEqual({
    itemId: 'scriveners-hint', kind: 'reveal_option',
  });

  s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's second turn opened, Hint still armed").toBe('playerMove');

  // dev-antechamber spawns enemies far from the party (combat-status.spec.ts's own note) — put
  // wisp-0 within Smite's range 2 (combat-magic.spec.ts's own (5,3)/(6,3) precedent).
  await debugSetPos(page, 'keeper', 5, 3);
  await debugSetPos(page, 'wisp-0', 6, 3);
  await page.keyboard.press('2'); // Smite (T1 Kindling, mcq)
  await page.waitForTimeout(150); // a bare `.press()` can race Phaser's own frame-tick handling
  expect((await snap(page))?.state, 'Rank 1 goes straight to targeting').toBe('playerTarget');

  await canvasClick(page, 192 + 6 * 48 + 24, 48 + 3 * 48 + 24); // wisp-0's tile

  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms arm guard
  await page.screenshot({ path: `${EV}/miras-stall-hint-strike.png` });

  // ---- exactly one wrong option struck, deterministic, inert.
  const struck = page.locator('.fw-opt.fw-struck');
  await expect(struck, 'exactly one option renders struck').toHaveCount(1);
  await expect(struck, 'the struck option is disabled').toBeDisabled();
  await expect(
    struck.locator('.fw-struck-sub'),
    'the struck sub-line is the verbatim amendment copy',
  ).toHaveText("— struck by the scrivener's hand");
  expect(
    await struck.getAttribute('data-commit'),
    'the struck option never carries the commit-button marking (W6 M2)',
  ).toBeNull();

  // ---- answer a DIFFERENT option to resolve the cast; the struck card is proven wrong (never
  // `is-correct`) regardless of which real fact this seed happens to draw.
  await page.locator('.fw-opt:not(.fw-struck)').first().click();
  await page.waitForTimeout(300);
  expect(
    await struck.evaluate((el) => el.classList.contains('is-correct')),
    'the struck option is never the correct answer',
  ).toBe(false);
  const onward = page.getByRole('button', { name: 'Onward ▸' });
  try {
    await onward.waitFor({ state: 'visible', timeout: 1500 });
    await onward.click();
  } catch { /* correct answer auto-resolves without a continue button (kinds.ts renderMcq) */ }

  // ---- fired: item deducted, arm cleared.
  const inv = await waitForState<{ stacks?: Record<string, number> }>(
    page, 'inventory.json', (i) => (i?.stacks?.['scriveners-hint'] ?? 0) === 0,
  );
  expect(inv?.stacks?.['scriveners-hint'] ?? 0, 'the Hint is consumed on fire').toBe(0);
  expect((await snap(page))?.armedAid, 'the arm is cleared after firing').toBeNull();
});

// Ch. VII Mira's Stall, Task 3 scenario b2: a lantern-raise mid-cast re-presents the SAME
// strikeOneFalse request — the strike persists across the redraw, and the Hint only fires
// (consumes, clears) once, on the eventual genuine answer, never on the sentinel re-present.
test('a lantern-raise redraw during a struck cast keeps the strike; the Hint fires once, on the eventual answer', async ({ page }) => {
  test.setTimeout(90_000);
  await page.request.put('/api/state/save.json', { data: { hp: 16, lanternLight: true } });
  await page.request.put('/api/state/inventory.json', {
    data: { version: 1, gold: 20, stacks: { 'scriveners-hint': 1 } },
  });

  await page.goto('/?scene=combat&seed=7&rank=1');
  await waitReady(page, 'combat');

  let s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's first turn opened for manual control").toBe('playerMove');

  await armHint(page);

  s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's second turn opened, Hint still armed").toBe('playerMove');

  await debugSetPos(page, 'keeper', 5, 3);
  await debugSetPos(page, 'wisp-0', 6, 3);
  await page.keyboard.press('2'); // Smite (T1 Kindling, mcq)
  await page.waitForTimeout(150);
  await canvasClick(page, 192 + 6 * 48 + 24, 48 + 3 * 48 + 24); // wisp-0's tile

  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms arm guard

  await expect(page.locator('.fw-opt.fw-struck'), 'struck before the raise').toHaveCount(1);
  await expect(page.locator('.fw-lantern-btn'), 'lanternLight:true shows the raise affordance').toBeVisible();

  await page.locator('.fw-lantern-btn').click();

  // The old overlay closes (170ms exit anim) and a fresh runEncounter re-presents from the
  // round's own drawn pool (draw-census law, unchanged) — same strikeOneFalse flag riding the
  // re-present request (T3 law: the redraw sentinel itself never fires the aid).
  await expect.poll(() => page.locator('.fw-lantern-btn').count(), { timeout: 15_000 }).toBe(0);
  await expect(page.locator('.fw-overlay')).toBeVisible();
  await page.waitForTimeout(450); // the re-presented overlay's OWN 400ms arm guard

  // ---- the strike persists across the redraw re-present.
  const struck = page.locator('.fw-opt.fw-struck');
  await expect(struck, 'exactly one option still renders struck after the redraw').toHaveCount(1);
  await expect(struck, 'the re-presented struck option is disabled').toBeDisabled();

  // ---- the redraw sentinel itself must NOT have fired the Hint (still armed, item retained).
  expect(
    (await snap(page))?.armedAid,
    'the Hint is still armed — the redraw sentinel never fires it',
  ).toEqual({ itemId: 'scriveners-hint', kind: 'reveal_option' });
  const invMidRedraw = await readState<{ stacks?: Record<string, number> }>(page, 'inventory.json');
  expect(invMidRedraw?.stacks?.['scriveners-hint'] ?? 0, 'not consumed yet — nothing was answered').toBe(1);

  // ---- answer the re-presented question; NOW the Hint fires, exactly once.
  await page.locator('.fw-opt:not(.fw-struck)').first().click();
  await page.waitForTimeout(300);
  const onward = page.getByRole('button', { name: 'Onward ▸' });
  try {
    await onward.waitFor({ state: 'visible', timeout: 1500 });
    await onward.click();
  } catch { /* correct answer auto-resolves without a continue button (kinds.ts renderMcq) */ }

  const inv = await waitForState<{ stacks?: Record<string, number> }>(
    page, 'inventory.json', (i) => (i?.stacks?.['scriveners-hint'] ?? 0) === 0,
  );
  expect(inv?.stacks?.['scriveners-hint'] ?? 0, 'the Hint fires exactly once, on the genuine answer').toBe(0);
  expect((await snap(page))?.armedAid, 'the arm is cleared after firing').toBeNull();
});

// Ch. VII Mira's Stall, Task 3 fix round 1 (Critical review finding): armedAid.kind + context
// alone aren't enough to gate the fire — Weave/Sequence/Cast all share context:'combat' with
// Smite too, but only renderMcq (kinds.ts) ever reads ctx.strikeOneFalse. Arms the Hint, casts
// a non-MCQ form (Cast From Memory / free_recall) and proves it resolves with NO consume and
// the arm still standing, then casts Smite on a later turn and proves the surviving arm still
// fires normally.
test('armed Hint survives a non-MCQ combat cast untouched; only an MCQ cast fires it', async ({ page }) => {
  test.setTimeout(90_000);
  await page.request.put('/api/state/save.json', { data: { hp: 16 } });
  await page.request.put('/api/state/inventory.json', {
    data: { version: 1, gold: 20, stacks: { 'scriveners-hint': 1 } },
  });

  await page.goto('/?scene=combat&seed=7&rank=1');
  await waitReady(page, 'combat');

  let s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's first turn opened for manual control").toBe('playerMove');

  await armHint(page);

  // ---- second Keeper turn: Cast From Memory (free_recall) — context:'combat' just like
  // Smite, but a different encounter kind; renderFreeRecall never reads ctx.strikeOneFalse.
  s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's second turn opened, Hint still armed").toBe('playerMove');

  await debugSetPos(page, 'keeper', 5, 3);
  await debugSetPos(page, 'wisp-0', 6, 3);
  await page.keyboard.press('5'); // Cast From Memory (T1, free_recall)
  await page.waitForTimeout(150);
  expect((await snap(page))?.state, 'Rank 1 goes straight to targeting').toBe('playerTarget');
  await canvasClick(page, 192 + 6 * 48 + 24, 48 + 3 * 48 + 24); // wisp-0's tile

  await page.locator('.fw-textarea').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms arm guard
  await expect(
    page.locator('.fw-opt.fw-struck'),
    'a free_recall overlay never renders a struck option (only renderMcq reads strikeOneFalse)',
  ).toHaveCount(0);
  await page.locator('.fw-textarea').fill('irrelevant answer — only the bookkeeping is under test');
  await page.getByRole('button', { name: 'Cast' }).click();
  const cont = page.getByRole('button', { name: 'Onward ▸' });
  try {
    await cont.waitFor({ state: 'visible', timeout: 3000 });
    await cont.click();
  } catch { /* an unexpectedly-correct answer can auto-resolve without a continue button too */ }
  await page.waitForTimeout(300);

  // ---- the non-MCQ cast resolved; the Hint must be untouched (this is the fix under test).
  const invAfterCast = await readState<{ stacks?: Record<string, number> }>(page, 'inventory.json');
  expect(invAfterCast?.stacks?.['scriveners-hint'] ?? 0, 'a non-MCQ cast consumes nothing').toBe(1);
  expect((await snap(page))?.armedAid, 'the Hint is still armed after a non-MCQ cast').toEqual({
    itemId: 'scriveners-hint', kind: 'reveal_option',
  });

  // ---- third Keeper turn: NOW cast Smite (mcq) — the surviving arm fires normally.
  s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's third turn opened, Hint still armed").toBe('playerMove');

  await debugSetPos(page, 'keeper', 5, 3);
  await debugSetPos(page, 'wisp-0', 6, 3);
  await page.keyboard.press('2'); // Smite (T1, mcq)
  await page.waitForTimeout(150);
  await canvasClick(page, 192 + 6 * 48 + 24, 48 + 3 * 48 + 24); // wisp-0's tile

  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(450);

  const struck = page.locator('.fw-opt.fw-struck');
  await expect(struck, 'the surviving arm strikes an option on the eventual MCQ cast').toHaveCount(1);

  await page.locator('.fw-opt:not(.fw-struck)').first().click();
  await page.waitForTimeout(300);
  const onward = page.getByRole('button', { name: 'Onward ▸' });
  try {
    await onward.waitFor({ state: 'visible', timeout: 1500 });
    await onward.click();
  } catch { /* correct answer auto-resolves without a continue button (kinds.ts renderMcq) */ }

  const inv = await waitForState<{ stacks?: Record<string, number> }>(
    page, 'inventory.json', (i) => (i?.stacks?.['scriveners-hint'] ?? 0) === 0,
  );
  expect(inv?.stacks?.['scriveners-hint'] ?? 0, 'the Hint fires exactly once, on the eventual MCQ cast').toBe(0);
  expect((await snap(page))?.armedAid, 'the arm is cleared after firing').toBeNull();
});

// Ch. VII Mira's Stall, Task 4 scenario c: an armed Second Wind Seal fires on a genuinely FAILED
// combat cast — the SAME encounter re-presents at once (verbatim notice), answering it correctly
// there drives the combat outcome, while the SRS Ledger keeps only the ORIGINAL miss. "The
// Ledger remembers the stumble; the seal only buys the moment" (Concordance Ch. VII, Global
// Constraint 1). Pins the Step-3 ordering too: grace never touches this cast (the Keeper never
// stands on a lantern tile below), so the ONLY way positive damage can land is the retry's
// quality substituting in BEFORE the outcome math runs.
test('armed Second Wind Seal retries a failed cast; the retry drives damage, the miss stands in the Ledger', async ({ page }) => {
  test.setTimeout(90_000);
  await seedSrsBaseline(page);
  await page.request.put('/api/state/save.json', { data: { hp: 16 } });
  await page.request.put('/api/state/inventory.json', {
    data: { version: 1, gold: 20, stacks: { 'second-wind-seal': 1 } },
  });

  await page.goto('/?scene=combat&seed=7&rank=1');
  await waitReady(page, 'combat');

  let s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's first turn opened for manual control").toBe('playerMove');

  await armSeal(page);
  expect((await snap(page))?.armedAid, 'the Seal is armed going into the cast').toEqual({
    itemId: 'second-wind-seal', kind: 'retry_cast',
  });

  s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's second turn opened, Seal still armed").toBe('playerMove');

  await debugSetPos(page, 'keeper', 5, 3);
  await debugSetPos(page, 'wisp-0', 6, 3);
  await page.keyboard.press('5'); // Cast From Memory (T1 Attestation, free_recall)
  await page.waitForTimeout(150); // a bare `.press()` can race Phaser's own frame-tick handling
  expect((await snap(page))?.state, 'Rank 1 goes straight to targeting').toBe('playerTarget');
  await canvasClick(page, 192 + 6 * 48 + 24, 48 + 3 * 48 + 24); // wisp-0's tile

  // ---- the ORIGINAL cast: a deliberately unrelated answer fails the stub judge's keyword bar
  // (quality 0) regardless of which real rubric REVIVE_FACT carries — pinned deterministically
  // by seedSrsBaseline above, so this IS that fact/encounter.
  await page.locator('.fw-overlay .fw-textarea').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
  await page.locator('.fw-textarea').fill(WRONG_ANSWER);
  await page.getByRole('button', { name: 'Cast' }).click();
  const onward1 = page.getByRole('button', { name: 'Onward ▸' });
  await onward1.waitFor({ state: 'visible', timeout: 10_000 });
  await onward1.click();

  // ---- the Seal fires: the SAME encounter re-presents at once, verbatim notice line.
  await page.locator('.fw-notice').waitFor({ state: 'visible', timeout: 15_000 });
  expect(await page.locator('.fw-notice').textContent(), 'the Seal fire notice is verbatim').toBe(
    'The seal breaks — the moment returns to your hand.',
  );
  await page.waitForTimeout(450); // the re-presented overlay's OWN 400ms arm guard
  await page.screenshot({ path: `${EV}/miras-stall-seal-retry.png` });

  // ---- fired ALREADY, before the retry is even answered: item consumed, arm cleared (aids
  // contract — deduct on fire, not on retry success).
  const invMidRetry = await readState<{ stacks?: Record<string, number> }>(page, 'inventory.json');
  expect(
    invMidRetry?.stacks?.['second-wind-seal'] ?? 0,
    'the Seal is consumed on fire, before the retry resolves',
  ).toBe(0);
  expect((await snap(page))?.armedAid, 'the arm is cleared on fire').toBeNull();

  // ---- answer the retry CORRECTLY — the retry drives combat outcome.
  await page.locator('.fw-textarea').fill(REVIVE_ANSWER);
  await page.getByRole('button', { name: 'Cast' }).click();
  const onward2 = page.getByRole('button', { name: 'Onward ▸' });
  await onward2.waitFor({ state: 'visible', timeout: 10_000 });
  await onward2.click();
  await page.waitForTimeout(700); // let applyOutcome/actionLog/endPlayerTurn settle

  // ---- precondition, asserted structurally rather than merely assumed (task-4-review.md M1):
  // the Keeper's forced cast tile (5,3) must not be a lantern, or graceAppliesTo('attestation')
  // + a broken retry's q0 could turn into grace's q0.5 (SPELLBOOK.cast.effects.q05 hits:2) —
  // which lands EXACTLY the same dmg:2 the assertion below expects from a genuine q1 retry,
  // since wisp-0's own 2 HP (units.ts) caps q1's hits:6 down to the same number. An "assert
  // exact q1 damage" pin alone would NOT catch that regression against this target — asserting
  // the tile precondition is what actually makes the pin self-defending, per the review.
  const layout = buildLayout('dev-antechamber', 7); // seed(7) -> fixtureLaunch -> fixtureRoom(false)
  expect(layout.tiles[3]?.[5], "the Keeper's cast tile (r3,c5) must not be a lantern").not.toBe('lantern');

  // ---- damage reflects the RETRY's quality (1 -> SPELLBOOK.cast.effects.q1.hits:6, capped at
  // wisp-0's own 2 HP -> dmg:2), never the original miss's (quality 0 -> q0's hits:0/fade:2 ->
  // dmg:0). With the precondition above ruling grace out structurally, positive damage is
  // reachable ONLY via the retry's quality substituting into dmgQuality before the outcome math
  // ran — this is the Step-3 ordering pin.
  const afterCast = await snap(page);
  const lastAction = afterCast?.log.at(-1);
  expect(lastAction?.action, 'the logged action is the cast').toBe('cast');
  expect(lastAction?.dmg ?? 0, 'damage reflects the RETRY quality, not the original miss').toBeGreaterThan(0);

  // ---- the SRS Ledger keeps ONLY the original miss — no second row for the retry (the retry
  // result is never pushed to this.results, never passed to record() — Global Constraint 1/2).
  const srs = await waitForState<Srs>(
    page, 'srs.json', (x) => (x?.facts?.[REVIVE_FACT]?.history?.length ?? 0) >= 1,
  );
  const history = srs?.facts?.[REVIVE_FACT]?.history ?? [];
  expect(history.length, 'exactly one Ledger row — the original miss, no second row for the retry').toBe(1);
  expect(history[0]?.quality, "the standing row is the ORIGINAL miss's quality").toBe(0);
});

// Ch. VII Mira's Stall, Task 5 scenario d: the Vigil break law — a missed calendar
// hearth-night (gap > 1 night since lastHearthAt, per canRestTonight's own day-boundary
// math) snaps save.streak to 0 at the next rest, with NO ward held. Detected lazily in
// doCottage, not enforced eagerly (Global Constraint 4).
test('a missed night with no Ward of Focus snaps the streak to 0', async ({ page }) => {
  test.setTimeout(60_000);
  const beforeSave = await readState<Save>(page, 'save.json');
  const beforeInv = await readState<{ gold?: number; stacks?: Record<string, number> }>(
    page, 'inventory.json',
  );

  try {
    // Fixture: rested 3 calendar days ago (a two-night gap — broken), a distinguishable
    // streak (7) so "snapped to 0" is unambiguous, no ward held.
    await page.request.put('/api/state/save.json', {
      data: { scene: 'hamlet', hp: 3, embers: 0, lastHearthAt: daysAgoIso(3), streak: 7, lastPlayed: '' },
    });
    await page.request.put('/api/state/inventory.json', { data: { version: 1, gold: 0, stacks: {} } });

    await page.goto('/?scene=hamlet&seed=7');
    await waitReady(page, 'hamlet');
    await waitHamletPlayer(page);

    const warped = await warpHamletTo(page, 'cottage');
    expect(warped, 'warp hook parked the Keeper at the Cottage').toBe(true);

    // hearthRestConv's 2 base pages + the break line (Ch. VII amendment) = 3 pages.
    const lastLine = await runCottageConversation(page, 3);
    expect(lastLine.replace(/\s+/g, ' '), 'the break line is the verbatim amendment copy').toBe(
      'The vigil lapsed — the chain begins anew.',
    );

    const after = await waitForState<Save>(page, 'save.json', (s) => s?.streak === 0);
    expect(after?.streak, 'the missed night snapped the chain to 0').toBe(0);
    expect(after?.hp, 'the rest itself still banks normally').toBe(16);
    expect(after?.lastHearthAt, 'lastHearthAt still stamps tonight').toBeTruthy();

    await page.screenshot({ path: `${EV}/miras-stall-vigil-break.png` });
  } finally {
    await restoreSave(page, beforeSave);
    await page.request.put('/api/state/inventory.json', {
      data: beforeInv ?? { version: 1, gold: 0, stacks: {} },
    });
  }
});

// Ch. VII Mira's Stall, Task 5 scenario e: the SAME broken fixture as scenario d, but a Ward
// of Focus is held — the ward intercepts the break and restores the status quo: the chain
// holds at EXACTLY its prior value, never grows (controller ruling, fix round 1 — no normal
// unbroken Cottage rest increments streak either, so a ward-save gets the same untouched
// treatment). The ward is spent doing it (spend-before-benefit — removed before the save
// patch composes).
test('a missed night WITH Ward of Focus holds the chain and consumes the ward', async ({ page }) => {
  test.setTimeout(60_000);
  const beforeSave = await readState<Save>(page, 'save.json');
  const beforeInv = await readState<{ gold?: number; stacks?: Record<string, number> }>(
    page, 'inventory.json',
  );

  try {
    // Same broken fixture as scenario d — the ward is the ONLY difference, isolating its
    // own effect from the break-detection itself.
    await page.request.put('/api/state/save.json', {
      data: { scene: 'hamlet', hp: 3, embers: 0, lastHearthAt: daysAgoIso(3), streak: 7, lastPlayed: '' },
    });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 0, stacks: { 'ward-of-focus': 1 } },
    });

    await page.goto('/?scene=hamlet&seed=7');
    await waitReady(page, 'hamlet');
    await waitHamletPlayer(page);

    const warped = await warpHamletTo(page, 'cottage');
    expect(warped, 'warp hook parked the Keeper at the Cottage').toBe(true);

    // hearthRestConv's 2 base pages + the ward line (Ch. VII amendment) = 3 pages.
    const lastLine = await runCottageConversation(page, 3);
    expect(lastLine.replace(/\s+/g, ' '), 'the ward line is the verbatim amendment copy').toBe(
      'The ward cracks — your vigil holds.',
    );

    const after = await waitForState<Save>(page, 'save.json', (s) => s?.streak === 7);
    expect(after?.streak, 'the ward holds the chain unchanged — restores the status quo, never grows it').toBe(7);

    const inv = await readState<{ stacks?: Record<string, number> }>(page, 'inventory.json');
    expect(inv?.stacks?.['ward-of-focus'] ?? 0, 'the ward is consumed').toBe(0);

    await page.screenshot({ path: `${EV}/miras-stall-vigil-warded.png` });
  } finally {
    await restoreSave(page, beforeSave);
    await page.request.put('/api/state/inventory.json', {
      data: beforeInv ?? { version: 1, gold: 0, stacks: {} },
    });
  }
});

// ---- Task 6: wave e2e completeness sweep ------------------------------------

// Ch. VII Mira's Stall, Task 6 (wave e2e completeness — replace law, live end-to-end):
// combat/aids.test.ts (Task 1) proves armAid/aidFires as pure functions — no inventory, no
// Satchel, no real cast anywhere near them. The Task 2 e2e test above proves the item survives
// the moment of replacement itself, but never drives a fire afterward. This closes the gap:
// arm the Hint (A), arm the Seal (B) — replacing A — genuinely FAIL a cast so B fires, and
// prove through the REAL inventory that B's fire never touches A's retained item.
test("the replace law holds live: firing the replacing Seal never touches the replaced Hint's item", async ({ page }) => {
  test.setTimeout(90_000);
  await seedSrsBaseline(page);
  await page.request.put('/api/state/save.json', { data: { hp: 16 } });
  await page.request.put('/api/state/inventory.json', {
    data: { version: 1, gold: 20, stacks: { 'scriveners-hint': 1, 'second-wind-seal': 1 } },
  });

  await page.goto('/?scene=combat&seed=7&rank=1');
  await waitReady(page, 'combat');

  // ---- turn 1: arm the Hint (A).
  let s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's first turn opened for manual control").toBe('playerMove');
  await armHint(page);
  expect((await snap(page))?.armedAid, 'A (the Hint) is armed').toEqual({
    itemId: 'scriveners-hint', kind: 'reveal_option',
  });

  // ---- turn 2: arm the Seal (B) — replaces A live, through the real Satchel/inventory loop.
  s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's second turn opened, A still armed").toBe('playerMove');
  await armSeal(page);
  expect((await snap(page))?.armedAid, 'B (the Seal) REPLACED A').toEqual({
    itemId: 'second-wind-seal', kind: 'retry_cast',
  });
  const invAfterReplace = await readState<{ stacks?: Record<string, number> }>(page, 'inventory.json');
  expect(invAfterReplace?.stacks?.['scriveners-hint'] ?? 0, "A's item survives the replace itself").toBe(1);

  // ---- turn 3: genuinely FAIL a cast — B fires.
  s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's third turn opened, B still armed").toBe('playerMove');
  await debugSetPos(page, 'keeper', 5, 3);
  await debugSetPos(page, 'wisp-0', 6, 3);
  await page.keyboard.press('5'); // Cast From Memory (T1 Attestation, free_recall)
  await page.waitForTimeout(150); // a bare `.press()` can race Phaser's own frame-tick handling
  expect((await snap(page))?.state, 'Rank 1 goes straight to targeting').toBe('playerTarget');
  await canvasClick(page, 192 + 6 * 48 + 24, 48 + 3 * 48 + 24); // wisp-0's tile

  // ---- the ORIGINAL cast: a deliberately unrelated answer fails the stub judge's keyword bar.
  await page.locator('.fw-overlay .fw-textarea').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
  await page.locator('.fw-textarea').fill(WRONG_ANSWER);
  await page.getByRole('button', { name: 'Cast' }).click();
  const onward1 = page.getByRole('button', { name: 'Onward ▸' });
  await onward1.waitFor({ state: 'visible', timeout: 10_000 });
  await onward1.click();

  // ---- B fires: the same encounter re-presents at once.
  await page.locator('.fw-notice').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(450); // the re-presented overlay's OWN 400ms arm guard
  await page.screenshot({ path: `${EV}/miras-stall-replace-law-live.png` });

  // ---- fired ALREADY, before the retry is even answered: B consumed, arm cleared, and —
  // the new proof — A's item is completely untouched by B's fire.
  const invMidRetry = await readState<{ stacks?: Record<string, number> }>(page, 'inventory.json');
  expect(invMidRetry?.stacks?.['second-wind-seal'] ?? 0, 'B is consumed on fire').toBe(0);
  expect((await snap(page))?.armedAid, 'the arm is cleared on fire').toBeNull();
  expect(
    invMidRetry?.stacks?.['scriveners-hint'] ?? 0,
    "A's item is untouched by B's fire — retention through replacement, proven live, not mocked",
  ).toBe(1);

  // ---- resolve the retry cleanly so the turn/battle loop settles.
  await page.locator('.fw-textarea').fill(REVIVE_ANSWER);
  await page.getByRole('button', { name: 'Cast' }).click();
  const onward2 = page.getByRole('button', { name: 'Onward ▸' });
  await onward2.waitFor({ state: 'visible', timeout: 10_000 });
  await onward2.click();
  await page.waitForTimeout(700); // let applyOutcome/actionLog/endPlayerTurn settle

  // ---- final check: A's item is STILL owned after the whole replace-then-fire cycle.
  const invFinal = await readState<{ stacks?: Record<string, number> }>(page, 'inventory.json');
  expect(invFinal?.stacks?.['scriveners-hint'] ?? 0, "A's item is still owned after the full cycle").toBe(1);
  expect(invFinal?.stacks?.['second-wind-seal'] ?? 0, 'B stays consumed').toBe(0);
});

// Ch. VII Mira's Stall, Task 6 (wave e2e completeness — Death's Door context gate, Global
// Constraint 5): fixture/drive cloned from e2e/deaths-door.spec.ts's own Pin tests (own-file
// helper-clone convention, this file's established practice) — the packless dev dungeon's
// first room via ?dev=1&sim=0&auto=win, hp:2 so a single connecting enemy hit ends the party
// and opens the door. Proves the context gate live: an aid armed BEFORE the door opens must
// sit completely inert through it — no strike in the door's own MCQ, never fired, never
// consumed — because runDeathsDoorRound's own runEncounter call (CombatScene.ts) is built
// with context:'drill' and never wires strikeOneFalse at all, and never once reads
// this.armedAid across the whole round loop.
type DdSave = Save & { dungeon?: { roomIndex: number; cleared: string[]; gatePending?: string } };
type DdInventory = { version: number; gold: number; stacks: Record<string, number> };

/** vc.econ.valuation.pre-vs-post-money carries an mcq encounter (enc.mcq.pre-post-money)
 *  EARLIER in the pack's own encounters array than its free_recall sibling (enc.fr.pre-post-
 *  money) — engine.ts's pick() takes encountersOf(factId)'s FIRST kind-matching entry (the
 *  door's own runEncounter call carries no spellTier to narrow further), so seeding this fact
 *  as the single most-overdue one deterministically draws the mcq encounter at the door's
 *  first round. Same override shape as this file's own seedSrsBaseline (REVIVE_FACT) above. */
const DD_MCQ_FACT = 'vc.econ.valuation.pre-vs-post-money';

async function seedSrsForDoorMcq(page: Page): Promise<void> {
  const ids = await installedFactIds(page);
  const now = Date.now();
  const facts: NonNullable<Srs['facts']> = {};
  for (const id of ids) facts[id] = { box: 1, next_due: now - 5_000, history: [] };
  facts[DD_MCQ_FACT] = { box: 1, next_due: now - 999_999_999, history: [] };
  const res = await page.request.put('/api/state/srs.json', { data: { version: 1, facts } });
  expect(res.ok(), 'seeded state/srs.json through the dev bridge').toBe(true);
}

/** Wait-spam damage-path idiom, cloned verbatim from deaths-door.spec.ts's own driveToZeroHp:
 *  the party never fights back, so enemy turns whittle the seeded-low pool to 0, opening the
 *  door. Stops the instant the door opens ('deathsdoor') or the fight otherwise resolves. */
async function driveToDoorOpen(page: Page, timeoutMs = 75_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if ((await currentScene(page)) !== 'combat') return;
    const st = await snap(page);
    if (!st || st.state === 'over' || st.state === 'deathsdoor') return;
    if (st.state === 'playerMove') await page.keyboard.press('7'); // Wait
    await page.waitForTimeout(150);
  }
}

/** Answers up to THREE door drills WRONG via Escape — cloned from deaths-door.spec.ts's own
 *  answerDrillsWrong: overlay.ts's ESC policy fires on context:'drill' regardless of encounter
 *  kind, so this is kind-agnostic. Three misses wipe the party (CombatScene's own "Three
 *  marks" comment) — the simplest deterministic route through the WHOLE door sequence. */
async function answerDoorDrillsWrong(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const drill = page.locator('.fw-overlay .fw-textarea, .fw-overlay .fw-opt').first();
    const appeared = await drill.waitFor({ state: 'visible', timeout: 4_000 }).then(() => true).catch(() => false);
    if (!appeared) return;
    await page.waitForTimeout(600); // arming guard (shared idiom, boss-victory.spec.ts's driveParley)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
}

/** Quiesced, polling restore — cloned from e2e/deaths-door.spec.ts's own restoreState (fix
 *  round 1, review Important #2): this test's own finally runs right after a LIVE scene
 *  transition (combat -> door -> wipe -> hamlet), the exact shape that file's doc comment
 *  built this idiom for — "a live scene's own persist writes can otherwise land AFTER a bare
 *  PUT and poison whatever spec runs next." page.goto('about:blank') first removes the
 *  hamlet scene as a second, racing writer; the PUT-and-verify loop (5x, 150ms apart) then
 *  confirms the restore actually settled rather than trusting one unverified write. Task 5's
 *  tests correctly use the simpler non-polling restoreSave above — they never transition
 *  scenes immediately before their own finally, so they were never exposed to this race. */
async function restoreDoorState(page: Page, save: DdSave | null, inv: DdInventory | null): Promise<void> {
  const saveData: DdSave = save ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
  const invData: DdInventory = inv ?? { version: 1, gold: 20, stacks: {} };
  await page.goto('about:blank');
  for (let i = 0; i < 5; i++) {
    await page.request.put('/api/state/save.json', { data: saveData });
    await page.request.put('/api/state/inventory.json', { data: invData });
    await new Promise((r) => setTimeout(r, 150));
    const nowSave = (await page.request.get('/api/state/save.json').then((r) => r.json()).catch(() => undefined)) as
      | DdSave
      | undefined;
    const nowInv = (await page.request
      .get('/api/state/inventory.json')
      .then((r) => r.json())
      .catch(() => undefined)) as DdInventory | undefined;
    if (
      nowSave?.scene === saveData.scene &&
      nowInv?.gold === invData.gold &&
      JSON.stringify(nowInv?.stacks ?? {}) === JSON.stringify(invData.stacks ?? {})
    ) {
      return;
    }
  }
  throw new Error('restoreDoorState: save.json/inventory.json never settled on the restored snapshot');
}

test("an armed aid is inert at Death's Door: no strike renders, the arm neither fires nor is consumed (Constraint 5's context gate)", async ({ page }) => {
  test.setTimeout(120_000);
  const beforeSave = await readState<DdSave>(page, 'save.json');
  const beforeInv = await readState<DdInventory>(page, 'inventory.json');

  try {
    await seedSrsForDoorMcq(page);
    await page.request.put('/api/state/save.json', {
      data: { scene: 'hamlet', hp: 2, streak: 0, lastPlayed: '', dungeon: { roomIndex: 0, cleared: [] } },
    });
    await page.request.put('/api/state/inventory.json', {
      data: { version: 1, gold: 20, stacks: { 'scriveners-hint': 1 } },
    });

    await page.goto('/?scene=vaults&dev=1&sim=0&auto=win&seed=7');
    await waitReady(page, 'combat');

    let s = await waitForKeeperTurn(page);
    expect(s?.state, "the Keeper's first turn opened for manual control").toBe('playerMove');

    await armHint(page);
    expect((await snap(page))?.armedAid, 'the Hint is armed going into the door').toEqual({
      itemId: 'scriveners-hint', kind: 'reveal_option',
    });

    await driveToDoorOpen(page);

    await page.locator('.fw-holdline').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms arm guard
    await page.screenshot({ path: `${EV}/miras-stall-dd-aid-inert.png` });

    // ---- precondition (fix round 1, review Important #1): prove this round really IS an
    // MCQ presentation before trusting the no-strike check below. Without this, a future
    // vc-law pack-content edit that reorders/adds an earlier-matching encounter for
    // DD_MCQ_FACT could silently flip the door to a free_recall presentation (zero .fw-opt
    // elements at all) — the count-0 check below would then stay green for the wrong
    // reason (nothing to strike, not correctly-suppressed striking), permanently and
    // silently losing the one test covering Constraint 5's context gate. This precondition
    // turns that drift into a loud failure instead.
    await expect(
      page.locator('.fw-overlay .fw-opt'),
      'precondition: the door drill really is MCQ-shaped (guards the no-strike check below from going vacuous)',
    ).not.toHaveCount(0);

    // ---- Constraint 5: runDeathsDoorRound's own runEncounter call never wires
    // strikeOneFalse at all — no strike renders even though the Hint is armed and this IS
    // the seeded, guaranteed mcq presentation.
    await expect(
      page.locator('.fw-opt.fw-struck'),
      "no strike renders in the door's MCQ — context:'drill' excludes the aid (Constraint 5)",
    ).toHaveCount(0);
    expect((await snap(page))?.armedAid, 'the arm is untouched by the first drill round').toEqual({
      itemId: 'scriveners-hint', kind: 'reveal_option',
    });

    // ---- drive the WHOLE door sequence to a terminal outcome (three misses wipe —
    // deaths-door.spec.ts Pin B's own kind-agnostic terminal).
    await answerDoorDrillsWrong(page, 3);
    await expect.poll(() => currentScene(page), { timeout: 20_000 }).toBe('hamlet');

    // ---- the arm survived the ENTIRE door sequence: never fired, never consumed. Checked
    // through the real inventory — resolveBattle's own unconditional armedAid clear dissolves
    // any standing arm at battle end regardless of outcome, so item retention (not armedAid)
    // is the durable, honest signal that it was never FIRED along the way.
    const invAfter = await readState<{ stacks?: Record<string, number> }>(page, 'inventory.json');
    expect(
      invAfter?.stacks?.['scriveners-hint'] ?? 0,
      'the Hint survives the whole door sequence untouched — drill context never fires it',
    ).toBe(1);
  } finally {
    await restoreDoorState(page, beforeSave, beforeInv);
  }
});

/** All three Satchel branches must now pay Ch. VI's price the SAME way: spend the turn's one
 *  action, leave banked movement spendable, and hand the actor back its own action menu under
 *  the "Steps remain" banner. Asserted at the BUDGET, deliberately — the actionLog entry the
 *  old pins used is pushed BEFORE the 560ms delayedCall on every branch, so it stays green
 *  whether or not spendAction is ever reached (final review C1: that is exactly how the arm
 *  branch's missing gate hid). `left > 0` is what proves the action didn't eat the whole turn. */
async function expectSatchelPaidTheAction(page: Page, leg: string): Promise<void> {
  const s = await snap(page);
  expect(s?.log.at(-1)?.action, `${leg}: resolved as a satchel action`).toBe('satchel');
  expect(s?.budget?.actionSpent, `${leg}: spent the turn's ACTION (Ch. VI's spendAction gate)`).toBe(true);
  expect(s?.budget?.left ?? 0, `${leg}: movement is NOT forfeited — steps remain spendable`).toBeGreaterThan(0);
  expect(s?.state, `${leg}: the actor is back at its own action menu, turn still open`).toBe('playerMove');
  expect(s?.activeId, `${leg}: it is still the Keeper's turn — the action never ended it`).toBe('keeper');
  expect(await bannerText(page), `${leg}: the steps-remain banner is up`).toBe(
    'Steps remain — press End Turn when done.',
  );
}

// Ch. VII Mira's Stall, Task 6 + the W6 rebase round (final review C1): every Satchel branch —
// heal and glow (satchel.ts's own Phase 1/Phase 2 history) and the new trial-tool ARM branch —
// obeys W6's turn budget identically. The arm branch is the one that matters: it was written
// before W6 existed, ends up inserted BETWEEN the two branches W6 converted, and so composes
// cleanly and wrongly at the rebase with no conflict marker to prompt anyone. The old version
// of this pin covered only heal/glow and asserted only the pre-delayedCall actionLog push, so
// it could not have caught that. This one asserts the budget, on all three.
test('every Satchel use costs the ACTION, not the turn (heal, glow, and the trial-tool arm)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.request.put('/api/state/save.json', { data: { hp: 10 } });
  await page.request.put('/api/state/inventory.json', {
    data: {
      version: 1, gold: 20,
      stacks: { 'embermend-draught': 1, 'wick-tallow': 1, 'scriveners-hint': 1 },
    },
  });

  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');

  // ---- heal.
  let s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's first turn opened for manual control").toBe('playerMove');

  await page.keyboard.press('q');
  await page.locator('.inv-overlay').waitFor({ state: 'visible', timeout: 5_000 });
  const healRow = page.locator('.inv-row', { hasText: 'Embermend Draught' });
  await healRow.getByRole('button', { name: 'Use' }).click();
  await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(700); // past useSatchelItem's 560ms delayedCall -> the budget gate

  await expectSatchelPaidTheAction(page, 'heal');

  // ---- glow, on the Keeper's next open turn (waitForKeeperTurn ends the spent one).
  s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's second turn opened").toBe('playerMove');

  await page.keyboard.press('q');
  await page.locator('.inv-overlay').waitFor({ state: 'visible', timeout: 5_000 });
  const glowRow = page.locator('.inv-row', { hasText: 'Wick-Tallow' });
  await glowRow.getByRole('button', { name: 'Use' }).click();
  await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });
  await page.waitForTimeout(700);

  await expectSatchelPaidTheAction(page, 'glow');

  // ---- the arm branch: the leg the old pin never covered, and the one the rebase would
  // otherwise have left on the pre-W6 one-liner.
  s = await waitForKeeperTurn(page);
  expect(s?.state, "the Keeper's third turn opened").toBe('playerMove');

  await armHint(page);
  expect((await snap(page))?.armedAid, 'the arm landed — this leg really is the arm branch').toEqual({
    itemId: 'scriveners-hint', kind: 'reveal_option',
  });
  await page.waitForTimeout(500); // past the arm branch's own 560ms delayedCall (armHint waits 250)

  await expectSatchelPaidTheAction(page, 'aid-arm');

  await page.screenshot({ path: `${EV}/miras-stall-satchel-cost-pins.png` });
});
