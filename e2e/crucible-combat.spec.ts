import { test, expect, type Page } from '@playwright/test';
import { waitReady, currentScene, readState } from './helpers';

const EV = 'screenshots';

type Snap = {
  state: string;
  activeTeam: string | null;
  activeId: string;
  enemyHp: number;
  partyHp: number;
  log: Array<{ action: string; dmg: number; overlay: boolean }>;
} | null;

type UnitDebug = {
  c: number; r: number; alive: boolean; hp: number; maxHp: number; attack: number; depth: number;
  statuses: Array<{ id: string; turnsLeft: number; magnitude: number }>;
} | null;

/** crucible #10 (2026-07-21 drift-hunt): the atomic single-evaluate() bundle hudDriftDebug()
 *  returns — see the CombatScene method for why this replaced a 3-call split poll. */
type HudDrift = {
  keeperHp: number | null; miraHp: number | null; hudText: string; refreshSeq: number;
  lastHpEvent: { unitId: string; kind: string; amount: number; seq: number } | null;
  pool: number; state: string; activeId: string;
} | null;

type Layout = { tiles: string[][]; braziers: unknown[]; mist: unknown[] } | null;

type Save = { scene?: string; hp?: number; streak?: number; dungeon?: { roomIndex: number; cleared: string[] } };
type Inv = { gold?: number; stacks?: Record<string, number> };

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { combatSnapshot?(): unknown } | undefined;
    return (s?.combatSnapshot?.() ?? null) as Snap;
  });
}

async function unitDebug(page: Page, id: string): Promise<UnitDebug> {
  return page.evaluate((uid) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { unitDebug?(id: string): unknown } | undefined;
    return (s?.unitDebug?.(uid) ?? null) as UnitDebug;
  }, id);
}

async function layoutDebug(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { layoutDebug?(): unknown } | undefined;
    return (s?.layoutDebug?.() ?? null) as Layout;
  });
}

/** crucible #10 (2026-07-21 drift-hunt): ONE page.evaluate() reading both units' live hp
 *  AND the HUD's raw text in the same synchronous scene call — see CombatScene.hudDriftDebug
 *  for why this replaced the original hudPartyText()+unitDebug()×2 split-read poll (three
 *  independent CDP round trips could straddle a legitimate enemy-turn hp update). */
async function hudDriftDebug(page: Page): Promise<HudDrift> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { hudDriftDebug?(): unknown } | undefined;
    return (s?.hudDriftDebug?.() ?? null) as HudDrift;
  });
}

/** Force the ?demo autopilot to prefer one action kind — 'strike' keeps a fight moving
 *  with NO encounter overlay ever opening (free, no-question, always hits), which several
 *  tests below need since they aren't driving a text-answer/MCQ overlay themselves. */
async function setPilot(page: Page, kind: string | null): Promise<void> {
  await page.evaluate((k) => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { setPilotPreference?(k: string | null): void } | undefined;
    s?.setPilotPreference?.(k);
  }, kind);
}

async function lastEncounterId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const s = g?.scene?.getScene?.('combat') as { lastEncounterId?(): string | null } | undefined;
    return s?.lastEncounterId?.() ?? null;
  });
}

/** Grid math mirrored from CombatScene.ts (ORIGIN/CELL) so the test can click real tiles. */
const CELL = 48;
const ORIGIN = { x: (960 - 12 * CELL) / 2, y: 48 };
function tileScreen(c: number, r: number): { x: number; y: number } {
  return { x: ORIGIN.x + c * CELL + CELL / 2, y: ORIGIN.y + r * CELL + CELL / 2 };
}
async function canvasClickAt(page: Page, ix: number, iy: number, button: 'left' | 'right' = 'left'): Promise<void> {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + (ix / 960) * box.width, box.y + (iy / 540) * box.height, { button });
}

async function pollUntil<T>(fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs: number, intervalMs = 150): Promise<T> {
  const start = Date.now();
  let v = await fn();
  while (!pred(v) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    v = await fn();
  }
  return v;
}

// ---------------------------------------------------------------------------------------
// crucible #7 (sev3), superseded by crucible V1-1: re-entering a room (and therefore combat)
// at 0 pooled HP used to skip the turn engine straight into an unwinnable instant defeat
// (checkEnd sees no living party unit before the player can ever act — the launch-time
// applyPoolHp split gives both units exactly 0 hp), so DungeonScene must still never launch
// combat at hp<=0. #7's original fix bounced the player to hamlet with a generic toast, but
// that bounce was itself a dead end (V1-1): hamlet shows no HP indicator, so a player who
// wandered back in at 0 HP saw nothing wrong, and the vaults' own halo affordance points
// straight back at the same "wrong" node, looping forever. DungeonScene now heals in place
// via onCamp()'s existing heal-and-toast instead of bouncing — the wrong click becomes the
// fix (auto-drivers get persist:true, same as runAuto()'s own 'camp' case, so this never
// blocks on a click that will never come).
// ---------------------------------------------------------------------------------------
test('crucible #7/V1-1: entering a room at 0 pooled HP never launches combat, heals in place instead of bouncing to hamlet', async ({ page }) => {
  test.setTimeout(90_000);
  const before = await readState<Save>(page, 'save.json');
  try {
    await page.request.put('/api/state/save.json', { data: { scene: 'vaults', hp: 0, streak: 0, lastPlayed: '' } });

    await page.goto('/?scene=vaults&dev=1&sim=0&auto=win&seed=7');
    // Deliberately no waitReady(page,'vaults') here: markReadyOnce() timing across the old
    // and new behavior isn't the thing under test — polling scene identity directly, recording
    // every value seen, is the robust way to prove 'combat' was never entered even transiently.
    const seen = new Set<string>();
    const start = Date.now();
    while (Date.now() - start < 8_000) {
      const sc = await currentScene(page);
      if (sc) seen.add(sc);
      await page.waitForTimeout(40);
    }
    expect([...seen], 'combat scene was never entered at all').not.toContain('combat');
    expect(await currentScene(page), 'V1-1: stays in vaults — no more bounce to hamlet').toBe('vaults');

    const save = await readState<Save>(page, 'save.json');
    expect(save?.hp ?? -1, 'V1-1: healed in place (onCamp) instead of being stranded at 0').toBe(16);
    expect(save?.dungeon?.cleared ?? [], 'no room was falsely marked cleared').toEqual([]);
  } finally {
    await page.request.put('/api/state/save.json', { data: before ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' } });
  }
});

// ---------------------------------------------------------------------------------------
// crucible #13 (sev2): right-click during playerMove had no rightButtonDown() guard (unlike
// the playerTarget branch one line below it in wireInput), so it silently spent the turn's
// movement exactly like a deliberate left-click. Right-click must be inert here.
// ---------------------------------------------------------------------------------------
test('crucible #13: right-click during playerMove does not spend the move', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');

  const s = await pollUntil(() => snap(page), (v) => v?.state === 'playerMove', 20_000);
  expect(s?.state, 'a player turn opened for manual control').toBe('playerMove');
  const activeId = s!.activeId;
  const before = await unitDebug(page, activeId);
  expect(before, 'active unit debug readable').not.toBeNull();

  const layout = await layoutDebug(page);
  expect(layout, 'layout readable').not.toBeNull();
  const neighbors: Array<[number, number]> = [
    [before!.c + 1, before!.r], [before!.c - 1, before!.r], [before!.c, before!.r + 1], [before!.c, before!.r - 1],
  ];
  const target = neighbors.find(([c, r]) => layout!.tiles[r]?.[c] && layout!.tiles[r][c] !== 'wall');
  expect(target, 'found a walkable neighbor tile to test against').toBeTruthy();
  const [tc, tr] = target!;
  const p = tileScreen(tc, tr);

  // Right-click the reachable tile — must be a no-op.
  await canvasClickAt(page, p.x, p.y, 'right');
  await page.waitForTimeout(300);
  const afterRight = await unitDebug(page, activeId);
  expect([afterRight?.c, afterRight?.r], 'right-click did not move the unit').toEqual([before!.c, before!.r]);
  const s2 = await snap(page);
  expect(s2?.state, 'still playerMove — the turn was not spent').toBe('playerMove');

  // Positive control: a LEFT-click on the same tile still works (proves the tile really was
  // reachable, so the right-click's no-op above is meaningful, not an unrelated miss-click).
  await canvasClickAt(page, p.x, p.y, 'left');
  await page.waitForTimeout(500);
  const afterLeft = await unitDebug(page, activeId);
  expect([afterLeft?.c, afterLeft?.r], 'a left-click on the same tile does move the unit').toEqual([tc, tr]);
});

// ---------------------------------------------------------------------------------------
// crucible #16 (sev1): fadeDead never called .setDepth(), so a corpse's depth froze at its
// death row (10 + r, the same scheme living units use) — a living unit later walking onto
// that tile ties on depth and can lose the draw order to the corpse. Depth-sort at death.
// ---------------------------------------------------------------------------------------
test('crucible #16: a dead unit is depth-sorted below any living unit on its row', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?scene=combat&seed=7&demo=1');
  await waitReady(page, 'combat');
  await setPilot(page, 'strike'); // no overlay ever opens; nothing here answers one

  const ids = ['wisp-0', 'wisp-1', 'wraith-2'];
  const start = Date.now();
  let dead: UnitDebug = null;
  while (!dead && Date.now() - start < 70_000) {
    for (const id of ids) {
      const u = await unitDebug(page, id);
      if (u && !u.alive) { dead = u; break; }
    }
    if (!dead) await page.waitForTimeout(300);
  }
  expect(dead, 'at least one enemy died during the fight').not.toBeNull();
  await page.screenshot({ path: `${EV}/e2e-crucible16-corpse-depth.png` });

  // The invariant that matters: whatever depth a corpse freezes at, it must sit BELOW where
  // a living unit on the SAME row would be (10 + r) — the exact tie this finding reported.
  expect(dead!.depth, 'corpse depth stays under the same-row living-unit depth (10 + r)').toBeLessThan(10 + dead!.r);
  expect(dead!.depth, 'corpse still renders above the floor/range-highlight layers').toBeGreaterThan(5);
});

// ---------------------------------------------------------------------------------------
// crucible #10 (sev2 ux): damageUnit drew the hp bar but never refreshed the text sidebar,
// so an ally faintED (or just damaged) during the ENEMY's turn could still read healthy/
// stale there until the player's own next action happened to trigger a refresh. The fix
// wires refreshParty into damageUnit itself (the one choke point every hp change funnels
// through), so the sidebar can never legitimately drift from the live unit state.
//
// 2026-07-21 drift-hunt (intermittent failure in full-suite runs, e.g. "Keeper real=5
// shown=4 at state=enemy"): root-caused to this SPEC, not the engine. The original poll
// read unitDebug('keeper'), unitDebug('mira'), and hudPartyText() as three SEPARATE
// page.evaluate() round trips via Promise.all — not one atomic read. Each is an
// independent CDP call, so a legitimate enemy-turn damageUnit→refreshParty update could
// land in the real-time gap BETWEEN them, making an older hp read look "ahead of" a newer
// (and fully correct) hud-text read. Caught live with refreshSeq instrumentation: a 3-call
// poll read keeper hp=3 (pre-hit) against hud text "2/10" (post-hit) — refreshSeq had
// already advanced from 15 to 16 strictly between the two reads (lastHpEvent confirmed a
// real 1-dmg hit on keeper), while a same-instant atomic read showed keeperHp=2 matching
// the hud text exactly (1 failure in 25 loop runs before this fix, isolated to an own-server
// repro harness). Fixed by reading everything through ONE evaluate() (hudDriftDebug, below)
// instead of splitting the read across three round trips. While tracing every hp-mutation path for
// this, also found (and hardened) a SECOND real gap: healUnit (the spell-heal path) mutated
// hp directly without calling refreshParty, unlike damageUnit — unreachable by this specific
// test today (no heal ever fires here) but a real violation of the "one choke point" the
// comment above claims; healUnit now refreshes for party targets too (see CombatScene.ts).
// ---------------------------------------------------------------------------------------
function parseHudHp(text: string, name: 'Keeper' | 'Mira'): { hp: number; max: number } | null {
  const m = text.match(new RegExp(`${name}\\s+[▰▱]+\\s+(\\d+)\\/(\\d+)`));
  return m ? { hp: Number(m[1]), max: Number(m[2]) } : null;
}

test('crucible #10: the party HUD sidebar never drifts from live unit hp, even mid-enemy-turn', async ({ page }) => {
  test.setTimeout(60_000);
  // Deliberately NO ?demo=1 and NO fighting back: the player always Waits (hotkey '7',
  // which — unlike Strike/Cast/etc — never itself calls refreshParty). That maximizes the
  // window a stale sidebar would show under the old bug (nothing else masks it by
  // incidentally refreshing on the player's own turn); the party takes real hits from
  // enemies every round regardless, and eventually wipes, which is a fine natural end.
  await page.goto('/?scene=combat&seed=7');
  await waitReady(page, 'combat');

  let mismatch: string | null = null;
  const start = Date.now();
  while (Date.now() - start < 25_000) {
    const s = await snap(page);
    if (!s || s.state === 'over' || (await currentScene(page)) !== 'combat') break;
    // ONE evaluate() reading both units' live hp AND the HUD text together (see
    // hudDriftDebug's doc comment) — this can never straddle a damageUnit/healUnit→
    // refreshParty update the way the original 3-call split poll could.
    const d = await hudDriftDebug(page);
    if (d) {
      const shownKeeper = parseHudHp(d.hudText, 'Keeper');
      const shownMira = parseHudHp(d.hudText, 'Mira');
      if (d.keeperHp !== null && shownKeeper && d.keeperHp !== shownKeeper.hp) {
        mismatch = `Keeper real=${d.keeperHp} shown=${shownKeeper.hp} at state=${d.state} (lastHpEvent=${JSON.stringify(d.lastHpEvent)})`;
      } else if (d.miraHp !== null && shownMira && d.miraHp !== shownMira.hp) {
        mismatch = `Mira real=${d.miraHp} shown=${shownMira.hp} at state=${d.state} (lastHpEvent=${JSON.stringify(d.lastHpEvent)})`;
      }
      if (mismatch) break;
    }
    if (s.state === 'playerMove') await page.keyboard.press('7'); // Wait — never refreshes on its own
    await page.waitForTimeout(120);
  }
  expect(mismatch, `HUD sidebar matched live hp throughout (${mismatch})`).toBeNull();
});

// ---------------------------------------------------------------------------------------
// crucible #3 (sev3): a mid-battle Satchel heal syncs the LIVE pool into save.json (so the
// heal's own math is against a fresh number), but end-of-battle resolveCombat used to
// subtract the WHOLE battle's cumulative hpLost from that already-synced base — double-
// subtracting the pre-heal damage. Fixed by re-anchoring hpLost to 0 at each mid-battle
// sync point (see useSatchelItem). Invariant checked here: the live pool at the moment
// victory is declared must equal whatever save.json ends up holding once the dungeon
// settles it — no more, no less — even though a heal happened in between.
// ---------------------------------------------------------------------------------------
test('crucible #3: a mid-battle Satchel heal does not double-subtract predamage at battle end', async ({ page }) => {
  test.setTimeout(120_000);
  const beforeSave = await readState<Save>(page, 'save.json');
  const beforeInv = await readState<Inv>(page, 'inventory.json');
  try {
    await page.request.put('/api/state/save.json', { data: { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '' } });
    await page.request.put('/api/state/inventory.json', { data: { version: 1, gold: 20, stacks: { 'embermend-draught': 3 } } });

    await page.goto('/?scene=vaults&dev=1&sim=0&auto=win&demo=1&seed=7');
    await waitReady(page, 'combat');
    await setPilot(page, 'strike'); // no overlay ever opens; nothing here answers one

    // Let real combat damage land BEFORE the heal (otherwise there is no pre-heal loss for
    // the bug to double-subtract — a pool merely seeded below max never touched damageUnit).
    await pollUntil(() => snap(page), (v) => !v || (v.partyHp ?? 16) < 16, 30_000);
    let s = await snap(page);
    expect(s && s.partyHp < 16, 'at least one real hit landed on the party before the heal').toBeTruthy();

    // Race the ?demo autopilot's own 520ms action delay: the instant a party turn opens,
    // steal it for a manual Satchel heal instead of letting autoStep act.
    s = await pollUntil(() => snap(page), (v) => v?.state === 'playerMove', 20_000, 60);
    expect(s?.state, 'a party turn opened to intercept for the heal').toBe('playerMove');
    await page.keyboard.press('q');
    await page.locator('.inv-overlay').waitFor({ state: 'visible', timeout: 5_000 });
    await page.locator('.inv-row').getByRole('button', { name: 'Use' }).first().click();
    await page.locator('.inv-overlay').waitFor({ state: 'detached', timeout: 5_000 });

    // Let autopilot resume and finish the fight (win or wipe — both cross the same
    // DungeonScene.resolveCombat -> applyHp choke point this finding lives in).
    const resolved = await pollUntil(
      () => snap(page),
      (v) => !v || v.state === 'over',
      60_000,
      150,
    );
    const liveHpAtResolution = resolved?.partyHp ?? null;
    expect(liveHpAtResolution, 'captured the live pool at the moment of resolution').not.toBeNull();

    // Wait for the scene to actually leave combat (the 1600ms transition + settlement).
    await pollUntil(async () => currentScene(page), (sc) => sc !== 'combat' && sc !== undefined, 15_000, 200);

    const finalSave = await readState<Save>(page, 'save.json');
    expect(
      finalSave?.hp,
      `save.json hp (${finalSave?.hp}) must equal the live pool at resolution (${liveHpAtResolution}) — ` +
        `a mismatch means the pre-heal damage got double-subtracted`,
    ).toBe(liveHpAtResolution);
  } finally {
    await page.request.put('/api/state/save.json', { data: beforeSave ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' } });
    await page.request.put('/api/state/inventory.json', { data: beforeInv ?? { version: 1, gold: 0, stacks: {} } });
  }
});

// ---------------------------------------------------------------------------------------
// crucible #5 (sev3 exploit): the hearth streak used to bump immediately (independent,
// fire-and-forget) the instant victory was declared in CombatScene, while hp/loot/dungeon-
// progress only ever settled later when the return scene resumed and recovered the pending
// outcome (game-event + registry PENDING_KEY — combatOutcome in scene.start's init data is
// a decoy DungeonScene.init() never reads). A hard reload in that gap kept the free streak
// but lost the room's actual settlement. The streak bump now travels through that same
// pending-outcome channel, so a reload before it fires loses (or a completed run keeps)
// streak and progress together.
// ---------------------------------------------------------------------------------------
test('crucible #5: a reload right after Victory must not keep the streak while losing room progress', async ({ page }) => {
  test.setTimeout(120_000);
  const beforeSave = await readState<Save>(page, 'save.json');
  try {
    await page.request.put('/api/state/save.json', { data: { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '', dungeon: { roomIndex: 0, cleared: [] } } });

    await page.goto('/?scene=vaults&dev=1&sim=0&auto=win&demo=1&seed=7');
    await waitReady(page, 'combat');
    await setPilot(page, 'strike'); // no overlay ever opens; nothing here answers one

    // Reach victory, then navigate away (the hard-reload simulation this repo's own
    // convention uses — page.reload() is never used anywhere in this suite; a fresh
    // goto() is) as fast as this loop can detect it, well inside the 1600ms window
    // CombatScene holds before it ever calls scene.start() on the return scene.
    await pollUntil(() => snap(page), (v) => v?.state === 'over', 60_000, 60);
    await page.goto('/?seed=7');
    await waitReady(page);

    const save = await readState<Save>(page, 'save.json');
    const roomCleared = (save?.dungeon?.cleared ?? []).length > 0;
    const streakBumped = (save?.streak ?? 0) > 0;
    // The exploit was specifically "streak bumped, progress not" — a partial, free-win
    // commit. Either both happened (the settlement fully completed before the reload) or
    // neither did (the reload beat it) — never streak alone.
    expect(
      streakBumped && !roomCleared,
      `exploitable partial commit: streak=${save?.streak} cleared=${JSON.stringify(save?.dungeon?.cleared)}`,
    ).toBe(false);
  } finally {
    await page.request.put('/api/state/save.json', { data: beforeSave ?? { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' } });
  }
});

// ---------------------------------------------------------------------------------------
// crucible #11 (sev2): the standalone boss dev/e2e fixture (?scene=combat&boss=1) forces a
// packId/phase-encounter-ids that exist in no installed pack, so encounters/engine.ts's
// pick() silently fell back to the same generic candidate for every phase — with vc-law
// installed, phases 2/3 never showed the Warden's real authored Shield encounters. Real
// dungeon-launched battles are unaffected (their launch already carries the real pack's own
// ids); this only exercises the standalone dev harness routing to vc-law's real boss phases.
// ---------------------------------------------------------------------------------------
test('crucible #11: the standalone boss fixture routes to the installed pack\'s real authored phase', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/?scene=combat&seed=7&boss=1');
  await waitReady(page, 'combat');

  // Phase 0's reveal + branch opens automatically; wait for the first scenario_branch
  // overlay and answer it (any option), then read which encounterId it actually resolved.
  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 20_000 });
  // The boss-reveal input-arming guard (crucible #4 fix) deliberately ignores keys for a
  // beat after the overlay mounts, so a genuine deliberate press needs to wait it out —
  // same settle delay e2e/combat.spec.ts's own boss-reveal test already uses.
  await page.waitForTimeout(600);
  await page.keyboard.press('1');
  // The branch verdict shows inline with an 'Onward ▸' continuation; runEncounter's
  // promise (and so this.results / lastEncounterId) doesn't settle until it's dismissed.
  const cont = page.getByRole('button', { name: 'Onward ▸' });
  await cont.waitFor({ state: 'visible', timeout: 10_000 });
  await cont.click();
  await page.waitForTimeout(300);

  const id = await lastEncounterId(page);
  expect(id, 'a boss-phase encounter resolved').not.toBeNull();
  // The fixture's own placeholder ids ('dev-boss-phase-N') are the pre-fix, generic-fallback
  // giveaway; vc-law's real authored phases are named enc.sb.boss*.
  expect(id, 'resolved a REAL vc-law-authored phase encounter, not the disconnected fixture id').toMatch(/^enc\.sb\.boss/);
});
