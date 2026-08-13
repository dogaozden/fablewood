import { test, expect, type Page } from '@playwright/test';
import {
  waitReady,
  tapKey,
  waitHamletPlayer,
  waitProvincesLoaded,
  warpHamletTo,
  readState,
  hamletPlayer,
} from './helpers';

// Wave 4 leveling — RED e2e pins (task-4-brief.md), written BEFORE the wiring exists. Tasks
// 1-3 landed the pure XP module (progression/xp.ts), the SaveData xp/level fields
// (contracts.ts), and the grantXp seam (progression/grant.ts) — but nothing calls grantXp
// yet, no level-up ceremony card exists, and CombatScene exposes no progressionSnapshot().
// Tasks 5-6 wire all three; these pins are RED today against that gap and flip green once
// they land.
//
// Two consumption contracts these pins encode for Tasks 5/6 (task-4-brief.md's PRODUCES):
//
//  1. Ceremony beat law (binding on Task 5): the level-up card presents at the NEXT SAFE
//     BEAT — hamlet-context grants (Wellspring, amendments) present the card immediately
//     after the triggering flow's own overlay closes; dungeon-context grants (room clear,
//     gate, boss) present it inside the existing post-combat/boss beat sequence;
//     combat-context grants (mid-fight renewal) DEFER — CombatScene stashes pending
//     level-ups and DungeonScene presents the card after resolveCombat finishes its outcome
//     bookkeeping. ONE card lists EVERY level gained that beat (Constraint 6). Pin B below
//     is the hamlet-context case.
//
//  2. Debug-hook contract (binding on Task 6): CombatScene exposes
//     progressionSnapshot(): { xp: number; level: number; tierFloor: 1|2|3; composedTier:
//     1|2|3 } — same debug-accessor family as deathsDoorSnapshot()/combatSnapshot().
//     tierFloor = tierForLevel(level); composedTier = max(rank, tierFloor). Pin C below
//     proves the level half in isolation from the SRS-rank half.
//
// Model files: wellspring-srs.spec.ts (the drill drive/answer choreography, mirrored below
// rather than reinvented), gate-retreat-ledger.spec.ts (the page.request.put save-seeding
// idiom), deaths-door.spec.ts's Pin B (rig-sanity structure — cheap sanity assertions pass
// BEFORE the first true red, so a pin reds on the DOCUMENTED absent mechanism, never on
// setup) and its seedSrsBaseline/installedFactIds (the srs-seeding idiom for a deterministic
// due-queue draw).

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

type SrsEntry = {
  box: number;
  next_due: number;
  history: Array<{ ts: string; quality: 0 | 0.5 | 1; encounter_id: string }>;
};

// The fact deaths-door.spec.ts's own REVIVE_FACT precedent already proved out against THIS
// installed pack (packs/vc-law/pack.json): 'vc.econ.overview.economics-vs-control' carries
// TWO candidate encounters — enc.fr.economics-vs-control (free_recall, pack-array index 17)
// and enc.match.foundational-terms (match, index 43). engine.ts's pick() (its due-queue
// loop, :118-127) returns the FIRST pack-order encounter whose fact_ids includes the
// earliest-due factId — array order, not random — so seeding this fact as the single
// most-overdue one makes Wellspring's drill deterministically open the free_recall prompt
// (index 17 sorts before index 43). services.draw.due() (Wellspring's own draw call) bottoms
// out in the exact same services.srs.dueQueue/leitner.ts most-overdue-first sort
// (draw/register.ts's dueOrder adapter), so deaths-door.spec.ts's seeding technique transfers
// verbatim. answerWellspringRenewalCorrectly below also handles the match encounter as a
// fallback (verified independently correct — see its own doc) in case a future change to the
// due-queue tiebreak ever surfaces it instead.
const RENEWAL_FACT = 'vc.econ.overview.economics-vs-control';
// Proven stub-judge PASS for enc.fr.economics-vs-control's rubric (combat.spec.ts's
// answerCast, redemption-bell.spec.ts's combat test — both reused verbatim).
const RENEWAL_ANSWER = 'Economics and control.';
// The two OTHER facts enc.match.foundational-terms also teaches (its fact_ids array,
// verified against packs/vc-law/pack.json — no OTHER encounter in the pack references
// RENEWAL_FACT at all, confirmed by grepping every encounter's fact_ids). Sharing that
// encounter with RENEWAL_FACT matters because leitner.ts's record() applies ONE quality to
// every fact_id an encounter covers — so if either of these siblings is still "due" for
// round 2/3, the due-queue can draw IT instead, resolve to the SAME shared match encounter,
// and a flee (quality 0) on it demotes RENEWAL_FACT's box right back to 1 as a side effect,
// even though round 1 already answered RENEWAL_FACT correctly. Confirmed empirically: without
// excluding these two, round 2 drew enc.match.foundational-terms via one of them and
// RENEWAL_FACT's box read 1, not 2+, at the end (srs.json history showed the quality-0 entry
// against enc.match.foundational-terms right after the quality-1 free_recall one).
const RENEWAL_SIBLING_FACTS = ['vc.econ.overview.preferred-vs-common', 'vc.econ.liqpref.conversion-ratio'];

async function seedSave(page: Page, patch: Partial<Save> = {}): Promise<void> {
  // DEFAULT_SAVE-shaped (srs/store.ts) plus only what each pin overrides — Pin A calls this
  // with no patch at all, which IS the legacy shape this pin pins: no xp, no level.
  const data: Save = { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '', ...patch };
  const res = await page.request.put('/api/state/save.json', { data });
  expect(res.ok(), 'seeded state/save.json').toBe(true);
}

async function restoreSave(page: Page, save: Save | null): Promise<void> {
  const data: Save = save ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' };
  await page.request.put('/api/state/save.json', { data });
}

/** Every installed fact id (deaths-door.spec.ts's installedFactIds idiom, verbatim). */
async function installedFactIds(page: Page): Promise<string[]> {
  const res = await page.request.get('/api/packs');
  expect(res.ok(), 'read installed packs').toBe(true);
  const { packs } = (await res.json()) as { packs: Array<{ pack?: { facts?: Array<{ id: string }> } }> };
  const ids: string[] = [];
  for (const entry of packs) for (const f of entry.pack?.facts ?? []) ids.push(f.id);
  expect(ids.length, 'the installed pack has facts to seed').toBeGreaterThan(0);
  return ids;
}

/** Seed EVERY installed fact at box 1/due (deaths-door.spec.ts's seedSrsBaseline idiom),
 *  overriding RENEWAL_FACT to be far more overdue than the rest so the due-queue sorts it
 *  first, deterministically — single-installed-pack e2e server, so no cross-pack day-bucket
 *  tiebreak noise (see seedSrsBaseline's own doc in deaths-door.spec.ts for why). srs.json is
 *  deliberately left seeded afterward, not restored — same precedent redemption-bell.spec.ts
 *  and deaths-door.spec.ts both already set. */
async function seedSrsForRenewal(page: Page): Promise<void> {
  const ids = await installedFactIds(page);
  const now = Date.now();
  const facts: Record<string, SrsEntry> = {};
  for (const id of ids) facts[id] = { box: 1, next_due: now - 5_000, history: [] };
  facts[RENEWAL_FACT] = { box: 1, next_due: now - 500_000, history: [] };
  // Not due, deliberately — see RENEWAL_SIBLING_FACTS's own doc for why.
  for (const id of RENEWAL_SIBLING_FACTS) facts[id] = { box: 8, next_due: now + 30 * 86_400_000, history: [] };
  const res = await page.request.put('/api/state/srs.json', { data: { version: 1, facts } });
  expect(res.ok(), 'seeded state/srs.json through the dev bridge').toBe(true);
}

/** A genuinely EMPTY srs.json — zero records anywhere, so computeRank (arts.ts) has nothing
 *  to weld and floors the SRS-mastery rank at 1 regardless of level. Pin C needs this to
 *  isolate the LEVEL half of the hybrid tier rule from the SRS half. */
async function seedSrsEmpty(page: Page): Promise<void> {
  const res = await page.request.put('/api/state/srs.json', { data: { version: 1, facts: {} } });
  expect(res.ok(), 'seeded an empty state/srs.json').toBe(true);
}

/** Drive hamlet -> Wellspring up to its first drill encounter (wellspring-srs.spec.ts's own
 *  choreography, verbatim through the overlay-visible wait — not reinvented). */
async function openWellspringDrill(page: Page): Promise<void> {
  await page.goto('/?seed=7');
  await waitReady(page, 'boot');
  await page.keyboard.press('Enter');
  await waitReady(page, 'hamlet');
  await waitHamletPlayer(page);
  await waitProvincesLoaded(page); // else doWellspring() takes the no-pack branch (no drill)

  const warped = await warpHamletTo(page, 'wellspring');
  expect(warped, 'dev warp hook parked the Keeper at the Wellspring').toBe(true);
  await tapKey(page, 'e'); // open the Wellspring intro
  await page.waitForTimeout(220);
  for (let k = 0; k < 12; k++) {
    if (await page.locator('.fw-overlay').count()) break;
    await tapKey(page, 'e');
    await page.waitForTimeout(300);
  }
  await expect(page.locator('.fw-overlay'), 'the drill opened its first encounter').toBeVisible({
    timeout: 8_000,
  });
}

/** Answer the drill's first (and, for these pins, only) encounter with a KNOWN-correct
 *  (quality 1) response, then close its verdict — "one correct renewal." Handles the two
 *  kinds seedSrsForRenewal's fact can resolve to (see RENEWAL_FACT's own doc): free_recall
 *  (fill the proven answer) or match (straight index-order pairing — kinds.ts's renderMatch
 *  never shuffles its options, and packs/vc-law/pack.json's foundational-terms options/answer
 *  arrays are already index-aligned, so pairing lefts[i] with rights[i] for every i IS the
 *  correct weave, verified against the pack's own `answer` field, not assumed). Throws loudly
 *  on any other kind rather than silently submitting a guess and reding for the wrong reason
 *  once Tasks 5/6 land. */
async function answerWellspringRenewalCorrectly(page: Page): Promise<void> {
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
  if (await page.locator('.fw-textarea').count()) {
    await page.locator('.fw-textarea').fill(RENEWAL_ANSWER);
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
  } else {
    const snippet = await page.evaluate(
      () => document.querySelector('.fw-overlay')?.innerHTML.slice(0, 200) ?? 'none',
    );
    throw new Error(
      `seedSrsForRenewal's fact resolved to an unrecognized encounter shape — neither ` +
        `.fw-textarea nor .fw-chip is present (overlay snippet: ${snippet}). Update ` +
        `answerWellspringRenewalCorrectly to handle it.`,
    );
  }
  await page.waitForTimeout(300);
  const cont = page.getByRole('button', { name: 'Onward ▸' });
  await cont.waitFor({ state: 'visible', timeout: 15_000 });
  await cont.click();
  await page.waitForTimeout(600); // let srs.record + (eventually) grantXp's save patch settle
}

/** Flee the CURRENTLY OPEN drill round via Escape. Verified directly against overlay.ts's ESC
 *  policy (:236): it checks `ctx.context === 'drill'` only, never `encounter.kind`, so this
 *  works regardless of which kind rounds 2-3 draw, and always grades quality 0 — meaning it
 *  can never trigger an unplanned `grantXp('renewal')` once Task 5 wires the `quality === 1`
 *  gate (task-5-brief.md Step 4.1). */
async function fleeWellspringRound(page: Page): Promise<void> {
  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 8_000 });
  await page.waitForTimeout(600); // past overlay.ts's paint-anchored arm guard (shared idiom)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

/** Close wellspringOutro (HamletScene.ts:966, `this.dialogue.run(wellspringOutro(...))`) — a
 *  single-page Conversation with NO `choices` array (content.ts:152-159). Verified directly
 *  against DialogueBox.advance(): on a no-choice conversation's last page, the FIRST advance
 *  only finishes that page's typewriter (`onPageComplete`); only the SECOND advance actually
 *  closes it (`this.close(undefined)`, since `choices.length` is 0) — i.e. two 'e' presses
 *  from a cold open, not one. Rather than hardcode that count, this polls the live
 *  `dialogueOpen` flag (helpers.ts's `hamletPlayer`) so it's robust to timing either way, and
 *  throws loudly (not a silent no-op) if the outro never opens or never closes — the same
 *  "fail loud, not wrong" discipline as answerWellspringRenewalCorrectly's unrecognized-kind
 *  branch. */
async function closeWellspringOutro(page: Page): Promise<void> {
  let opened = false;
  for (let k = 0; k < 30; k++) {
    if ((await hamletPlayer(page))?.dialogueOpen) {
      opened = true;
      break;
    }
    await page.waitForTimeout(150);
  }
  if (!opened) throw new Error("wellspringOutro never opened after the drill's three rounds");
  for (let k = 0; k < 10; k++) {
    if (!(await hamletPlayer(page))?.dialogueOpen) return;
    await tapKey(page, 'e');
    await page.waitForTimeout(250);
  }
  throw new Error('wellspringOutro did not close after 10 taps');
}

/** Drive ALL THREE Wellspring rounds (doWellspring()'s own `for (i=0;i<3;i++)` loop,
 *  HamletScene.ts:889) — round 1 the one deterministic correct renewal
 *  (answerWellspringRenewalCorrectly), rounds 2-3 fled via Escape (quality 0, no additional
 *  grant) — then closes the outro. Required for Pin B, not Pin A: Task 5's wire-1
 *  (task-5-brief.md Step 4.1) batches pending level-ups across the WHOLE drill and presents
 *  ONE ceremony card only after "the drill's own overlay closes", which — given
 *  doWellspring()'s real structure (3-round loop -> streak bump -> wellspringOutro) — means
 *  the whole visit, not round 1's transient encounter card alone. Pin A's grantXp fires
 *  synchronously per-round (before rounds 2-3 even run), so it reads state before this
 *  matters; Pin B's ceremony-card wait does not resolve without it. */
async function driveWellspringRenewal(page: Page): Promise<void> {
  await answerWellspringRenewalCorrectly(page); // round 1 -> the one correct renewal
  await fleeWellspringRound(page); // round 2 -> quality 0, no grant
  await fleeWellspringRound(page); // round 3 -> quality 0, no grant
  await closeWellspringOutro(page);
}

type CombatSnap = { rank: number } | null;
async function combatSnap(page: Page): Promise<CombatSnap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as CombatSnap;
  });
}

type ProgressionSnap = { xp: number; level: number; tierFloor: 1 | 2 | 3; composedTier: 1 | 2 | 3 };
/** Task 6's debug-hook consumption contract (see file header) — same family as
 *  combatSnapshot()/deathsDoorSnapshot(). Deliberately unguarded (no `?.()` on the CALL
 *  itself, unlike every other debug-hook reader in this suite): until Task 6 lands,
 *  `progressionSnapshot` is undefined on the scene object, so invoking it throws "is not a
 *  function" — the exact documented red for this pin, not a benign undefined mismatch a
 *  tolerant `?.()` would produce instead. */
async function progressionSnap(page: Page): Promise<ProgressionSnap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { progressionSnapshot(): ProgressionSnap } | undefined;
    return s!.progressionSnapshot();
  });
}

test.describe('leveling — RED pins (written before the wiring exists)', () => {
  test('Pin A — a correct renewal pays 5 (legacy-save default path: no xp/level keys)', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const beforeSave = await readState<Save>(page, 'save.json');

    try {
      await seedSave(page); // no patch = DEFAULT_SAVE shape, no xp/level keys at all
      await seedSrsForRenewal(page);

      await openWellspringDrill(page);
      await page.screenshot({ path: `${EV}/e2e-leveling-pin-a-drill-open.png` });
      await answerWellspringRenewalCorrectly(page);

      // rig sanity (passes today): the renewal was genuinely recorded correct before we
      // ever look at xp — box 1 -> 2+ only happens on a quality-1 (full pass) grade
      // (leitner.ts:108).
      const srs = await readState<{ facts?: Record<string, { box: number }> }>(page, 'srs.json');
      expect(
        srs?.facts?.[RENEWAL_FACT]?.box,
        'rig sanity: the seeded fact recorded a correct (box-advancing) answer',
      ).toBeGreaterThanOrEqual(2);

      // the true red: nothing calls grantXp yet (Task 5), so a legacy save never gains an
      // xp field at all — save?.xp reads undefined today.
      const save = await readState<Save>(page, 'save.json');
      expect(save?.xp, 'EXPECTED NOW: fails — grantXp is unwired; xp is undefined').toBe(5);
      expect(save?.level, "the ?? 1 default still reads Level 1 once xp's default lands").toBe(1);
    } finally {
      await restoreSave(page, beforeSave);
    }
  });

  test('Pin B — the lantern burns brighter (level-up: xp, level, +2 hp, ceremony card)', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const beforeSave = await readState<Save>(page, 'save.json');

    try {
      await seedSave(page, { xp: 95, hp: 10 });
      await seedSrsForRenewal(page);

      await openWellspringDrill(page);
      // All 3 rounds, not just round 1 — see driveWellspringRenewal's doc: Task 5 batches
      // pending level-ups across the WHOLE drill and presents ONE card only after the drill
      // (all 3 rounds + wellspringOutro) closes, not after round 1's own encounter card.
      // Round 1 is the one correct renewal (+5 -> exactly 100 -> Level 2); rounds 2-3 flee
      // (quality 0, no additional grant).
      await driveWellspringRenewal(page);

      // rig sanity (passes today): the renewal that should trigger the level-up genuinely
      // happened, correct, before we look for its ceremony.
      const srs = await readState<{ facts?: Record<string, { box: number }> }>(page, 'srs.json');
      expect(
        srs?.facts?.[RENEWAL_FACT]?.box,
        'rig sanity: the seeded fact recorded a correct (box-advancing) answer',
      ).toBeGreaterThanOrEqual(2);
      await page.screenshot({ path: `${EV}/e2e-leveling-pin-b-after-renewal.png` });

      // the true red: no ceremony card exists yet (Task 5) — this locator timeout IS the
      // red. Nothing below it runs until Task 5/6 land.
      const card = page.locator('.fw-overlay', { hasText: /The Lantern Burns Brighter/ });
      await expect(
        card,
        'EXPECTED NOW: fails — the level-up ceremony card does not exist yet',
      ).toBeVisible({ timeout: 8_000 });
      await expect(card, 'the card lists the level reached').toContainText(/Level 2/);
      await page.screenshot({ path: `${EV}/e2e-leveling-pin-b-ceremony.png` });

      // Best-effort close, matching the "Onward ▸" convention presentNightLedger
      // (overlay.ts:391-394, verified) and VaultView's finishCard (VaultView.ts:617,
      // verified) both already use for a beat/ceremony card — Task 5's plan text directs
      // presentLevelUp to mirror presentNightLedger's idiom specifically. Task 5's own call
      // if its card differs; unreached today since the assertion above throws first.
      await page.getByRole('button', { name: 'Onward ▸' }).click();
      await page.waitForTimeout(400);

      const save = await readState<Save>(page, 'save.json');
      expect(save?.xp).toBe(100);
      expect(save?.level).toBe(2);
      expect(
        save?.hp,
        '+2/level, clamped by maxHpForLevel — 10+2=12 well under the L2 ceiling of 18',
      ).toBe(12);
    } finally {
      await restoreSave(page, beforeSave);
    }
  });

  test('Pin C — the level half of the hybrid tier (level 6 opens T3 with zero welded facts)', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const beforeSave = await readState<Save>(page, 'save.json');

    try {
      // level:6 seeded explicitly alongside xp — Task 6 (plan:438) reads `save.level ?? 1`
      // directly at battle-create, never deriving it from xp via levelForXp, and grantXp
      // (grant.ts:60-62) always writes the two fields in lockstep. Seeding xp without level
      // would read as a save that's *impossible* under grantXp's own writer, and would red
      // this pin on a value mismatch (level 1, tierFloor 1) forever after Task 6 lands
      // exactly as specified, instead of flipping green.
      await seedSave(page, { xp: 2_500, level: 6, dungeon: { roomIndex: 0, cleared: [] } }); // -> tierFloor 3
      await seedSrsEmpty(page); // zero welded facts -> computeRank floors the SRS rank at 1

      await page.goto('/?scene=vaults&dev=1&sim=0&auto=win&seed=7');
      await waitReady(page, 'combat');
      await page.screenshot({ path: `${EV}/e2e-leveling-pin-c-combat-open.png` });

      // rig sanity (passes today): the existing rank read really does floor at 1 against an
      // empty srs.json, proving the assertion below isolates the LEVEL half of the hybrid
      // rule rather than riding on a coincidentally-already-tier-3 SRS rank.
      const combat = await combatSnap(page);
      expect(combat?.rank, 'rig sanity: zero welded facts floors the SRS-mastery rank at 1').toBe(1);

      // the true red: progressionSnapshot does not exist yet (Task 6) — the unguarded call
      // throws "... progressionSnapshot is not a function" here, not a benign undefined.
      const prog = await progressionSnap(page);
      expect(prog.level).toBe(6);
      expect(prog.tierFloor).toBe(3);
      expect(prog.composedTier, 'level alone opens T3 even though the SRS rank never left 1').toBe(3);
    } finally {
      await restoreSave(page, beforeSave);
    }
  });
});
