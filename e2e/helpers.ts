import { type Page, expect } from '@playwright/test';

/** Wait for the harness ready flag, optionally for a specific scene to be active.
 * The ceiling is generous: the very first navigation of a run pays a one-time Vite
 * cost compiling the full Phaser module graph (~25s cold locally; a 2-core CI runner
 * can roughly double that); warm loads resolve in <2s. */
export async function waitReady(page: Page, scene?: string): Promise<void> {
  await page.waitForFunction(() => (window as Window).__FABLEWOOD_READY === true, undefined, {
    timeout: 75_000,
  });
  if (scene) {
    await page.waitForFunction(
      (s) => (window as Window).__FABLEWOOD_STATE?.scene === s,
      scene,
      { timeout: 20_000 },
    );
  }
}

export async function currentScene(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as Window).__FABLEWOOD_STATE?.scene);
}

/** Read a value out of the shared Phaser game registry (e.g. 'vaults:packId'). */
export async function registryGet(page: Page, key: string): Promise<unknown> {
  return page.evaluate((k) => {
    const g = (window as Window).__FABLEWOOD_GAME as
      | { registry?: { get(key: string): unknown } }
      | undefined;
    return g?.registry?.get(k);
  }, key);
}

/** Open the encounter overlay dev harness for one kind and wait for it to render. */
export async function openOverlay(page: Page, kind: string, seed = 7, scene?: string): Promise<void> {
  await page.goto(`/?overlay=${kind}&seed=${seed}${scene ? `&scene=${scene}` : ''}`);
  await waitReady(page, scene);
  await page.locator('.fw-overlay').waitFor({ state: 'visible', timeout: 10_000 });
}

/** Click a point given in the canvas's internal 960x540 coords, scaled to its rendered size. */
export async function canvasClick(page: Page, ix: number, iy: number): Promise<void> {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + (ix / 960) * box.width, box.y + (iy / 540) * box.height);
}

/** tileToScreen: ORIGIN(192,48) + c*48+24, r*48+24 — the formula every combat spec uses to turn
 *  a board tile into a click point (boss-victory/boss-reforged/fixwave-combat's own former
 *  per-file copies of this exact helper, built on canvasClick above). */
export async function tileClick(page: Page, c: number, r: number): Promise<void> {
  await canvasClick(page, 192 + c * 48 + 24, 48 + r * 48 + 24);
}

/** Hold a key down for a duration (real key-repeat, drives Phaser movement). */
export async function holdKey(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/** Read the live HamletScene position/facing (read-only debug surface). null if not active. */
export async function hamletPlayer(
  page: Page,
): Promise<{ x: number; y: number; facing?: string; dialogueOpen: boolean } | null> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const h = g?.scene?.getScene?.('hamlet') as
      | { player?: { x: number; y: number }; facing?: string; dialogue?: { isOpen?: boolean } }
      | undefined;
    if (!h?.player) return null;
    return { x: Math.round(h.player.x), y: Math.round(h.player.y), facing: h.facing, dialogueOpen: !!h.dialogue?.isOpen };
  });
}

/** Wait until the HamletScene player exists (it's created in an async bootstrap that can lag
 *  the ready flag). Returns true once readable. */
export async function waitHamletPlayer(page: Page, timeout = 8000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await hamletPlayer(page)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

/** Walk the hamlet Keeper to (tx,ty) with REAL arrow-key input, closed-loop on real position
 *  (Y then X — matches the carved L-corridor). Robust to frame-timing unlike fixed holds. */
export async function walkHamletTo(page: Page, tx: number, ty: number, tol = 12): Promise<boolean> {
  await waitHamletPlayer(page);
  for (const axis of ['y', 'x'] as const) {
    let stuck = 0;
    for (let i = 0; i < 30; i++) {
      const p = await hamletPlayer(page);
      if (!p) return false;
      const d = axis === 'y' ? ty - p.y : tx - p.x;
      if (Math.abs(d) <= tol) break;
      const before = axis === 'y' ? p.y : p.x;
      const key = axis === 'y' ? (d > 0 ? 'ArrowDown' : 'ArrowUp') : d > 0 ? 'ArrowRight' : 'ArrowLeft';
      await holdKey(page, key, Math.min(240, (Math.abs(d) / 78) * 1000 + 40));
      const after = await hamletPlayer(page);
      const moved = after ? Math.abs((axis === 'y' ? after.y : after.x) - before) : 0;
      if (moved < 1 && ++stuck >= 3) break;
      if (moved >= 1) stuck = 0;
    }
  }
  const p = await hamletPlayer(page);
  return !!p && Math.abs(p.x - tx) <= tol && Math.abs(p.y - ty) <= tol;
}

/** A deliberate key tap — down, hold a few frames, up. Phaser edge-detects (JustDown) miss
 *  Playwright's default instant press, so interactions/dialogue need this. */
export async function tapKey(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(90);
  await page.keyboard.up(key);
}

/** Hold a key DOWN until `done(pos)` holds or `maxMs` elapses, polling the live position —
 *  closed-loop DURING the hold (release precision ≈ speed × poll ≈ 4px), unlike a timed hold
 *  whose distance is at the mercy of headless frame pacing. Returns the position at release. */
async function holdKeyUntil(
  page: Page,
  key: string,
  done: (p: { x: number; y: number }) => boolean,
  maxMs = 3000,
): Promise<{ x: number; y: number } | null> {
  const start = Date.now();
  let p = await hamletPlayer(page);
  await page.keyboard.down(key);
  try {
    while (Date.now() - start < maxMs) {
      p = await hamletPlayer(page);
      if (!p || done(p)) break;
      await page.waitForTimeout(40);
    }
  } finally {
    await page.keyboard.up(key);
  }
  return p;
}

/** Hold a key until the player stops moving on `axis` (pinned against collision) — the walls
 *  turn a flaky approach into an exact one: wherever the hold started, the release coordinate
 *  is the collision boundary. */
async function holdKeyUntilPinned(page: Page, key: string, axis: 'x' | 'y', maxMs = 3000): Promise<void> {
  let last = -999;
  let still = 0;
  await holdKeyUntil(
    page,
    key,
    (p) => {
      const v = axis === 'x' ? p.x : p.y;
      still = Math.abs(v - last) < 1 ? still + 1 : 0;
      last = v;
      return still >= 3; // ~3 polls (~120ms) without movement = pinned
    },
    maxMs,
  );
}

/** Wait until the hamlet scene's async bootstrap has loaded the provinces (packs). Read-only
 *  peek, same pattern as hamletPlayer: without it a fast approach can knock on the gate before
 *  Alder has anything to offer (empty-province dialogue has no choice and no warp). Also needed
 *  before the Wellspring interaction: without a loaded packId, doWellspring() takes its
 *  no-pack branch (wellspringEmpty(), no drill) instead of the real intro. */
export async function waitProvincesLoaded(page: Page, timeout = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const n = await page.evaluate(() => {
      const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
      const h = g?.scene?.getScene?.('hamlet') as { provinces?: unknown[] } | undefined;
      return h?.provinces?.length ?? 0;
    });
    if (n > 0) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/** Approach the South Gate door and enter the vaults on 100% REAL input. The geometry makes
 *  this deterministic rather than merely convergent: the door tile (248,204) sits in a 1-tile
 *  corridor whose floor (the row-13 tree ring) and ceiling (the gate building) are collision
 *  walls, so the funnel is (1) hold Down until pinned on the corridor floor — Y becomes exact,
 *  (2) hold Right/Left releasing at the door column — closed-loop, ±4px, (3) hold Up until
 *  pinned against the gate — faces up AND lands y≈202, 2px from the door's interact point,
 *  (4) tap E; then advance Alder with E only (arrows would move the province selection onto
 *  "Not yet"). Returns true once the vaults scene is active. */
export async function enterVaultsViaGate(page: Page, doorX = 248, doorY = 204): Promise<boolean> {
  await waitHamletPlayer(page);
  await waitProvincesLoaded(page);

  for (let attempt = 0; attempt < 3; attempt++) {
    let p = await hamletPlayer(page);
    if (!p) return false;
    if ((await currentScene(page)) === 'vaults') return true;

    // Stage from the south road if far afield — the funnel below assumes the road/plaza
    // region, where "down" pins on the corridor floor and "right" runs clear to the door.
    if (!p.dialogueOpen && (Math.abs(p.x - doorX) > 44 || p.y < doorY - 26)) {
      await walkHamletTo(page, doorX - 16, doorY, 16);
    }

    p = await hamletPlayer(page);
    if (p && !p.dialogueOpen) {
      // (1) pin on the corridor floor; (2) align to the door column; (3) pin against the gate.
      await holdKeyUntilPinned(page, 'ArrowDown', 'y', 1500);
      p = await hamletPlayer(page);
      if (p && Math.abs(p.x - doorX) > 3) {
        const dir = p.x < doorX ? 'ArrowRight' : 'ArrowLeft';
        await holdKeyUntil(page, dir, (q) => (dir === 'ArrowRight' ? q.x >= doorX - 2 : q.x <= doorX + 2), 3000);
      }
      await holdKeyUntilPinned(page, 'ArrowUp', 'y', 800);

      // (4) knock: E opens Alder when in range+facing; re-tap briefly, else re-run the funnel.
      for (let k = 0; k < 4; k++) {
        await tapKey(page, 'e');
        await page.waitForTimeout(260);
        if ((await hamletPlayer(page))?.dialogueOpen) break;
      }
    }

    if ((await hamletPlayer(page))?.dialogueOpen) {
      for (let k = 0; k < 16; k++) {
        await tapKey(page, 'e'); // advance Alder + confirm the default (province) choice
        await page.waitForTimeout(280);
        if ((await currentScene(page)) === 'vaults') return true;
        const q = await hamletPlayer(page);
        if (q && !q.dialogueOpen) break; // dialogue ended without a warp (e.g. packs raced) → retry
      }
    }
    if ((await currentScene(page)) === 'vaults') return true;
  }
  return (await currentScene(page)) === 'vaults';
}

/** Read a state file back through the dev bridge (GET /api/state/<name>). null if unwritten. */
export async function readState<T = Record<string, unknown>>(
  page: Page,
  name: string,
): Promise<T | null> {
  const res = await page.request.get(`/api/state/${name}`);
  if (!res.ok()) return null;
  return (await res.json()) as T;
}

/** Poll a state file until `pred` holds (state writes round-trip through disk). */
export async function waitForState<T = Record<string, unknown>>(
  page: Page,
  name: string,
  pred: (data: T | null) => boolean,
  timeout = 15_000,
): Promise<T | null> {
  const start = Date.now();
  let last: T | null = null;
  while (Date.now() - start < timeout) {
    last = await readState<T>(page, name);
    if (pred(last)) return last;
    await page.waitForTimeout(300);
  }
  expect(pred(last), `state/${name} never satisfied predicate; last=${JSON.stringify(last)}`).toBe(
    true,
  );
  return last;
}

/** Poll a live value until `pred` holds — the loud form: on timeout, `expect.poll`'s own
 *  failure output reports the last polled value alongside `message`, unlike a silent while-loop
 *  that just returns whatever it last saw and leaves a later assertion to explain why. Shared by
 *  every boss e2e spec that waits on a live CombatScene snapshot (boss-victory/boss-reforged/
 *  fixwave-combat's own former per-file copies of this exact helper). */
export async function waitForCombat<T>(
  read: () => Promise<T>,
  pred: (v: T) => boolean,
  message: string,
  timeout = 40_000,
): Promise<T> {
  await expect.poll(async () => (pred(await read()) ? 'yes' : 'no'), { message, timeout }).toBe('yes');
  return read();
}

/** The vc-law pack's own authored correct-branch text per Vault-Warden boss phase
 *  (packs/vc-law/pack.json) — a distinctive prefix of each `correct:true` branch's label.
 *  encounters/engine.ts's reskin() seed-shuffles branches[] order on every runEncounter
 *  (anti-staleness), so the FIRST rendered `.fw-optlabel` is never reliably the authored correct
 *  one — match by this text content, never by slot or hotkey. Shared by every boss e2e spec that
 *  drives a Parley (boss-victory/boss-reforged/fixwave-combat's own former per-file copies). */
export const CORRECT_BRANCH_PREFIX = [
  'Cite the standard',           // enc.sb.boss1-preference-multiple
  'Counter to nonparticipating', // enc.sb.boss2-participation-cap
  'Counter both terms',          // enc.sb.boss3-antidilution-pool
];

/** After a debug-teleport-and-Cast on the Warden, close the turn if it's still open. Step 0c (T6
 *  boss-cluster bisect): debugSetPos is a teleport that never spends the movement leg
 *  (turnBudget.ts), so post-T2 (move·act·move, End Turn) the turn stays open ("Steps remain")
 *  after a single Cast — advanceTurn() (the only place that consumes pendingBossPhase and opens
 *  the next Parley) never runs otherwise. Press End Turn like a real player standing still with
 *  movement left over would (boss-cluster-diagnosis.md) — never touches debugSetPos itself. The
 *  scene briefly holds `state:'resolving'` while the encounter/SRS/banner chain settles
 *  (CombatScene.ts's Phase type) — wait it out before deciding whether the turn is still open.
 *  Shared by every boss e2e spec that drives a Cast via debugSetPos (boss-victory/boss-reforged/
 *  fixwave-combat's own former per-file copies of this exact snippet). */
export async function closeCastTurnIfOpen(
  read: () => Promise<{ state: string } | null>,
  page: Page,
): Promise<void> {
  const afterCast = await waitForCombat(
    read, (s) => s?.state !== 'resolving', 'the post-Cast state settled (left "resolving")', 5_000,
  );
  if (afterCast?.state === 'playerMove') {
    await page.keyboard.press('7'); // End Turn
    await page.waitForTimeout(400);
  }
}

// --- minimal window typing for the harness surfaces (kept local to e2e) -------
declare global {
  interface Window {
    __FABLEWOOD_READY?: boolean;
    __FABLEWOOD_STATE?: { scene?: string; title?: string; seed?: number };
    __FABLEWOOD_GAME?: unknown;
    /** Dev/e2e-only warp hook installed by HamletScene (absent in production builds). */
    __fwWarp?: (locationId: string) => boolean;
  }
}

/** Warp the hamlet Keeper next to a location's door (dev/e2e-only hook — instant,
 *  flake-proof setup positioning). Returns false if the hook or the location is
 *  missing. NOT for the full-chain spec: that one spec's South Gate approach stays
 *  100% real keyboard input on purpose; this is for OTHER specs' setup. */
export async function warpHamletTo(page: Page, locationId: string): Promise<boolean> {
  return page.evaluate((id) => window.__fwWarp?.(id) ?? false, locationId);
}
