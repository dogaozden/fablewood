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
