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
  it('conserves the pool exactly for every integer 0-16', () => {
    for (let pool = 0; pool <= 16; pool++) {
      const { keeper, mira } = splitPooledHp(pool);
      expect(keeper + mira, `pool=${pool} → keeper=${keeper} mira=${mira}`).toBe(pool);
    }
  });

  it('never exceeds either unit max (Keeper 10 / Mira 6) and never goes negative', () => {
    for (let pool = 0; pool <= 16; pool++) {
      const { keeper, mira } = splitPooledHp(pool);
      expect(keeper).toBeLessThanOrEqual(10);
      expect(mira).toBeLessThanOrEqual(6);
      expect(keeper).toBeGreaterThanOrEqual(0);
      expect(mira).toBeGreaterThanOrEqual(0);
    }
  });

  it('pool=0 leaves both fainted', () => {
    expect(splitPooledHp(0)).toEqual({ keeper: 0, mira: 0 });
  });

  it('pool=16 (full) matches the shipped 10/6 split', () => {
    expect(splitPooledHp(16)).toEqual({ keeper: 10, mira: 6 });
  });
});
