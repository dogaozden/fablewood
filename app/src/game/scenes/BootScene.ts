import Phaser from 'phaser';
import { markReady } from '../ready';
import { services } from '../contracts';
import { buildTextures } from '../../art/buildTextures';
import { music, resumeMusicOnce } from '../../music/instance';

/**
 * Boot scene — the single texture-bake + service-warm site, and the title screen.
 *
 * Every entry path routes through here (PhaserGame always starts 'boot'; a
 * ?scene=<key> jump arrives as init.next and is forwarded AFTER buildTextures,
 * so real art renders on every path — harness, e2e, and normal play alike).
 * With no `next`, renders the title screen over the key art and enters the
 * hamlet on the first input gesture (which also unlocks the audio context).
 */
export class BootScene extends Phaser.Scene {
  private seed = 0;
  private next?: string;

  constructor() {
    super('boot');
  }

  init(data: { seed?: number; next?: string }): void {
    this.seed = data?.seed ?? Date.now();
    this.next = data?.next;
  }

  preload(): void {
    // Lane-B painterly ground tiles (16x16). Loaded on EVERY path — title and
    // ?scene= jumps alike — so the hamlet floor upgrades everywhere. A loaded
    // key wins: buildTextures + scene placeholders skip keys that exist.
    this.load.image('tile.grass', '/art/tile-grass.png');
    this.load.image('tile.path', '/art/tile-path.png');
    this.load.image('tile.water', '/art/tile-water.png');
    if (!this.next) {
      this.load.image('title-key-art', '/art/title-key-art.png');
    }
    // Lane-B painterly hamlet buildings — loaded on every path so they register
    // before buildTextures() runs in create(); an existing key makes it skip the
    // Lane-A grid bake, so the painterly art wins with zero scene edits.
    this.load.image('prop.cottage', '/art/cottage-moss-roof.png');
    this.load.image('prop.tavern', '/art/tavern-gilded-acorn.png');
  }

  create(): void {
    // Real art first: any key registered here wins over scene placeholder bakes
    // (their ensureTextures skip existing keys).
    buildTextures(this);

    // Warm the persistence layer at boot (idempotent; scenes still await ready()
    // before reads). Fire-and-forget so the ready-flag timing stays deterministic.
    void Promise.all([
      services.srs.ready(),
      services.save.ready(),
      services.settings.ready(),
    ]).catch(() => {});

    // Harness path: forward to the requested scene; it marks ready itself.
    if (this.next && this.scene.manager.keys[this.next]) {
      this.scene.start(this.next, { seed: this.seed });
      return;
    }

    // Title screen.
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#241b2f');

    if (this.textures.exists('title-key-art')) {
      const img = this.add.image(width / 2, height / 2, 'title-key-art');
      const cover = Math.max(width / img.width, height / img.height);
      img.setScale(cover);
      // gentle darkening so the wordmark band reads
      this.add.rectangle(width / 2, height / 2, width, height, 0x241b2f, 0.18);
    }

    this.add
      .text(width / 2, height * 0.2, 'FABLEWOOD', {
        fontFamily: 'Georgia, serif',
        fontSize: '72px',
        color: '#f4c67a',
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#241a14', 10, false, true);

    this.add
      .text(width / 2, height * 0.32, 'the door into the Ledger Realms', {
        fontFamily: 'Georgia, serif',
        fontSize: '20px',
        color: '#f0e6d0',
      })
      .setOrigin(0.5)
      .setShadow(0, 2, '#241a14', 6, false, true);

    const prompt = this.add
      .text(width / 2, height * 0.86, 'press any key to enter the Fablewood', {
        fontFamily: 'Georgia, serif',
        fontSize: '18px',
        color: '#ffe9b8',
      })
      .setOrigin(0.5)
      .setShadow(0, 2, '#241a14', 6, false, true);
    this.tweens.add({
      targets: prompt,
      alpha: { from: 1, to: 0.35 },
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    markReady({ scene: 'boot', title: 'FABLEWOOD', seed: this.seed });

    const enter = (): void => {
      void resumeMusicOnce().then(() => {
        try {
          music.play('hamlet');
        } catch {
          /* audio must never block entry */
        }
      });
      this.scene.start('hamlet', { seed: this.seed });
    };
    this.input.keyboard?.once('keydown', enter);
    this.input.once('pointerdown', enter);
  }
}
