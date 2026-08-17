/**
 * Flow-level regression tests for the dungeon room sequence. DungeonScene is Phaser-bound,
 * so the node test env stubs the engine and every presentation/IO leaf (VaultView, music,
 * bridge, the satchel pane) and injects the handful of scene systems the flow actually
 * touches — registry, time, scene.start, game.events. Everything that DECIDES anything
 * stays real: roomFlow, specResolve, the loot economy, and the bundled dev dungeon fixture
 * (under-1, under-2, under-3 "The Warded Door" with a free_recall gate, under-boss).
 *
 * Nothing here touches state/ — the save/srs/inventory services are in-memory fakes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const vv = vi.hoisted(() => ({
  log: [] as string[],
  handlers: null as null | {
    onRoom: (i: number) => void;
    onCamp: () => void;
    onSatchel: () => void;
    onTrim: () => void;
  },
}));

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../../../ready', () => ({ markReady: vi.fn() }));
vi.mock('../../../../music/instance', () => ({ music: { play: vi.fn(), stop: vi.fn() } }));
vi.mock('../../../../bridge/client', () => ({
  getPacks: vi.fn(async () => ({ packs: [] })),
  getPackAsset: vi.fn(async () => null),
}));
vi.mock('../../../../inventory/ui/inventoryPane', () => ({ openInventoryPane: vi.fn(async () => {}) }));
vi.mock('../VaultView', () => ({
  VaultView: class {
    constructor(_scene: unknown) {}
    renderChrome(_onTrim: () => void): void {}
    setHeader(): void {}
    renderMap(
      _spec: unknown,
      _progress: unknown,
      handlers: {
        onRoom: (i: number) => void;
        onCamp: () => void;
        onSatchel: () => void;
        onTrim: () => void;
      },
    ): void {
      vv.handlers = handlers;
    }
    setStatus(): void {}
    toast(msg: string): void { vv.log.push(`toast:${msg}`); }
    shakeNode(): void {}
    errorToast(msg: string): void { vv.log.push(`error:${msg}`); }
    lootToast(msg: string): void { vv.log.push(`lootToast:${msg}`); }
    async showBlurbCard(): Promise<void> { vv.log.push('blurb'); }
    async showCampCard(): Promise<void> { vv.log.push('camp'); }
    async showResumeChoice(): Promise<'continue'> { return 'continue'; }
    async combatFlash(): Promise<void> {}
    async vaultOpensBeat(msg: string): Promise<void> { vv.log.push(`vaultOpens:${msg}`); }
    tooltipDebug(): null { return null; }
  },
}));

import { DungeonScene } from '../DungeonScene';
import { services, type SaveData, type Quality, type DungeonRoom, type FactLite } from '../../../contracts';

const tick = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });

async function waitFor(pred: () => boolean, label: string, tries = 300): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await tick();
  }
  throw new Error(`timed out waiting for: ${label}`);
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

// ---- scene systems the flow touches ----------------------------------------

interface Env {
  sceneStarts: { key: string; data?: unknown }[];
  emit(event: string, ...args: unknown[]): void;
  systems: Record<string, unknown>;
}

function makeEnv(): Env {
  const store = new Map<string, unknown>();
  const sceneStarts: { key: string; data?: unknown }[] = [];
  const once = new Map<string, ((...a: unknown[]) => void)[]>();
  return {
    sceneStarts,
    emit(event, ...args) {
      const fns = once.get(event) ?? [];
      once.delete(event);
      for (const fn of fns) fn(...args);
    },
    systems: {
      registry: {
        get: (k: string) => store.get(k),
        set: (k: string, v: unknown) => { store.set(k, v); },
        remove: (k: string) => { store.delete(k); },
      },
      // every delay collapses to a macrotask so the flow runs at test speed
      time: { delayedCall: (_ms: number, cb: () => void) => { setTimeout(cb, 0); } },
      scene: { start: (key: string, data?: unknown) => { sceneStarts.push({ key, data }); } },
      game: {
        events: {
          once: (event: string, fn: (...a: unknown[]) => void) => {
            once.set(event, [...(once.get(event) ?? []), fn]);
          },
        },
      },
      input: { keyboard: { enabled: true, resetKeys: () => {} } },
    },
  };
}

function makeScene(env: Env): DungeonScene {
  const scene = new DungeonScene();
  Object.assign(scene, env.systems);
  return scene;
}

// ---- service fakes ----------------------------------------------------------

interface Harness {
  save: () => SaveData;
  gateQuality: { value: Quality };
  addGoldGate: { hold: boolean; calls: number; release: () => void };
  grantedItems: () => string[];
}

function installServices(initial: Partial<SaveData>): Harness {
  let data: SaveData = { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '', ...initial };
  const gateQuality = { value: 0 as Quality };
  const firstGold = deferred<void>();
  const addGoldGate = { hold: false, calls: 0, release: () => { firstGold.resolve(); } };
  const grantedItems: string[] = [];

  services.save = {
    ready: async () => {},
    get: () => data,
    save: async (patch) => { data = { ...data, ...patch }; },
  };
  services.srs = {
    ready: async () => {},
    dueQueue: () => [],
    record: async () => {},
    boxOf: () => 0,
    hasRecord: () => false,
    nextDueOf: () => undefined, // nothing recorded, so nothing has a next_due
    masteryAvg: () => 0,
    historyQualities: () => [],
  };
  services.inventory = {
    ready: async () => {},
    getGold: () => 0,
    snapshot: () => ({ gold: 0, stacks: {}, bornRelicId: null }),
    addGold: async () => {
      addGoldGate.calls += 1;
      if (addGoldGate.hold && addGoldGate.calls === 1) await firstGold.promise;
      return 0;
    },
    spendGold: async () => true,
    grantItem: async (id) => { grantedItems.push(id); },
    removeItem: async () => true,
    countOf: () => 0,
    useItem: async () => ({ ok: true, message: '' }),
    buy: async () => true,
    sell: async () => true,
    bearRelic: async () => true,
    bornRelic: () => null,
  };
  services.amendments = {
    ready: async () => {},
    isWitnessed: () => true,
    isSuspended: () => false,
    eligible: (ids) => [...ids],
    pending: () => [],
    witness: async () => {},
    firstAmendedAppearance: () => null,
  };
  services.runEncounter = async (req) => ({
    encounterId: req.encounterId ?? 'gate',
    kind: 'free_recall',
    factIds: ['moss.f4'],
    quality: gateQuality.value,
  });
  services.showTeaching = async () => {};
  services.showNightLedger = async () => {};
  services.showAmendment = async () => {};
  services.showLevelUp = async () => {};

  return { save: () => data, gateQuality, addGoldGate, grantedItems: () => grantedItems };
}

function setSearch(search: string): void {
  (globalThis as unknown as { window: { location: { search: string } } }).window = {
    location: { search },
  };
}

beforeEach(() => {
  vv.log.length = 0;
  vv.handlers = null;
});

describe('gate HP-out is not passage (crucible-2)', () => {
  it('leaves the warded room uncleared when the Fade takes the party mid-drill', async () => {
    // Rooms 1-2 already done; the crawl is at under-3, "The Warded Door", on 1 HP.
    setSearch('?dev=1&sim=1&auto=win');
    const h = installServices({
      hp: 1,
      dungeon: { roomIndex: 2, cleared: ['under-1', 'under-2'] },
    });
    h.gateQuality.value = 0; // the ward is failed, every attempt

    const env = makeEnv();
    const scene = makeScene(env);
    scene.init({ seed: 7 });
    scene.create();

    await waitFor(() => env.sceneStarts.some((s) => s.key === 'hamlet'), 'the walk home');

    // Combat was won, so the fight must not be re-litigated — but the ward never opened,
    // and an unopened ward is not a cleared vault. A permanently "cleared" under-3 would
    // hand the player a room they never passed AND swallow its loot, streak and gate
    // forever, since a cleared node only ever shows its revisit blurb.
    expect(h.save().dungeon?.cleared).toEqual(['under-1', 'under-2']);
    // …but the won fight is banked, so re-entry meets the ward, not the wraith again.
    expect(h.save().dungeon?.gatePending).toBe('under-3');
    expect(h.save().hp).toBe(0);
    expect(h.save().scene).toBe('hamlet');
  });

  it('resumes a shut ward straight into the drill, without re-fighting the room', async () => {
    // the save an HP-out at the ward leaves behind, after a night at the camp hearth
    setSearch('?dev=1&sim=1&auto=win');
    const h = installServices({
      hp: 16,
      dungeon: { roomIndex: 2, cleared: ['under-1', 'under-2'], gatePending: 'under-3' },
    });
    h.gateQuality.value = 1; // this time the ward yields

    const env = makeEnv();
    const scene = makeScene(env);
    scene.init({ seed: 7 });
    scene.create();

    await waitFor(() => vv.log.some((l) => l.startsWith('lootToast:')), 'the room-clear loot');
    // Fable_SPEC.md:31 — a wipe costs the loot roll, never story progress: no teaching card,
    // no second battle, straight back to the door that beat us.
    expect(vv.log).not.toContain('blurb');
    expect(env.sceneStarts.filter((s) => s.key === 'combat')).toHaveLength(0);
    expect(h.save().dungeon?.cleared).toEqual(['under-1', 'under-2', 'under-3']);
    expect(h.save().dungeon?.gatePending).toBeUndefined();
  });

  it('clears the warded room once the ward actually yields', async () => {
    setSearch('?dev=1&sim=1&auto=win');
    const h = installServices({
      hp: 8,
      dungeon: { roomIndex: 2, cleared: ['under-1', 'under-2'] },
    });
    h.gateQuality.value = 1; // the ward yields on the first try

    const env = makeEnv();
    const scene = makeScene(env);
    scene.init({ seed: 7 });
    scene.create();

    await waitFor(() => vv.log.some((l) => l.startsWith('lootToast:')), 'the room-clear loot');
    expect(h.save().dungeon?.cleared).toEqual(['under-1', 'under-2', 'under-3']);
    expect(h.save().streak).toBe(1);
  });
});

describe('busy lock across the battle-return settlement (crucible-2)', () => {
  it('swallows a map click while the previous room is still settling, then re-arms', async () => {
    setSearch('?dev=1&sim=0&auto=win'); // sim=0 → the real CombatScene handoff
    const h = installServices({ hp: 16 });
    h.addGoldGate.hold = true; // freeze the settlement inside grantRoomLoot

    const env = makeEnv();
    const scene = makeScene(env);
    scene.init({ seed: 7 });
    scene.create();

    // room 1 hands off to combat…
    await waitFor(() => env.sceneStarts.some((s) => s.key === 'combat'), 'the first battle');
    // …combat resolves, stashing its outcome for our next create() (the real handoff)…
    env.emit('combat:resolved', { outcome: 'victory', hpLost: 2, results: [] });
    // …and the scene restarts to settle it.
    scene.init({ seed: 7 });
    scene.create();

    await waitFor(() => h.addGoldGate.calls === 1, 'the loot grant in flight');
    expect(vv.handlers).not.toBeNull();
    vv.log.length = 0;

    // The map is live and under-2 is now the current node, but under-1's outcome is still
    // being settled — progress, streak and loot are all mid-write. A click here used to
    // sail through (resolveCombat releases `busy` at the end without ever taking it) and
    // launch a SECOND battle on top of the first one's unfinished settlement.
    vv.handlers!.onRoom(1);
    await tick();
    await tick();
    await tick();
    expect(vv.log).not.toContain('blurb');
    expect(env.sceneStarts.filter((s) => s.key === 'combat')).toHaveLength(1);

    // Once the settlement finishes the lock must release — the click is deferred, not dead.
    h.addGoldGate.release();
    await waitFor(() => vv.log.some((l) => l.startsWith('lootToast:')), 'the settlement to finish');
    await tick();
    vv.handlers!.onRoom(1);
    await waitFor(
      () => env.sceneStarts.filter((s) => s.key === 'combat').length === 2,
      'the second battle after the lock releases',
    );
  });
});

describe('onCamp busy-lock does not silently drop a click (W2 T8)', () => {
  it('rejects a camp click visibly while busy is held, instead of silently swallowing the heal', async () => {
    // The camp hearth is its OWN map node (VaultView.campNode → handlers.onCamp directly), NOT
    // routed through onRoom's busy guard. resolveCombat (066ca1f) holds `busy` across its whole
    // async settlement, and drawMap() runs partway through that window — so the hearth can be
    // visible and clickable while `busy` is still true. A 0-HP party's ONLY way to heal is this
    // node (or enterRoom's own hp<=0 redirect, which calls onCamp with busy already false —
    // never vulnerable); if onCamp silently no-ops here, the heal vanishes with no trace at all.
    setSearch('?dev=1');
    const h = installServices({ hp: 0 });

    const env = makeEnv();
    const scene = makeScene(env);
    scene.init({ seed: 7 });
    scene.create();

    await waitFor(() => vv.handlers !== null, 'the map to render');
    vv.log.length = 0;

    // Arrange the held lock exactly as resolveCombat's settlement window holds it.
    (scene as unknown as { busy: boolean }).busy = true;
    vv.handlers!.onCamp();
    await tick();
    await tick();

    // Pre-fix (RED): onCamp's own `if (this.busy) return;` drops the click with zero trace —
    // hp stays 0 and vv.log stays empty, indistinguishable from a broken hearth.
    expect(h.save().hp).toBe(0);
    expect(vv.log.some((m) => m.startsWith('toast:'))).toBe(true);

    // The rejection is a "try again", never a dead end — once the lock clears, the same click
    // (re-issued, matching every other busy-gated node in this file) must still land.
    (scene as unknown as { busy: boolean }).busy = false;
    vv.log.length = 0;
    vv.handlers!.onCamp();
    await waitFor(() => vv.log.includes('camp'), 'the camp card once the lock clears');
    expect(h.save().hp).toBe(16);
  });
});

// ---- onTrim() — Trim the Lantern, the between-rooms Ember-spend drill (W3 T5) ----

/** Installs services.draw + services.runEncounter for the trim ladder (due → fresh →
 *  seededShuffle(eligible(allFactIds))). Spies expose call evidence so a refused Trim
 *  (zero Embers / full HP) can PROVE the draw never fired, not just infer it. */
function installTrimDraw(
  opts: { due?: string[]; fresh?: string[]; allFactIds?: string[]; quality?: Quality } = {},
): { due: ReturnType<typeof vi.fn>; fresh: ReturnType<typeof vi.fn>; allFactIds: ReturnType<typeof vi.fn> } {
  const due = vi.fn(() => opts.due ?? []);
  const fresh = vi.fn(() => opts.fresh ?? []);
  const allFactIds = vi.fn(() => opts.allFactIds ?? []);
  services.draw = {
    ready: async () => {},
    indexReady: async () => {},
    due,
    fresh,
    allFactIds,
    sourceOf: () => undefined,
    factOf: () => undefined,
    encountersOf: () => [],
    isEmpty: () => false,
  };
  services.runEncounter = async (req) => ({
    encounterId: req.encounterId ?? 'trim-fact',
    kind: 'free_recall',
    factIds: req.factIds ?? [],
    quality: opts.quality ?? 1,
  });
  return { due, fresh, allFactIds };
}

/** Click Trim and wait for its toast — every outcome (refuse / refund / correct / miss)
 *  ends in exactly one toast, so this is a branch-agnostic sync point. */
async function fireTrim(): Promise<void> {
  vv.handlers!.onTrim();
  await waitFor(() => vv.log.some((m) => m.startsWith('toast:')), 'a trim toast');
}

type TrimDebugScene = { trimDebug(): { lastQuality: number | null; embersSpent: number } };

describe('onTrim — Trim the Lantern (W3 T5)', () => {
  it('(a) spends one Ember and heals +4 on a correct answer', async () => {
    setSearch('?dev=1');
    const h = installServices({ hp: 10, embers: 2 });
    const srsRecord = vi.fn(async () => {});
    services.srs.record = srsRecord;
    installTrimDraw({ due: ['moss.f1'], quality: 1 });

    const env = makeEnv();
    const scene = makeScene(env);
    scene.init({ seed: 7 });
    scene.create();
    await waitFor(() => vv.handlers !== null, 'the map to render');
    vv.log.length = 0;

    await fireTrim();

    expect(h.save().embers).toBe(1);
    expect(h.save().hp).toBe(14);
    expect(vv.log).toContain('toast:The flame answers. The party mends (+4).');
    expect(srsRecord).toHaveBeenCalledWith('moss.f1', 1, 'trim-fact', 'concept');
    expect((scene as unknown as TrimDebugScene).trimDebug()).toEqual({ lastQuality: 1, embersSpent: 1 });
  });

  it('(b) spends one Ember and heals +1 on a miss', async () => {
    setSearch('?dev=1');
    const h = installServices({ hp: 10, embers: 2 });
    installTrimDraw({ due: ['moss.f1'], quality: 0 });

    const env = makeEnv();
    const scene = makeScene(env);
    scene.init({ seed: 7 });
    scene.create();
    await waitFor(() => vv.handlers !== null, 'the map to render');
    vv.log.length = 0;

    await fireTrim();

    expect(h.save().embers).toBe(1);
    expect(h.save().hp).toBe(11);
    expect(vv.log).toContain('toast:A guttering flicker — the rest still soothes (+1).');
  });

  it('(c) partial credit (0.5) heals as a MISS, +1 — RT-1', async () => {
    setSearch('?dev=1');
    const h = installServices({ hp: 10, embers: 2 });
    installTrimDraw({ due: ['moss.f1'], quality: 0.5 });

    const env = makeEnv();
    const scene = makeScene(env);
    scene.init({ seed: 7 });
    scene.create();
    await waitFor(() => vv.handlers !== null, 'the map to render');
    vv.log.length = 0;

    await fireTrim();

    expect(h.save().embers).toBe(1);
    expect(h.save().hp).toBe(11);
    expect(vv.log).toContain('toast:A guttering flicker — the rest still soothes (+1).');
  });

  it('(d) zero Embers refuses: no draw, no spend', async () => {
    setSearch('?dev=1');
    const h = installServices({ hp: 10, embers: 0 });
    const draw = installTrimDraw({ due: ['moss.f1'], quality: 1 });

    const env = makeEnv();
    const scene = makeScene(env);
    scene.init({ seed: 7 });
    scene.create();
    await waitFor(() => vv.handlers !== null, 'the map to render');
    vv.log.length = 0;

    await fireTrim();

    expect(h.save().embers).toBe(0);
    expect(h.save().hp).toBe(10);
    expect(vv.log).toContain('toast:The ember pouch is empty. The hearth refills it come night.');
    expect(draw.due).not.toHaveBeenCalled();
    expect(draw.fresh).not.toHaveBeenCalled();
  });

  it('(e) full HP refuses: no spend', async () => {
    setSearch('?dev=1');
    const h = installServices({ hp: 16, embers: 2 });
    const draw = installTrimDraw({ due: ['moss.f1'], quality: 1 });

    const env = makeEnv();
    const scene = makeScene(env);
    scene.init({ seed: 7 });
    scene.create();
    await waitFor(() => vv.handlers !== null, 'the map to render');
    vv.log.length = 0;

    await fireTrim();

    expect(h.save().embers).toBe(2);
    expect(h.save().hp).toBe(16);
    expect(vv.log).toContain('toast:The lantern burns steady — nothing to trim.');
    expect(draw.due).not.toHaveBeenCalled();
  });

  it('(f) an empty draw (packless edge) refunds the Ember and bails clean', async () => {
    setSearch('?dev=1');
    const h = installServices({ hp: 10, embers: 2 });
    installTrimDraw({ due: [], fresh: [], allFactIds: [] });

    const env = makeEnv();
    const scene = makeScene(env);
    scene.init({ seed: 7 });
    scene.create();
    await waitFor(() => vv.handlers !== null, 'the map to render');
    vv.log.length = 0;

    await fireTrim();

    // net zero: spent then refunded — never left holding one fewer Ember than it started with
    expect(h.save().embers).toBe(2);
    expect(h.save().hp).toBe(10);
    expect(vv.log).toContain('toast:Nothing stirs in the Ledger tonight. The ember is yours again.');
    expect((scene as unknown as TrimDebugScene).trimDebug().embersSpent).toBe(0);
  });
});

// ---- teachingFacts() exhausted-pool fallback (wave-1 T9 fix round 1) -------

/** teachingFacts() is a private method; the drawGlobal branch only activates after a real
 *  loadSpecAndFacts() pack resolution, which this file's zero-packs bridge mocks (getPacks/
 *  getPackAsset) don't provide. Reaching directly into scene internals isolates the unit under
 *  test (the exhausted-pool fallback) from that unrelated plumbing. */
type TeachingFactsInternals = {
  drawGlobal: boolean;
  seed: number;
  facts: Map<string, FactLite>;
  teachingFacts(room: DungeonRoom, roomIndex: number): FactLite[];
};

function poke(scene: DungeonScene): TeachingFactsInternals {
  return scene as unknown as TeachingFactsInternals;
}

function installDraw(fresh: (opts: { count: number; seed: number; now: number }) => string[]): void {
  services.draw = {
    ready: async () => {},
    indexReady: async () => {},
    due: () => [],
    fresh,
    allFactIds: () => [],
    sourceOf: () => undefined,
    factOf: () => undefined,
    encountersOf: () => [],
    isEmpty: () => false,
  };
}

describe('teachingFacts — exhausted global pool falls back to the room\'s authored scroll (fix round 1)', () => {
  it('falls back to room.teaching (through eligibility) when services.draw.fresh() finds nothing new', () => {
    installServices({});
    services.amendments.eligible = (ids) => ids.filter((id) => id !== 'moss.f2'); // simulate a suspended fact
    installDraw(() => []); // every installed fact already has an SRS record — nothing unseen remains

    const s = poke(new DungeonScene());
    s.drawGlobal = true;
    s.seed = 7;
    s.facts = new Map([
      ['moss.f1', { id: 'moss.f1', type: 'definition', statement: 'stmt1' }],
      ['moss.f2', { id: 'moss.f2', type: 'definition', statement: 'stmt2' }],
    ]);
    const room: DungeonRoom = { id: 'r1', name: 'Room', teaching: ['moss.f1', 'moss.f2'], enemies: [] };

    // Pre-fix (RED): fresh()'s empty result short-circuits straight to an empty array — the
    // room's own authored scroll never surfaces, even though it always did pre-wave-1.
    // Post-fix (GREEN): falls back to room.teaching, still filtered through eligibility
    // (moss.f2 excluded), landing on exactly moss.f1.
    const result = s.teachingFacts(room, 0);
    expect(result.map((f) => f.id)).toEqual(['moss.f1']);
  });

  it('does not top up a partial fresh() draw with scripted ids — new-first stands as-is', () => {
    installServices({});
    installDraw(() => ['moss.f9']); // exactly one new fact remains unseen anywhere installed

    const s = poke(new DungeonScene());
    s.drawGlobal = true;
    s.seed = 7;
    s.facts = new Map([
      ['moss.f9', { id: 'moss.f9', type: 'definition', statement: 'stmt9' }],
      ['moss.f1', { id: 'moss.f1', type: 'definition', statement: 'stmt1' }],
      ['moss.f2', { id: 'moss.f2', type: 'definition', statement: 'stmt2' }],
    ]);
    // a 2-id authored scroll — if the fallback wrongly topped up a PARTIAL draw, moss.f1/f2
    // would leak into the result alongside moss.f9.
    const room: DungeonRoom = { id: 'r1', name: 'Room', teaching: ['moss.f1', 'moss.f2'], enemies: [] };

    const result = s.teachingFacts(room, 0);
    expect(result.map((f) => f.id)).toEqual(['moss.f9']);
  });
});

describe('flawless means untouched, not "no delta" (W4 T6 fix round)', () => {
  /** Drive one full battle-return settlement of the first (ungated) room and report the XP the
   *  room-clear grant paid — 40 flawless vs 25 bloodied, the only grant on this path. */
  async function settledXp(outcome: Record<string, unknown>): Promise<number> {
    setSearch('?dev=1&sim=0&auto=win'); // sim=0 → the real CombatScene handoff
    const h = installServices({ hp: 16, xp: 0, level: 1 });
    const env = makeEnv();
    const scene = makeScene(env);
    scene.init({ seed: 7 });
    scene.create();

    await waitFor(() => env.sceneStarts.some((s) => s.key === 'combat'), 'the battle');
    env.emit('combat:resolved', outcome); // stashes the outcome for the next create()
    scene.init({ seed: 7 });
    scene.create();

    await waitFor(() => (h.save().xp ?? 0) > 0, 'the room-clear grant');
    return h.save().xp ?? 0;
  }

  it('a bloodied battle that healed mid-fight and finished clean pays room-clear, NOT flawless', async () => {
    // The exact shape a mid-fight satchel heal / death's-door revival / level-up pool bump
    // leaves behind: hpLost re-anchored to 0, but the party genuinely took 3.
    expect(await settledXp({ outcome: 'victory', hpLost: 0, damageTaken: 3, results: [] })).toBe(25);
  });

  it('a genuinely untouched battle still pays flawless', async () => {
    expect(await settledXp({ outcome: 'victory', hpLost: 0, damageTaken: 0, results: [] })).toBe(40);
  });

  it('an outcome that omits damageTaken (the sim victory) still pays flawless', async () => {
    expect(await settledXp({ outcome: 'victory', hpLost: 0, results: [] })).toBe(40);
  });
});

// Fix round 2 (review's carried concern #2): lootToast()/vaultOpensBeat()'s fakes used to
// declare zero parameters, so nothing captured the MESSAGE TEXT the Wick's catch composes
// into — only that a call happened. offerLantern only ever reaches spendLanternLight() (and
// so the catch) once a Lantern-light raise is actually spent, so every scenario here needs
// lanternLight:true; there is no "Wick catches with no lantern held" case to isolate — the
// catch is nested inside the raise, by chapter law. Both expected strings below were verified
// against the REAL roomClearLoot/bossLoot/mulberry32 chain via a throwaway node probe during
// authoring (same discipline lantern-light.spec.ts's own seed-7 pins use), not hand-derived.
describe('the Second Wick composes into the loot message, not a second toast (Ch. IX, fix round 2)', () => {
  it('grantRoomLoot: the catch takes precedence over the refund explanation, in the SAME toast', async () => {
    // room 0 ("The Dripping Threshold"), seed 7, edge:'advantage' (the auto-raised lantern):
    // gold 13, no trinket — the exact precondition under which `refunding` would ALSO have
    // been true had the Wick not caught the spend first. Precedence is what's under test.
    setSearch('?dev=1&sim=1&auto=win');
    const h = installServices({ hp: 16, lanternLight: true });
    services.inventory.bornRelic = () => 'second-wick';

    const env = makeEnv();
    const scene = makeScene(env);
    scene.init({ seed: 7 });
    scene.create();

    await waitFor(() => vv.log.some((l) => l.startsWith('lootToast:')), 'the room-clear loot');

    const toast = vv.log.find((l) => l.startsWith('lootToast:'));
    expect(toast).toBe('lootToast:The Dripping Threshold falls quiet. +13 coin. The second wick catches.');
    expect(toast, 'the refund explanation never appears — the catch wins by construction').not.toContain(
      'dust glitters',
    );

    expect(h.save().wickCaught, 'the catch fired').toBe(true);
    expect(h.save().lanternLight, 'the light re-banked at once — still held, not cleared').toBe(true);
  });

  it("bossVictory: the catch appends to lootLine, the SAME text vaultOpensBeat shows once", async () => {
    // seed 7's boss loot under edge:'advantage': 60 gold, Clerk's Silver Nib (drawn by the
    // lantern's light — the trinket suffix), the Warden's signet. DEV_REWARD prefixes it (no
    // pack in this fixture). bornRelic returns 'second-wick', never the Signet, so `edged`
    // stays false — this exercises the Wick's append in isolation from the Signet's own edge.
    setSearch('?dev=1&sim=1&auto=win');
    const h = installServices({
      hp: 16,
      lanternLight: true,
      dungeon: { roomIndex: 4, cleared: ['under-1', 'under-2', 'under-3', 'under-bestiary'] },
    });
    services.inventory.bornRelic = () => 'second-wick';

    const env = makeEnv();
    const scene = makeScene(env);
    scene.init({ seed: 7 });
    scene.create();

    await waitFor(() => vv.log.some((l) => l.startsWith('vaultOpens:')), 'the boss victory beat');

    const beat = vv.log.find((l) => l.startsWith('vaultOpens:'));
    expect(beat).toBe(
      'vaultOpens:the Undercroft falls quiet, and one knot in the Fade comes undone' +
        " The Warden yields 60 coin, their signet, and a Clerk's Silver Nib" +
        ' — drawn by the lantern\'s light. The second wick catches.',
    );

    expect(h.save().wickCaught, 'the catch fired').toBe(true);
    expect(h.save().lanternLight, 'the light re-banked at once — still held, not cleared').toBe(true);
  });
});

// Ch. IX (Provenance) — Task 8: "each boss carries its own [relic]". The shipped dev fixture's
// under-boss room names relicId:'unbroken-clasp' (specResolve.test.ts pins this fixture clean
// against relicError); this proves the WIRING, not just the pure functions either side of it —
// resolveCombat -> bossVictory -> bossLoot actually reads the room's own relicId and grants
// THAT, rather than silently falling back to the hardcoded Signet the way a plumbing gap would.
describe("bossVictory reads the room's relicId (Ch. IX Provenance — Task 8)", () => {
  it("the dev fixture's boss room names unbroken-clasp; bossVictory grants exactly that, not the Signet fallback", async () => {
    setSearch('?dev=1&sim=1&auto=win');
    const h = installServices({
      hp: 16,
      dungeon: { roomIndex: 4, cleared: ['under-1', 'under-2', 'under-3', 'under-bestiary'] },
    });

    const env = makeEnv();
    const scene = makeScene(env);
    scene.init({ seed: 7 });
    scene.create();

    await waitFor(() => vv.log.some((l) => l.startsWith('vaultOpens:')), 'the boss victory beat');

    expect(h.grantedItems(), "the spec's own relicId was granted").toContain('unbroken-clasp');
    expect(h.grantedItems(), 'never the hardcoded Signet fallback when the spec names one').not.toContain(
      'warden-signet-of-terms',
    );
  });
});
