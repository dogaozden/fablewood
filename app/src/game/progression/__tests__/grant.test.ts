import { describe, it, expect, beforeEach } from 'vitest';
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

  it('quest grants use the explicit pack-authored amount', () => {
    services.save = {
      ready: async () => {},
      get: () => makeSave({ xp: 0 }),
      save: async (p) => { patches.push(p); },
    };
    grantXp('quest', { amount: 35 });
    expect(patches).toEqual([{ xp: 35, level: 1 }]);
  });

  it('never throws on a save failure — logs and returns []', () => {
    services.save = {
      ready: async () => {},
      get: () => { throw new Error('boom'); },
      save: async () => {},
    };
    expect(grantXp('renewal')).toEqual([]);
  });

  it('applyHp:false suppresses the hp patch but still persists xp+level (mid-battle callers)', () => {
    expect(grantXp('renewal', { applyHp: false })).toEqual([2]);   // 95 + 5 = 100
    expect(patches).toEqual([{ xp: 100, level: 2 }]);              // no hp key at all
  });
});
