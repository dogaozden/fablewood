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
  handlers: null as null | { onRoom: (i: number) => void; onCamp: () => void; onSatchel: () => void },
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
    renderChrome(): void {}
    setHeader(): void {}
    renderMap(
      _spec: unknown,
      _progress: unknown,
      handlers: { onRoom: (i: number) => void; onCamp: () => void; onSatchel: () => void },
    ): void {
      vv.handlers = handlers;
    }
    setStatus(): void {}
    toast(msg: string): void { vv.log.push(`toast:${msg}`); }
    shakeNode(): void {}
    errorToast(msg: string): void { vv.log.push(`error:${msg}`); }
    lootToast(): void { vv.log.push('lootToast'); }
    async showBlurbCard(): Promise<void> { vv.log.push('blurb'); }
    async showCampCard(): Promise<void> { vv.log.push('camp'); }
    async showResumeChoice(): Promise<'continue'> { return 'continue'; }
    async combatFlash(): Promise<void> {}
    async vaultOpensBeat(): Promise<void> { vv.log.push('vaultOpens'); }
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
}

function installServices(initial: Partial<SaveData>): Harness {
  let data: SaveData = { scene: 'vaults', hp: 16, streak: 0, lastPlayed: '', ...initial };
  const gateQuality = { value: 0 as Quality };
  const firstGold = deferred<void>();
  const addGoldGate = { hold: false, calls: 0, release: () => { firstGold.resolve(); } };

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
    snapshot: () => ({ gold: 0, stacks: {} }),
    addGold: async () => {
      addGoldGate.calls += 1;
      if (addGoldGate.hold && addGoldGate.calls === 1) await firstGold.promise;
      return 0;
    },
    spendGold: async () => true,
    grantItem: async () => {},
    removeItem: async () => true,
    countOf: () => 0,
    useItem: async () => ({ ok: true, message: '' }),
    buy: async () => true,
    sell: async () => true,
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

  return { save: () => data, gateQuality, addGoldGate };
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

    await waitFor(() => vv.log.includes('lootToast'), 'the room-clear loot');
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

    await waitFor(() => vv.log.includes('lootToast'), 'the room-clear loot');
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
    await waitFor(() => vv.log.includes('lootToast'), 'the settlement to finish');
    await tick();
    vv.handlers!.onRoom(1);
    await waitFor(
      () => env.sceneStarts.filter((s) => s.key === 'combat').length === 2,
      'the second battle after the lock releases',
    );
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
