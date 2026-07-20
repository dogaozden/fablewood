import { describe, it, expect, vi } from 'vitest';

// CombatScene.ts imports 'phaser' (Scene base class); real Phaser touches `window` at
// module-load time (device detection), which crashes in vitest's node environment (no
// jsdom in this project). Stub the one export CombatScene.ts's module scope actually
// needs at class-declaration time (`class CombatScene extends Phaser.Scene`) so the
// module can load far enough to reach the pure `parseRankOverride` export below it — no
// Phaser.Scene method is ever called, since we never instantiate CombatScene here.
// Mirrors splitPooledHp.test.ts's established pattern for this exact problem.
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

// CombatScene.ts also imports music/instance.ts, which eagerly constructs a MusicPlayer
// (Tone.Gain/Tone.Reverb) at module-load time — real Tone needs a Web Audio API that
// doesn't exist under vitest's node environment. Same minimal stub splitPooledHp.test.ts uses.
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

const { parseRankOverride } = await import('../CombatScene');

describe('parseRankOverride (§6 — the ?rank= dev/e2e harness override)', () => {
  it('accepts exactly 1, 2, or 3', () => {
    expect(parseRankOverride('1')).toBe(1);
    expect(parseRankOverride('2')).toBe(2);
    expect(parseRankOverride('3')).toBe(3);
  });

  it('falls back to null for absent, malformed, or out-of-range values', () => {
    expect(parseRankOverride(null)).toBeNull();
    expect(parseRankOverride('')).toBeNull();
    expect(parseRankOverride('0')).toBeNull();
    expect(parseRankOverride('4')).toBeNull();
    expect(parseRankOverride('abc')).toBeNull();
    expect(parseRankOverride('2.5')).toBeNull();
    expect(parseRankOverride('-1')).toBeNull();
  });
});
