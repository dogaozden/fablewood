import { describe, it, expect, vi } from 'vitest';

// CombatScene.ts imports 'phaser' (Scene base class); real Phaser touches `window` at
// module-load time (device detection), which crashes in vitest's node environment (no
// jsdom in this project). Stub the one export CombatScene.ts's module scope actually
// needs at class-declaration time (`class CombatScene extends Phaser.Scene`) so the
// module can load far enough to reach the pure `splitPooledHp` export below it — no
// Phaser.Scene method is ever called, since we never instantiate CombatScene here.
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

// CombatScene.ts also imports music/instance.ts, which eagerly constructs a MusicPlayer
// (Tone.Gain/Tone.Reverb) at module-load time — real Tone needs a Web Audio API that
// doesn't exist under vitest's node environment. Same minimal stub already established
// by music/__tests__/instance.test.ts for this exact problem.
vi.mock('tone', () => ({
  getContext: () => ({ state: 'running' }),
  start: async () => {},
  Gain: class {
    connect() { /* no-op */ }
  },
  Reverb: class {
    toDestination() { /* no-op */ }
  },
}));

const { splitPooledHp } = await import('../CombatScene');

describe('splitPooledHp (crucible #9 — pooled-HP split invariant)', () => {
  // Wave 4 Task 7 — poolMax is now a required second param (the caps go level-keyed):
  // 16 (L1, maxHpForLevel(1)), 20 (L3), 34 (L10/LEVEL_CAP, maxHpForLevel(10)). The 10:16
  // Keeper ratio is the preserved constant carried across every poolMax, not the caps
  // themselves.
  const POOL_MAXES = [16, 20, 34];

  it('conserves the pool exactly for every integer pool, at every poolMax', () => {
    for (const poolMax of POOL_MAXES) {
      for (let pool = 0; pool <= poolMax; pool++) {
        const { keeper, mira } = splitPooledHp(pool, poolMax);
        expect(keeper + mira, `poolMax=${poolMax} pool=${pool} → keeper=${keeper} mira=${mira}`).toBe(
          Math.min(pool, poolMax),
        );
      }
    }
  });

  it('keeper never exceeds the scaled ratio ceiling (Math.ceil(poolMax * 10 / 16)); neither share goes negative', () => {
    for (const poolMax of POOL_MAXES) {
      const keeperCeiling = Math.ceil((poolMax * 10) / 16);
      for (let pool = 0; pool <= poolMax; pool++) {
        const { keeper, mira } = splitPooledHp(pool, poolMax);
        expect(keeper).toBeLessThanOrEqual(keeperCeiling);
        expect(keeper).toBeGreaterThanOrEqual(0);
        expect(mira).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('pool=0 leaves both fainted, at every poolMax', () => {
    for (const poolMax of POOL_MAXES) {
      expect(splitPooledHp(0, poolMax)).toEqual({ keeper: 0, mira: 0 });
    }
  });

  it('pool=poolMax (full) matches the scaled keeper:mira ratio exactly, incl. the shipped L1 pin', () => {
    for (const poolMax of POOL_MAXES) {
      const keeperCeiling = Math.ceil((poolMax * 10) / 16);
      expect(splitPooledHp(poolMax, poolMax)).toEqual({ keeper: keeperCeiling, mira: poolMax - keeperCeiling });
    }
    // concrete pin at the shipped L1 cap, byte-identical to the pre-Wave-4 split
    expect(splitPooledHp(16, 16)).toEqual({ keeper: 10, mira: 6 });
  });

  it('backcompat — splitPooledHp(p, 16) equals the pre-Wave-4 shipped split for every p in [0,16]', () => {
    for (let pool = 0; pool <= 16; pool++) {
      const clamped = Math.max(0, Math.min(16, pool));
      const legacyKeeper = Math.min(10, Math.ceil((clamped * 10) / 16));
      const legacyMira = clamped - legacyKeeper;
      expect(splitPooledHp(pool, 16)).toEqual({ keeper: legacyKeeper, mira: legacyMira });
    }
  });
});
