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
    // Lane-B painterly hamlet building props (chroma-keyed cutouts). Loaded on
    // every path so they register before buildTextures() runs in create(); an
    // existing key makes buildTextures/scene placeholders skip the Lane-A grid
    // bake, so the painterly art wins with zero scene edits.
    this.load.image('prop.cottage', '/art/cottage-moss-roof.png');
    this.load.image('prop.tavern', '/art/tavern-gilded-acorn.png');
    this.load.image('prop.records-office', '/art/records-office.png');
    this.load.image('prop.south-gate', '/art/south-gate.png');
    this.load.image('prop.wellspring', '/art/wellspring-fountain.png');
    this.load.image('prop.tree', '/art/tree-canopy-lane-b.png');
    this.load.image('prop.lantern-post', '/art/lantern-post.png');
    // Lane-B glow fx (luma-keyed on black; ADD-blended by the hamlet scene).
    this.load.image('fx.glow', '/art/fx-glow.png');
    this.load.image('fx.spark', '/art/fx-spark.png');
    // Lane-B painterly NPC stills. Single-frame; see the create() cleanup below
    // that drops their stale grid-built idle anim once a real PNG owns the key.
    this.load.image('char.berry', '/art/berry-portrait.png');
    this.load.image('char.clerk', '/art/clerk-portrait.png');
    this.load.image('char.alder', '/art/alder-portrait.png');
    // Lane-B 128x128 dialogue/boss portraits (docs/art-reviews/portraits-v1.md, PASSED
    // iter 2) — distinct from the tiny in-world char.* stills above. Loaded on every
    // path so DialogueBox (hamlet) and CombatScene's boss reveal (combat) both see them.
    this.load.image('portrait.berry', '/art/portrait-berry-bramblemaid.png');
    this.load.image('portrait.clerk', '/art/portrait-laconic-clerk.png');
    this.load.image('portrait.alder', '/art/portrait-gatewarden-alder.png');
    this.load.image('portrait.mira', '/art/portrait-mira-the-factor.png');
    this.load.image('portrait.vault-warden', '/art/portrait-vault-warden.png');
    // Lane-B combat backdrop for the Preference Vaults (960x540, matches the canvas).
    this.load.image('backdrop.vaults', '/art/backdrop-preference-vaults.png');
  }

  create(): void {
    // Real art first: any key registered here wins over scene placeholder bakes
    // (their ensureTextures skip existing keys).
    buildTextures(this);

    // Lane-B stills are single-frame: when a loaded PNG owns a char key (its
    // texture source is an HTMLImageElement, not a grid-baked canvas), drop the
    // stale grid-built idle anim — playing it would swap the sprite back to the
    // old `<key>__sheet` pixel art. HamletScene then falls back to its gentle
    // breathing-bob tween for these NPCs. If a PNG fails to load, the grid bake
    // owns the key, the anim survives, and behavior is unchanged.
    for (const key of ['char.berry', 'char.clerk', 'char.alder']) {
      if (!this.textures.exists(key)) continue;
      if (this.textures.get(key).getSourceImage() instanceof HTMLImageElement) {
        this.anims.remove(`${key}.idle`);
      }
    }

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

    // Resume target for a hard reload with no ?scene= jump: the saved scene pointer,
    // when it names a real resumable scene, else the hamlet. Combat is deliberately
    // never persisted (DungeonScene/HamletScene only ever write scene:'vaults' or
    // scene:'hamlet' — see their services.save.save() call sites), so a mid-battle
    // reload always lands back at the dungeon, never combat. Read at gesture time,
    // not raced against it: services.save.ready() is already warmed above (fire-and-
    // forget), so awaiting it again here resolves that SAME settled/in-flight promise
    // — virtually instant — but doing it here (rather than caching the answer in a
    // background .then() before any gesture exists) is what actually guarantees
    // correctness for a gesture that outruns the warm read (e.g. a fast e2e key tap).
    const enter = (): void => {
      void (async () => {
        let resumeScene = 'hamlet';
        try {
          await services.save.ready();
          if (services.save.get().scene === 'vaults') resumeScene = 'vaults';
        } catch {
          /* save unreadable — fall back to the hamlet, same as always */
        }
        void resumeMusicOnce().then(() => {
          try {
            music.play(resumeScene);
          } catch {
            /* audio must never block entry */
          }
        });
        this.scene.start(resumeScene, { seed: this.seed });
      })();
    };
    this.input.keyboard?.once('keydown', enter);
    this.input.once('pointerdown', enter);
  }
}
