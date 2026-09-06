import { test, expect, type Page } from '@playwright/test';
import {
  waitReady,
  tapKey,
  warpHamletTo,
  waitHamletPlayer,
  readState,
  waitForState,
  currentScene,
  canvasClick,
} from './helpers';
import { ROAD_SPEC } from '../app/src/story/beats';

/**
 * «Onward» Arc 1, walked end to end on the engine's own road spec (arc01-road).
 *
 * Two drives are used, deliberately different depths of "real":
 *  - Test 1 reaches the south gate and picks "Road South" through Alder's REAL menu (no
 *    query-param shortcut) — Task 3/4 review D1: doGate's `spec:` branch had no committed
 *    test, and the reviewer specifically asked that Task 5 reach the gate this way rather
 *    than warping past it, "or the destination path stays unproven."
 *  - Test 3 drives the crawl itself with `?scene=vaults&spec=arc01-road&auto=full&sim=1`.
 *    `auto=full` enters every room in order (DungeonScene.runAuto's 'full' case) through the
 *    SAME `enterRoom`/`fireStoryBeat`/`bossVictory` methods a real click-through would use;
 *    `sim=1` only synthesizes each battle's OUTCOME inline so the crawl closes in one page
 *    without a CombatScene hand-off. `sim` is passed EXPLICITLY and never defaulted for
 *    engine specs — a real player riding out from the gate (test 1) gets real combat.
 *
 * Alder's conversation (game/dialogue/DialogueBox.ts) is drawn entirely on the Phaser canvas —
 * there is no `.fw-dialogue` DOM node, so no locator can see its text or choices. Read and
 * drive it the same way e2e/helpers.ts's own hamletPlayer() already reads `dialogue.isOpen`:
 * straight off the live HamletScene instance (TypeScript `private` is a compile-time fence
 * only; it does not survive to the running JS `e2e/story.spec.ts:60`'s own Escape-close
 * comment already flags this "choice list" as untested territory for exactly this reason).
 *
 * Screenshots land in docs/overnight/shots/. They are taken by Playwright on THIS server
 * (5175) — scripts/shot.mjs is hardcoded to 5173 and self-starts a dev server, so it must
 * never be used here.
 */
const SHOTS = 'docs/overnight/shots';

/** A save that has heard the fable (beat III) — the earliest state that can ride south. */
const READY_SAVE = { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '2026-09-04T00:00:00.000Z' };
/** Same, but leveled up for test 3's real auto-drive: three real waystone gate drills
 *  (ws-1/ws-2/ws-3 — see the file doc comment on sim vs. gates) each cost 1 HP per failed
 *  attempt, and the broad-vocabulary answer below is not guaranteed to score >=0.5 on the
 *  first try against every possible drawn fact. `level` alone is NOT authoritative — progression
 *  is xp-driven (app/src/game/progression/xp.ts's levelForXp), and a save's `level` field gets
 *  recomputed from `xp` on load, same convention e2e/leveling.spec.ts:390 already uses (xp:2_500
 *  pairs with level:6) — so both must be set together. xp:13_500 is the LEVEL_CAP (10) threshold;
 *  maxHpForLevel(10) = 16 + 2*9 = 34, the highest HP this game allows, giving the most possible
 *  headroom to absorb a run of misses across all three gates without a false HP-out retreat —
 *  a test-harness allowance, not a claim about real play's difficulty curve. */
const ROAD_READY_SAVE = { ...READY_SAVE, xp: 13_500, level: 10, hp: 34 };
const SEEN_T1 = {
  version: 1,
  seenBeats: {
    'onward-01.dark-answers': '2026-09-04T00:00:00.000Z',
    'onward-01.barred-road': '2026-09-04T00:00:00.000Z',
    'onward-01.fable-waywright': '2026-09-04T00:00:00.000Z',
  },
  completedArcs: {},
  threadFragments: {},
};

type Story = {
  seenBeats?: Record<string, string>;
  completedArcs?: Record<string, string>;
  threadFragments?: Record<string, string>;
};

async function seed(page: Page, story: unknown = SEEN_T1, save: unknown = READY_SAVE): Promise<void> {
  await page.request.put('/api/state/save.json', { data: save });
  await page.request.put('/api/state/story.json', { data: story });
}

async function bootToHamlet(page: Page): Promise<void> {
  await page.goto('/?seed=7');
  await waitReady(page);
  await tapKey(page, 'Enter');
  await waitReady(page, 'hamlet');
  await waitHamletPlayer(page);
}

// ---------------------------------------------------------------- gate-choice helpers
// See the file doc comment: DialogueBox is canvas-drawn, so these read/drive the live scene
// instance directly instead of a DOM locator.

type GateChoice = { label: string; value: string };

async function gateDialogue(
  page: Page,
): Promise<{ isOpen: boolean; showingChoices: boolean; choices: GateChoice[]; selected: number } | null> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const h = g?.scene?.getScene?.('hamlet') as
      | { dialogue?: { isOpen?: boolean; showingChoices?: boolean; choices?: GateChoice[]; selected?: number } }
      | undefined;
    const d = h?.dialogue;
    if (!d) return null;
    return {
      isOpen: !!d.isOpen,
      showingChoices: !!d.showingChoices,
      choices: d.choices ?? [],
      selected: d.selected ?? 0,
    };
  });
}

/** Tap E through Alder's pages (content.ts's alderConv: 2 pages once there is a real choice)
 *  until the choice list is showing. Returns the live choices for the caller to search. */
async function advanceToGateChoices(page: Page): Promise<GateChoice[]> {
  for (let i = 0; i < 10; i++) {
    const d = await gateDialogue(page);
    if (d?.showingChoices) return d.choices;
    await tapKey(page, 'e');
    await page.waitForTimeout(250);
  }
  throw new Error('the gate choice list never appeared');
}

/** Arrow-key DialogueBox's own selection cursor (DialogueBox.ts's moveChoice) onto the choice
 *  whose value is `value` — closed-loop on the live `selected` index after every press, never
 *  a guessed pixel click or a fixed key count. */
async function moveGateSelectionTo(page: Page, value: string): Promise<void> {
  const first = await gateDialogue(page);
  const target = first?.choices.findIndex((c) => c.value === value) ?? -1;
  if (target < 0) {
    throw new Error(`no gate choice with value ${value}; saw ${JSON.stringify(first?.choices)}`);
  }
  for (let guard = 0; guard < (first?.choices.length ?? 0) + 1; guard++) {
    const cur = await gateDialogue(page);
    if (cur?.selected === target) return;
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(80);
  }
}

// ---------------------------------------------------------------- waystone gate helpers
// DungeonScene.runGate always runs a REAL free_recall drill (services.runEncounter) on the
// door out of a gated room (ws-1/ws-2/ws-3) — `sim=1` only synthesizes the room's COMBAT
// outcome (doCombat's sim branch), never the gate. This matches e2e/gate-retreat-ledger.spec.ts's
// own documented finding for the dev fixture's gated room: "auto=full's own runAuto doesn't
// call markReadyOnce() until it COMPLETES — which here blocks on the gate."

/** A deliberately broad answer for this dev server's one installed pack (vc-law, "Term Sheet
 *  Economics"). app/src/judge/stub.ts scores keyword OVERLAP against the RUBRIC, and
 *  DungeonScene.runGate only needs quality >= 0.5 — which a 'partial' verdict (overlap >=
 *  0.25) already satisfies, not a full 'pass' (>= 0.6).
 *
 *  Calibrated against a REAL drawn rubric (harvested via a throwaway diagnostic spec, per this
 *  session's "Test End-to-End" standard — never guessed blind), e.g.: "Full credit if the
 *  answer names both ECONOMICS and CONTROL (either order; no definitions required). Partial
 *  credit if only one of the two is named. No credit if it lists individual terms … without
 *  the two-category frame." stub.ts's STOP list does not cover this pack's tiered-rubric
 *  scaffolding words ("full", "both", "either", "order", "named", "partial", "one", "two",
 *  "required" are all real content words to the heuristic even though they carry no vc-law
 *  meaning) — a topic-only answer (just "economics and control" plus term-sheet vocabulary)
 *  hit only 2 of that rubric's 13 keys (0.15 overlap, a fail) until this scaffolding language
 *  was added alongside it, which then hit enough of the template's own recurring words to
 *  score a full pass on the first real attempt. Included on top of, not instead of, the topic
 *  vocabulary — this pack's OTHER facts may not share the same two-item template. */
const VC_SHOTGUN_ANSWER =
  'Full credit names both of the two things that matter most, either order, no definitions ' +
  'required. Partial credit if only one of the two is named, or first, second, third, one, ' +
  'two, three. Economics and control. Valuation, dilution, liquidation preference, ' +
  'anti-dilution protection, pro-rata rights, board seats, voting rights, vesting schedule, ' +
  'cap table, preferred stock, common stock, drag-along, tag-along, participation rights, ' +
  'option pool, founder equity, investor protections, term sheet, negotiation leverage, ' +
  'exit strategy, acquisition, convertible note, valuation cap, discount rate, redemption ' +
  'rights, information rights, right of first refusal, co-sale rights, no-shop exclusivity, ' +
  'due diligence, capitalization, ownership percentage, governance, protective provisions, ' +
  'preference stack, seniority, participation cap, warrant coverage, milestone vesting.';

/** Answer one open free_recall gate overlay (answerGateWrong's idiom from
 *  e2e/crucible-v1-package-a.spec.ts, with a broad-coverage answer instead of a
 *  deliberately-wrong one) and wait for the post-verdict continuation. Echoes the overlay's
 *  own prompt text (overlay.ts's `.fw-prompt` heading) ahead of the shotgun vocabulary: a
 *  rubric is written about the same fact as its prompt, so restating the prompt's own content
 *  words is a second, independent chance at overlap on top of guessing the answer's terms. */
async function answerGateBroadly(page: Page): Promise<void> {
  await page.locator('.fw-textarea').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
  const promptText = (await page.locator('.fw-prompt').textContent().catch(() => '')) ?? '';
  await page.locator('.fw-textarea').fill(`${promptText}. ${VC_SHOTGUN_ANSWER}`);
  await page.getByRole('button', { name: 'Cast' }).click();
  const cont = page.getByRole('button', { name: 'Onward ▸' });
  await cont.waitFor({ state: 'visible', timeout: 10_000 });
  await cont.click();
  await page.waitForTimeout(250);
}

/** Poll story.json for `pred`, answering any waystone gate drill that pops up along the way.
 *  Falls through to a plain wait when no drill is showing (identical behavior to
 *  e2e/helpers.ts's waitForState in that case) — this is that helper PLUS gate-awareness,
 *  needed only for the two checkpoints (the-middles, hollis-promise) that have a real gate
 *  between them and the previous checkpoint. */
async function waitForStoryState(
  page: Page,
  pred: (s: Story | null) => boolean,
  timeout = 120_000,
): Promise<Story | null> {
  const start = Date.now();
  let last: Story | null = null;
  while (Date.now() - start < timeout) {
    last = await readState<Story>(page, 'story.json');
    if (pred(last)) return last;
    if (await page.locator('.fw-textarea').isVisible().catch(() => false)) {
      await answerGateBroadly(page);
    } else {
      await page.waitForTimeout(300);
    }
  }
  expect(pred(last), `story.json predicate never satisfied; last=${JSON.stringify(last)}`).toBe(true);
  return last;
}

test('doGate routes Alder\'s real "Road South" choice onto the engine road spec, and the first waystone fires for real', async ({ page }) => {
  test.setTimeout(120_000); // real dialogue + a real scene transition, under a possibly busy machine (Task 3/4 review)
  await seed(page);
  await bootToHamlet(page);
  expect(await warpHamletTo(page, 'gate')).toBe(true);
  await tapKey(page, 'e'); // all three T1 beats are seeded seen — no south-gate card; straight to Alder

  const roadValue = `spec:${ROAD_SPEC}`;
  const choices = await advanceToGateChoices(page);
  expect(choices.map((c) => c.value), 'Alder offers the road once beat III is seen').toContain(roadValue);

  // D1 (Task 3/4 review) — select it through the real menu, never by warping past doGate.
  await moveGateSelectionTo(page, roadValue);
  await page.screenshot({ path: `${SHOTS}/t2-return-gate-choice.png` });
  await tapKey(page, 'e'); // confirm "Road South"

  // alderFarewell (one page, no choices) closes itself on the next advance once its
  // typewriter finishes; then doGate() persists and starts the vaults scene.
  for (let i = 0; i < 8; i++) {
    if ((await currentScene(page)) === 'vaults') break;
    await tapKey(page, 'e');
    await page.waitForTimeout(250);
  }
  await waitReady(page, 'vaults');

  // D1 — doGate's `spec:` branch: assert the REAL road spec loaded, not the dev fixture.
  // (DungeonScene.useEngineSpec silently falls back to useFixture on an unresolvable id —
  // exactly the failure the Task 4 review traced for a drifted destination id.)
  const road = await page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const v = g?.scene?.getScene?.('vaults') as
      | { engineSpecId?: string | null; spec?: { rooms?: { id: string }[] } }
      | undefined;
    return { specId: v?.engineSpecId ?? null, firstRoomId: v?.spec?.rooms?.[0]?.id };
  });
  expect(road.specId, "doGate's spec: branch set the road's own engine spec id").toBe(ROAD_SPEC);
  expect(road.firstRoomId, "the road's own first room (ws-1), not the dev fixture's").toBe('ws-1');

  // D1 — enterRoom's road-entry fire, on the real player path: click the first room node
  // (the same (225,300) anchor chain.spec.ts/lantern-light.spec.ts/measured-turn.spec.ts/
  // relics.spec.ts all use for "room 0", regardless of which spec is loaded) and see beat
  // IV's card. Test 3 owns fighting the actual crawl; this test stops once the card confirms
  // the handoff from the gate is wired all the way to the first story beat.
  await canvasClick(page, 225, 300);
  const card = page.locator('.fw-story-card');
  await expect(card).toHaveAttribute('data-beat', 'onward-01.first-waystone', { timeout: 15_000 });
  await tapKey(page, 'Enter');
});

test('the Road South never appears before the fable is heard', async ({ page }) => {
  test.setTimeout(90_000);
  await seed(page, { version: 1, seenBeats: {}, completedArcs: {}, threadFragments: {} });
  await bootToHamlet(page);
  expect(await warpHamletTo(page, 'gate')).toBe(true);
  await tapKey(page, 'e');
  const choices = await advanceToGateChoices(page);
  expect(
    choices.some((c) => c.value.startsWith('spec:')),
    `saw ${JSON.stringify(choices)}`,
  ).toBe(false);
  await page.keyboard.press('Escape'); // close without choosing (DialogueBox.onKey's own Escape handling)
});

test('the whole road: waystone, middles, the Span, the fragment, the Return, the desk', async ({ page }) => {
  test.setTimeout(300_000); // this is THE long one — 30s+90s+90s+120s+30s+30s of internal poll
  // ceilings alone exceed a 120s test budget; the Task 3 review measured this exact suite
  // family losing to CPU-starved false timeouts under a busy multi-agent session and asked
  // for a raised ceiling here specifically ("give it a raised timeout or a quiet machine").
  await seed(page, SEEN_T1, ROAD_READY_SAVE);

  await page.goto(`/?scene=vaults&spec=${ROAD_SPEC}&auto=full&sim=1&seed=7`);

  // NOTE: do NOT gate on waitReady(page,'vaults') here. For the `auto=full` driver,
  // DungeonScene.bootFlow() only calls markReadyOnce() AFTER runAuto() has walked every
  // room to completion (or via create()'s 8s READY_FALLBACK_MS safety net, whichever comes
  // first) — confirmed empirically: the first run of this test raced straight past every
  // beat card and finished the whole arc before the gate ever resolved true, because with
  // sim=1 + JUDGE_MODE=stub the crawl (minus the real gate drills answered below) is fast.
  // e2e/gate-retreat-ledger.spec.ts documents the identical race for the dev fixture's own
  // gated room. Poll the DOM directly instead — Playwright's own auto-retrying assertion
  // catches the card the instant showBeatCard() appends it, no readiness flag needed.
  const card = page.locator('.fw-story-card');
  await expect(card).toHaveAttribute('data-beat', 'onward-01.first-waystone', { timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/t2-road-first-waystone.png` });

  // ws-1's own waystone gate now blocks the crawl (file doc comment: sim=1 shortcuts combat,
  // never DungeonScene.runGate's real free_recall drill) — waitForStoryState answers it.
  // The middles: beat V, once the second stone is behind us.
  await waitForStoryState(
    page,
    (s) => typeof s?.seenBeats?.['onward-01.the-middles'] === 'string',
    90_000,
  );
  await page.screenshot({ path: `${SHOTS}/t2-road-middles.png` });

  // ws-2's gate blocks next; waitForStoryState answers it on the way to Hollis's promise.
  await waitForStoryState(
    page,
    (s) => typeof s?.seenBeats?.['onward-01.hollis-promise'] === 'string',
    90_000,
  );
  // ws-3's gate blocks last (span itself has no gate — only a boss), then the boss fight
  // (sim=true) and bossVictory's ceremony run with no further drill.
  await waitForStoryState(
    page,
    (s) => typeof s?.seenBeats?.['onward-01.the-span'] === 'string',
    120_000,
  );
  await page.screenshot({ path: `${SHOTS}/t2-span-toll-warden.png` });

  const afterSpan = await readState<Story>(page, 'story.json');
  expect(
    afterSpan?.threadFragments?.['frag.name.01-span-ledger'],
    'the Span grants the thread fragment',
  ).toEqual(expect.any(String));
  expect(afterSpan?.completedArcs?.['onward-01'], 'the arc is NOT complete until the Return').toBeUndefined();

  // D1 — bossVictory's roomId passthrough: 'onward-01.the-span' is only eligible when
  // ctx.roomId === 'span' (story/beats.ts), so the assertion above already proves the
  // passthrough reached the beat table; nothing further to add here.

  // bossVictory walks the Keeper home; the Return fires from the hamlet's own bootstrap.
  // D1 — the hamlet `return` ask after the Span.
  await waitReady(page, 'hamlet');
  await expect(card).toHaveAttribute('data-beat', 'onward-01.the-return', { timeout: 30_000 });
  await waitForState(
    page,
    'story.json',
    (s: Story | null) => typeof s?.completedArcs?.['onward-01'] === 'string',
    30_000,
  );

  const done = await readState<Story>(page, 'story.json');
  expect(Object.keys(done?.seenBeats ?? {}).sort()).toEqual(
    [
      'onward-01.barred-road',
      'onward-01.dark-answers',
      'onward-01.fable-waywright',
      'onward-01.first-waystone',
      'onward-01.hollis-promise',
      'onward-01.the-middles',
      'onward-01.the-return',
      'onward-01.the-span',
    ].sort(),
  );
});

test('after the Return the desk shows the closed chapter and its first road, and the dusk wisp-stream ran', async ({ page }) => {
  test.setTimeout(90_000);
  await seed(page, {
    version: 1,
    seenBeats: {
      ...SEEN_T1.seenBeats,
      'onward-01.first-waystone': '2026-09-04T00:00:00.000Z',
      'onward-01.the-middles': '2026-09-04T00:00:00.000Z',
      'onward-01.hollis-promise': '2026-09-04T00:00:00.000Z',
      'onward-01.the-span': '2026-09-04T00:00:00.000Z',
      'onward-01.the-return': '2026-09-04T00:00:00.000Z',
    },
    completedArcs: { 'onward-01': '2026-09-04T00:00:00.000Z' },
    threadFragments: { 'frag.name.01-span-ledger': '2026-09-04T00:00:00.000Z' },
  });
  await bootToHamlet(page);

  // D2 (Task 4 review) — this save has completedArcCount() > 0, so HamletScene.bootstrap()'s
  // `if (services.story.completedArcCount() > 0) this.buildWispStream();` must have both
  // counted it and built the 6 extra 'fx.spark' sprites (on top of buildFireflies'
  // unconditional 10) without the surrounding try/catch swallowing a thrown error. No
  // production field exists purely for this test to read, so — same technique as
  // hamletPlayer() and this file's own gateDialogue() — count sprites straight off the live
  // scene's worldGroup rather than inventing a new production surface for it.
  const wispSparkCount = await page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const h = g?.scene?.getScene?.('hamlet') as
      | { worldGroup?: { getChildren?(): { texture?: { key?: string } }[] } }
      | undefined;
    return (h?.worldGroup?.getChildren?.() ?? []).filter((o) => o.texture?.key === 'fx.spark').length;
  });
  expect(wispSparkCount, 'buildFireflies (10) + buildWispStream (6) both ran, uncaught').toBeGreaterThanOrEqual(16);

  // Bonus screenshot (beyond the plan's named five) — visual evidence for D2's ambience
  // hook, taken near the gate where buildWispStream anchors its sprites.
  expect(await warpHamletTo(page, 'gate')).toBe(true);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/t2-hamlet-return-wisps.png` });

  expect(await warpHamletTo(page, 'records')).toBe(true);
  await tapKey(page, 'e');
  // Loop bound: 6 taps to reach and confirm the desk choice (e2e/story.spec.ts:96-105).
  for (let i = 0; i < 10; i++) {
    await tapKey(page, 'e');
    await page.waitForTimeout(250);
    if (await page.locator('.fw-desk').isVisible().catch(() => false)) break;
  }
  const desk = page.locator('.fw-desk');
  await expect(desk).toBeVisible();
  await desk.getByRole('button', { name: /Chapter One/ }).click();
  await expect(desk).toContainText('[T2-PLACEHOLDER] Chapter One — closed.');
  await expect(desk).toContainText('[T2-PLACEHOLDER] a road south, over the Span');
  await expect(desk).toContainText('[T2-PLACEHOLDER] The Span and the Toll-Warden');
  await page.screenshot({ path: `${SHOTS}/t2-desk-closed-chapter.png` });
  await page.keyboard.press('Escape');
});
