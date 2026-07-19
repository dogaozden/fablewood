import Phaser from 'phaser';
import { markReady } from '../ready';
import { services } from '../contracts';

const PALETTE = [0xf4c67a, 0xe98a5b, 0x8ecae6, 0xa7d17a, 0xc792ea, 0xffd6a5];

/**
 * Boot scene: proves the canvas renders. Draws the FABLEWOOD title and a seeded,
 * animated grid of colored rectangles, then marks the game ready.
 */
export class BootScene extends Phaser.Scene {
  private seed = 0;

  constructor() {
    super('boot');
  }

  init(data: { seed?: number }): void {
    this.seed = data?.seed ?? Date.now();
  }

  create(): void {
    // Warm the persistence layer at boot (idempotent; scenes still await ready()
    // before reads). Fire-and-forget so the ready-flag timing stays deterministic.
    void Promise.all([
      services.srs.ready(),
      services.save.ready(),
      services.settings.ready(),
    ]).catch(() => {});

    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#241b2f');

    this.add
      .text(width / 2, height * 0.16, 'FABLEWOOD', {
        fontFamily: 'Georgia, serif',
        fontSize: '64px',
        color: '#f4c67a',
      })
      .setOrigin(0.5)
      .setShadow(0, 3, '#7a4a1e', 6, false, true);

    this.add
      .text(width / 2, height * 0.28, 'the door into the Ledger Realms', {
        fontFamily: 'Georgia, serif',
        fontSize: '20px',
        color: '#cdbfe0',
      })
      .setOrigin(0.5);

    // Seeded grid so a given ?seed= always renders identically (deterministic shots).
    const rng = mulberry32(this.seed);
    const cols = 8;
    const rows = 4;
    const size = 44;
    const gap = 14;
    const gridW = cols * size + (cols - 1) * gap;
    const startX = width / 2 - gridW / 2 + size / 2;
    const startY = height * 0.5;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const color = PALETTE[Math.floor(rng() * PALETTE.length)];
        const rect = this.add
          .rectangle(startX + c * (size + gap), startY + r * (size + gap), size, size, color)
          .setOrigin(0.5);
        this.tweens.add({
          targets: rect,
          alpha: { from: 0.35, to: 1 },
          duration: 700 + Math.floor(rng() * 900),
          delay: Math.floor(rng() * 600),
          yoyo: true,
          repeat: -1,
        });
      }
    }

    markReady({ scene: 'boot', title: 'FABLEWOOD', seed: this.seed });
  }
}

/** Small deterministic PRNG so seeds produce repeatable visuals. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
