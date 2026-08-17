import { describe, it, expect, vi } from 'vitest';

// CombatScene.ts imports 'phaser' (Scene base class); real Phaser touches `window` at
// module-load time (device detection), which crashes in vitest's node environment (no jsdom
// in this project). Stub the one export CombatScene.ts's module scope actually needs at
// class-declaration time so the module can load far enough to reach the pure `claspCatches`
// export below it — splitPooledHp.test.ts's own idiom, verbatim (no Phaser.Scene method is
// ever called, since we never instantiate CombatScene here).
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

// CombatScene.ts also imports music/instance.ts, which eagerly constructs a MusicPlayer
// (Tone.Gain/Tone.Reverb) at module-load time — real Tone needs a Web Audio API that doesn't
// exist under vitest's node environment. Same minimal stub splitPooledHp.test.ts established.
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

const { claspCatches } = await import('../CombatScene');

describe('claspCatches (Ch. IX — the Unbroken Clasp, the decision table pure)', () => {
  it('catches a felling blow: party unit, borne, unspent, amount === hp exactly', () => {
    expect(claspCatches('party', 2, 2, false, 'unbroken-clasp')).toBe(true);
  });

  it('catches an overkill felling blow too — magnitude never matters once it would fell', () => {
    expect(claspCatches('party', 2, 99, false, 'unbroken-clasp')).toBe(true);
  });

  it('never catches on the enemy team, even with every other condition satisfied', () => {
    expect(claspCatches('enemy', 2, 2, false, 'unbroken-clasp')).toBe(false);
  });

  it('never catches once already spent this battle — once per battle, not once per unit', () => {
    expect(claspCatches('party', 2, 2, true, 'unbroken-clasp')).toBe(false);
  });

  it('never catches a non-lethal blow — chip damage that was never going to fell the unit', () => {
    expect(claspCatches('party', 2, 1, false, 'unbroken-clasp')).toBe(false);
  });

  it('the boundary just short of lethal (amount = hp - 1) does not catch', () => {
    expect(claspCatches('party', 5, 4, false, 'unbroken-clasp')).toBe(false);
  });

  it('never catches a unit already at/through 0 hp — "past clasping" (damageUnit\'s own !alive guard already keeps this uncallable in practice; the pure decision honors the same law standalone)', () => {
    expect(claspCatches('party', 0, 5, false, 'unbroken-clasp')).toBe(false);
  });

  it('never catches with no relic borne (null)', () => {
    expect(claspCatches('party', 2, 2, false, null)).toBe(false);
  });

  it('never catches with a DIFFERENT relic borne — only the exact Clasp id catches', () => {
    expect(claspCatches('party', 2, 2, false, 'waymark-heel')).toBe(false);
  });

  it('catches regardless of how large hp is, as long as the blow is lethal', () => {
    expect(claspCatches('party', 16, 16, false, 'unbroken-clasp')).toBe(true);
    expect(claspCatches('party', 16, 15, false, 'unbroken-clasp')).toBe(false);
  });
});
