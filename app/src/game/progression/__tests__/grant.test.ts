import { describe, it, expect, beforeEach, vi } from 'vitest';
import { services } from '../../contracts';
import { grantXp, XP_AMOUNTS } from '../grant';

const makeSave = (over: Record<string, unknown> = {}) => ({
  scene: 'hamlet', hp: 10, streak: 0, lastPlayed: 't', ...over,
});

describe('grantXp', () => {
  let patches: Record<string, unknown>[];
  beforeEach(() => {
    patches = [];
    services.save = {
      ready: async () => {},
      get: () => makeSave({ xp: 95 }),
      save: async (p) => { patches.push(p); },
    };
  });

  it('XP_AMOUNTS carries the ratified table', () => {
    expect(XP_AMOUNTS).toEqual({
      renewal: 5, 'room-clear': 25, 'room-clear-flawless': 40, gate: 10,
      boss: 150, amendment: 20, 'hearth-streak': 30, quest: 0,
    });
  });

  it('plain grant patches xp+level only, no hp', () => {
    services.save = {
      ready: async () => {},
      get: () => makeSave({ xp: 0 }),
      save: async (p) => { patches.push(p); },
    };
    expect(grantXp('renewal')).toEqual([]);
    expect(patches).toEqual([{ xp: 5, level: 1 }]);
  });

  it('level-up patches xp, level, AND +2 current hp in ONE patch', () => {
    expect(grantXp('renewal')).toEqual([2]);
    expect(patches).toEqual([{ xp: 100, level: 2, hp: 12 }]);
  });

  it('a grant that crosses one level applies +2 hp, clamped to the new max', () => {
    // NOTE: brief's original scenario asserted grantXp('boss') from xp:90 crosses TWO levels
    // ([2,3], level 3, hp 20). That is arithmetically impossible against the real, already-merged
    // xp.ts: boss=150 (confirmed by the XP_AMOUNTS test above), 90+150=240, and levelForXp(240)=2
    // (xp.test.ts locks levelForXp(299)=2 / levelForXp(300)=3 — 240 never reaches 300). The brief's
    // [2,3]/level:3/hp:20 numbers match xp.test.ts's OWN awardXp(90, 250) case, not a 150-delta
    // grant — this looks like copy residue from that precedent onto the wrong source. Corrected here
    // to the real awardXp(90,150) output; still exercises +2/level AND the clamp (19+2=21 → capped
    // at maxHpForLevel(2)=18). Flagged to team-lead — see task-3-report.md.
    services.save = {
      ready: async () => {},
      get: () => makeSave({ xp: 90, hp: 19 }),
      save: async (p) => { patches.push(p); },
    };
    expect(grantXp('boss')).toEqual([2]);   // 90 + 150 = 240 → levelForXp(240) = 2
    expect(patches).toEqual([{ xp: 240, level: 2, hp: 18 }]); // 19+2=21 clamped to maxHpForLevel(2)=18
  });

  it('multi-level grant applies +2 per level crossed, clamped to the new max', () => {
    // The seam's genuine multi-level path: no table source can double-cross from below L2 (the
    // largest, boss, is 150 — even 99+150=249 stays under the L3 threshold of 300), so this pins
    // the behavior via 'quest' + an explicit amount, reusing xp.test.ts's own awardXp(90,250)
    // precedent (xp:340, levelsGained:[2,3]) — the original brief's intended numbers, reached by
    // a delta that actually produces them.
    services.save = {
      ready: async () => {},
      get: () => makeSave({ xp: 90, hp: 19 }),
      save: async (p) => { patches.push(p); },
    };
    expect(grantXp('quest', { amount: 250 })).toEqual([2, 3]);   // 90 + 250 = 340
    expect(patches).toEqual([{ xp: 340, level: 3, hp: 20 }]); // 19+4=23 clamped to maxHpForLevel(3)=20
  });

  it('quest grants use the explicit pack-authored amount', () => {
    services.save = {
      ready: async () => {},
      get: () => makeSave({ xp: 0 }),
      save: async (p) => { patches.push(p); },
    };
    grantXp('quest', { amount: 35 });
    expect(patches).toEqual([{ xp: 35, level: 1 }]);
  });

  it('never throws on a get() failure — logs and returns [] (the get-leg)', () => {
    services.save = {
      ready: async () => {},
      get: () => { throw new Error('boom'); },
      save: async () => {},
    };
    expect(grantXp('renewal')).toEqual([]);
  });

  it('a save() failure still returns the already-computed levelsGained, but warns once (the save-leg counterpart to the get() failure above)', async () => {
    // Unlike the get() leg, a save() rejection happens AFTER grantXp has already returned
    // levelsGained synchronously (the fire-and-forget call isn't awaited), so the synchronous
    // try/catch can't reach it — this pins the .catch() on the save() call instead.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    services.save = {
      ready: async () => {},
      get: () => makeSave({ xp: 95 }),
      save: async () => { throw new Error('offline'); },
    };
    expect(grantXp('renewal')).toEqual([2]); // 95+5=100, level 2 — returned before save() rejects
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the fire-and-forget .catch() settle
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('applyHp:false suppresses the hp patch but still persists xp+level (mid-battle callers)', () => {
    expect(grantXp('renewal', { applyHp: false })).toEqual([2]);   // 95 + 5 = 100
    expect(patches).toEqual([{ xp: 100, level: 2 }]);              // no hp key at all
  });
});

/**
 * Wave 4 final review, C1 — TWO grants in ONE synchronous block against a save whose save() is
 * genuinely async. This is the shape the whole suite missed: every other case above installs a
 * fake whose save() mutates immediately, so the "cache lags the in-flight write" window that the
 * real SaveStore has (srs/store.ts's ObjectStore.save() assigns this.cache only after an awaited
 * getState→putState round trip) never opened, and the two shipped call sites that grant twice per
 * tick — DungeonScene.runGate's renewal-then-gate pass branch and bossVictory's boss-then-quest
 * pair — both silently destroyed the first grant's XP and re-announced its level.
 *
 * Expected values are the reviewer's own proof table, verified against the real modules:
 * quality-1 gate pass 0 → 15 · 95 → 110 with ceremony [2] once · boss+quest 0 → 650 (vc-law's
 * bossQuest resolves to q.vaults.warden, reward.xp 500) with ceremony [2,3] and no duplicate.
 */
describe('grantXp — a SEQUENCE of grants in one tick (C1 regression)', () => {
  /** consume.test.ts's makeFakeSave(hp, delayMs) shape, reused rather than reinvented (the
   *  reviewer's own pointer): get() is a synchronous cache read, save() performs a real async
   *  round trip BEFORE the cache is updated — the one property that reproduces C1. Writes are
   *  serialized on a chain, like ObjectStore's own writeChain, so a later patch merges over an
   *  earlier one exactly as the real store's `{ ...base, ...patch }` does. */
  function makeAsyncSave(over: Record<string, unknown>, delayMs: number) {
    let cache: Record<string, unknown> = makeSave(over);
    const patches: Record<string, unknown>[] = [];
    let chain: Promise<void> = Promise.resolve();
    return {
      patches,
      ready: async () => {},
      get: () => cache as ReturnType<typeof makeSave> & { xp?: number; level?: number },
      save(patch: Record<string, unknown>) {
        patches.push(patch);
        chain = chain.then(async () => {
          await new Promise((r) => setTimeout(r, delayMs));
          cache = { ...cache, ...patch };
        });
        return chain;
      },
    };
  }

  /** Let every queued write settle, so the cache is authoritative again. */
  const drain = (delayMs: number) => new Promise((r) => setTimeout(r, delayMs * 4 + 20));

  function install(over: Record<string, unknown>, delayMs = 15) {
    const fake = makeAsyncSave(over, delayMs);
    // consume.test.ts's own install-by-cast idiom (services is a bare mutable registry).
    (services as unknown as { save: typeof fake }).save = fake;
    return fake;
  }

  it('a clean gate pass banks BOTH grants: renewal(+5) then gate(+10) from 0 reaches 15', async () => {
    const fake = install({ xp: 0 });

    // DungeonScene.runGate's pass branch, verbatim in shape: no await between the two.
    const pending = [...grantXp('renewal', { applyHp: true }), ...grantXp('gate')];

    expect(pending, 'no level crossed on the way to 15').toEqual([]);
    expect(fake.patches.map((p) => p.xp), 'the second grant builds on the first, not on 0').toEqual([5, 15]);
    await drain(15);
    expect(fake.get().xp, 'both grants are banked — XP is never lost').toBe(15);
  });

  it('a gate pass that crosses a level announces it ONCE: 95 → 110, ceremony [2]', async () => {
    const fake = install({ xp: 95, hp: 10 });

    const pending = [...grantXp('renewal', { applyHp: true }), ...grantXp('gate')];

    expect(pending, 'Level 2 listed once, not once per grant in the tick').toEqual([2]);
    await drain(15);
    expect(fake.get().xp).toBe(110);
    expect(fake.get().level).toBe(2);
    expect(fake.get().hp, '+2 for the one level actually gained (10 → 12), not twice').toBe(12);
  });

  it('a boss victory with a quest reward banks both: 0 → 650, ceremony [2,3], hp 16 → 20', async () => {
    const fake = install({ xp: 0, hp: 16 });

    // DungeonScene.bossVictory, verbatim in shape: the flat boss grant, then the pack's quest xp.
    const pending = [...grantXp('boss'), ...grantXp('quest', { amount: 500 })];

    expect(pending, 'two DISTINCT levels, in the order they were crossed').toEqual([2, 3]);
    expect(fake.patches.map((p) => p.xp), 'the quest grant builds on the boss grant').toEqual([150, 650]);
    await drain(15);
    expect(fake.get().xp, "the boss's 150 survives the quest's write").toBe(650);
    expect(fake.get().level).toBe(3);
    expect(
      fake.get().hp,
      'each level bumps the pool from the PREVIOUS bump: 16 → 18 (L2 cap) → 20 (L3 cap)',
    ).toBe(20);
  });

  it('three grants in one tick all land (doWellspring/doAmendments loop shape)', async () => {
    const fake = install({ xp: 0 });

    grantXp('amendment');
    grantXp('amendment');
    grantXp('amendment');

    await drain(15);
    expect(fake.get().xp, '3 × 20, none overwritten').toBe(60);
  });

  it('once the writes settle the store is authoritative again — a foreign hp write is not shadowed', async () => {
    const fake = install({ xp: 95, hp: 10 });

    expect(grantXp('renewal', { applyHp: true })).toEqual([2]); // 95 → 100, hp 10 → 12
    await drain(15);

    // Something that is NOT grantXp writes hp (CombatScene's sync sites, applyHp, consume.ts all
    // do): the party is bloodied down to 4 and the write lands.
    await fake.save({ hp: 4 });

    expect(grantXp('quest', { amount: 250 }), '100 → 350 crosses L3').toEqual([3]);
    await drain(15);
    expect(fake.get().xp).toBe(350);
    expect(fake.get().hp, 'the bump reads the bloodied 4, never the stale 12 this module wrote').toBe(6);
  });
});
