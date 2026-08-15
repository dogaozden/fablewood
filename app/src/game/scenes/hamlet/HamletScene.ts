/**
 * The Fablewood hamlet — the cozy home hub (slice-blueprint §5). A walkable
 * clearing with five locations, NPC dialogue, a bounty run at the Wellspring, and
 * province select at the South Gate. Renders the world under a 3x follow-camera and
 * all text under a second native-resolution UI camera for crispness.
 */
import Phaser from 'phaser';
import { markReady } from '../../ready';
import { services } from '../../contracts';
import { getPacks } from '../../../bridge/client';
import { DialogueBox } from '../../dialogue';
import { music } from '../../../music/instance';
import { openInventoryPane } from '../../../inventory/ui/inventoryPane';
import { openShopPane } from '../../../inventory/ui/shopPane';
import { hex, C } from './palette';
import { ensurePlaceholders } from './textures';
import { pickInteraction, facingVec, type Vec2 } from './interaction';
import {
  buildHamlet,
  resolveMove,
  type HamletMap,
  type LocationId,
  GRASS,
  ROWS,
  COLS,
  TILE,
  WORLD_W,
  WORLD_H,
} from './worldmap';
import {
  berryConv,
  clerkConv,
  alderConv,
  alderFarewell,
  cottageConv,
  hearthRestConv,
  factorConv,
  wellspringEmpty,
  wellspringIntro,
  wellspringOutro,
  type Province,
} from './content';
import { canRestTonight } from '../../rest/embers';
import { partitionByRecency, seededShuffle } from '../../recency';
import { planRedraw, FATE_HOLDS_LINE, heldLanternLight } from '../../lantern';
import { previewPick } from '../../encounters/engine';
import { FIXTURE_PACK } from '../../encounters/fixtures';
import type { Pack, Encounter } from '../../../packs/types';
import { AMENDMENT_BATCH_CAP } from '../../../srs/amendments';
import type { Amendment } from '../../contracts';
import { grantXp } from '../../progression/grant';
import { levelUpRows } from '../../progression/ceremony';
import { maxHpForLevel, emberMaxForLevel } from '../../progression/xp';

type Facing = 'up' | 'down' | 'left' | 'right';
type Key = Phaser.Input.Keyboard.Key;

/** M3 fix round 1 — the same guard encounters/register.ts's loadPacks() applies to its own
 *  getPacks() result, mirrored here rather than imported (register.ts's is file-private). */
function isPack(p: unknown): p is Pack {
  return !!p && typeof p === 'object' && Array.isArray((p as Pack).encounters) && !!(p as Pack).meta;
}

const SPEED = 78; // world px / second
const HW = 5;
const HH = 5;
const FOOT = 5; // collision box sits around the feet
const INTERACT_DIST = 22;
const LABEL_FONT = 'Georgia, "Times New Roman", serif';

/**
 * §recency (parity with CombatScene.dueFactIds() — see game/recency.ts) — facts
 * asked at the Wellspring this page session, across visits. Module-level so it
 * outlives any one doWellspring() call the same way CombatScene's session set
 * outlives any one battle; NOT persisted (state/ untouched, absent from SaveData).
 * Fixes the 3-round drill repeating a fact verbatim once the live due queue empties
 * mid-burst and falls back to the (otherwise static) initialDue/baseFactIds snapshot.
 */
const wellspringRecentFactIds = new Set<string>();

/**
 * services.draw.due()/fresh() cap (wave-1 draw service). Wellspring sets no `kinds` filter,
 * and encounters/engine.ts's pick() returns the FIRST candidate whose fact has ANY encounter
 * — so this only needs headroom over "the single most-due fact happens to have one", not an
 * exhaustive count. 20 is a generous cushion across both installed packs.
 */
const WELLSPRING_DRAW_COUNT = 20;

interface RawPack {
  meta?: { id?: string; title?: string };
  facts?: { id: string; type?: string }[];
}

export class HamletScene extends Phaser.Scene {
  private seed = 0;
  private map!: HamletMap;
  private worldGroup!: Phaser.GameObjects.Group;
  private uiRoot!: Phaser.GameObjects.Container;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private player!: Phaser.GameObjects.Sprite;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { up: Key; down: Key; left: Key; right: Key };
  private keyE!: Key;
  private keySpace!: Key;
  private keyI!: Key;

  private dialogue!: DialogueBox;
  private labels = new Map<LocationId, Phaser.GameObjects.Text>();
  private prompt!: Phaser.GameObjects.Text;

  // Mouse-hover tooltip (fun-review §3.6b: name + one line of flavor, independent of the
  // walk-proximity `labels` above — a mouse can discover a location's name without the
  // Keeper having to walk up to its door first).
  private hoverCont!: Phaser.GameObjects.Container;
  private hoverBg!: Phaser.GameObjects.Graphics;
  private hoverName!: Phaser.GameObjects.Text;
  private hoverBody!: Phaser.GameObjects.Text;
  private hoveredLoc: LocationId | null = null;

  private facing: Facing = 'down';
  private walkT = 0;
  private busy = false;
  private saveAccum = 0;
  private provinces: Province[] = [];
  private packId?: string;
  /** Test-support only: fact ids surfaced across the most recent Wellspring drill (e2e-interleave's
   *  wellspring-mix.spec.ts reads this via wellspringDrillDebug() to prove which pack(s) a drill
   *  actually drew from). Reset at the top of every doWellspring() call. */
  private wellspringSurfaced: string[] = [];
  private didShutdown = false;

  /** supersession-reteach.md §2 — amendments awaiting the Clerk, across every installed
   *  province. Non-empty ⇒ the Records Office pulses and its hover line changes. */
  private amendedPending: Amendment[] = [];
  private recordsPulse?: Phaser.GameObjects.Image;

  constructor() {
    super('hamlet');
  }

  init(data: { seed?: number }): void {
    this.seed = data?.seed ?? Date.now();
  }

  create(): void {
    ensurePlaceholders(this);
    this.map = buildHamlet();
    this.worldGroup = this.add.group();
    this.cameras.main.setBackgroundColor(hex(C.deepForest));

    this.buildGround();
    this.buildGlows();
    this.buildProps();
    this.buildNpcs();
    this.buildFireflies();
    this.buildPlayer();
    this.buildHoverZones();

    // Follow camera over the zoomed world.
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    cam.setZoom(3);
    cam.setDeadzone(46, 32);
    cam.startFollow(this.player, true, 0.12, 0.12);
    // Bias the view up: the map is only ~44px taller than the viewport, so lifting
    // the follow point frames the whole clearing (cottage + tavern read on arrival).
    cam.setFollowOffset(0, 40);
    cam.roundPixels = true;

    this.buildUi();
    this.setupInput();

    // Second camera: native-resolution UI overlay. Main ignores UI; UI ignores world.
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCam.setScroll(0, 0);
    this.uiCam.setName('ui');
    cam.ignore(this.uiRoot);
    this.uiCam.ignore(this.worldGroup.getChildren());

    // Dev/e2e-only warp hook: teleports the Keeper next to a location's door (same
    // spot `?demo=near-<id>` parks at below) without walking. For OTHER e2e specs'
    // setup only — the one full-chain spec keeps its 100% real-input South Gate
    // walk on purpose. Stripped from production builds by the `import.meta.env.DEV`
    // guard, same idiom as the `?overlay=` dev harness in encounters/register.ts.
    if (import.meta.env.DEV) {
      window.__fwWarp = (id: string): boolean => {
        const loc = this.map.locations.find((l) => l.id === id);
        if (!loc) return false;
        this.placePlayer(loc.door.x, loc.door.y + 2);
        this.facing = 'up';
        return true;
      };
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.didShutdown = true;
      void this.persist();
      this.dialogue.destroy();
      if (import.meta.env.DEV) delete window.__fwWarp;
    });

    // A full Game teardown (PhaserGame.tsx's unmount, e.g. the shell switching away
    // from the "Game" tab while the Keeper is still in the hamlet) does NOT emit
    // SHUTDOWN — Phaser's SceneManager.destroy() calls every scene's Systems.destroy()
    // directly, skipping shutdown() entirely. Without this, the position/scene pointer
    // was silently lost whenever the whole app closed mid-hamlet-visit instead of via a
    // scene transition. Guarded: every added scene (even ones that already shut down
    // earlier, e.g. hamlet -> vaults) gets a DESTROY event on full teardown too, so
    // without the guard this would replay stale hamlet coordinates over newer progress
    // made in whatever scene the game was actually destroyed from.
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      if (this.didShutdown) return;
      void this.persist();
    });

    void this.bootstrap();

    // Hamlet leitmotif — fire-and-forget; the shell handles gesture-resume + mute.
    try {
      music.play('hamlet');
    } catch {
      /* audio is optional; never let it block the scene */
    }

    markReady({ scene: 'hamlet', title: 'FABLEWOOD', seed: this.seed });
  }

  // ------------------------------------------------------------------ world build

  private buildGround(): void {
    const rt = this.add.renderTexture(0, 0, WORLD_W, WORLD_H).setOrigin(0, 0).setDepth(-1000);
    const keyFor = (t: number) => (t === 1 ? 'tile.path' : t === 2 ? 'tile.water' : 'tile.grass');
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) rt.draw(keyFor(this.map.tiles[r][c]), c * TILE, r * TILE);
    this.worldGroup.add(rt);
  }

  private buildGlows(): void {
    // A broad warm pool over the plaza, plus a glow at every lantern/window.
    const plaza = this.add
      .image(11 * TILE, 7 * TILE, 'fx.glow')
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(-850)
      .setAlpha(0.13)
      .setScale(2.4);
    this.worldGroup.add(plaza);
    this.tweens.add({ targets: plaza, alpha: 0.18, scale: 2.55, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    this.map.lanterns.forEach((l, i) => {
      const img = this.add
        .image(l.x, l.y, 'fx.glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(-800)
        .setAlpha(0.4)
        .setScale(1.1);
      this.worldGroup.add(img);
      this.tweens.add({
        targets: img,
        alpha: 0.52,
        scale: 1.25,
        duration: 1300 + i * 130,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    });

    // supersession-reteach.md §2 — the Records Office pulse. A soft lantern glow in the
    // existing vocabulary above (ADD blend, slow yoyo), hidden until the async bootstrap
    // finds amendments pending. Built here so it sits in the same depth band as the
    // lanterns rather than over the props.
    const records = this.map.locations.find((l) => l.id === 'records');
    if (records) {
      this.recordsPulse = this.add
        .image(records.center.x, records.center.y, 'fx.glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(-790)
        .setAlpha(0.34)
        .setScale(2.1)
        .setVisible(false);
      this.worldGroup.add(this.recordsPulse);
      // Wider and warmer than a lantern: the office is a 3x2-tile building, so a
      // lantern-sized glow behind it would be hidden by the sprite instead of haloing it.
      this.tweens.add({
        targets: this.recordsPulse,
        alpha: 0.66,
        scale: 2.6,
        duration: 1750,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }
  }

  private buildProps(): void {
    for (const p of this.map.props) {
      const img = this.add.image(p.x, p.y, p.key).setOrigin(p.ox, p.oy).setDepth(p.y);
      this.worldGroup.add(img);
    }
  }

  private buildNpcs(): void {
    const defs: { key: string; x: number; y: number }[] = [
      { key: 'char.berry', x: 245, y: 76 },
      { key: 'char.clerk', x: 44, y: 180 },
      { key: 'char.alder', x: 224, y: 202 },
      { key: 'char.mira', x: 296, y: 148 },
    ];
    for (const d of defs) {
      const npc = this.add.sprite(d.x, d.y, d.key).setOrigin(0.5, 1).setDepth(d.y);
      this.worldGroup.add(npc);
      const idle = `${d.key}.idle`;
      if (this.anims.exists(idle)) {
        // real art: play the shipped 2-frame idle loop (offset start so NPCs don't sync)
        npc.play(idle);
        npc.anims.setProgress(Math.random());
      } else {
        // placeholder art has no idle sheet — keep a gentle breathing bob
        this.tweens.add({
          targets: npc,
          y: d.y - 1.5,
          duration: 900 + Math.random() * 400,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.inOut',
        });
      }
    }
  }

  private buildFireflies(): void {
    const open: Vec2[] = [];
    for (let r = 1; r < ROWS - 1; r++)
      for (let c = 1; c < COLS - 1; c++)
        if (this.map.tiles[r][c] === GRASS && !this.map.solid[r][c])
          open.push({ x: c * TILE + 8, y: r * TILE + 8 });
    const rng = mulberry32(this.seed ^ 0x9e37);
    for (let i = 0; i < 10 && open.length; i++) {
      const p = open.splice(Math.floor(rng() * open.length), 1)[0];
      const a = 0.2 + rng() * 0.45;
      const f = this.add
        .image(p.x, p.y, 'fx.spark')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(6000)
        .setAlpha(a);
      this.worldGroup.add(f);
      this.tweens.add({
        targets: f,
        y: p.y - 5 - rng() * 9,
        x: p.x + (rng() * 8 - 4),
        alpha: 0.08,
        duration: 1500 + rng() * 1800,
        yoyo: true,
        repeat: -1,
        delay: rng() * 1600,
        ease: 'Sine.inOut',
      });
    }
  }

  private buildPlayer(): void {
    const s = this.map.spawn;
    this.player = this.add.sprite(s.x, s.y, 'char.keeper').setOrigin(0.5, 1).setDepth(s.y);
    this.worldGroup.add(this.player);
  }

  /** Mouse-hover hit zones (fun-review §3.6b) — one invisible Phaser Zone per named
   *  location, world-space so it tracks the camera's zoom/scroll automatically like every
   *  other world object. Added to worldGroup BEFORE create()'s uiCam.ignore(...) snapshot
   *  (below) picks up its children, so the UI camera correctly ignores these too. Sized to
   *  a generous typical building footprint; never gameplay-relevant (no physics body —
   *  movement collision is the separate `solid` grid, untouched). */
  private buildHoverZones(): void {
    for (const loc of this.map.locations) {
      const zone = this.add.zone(loc.center.x, loc.center.y, 48, 40).setOrigin(0.5);
      zone.setInteractive({ useHandCursor: false });
      zone.on('pointerover', () => {
        this.hoveredLoc = loc.id;
      });
      zone.on('pointerout', () => {
        if (this.hoveredLoc === loc.id) this.hoveredLoc = null;
      });
      this.worldGroup.add(zone);
    }
  }

  private buildUi(): void {
    this.uiRoot = this.add.container(0, 0).setDepth(10000);

    for (const loc of this.map.locations) {
      const t = this.add
        .text(0, 0, loc.name, {
          fontFamily: LABEL_FONT,
          fontSize: '15px',
          color: '#fff1c6',
          stroke: '#241a14',
          strokeThickness: 3,
          backgroundColor: 'rgba(42,29,19,0.62)',
          padding: { x: 7, y: 3 },
        })
        .setOrigin(0.5, 1)
        .setShadow(0, 1, '#100b0a', 4, false, true)
        .setAlpha(0);
      this.uiRoot.add(t);
      this.labels.set(loc.id, t);
    }

    this.prompt = this.add
      .text(this.scale.width / 2, this.scale.height - 40, '', {
        fontFamily: LABEL_FONT,
        fontSize: '15px',
        color: '#fff1c6',
        align: 'center',
        backgroundColor: 'rgba(42,29,19,0.82)',
        padding: { x: 12, y: 7 },
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.uiRoot.add(this.prompt);

    // Hover tooltip (fun-review §3.6b) — matches the overlay/hud parchment register (see
    // encounters/styles.ts, VaultView's card idiom): bark-shadow name, lanternGold hairline
    // accent, darker bark body text. Built once; updateHoverTip() retexts/repositions it.
    // Added to uiRoot LAST so it paints above the labels/prompt above (container children
    // render in list order; nothing else here sets an explicit depth either).
    this.hoverCont = this.add.container(0, 0).setAlpha(0);
    this.hoverBg = this.add.graphics();
    this.hoverName = this.add
      .text(0, 0, '', {
        fontFamily: LABEL_FONT,
        fontSize: '14px',
        color: hex(C.barkShadow),
        fontStyle: 'bold',
        align: 'center',
      })
      .setOrigin(0.5, 0);
    this.hoverBody = this.add
      .text(0, 0, '', {
        fontFamily: LABEL_FONT,
        fontSize: '12px',
        color: hex(C.darkBark),
        align: 'center',
        lineSpacing: 3,
        wordWrap: { width: 190 },
      })
      .setOrigin(0.5, 0);
    this.hoverCont.add([this.hoverBg, this.hoverName, this.hoverBody]);
    this.uiRoot.add(this.hoverCont);

    this.dialogue = new DialogueBox(this, this.uiRoot);
  }

  private setupInput(): void {
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    const KC = Phaser.Input.Keyboard.KeyCodes;
    this.wasd = {
      up: kb.addKey(KC.W),
      down: kb.addKey(KC.S),
      left: kb.addKey(KC.A),
      right: kb.addKey(KC.D),
    };
    this.keyE = kb.addKey(KC.E);
    this.keySpace = kb.addKey(KC.SPACE);
    this.keyI = kb.addKey(KC.I);
  }

  // ---------------------------------------------------------------- async data

  private async bootstrap(): Promise<void> {
    try {
      await Promise.all([
        services.save.ready(),
        services.srs.ready(),
        services.settings.ready(),
        services.inventory.ready(),
        services.amendments.ready(),
      ]);
    } catch {
      /* stubs/real impls both fine; ignore readiness errors */
    }

    try {
      const res = await getPacks();
      this.provinces = res.packs.map((p) => {
        const rp = p.pack as RawPack;
        const facts = rp?.facts ?? [];
        const factTypes: Record<string, string> = {};
        for (const fact of facts) {
          if (typeof fact.type === 'string') factTypes[fact.id] = fact.type;
        }
        return {
          id: p.id,
          title: rp?.meta?.title ?? p.id,
          factIds: facts.map((f) => f.id),
          factTypes,
        };
      });
      this.packId = this.provinces[0]?.id;
    } catch {
      this.provinces = [];
    }

    this.refreshAmendments();

    try {
      const save = services.save.get();
      if (save.scene === 'hamlet' && save.pos) this.placePlayer(save.pos.x, save.pos.y);
    } catch {
      /* no save yet */
    }

    this.handleDemo();
  }

  private placePlayer(x: number, y: number): void {
    const px = Phaser.Math.Clamp(x, TILE, WORLD_W - TILE);
    const py = Phaser.Math.Clamp(y, TILE, WORLD_H - 2);
    this.player.setPosition(px, py).setDepth(py);
    this.cameras.main.centerOn(px, py);
  }

  /** Dev screenshot hook: ?demo=berry|clerk|gate|cottage|wellspring opens a
   *  conversation; ?demo=near-<id> just parks the Keeper at a door so the prompt shows. */
  private handleDemo(): void {
    const demo = new URLSearchParams(window.location.search).get('demo');
    if (!demo) return;
    const alias: Record<string, LocationId> = {
      berry: 'tavern',
      clerk: 'records',
      alder: 'gate',
      gate: 'gate',
      tavern: 'tavern',
      records: 'records',
      cottage: 'cottage',
      wellspring: 'wellspring',
      mira: 'factor',
      factor: 'factor',
    };
    const parkOnly = demo.startsWith('near-');
    const id = alias[parkOnly ? demo.slice(5) : demo];
    if (!id) return;
    const loc = this.map.locations.find((l) => l.id === id);
    if (!loc) return;

    this.placePlayer(loc.door.x, loc.door.y + 2);
    this.facing = 'up';
    if (parkOnly) return;

    const conv = this.conversationFor(id);
    if (conv) {
      this.busy = true;
      void this.dialogue.run(conv, true);
    }
  }

  // ------------------------------------------------------------------- update

  update(_time: number, delta: number): void {
    if (!this.player) return;

    this.saveAccum += delta;
    if (this.saveAccum > 10000) {
      this.saveAccum = 0;
      void this.persist();
    }

    const locked = this.busy || this.dialogue.isOpen;
    if (!locked && Phaser.Input.Keyboard.JustDown(this.keyI)) void this.openSatchel();
    if (!locked) this.handleMovement(delta);
    else this.idleAnimate();

    this.updateLabels(locked);
    this.updatePromptAndInteract(locked);
    this.updateHoverTip(locked);
    this.player.setDepth(this.player.y);
  }

  private handleMovement(delta: number): void {
    let vx = 0;
    let vy = 0;
    if (this.cursors.left.isDown || this.wasd.left.isDown) vx -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) vx += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) vy -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) vy += 1;

    if (vx === 0 && vy === 0) {
      this.idleAnimate();
      return;
    }
    if (vx !== 0 && vy !== 0) {
      vx *= Math.SQRT1_2;
      vy *= Math.SQRT1_2;
    }
    const dt = Math.min(delta, 32) / 1000;
    const dx = vx * SPEED * dt;
    const dy = vy * SPEED * dt;
    const moved = resolveMoveFeet(this.map.solid, this.player.x, this.player.y, dx, dy);
    this.player.setPosition(moved.x, moved.y);

    this.facing = Math.abs(vx) >= Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';

    const anim = `char.keeper.walk.${this.facing}`;
    if (this.anims.exists(anim)) {
      if (this.player.anims.currentAnim?.key !== anim) this.player.play(anim);
      // ease any leftover bob scale to neutral so the walk sheet isn't stretched
      this.player.scaleX = Phaser.Math.Linear(this.player.scaleX, 1, 0.3);
      this.player.scaleY = Phaser.Math.Linear(this.player.scaleY, 1, 0.3);
    } else {
      // no walk sheet for this facing (left/right) — stop the idle loop and bob
      if (this.player.anims.isPlaying) this.player.anims.stop();
      this.walkT += dt * 12;
      const s = Math.sin(this.walkT);
      this.player.setScale(1 - s * 0.05, 1 + s * 0.06);
    }
  }

  private idleAnimate(): void {
    const idle = 'char.keeper.idle';
    if (this.anims.exists(idle)) {
      if (this.player.anims.currentAnim?.key !== idle) this.player.play(idle);
      // ease residual walk-bob scale back to neutral so idle↔walk never snap-pops
      this.player.scaleX = Phaser.Math.Linear(this.player.scaleX, 1, 0.25);
      this.player.scaleY = Phaser.Math.Linear(this.player.scaleY, 1, 0.25);
    } else {
      if (this.player.anims.isPlaying) this.player.anims.stop();
      const breathe = 1 + Math.sin(this.time.now / 520) * 0.015;
      this.player.scaleX = Phaser.Math.Linear(this.player.scaleX, 1, 0.2);
      this.player.scaleY = Phaser.Math.Linear(this.player.scaleY, breathe, 0.2);
    }
  }

  private updateLabels(locked: boolean): void {
    const cam = this.cameras.main;
    for (const loc of this.map.locations) {
      const label = this.labels.get(loc.id)!;
      const sx = (loc.label.x - cam.worldView.x) * cam.zoom;
      const sy = (loc.label.y - cam.worldView.y) * cam.zoom;
      label.setPosition(sx, Math.max(14, sy));
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, loc.center.x, loc.center.y);
      // Defer to the (richer) hover tooltip while this location is being moused over —
      // both anchor near loc.label, so showing both at once double-prints the name.
      const target = !locked && d < 66 && this.hoveredLoc !== loc.id ? 1 : 0;
      label.alpha = Phaser.Math.Linear(label.alpha, target, 0.18);
    }
  }

  private updatePromptAndInteract(locked: boolean): void {
    if (locked) {
      this.prompt.alpha = Phaser.Math.Linear(this.prompt.alpha, 0, 0.25);
      return;
    }
    const ref = { x: this.player.x, y: this.player.y - 4 };
    const target = pickInteraction(this.map.locations, ref.x, ref.y, facingVec(this.facing), INTERACT_DIST);
    if (target) {
      this.prompt.setText(`${target.name}\nE  ·  ${target.prompt}`);
      this.prompt.alpha = Phaser.Math.Linear(this.prompt.alpha, 1, 0.25);
      if (Phaser.Input.Keyboard.JustDown(this.keyE) || Phaser.Input.Keyboard.JustDown(this.keySpace)) {
        void this.enter(target.id);
      }
    } else {
      this.prompt.alpha = Phaser.Math.Linear(this.prompt.alpha, 0, 0.25);
    }
  }

  /** Mouse-hover tooltip (fun-review §3.6b) — name + one line of flavor, independent of
   *  walking proximity (updateLabels above): hovering any of the six locations' Zones
   *  (buildHoverZones) shows it regardless of where the Keeper stands. Suppressed while
   *  locked (dialogue/busy), same as the labels and prompt. Fades via opacity — an
   *  e2e can poll `hoverTipDebug().alpha`, the Phaser-drawn HUD idiom (see combat/hud.ts). */
  private updateHoverTip(locked: boolean): void {
    const loc = !locked && this.hoveredLoc ? this.map.locations.find((l) => l.id === this.hoveredLoc) : undefined;
    if (loc) {
      const cam = this.cameras.main;
      this.hoverName.setText(loc.name);
      this.hoverBody.setText(loc.blurb);
      const padX = 12;
      const padY = 8;
      const gap = 5;
      const contentW = Math.max(this.hoverName.width, this.hoverBody.width);
      const w = Math.min(210, contentW + padX * 2);
      this.hoverName.setWordWrapWidth(w - padX * 2);
      this.hoverBody.setWordWrapWidth(w - padX * 2);
      const h = this.hoverName.height + this.hoverBody.height + gap + padY * 2;

      const sx = (loc.label.x - cam.worldView.x) * cam.zoom;
      const sy = (loc.label.y - cam.worldView.y) * cam.zoom;
      const cx = Phaser.Math.Clamp(sx, w / 2 + 6, this.scale.width - w / 2 - 6);
      const bottomY = Math.max(14, sy) - 12; // sits just above the name label's own spot
      const topY = bottomY - h;

      this.hoverBg.clear();
      this.hoverBg.fillStyle(C.parchment, 0.97).fillRoundedRect(cx - w / 2, topY, w, h, 8);
      this.hoverBg.lineStyle(2, C.bark, 1).strokeRoundedRect(cx - w / 2, topY, w, h, 8);
      // lanternGold accent hairline between name and blurb (VaultView's goldRule idiom, mini)
      this.hoverBg.fillStyle(C.lanternGold, 0.8).fillRect(cx - w / 2 + 10, topY + padY + this.hoverName.height + gap / 2 - 1, w - 20, 2);
      this.hoverName.setPosition(cx, topY + padY);
      this.hoverBody.setPosition(cx, topY + padY + this.hoverName.height + gap);
    }
    const target = loc ? 1 : 0;
    this.hoverCont.alpha = Phaser.Math.Linear(this.hoverCont.alpha, target, 0.22);
  }

  /** Debug: a location's current on-screen anchor point (e2e-only) — lets a spec position
   *  the real mouse over a moving, zoomed, camera-relative world point without duplicating
   *  the projection math above. */
  locationScreenPos(id: LocationId): { x: number; y: number } | null {
    const loc = this.map.locations.find((l) => l.id === id);
    if (!loc) return null;
    const cam = this.cameras.main;
    return { x: (loc.center.x - cam.worldView.x) * cam.zoom, y: (loc.center.y - cam.worldView.y) * cam.zoom };
  }

  /** Debug: the hover tooltip's live alpha + rendered name/blurb (e2e-only — Phaser-drawn,
   *  not DOM, so a spec can't read this via a locator; mirrors CombatHud's bannerText()). */
  hoverTipDebug(): { alpha: number; name: string; blurb: string } {
    return { alpha: this.hoverCont.alpha, name: this.hoverName.text, blurb: this.hoverBody.text };
  }

  /** Debug: fact ids surfaced across the most recent Wellspring drill (e2e-only — the
   *  drill's encounter resolution isn't DOM-addressable; mirrors hoverTipDebug()'s precedent). */
  wellspringDrillDebug(): string[] {
    return [...this.wellspringSurfaced];
  }

  // --------------------------------------------------------------- interactions

  private conversationFor(id: LocationId) {
    switch (id) {
      case 'tavern':
        return berryConv(this.computeDue(), this.streak());
      case 'records':
        return clerkConv(this.computeDue(), this.lastPlayed());
      case 'gate':
        return alderConv(this.provinces);
      case 'cottage':
        return cottageConv();
      case 'wellspring':
        return this.packId ? wellspringIntro() : wellspringEmpty();
      case 'factor':
        return factorConv();
    }
  }

  private async enter(id: LocationId): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      switch (id) {
        case 'cottage':
          await this.doCottage();
          break;
        case 'tavern':
          await this.dialogue.run(berryConv(this.computeDue(), this.streak()));
          break;
        case 'records':
          // supersession-reteach.md §2 — amendments are presented BEFORE normal conversation.
          await this.doAmendments();
          await this.dialogue.run(clerkConv(this.computeDue(), this.lastPlayed()));
          break;
        case 'wellspring':
          await this.doWellspring();
          break;
        case 'gate':
          await this.doGate();
          break;
        case 'factor':
          await this.doFactor();
          break;
      }
    } finally {
      // Crucible v0 #1 (softlock): the physical E/Space press that closes a dialogue
      // (DialogueBox's own raw keydown listener, dialogue/DialogueBox.ts:130) ALSO
      // sets Phaser's keyE/keySpace `_justDown` flag on this scene's polled Key
      // objects — and updatePromptAndInteract() never calls JustDown() while locked,
      // so that flag goes unconsumed. The instant `busy` clears below, the very next
      // update() would read it as a brand-new press and call enter() again, silently
      // reopening whatever just closed. resetKeys() (same fix already used by
      // doFactor()/openSatchel() for their own overlays) clears it here — the single
      // choke point every enter()-routed path (cottage/tavern/records/wellspring/
      // gate/factor) funnels through on close.
      this.input.keyboard!.resetKeys();
      this.busy = false;
    }
  }

  /**
   * "The Ledger Amended" (supersession-reteach.md §2/§3) — up to AMENDMENT_BATCH_CAP cards
   * per visit, overflow waits for the next visit. Each card is witnessed as it is confirmed,
   * not at the end of the batch: closing the game (or reloading) mid-batch must leave the
   * remaining amendments pending, and re-show only those.
   *
   * Teach-only — no grade, no SRS record, no HP, no Glow. The witness write is the sole effect.
   */
  private async doAmendments(): Promise<void> {
    const batch = this.amendedPending.slice(0, AMENDMENT_BATCH_CAP);
    if (batch.length === 0) return;
    this.input.keyboard!.enabled = false;
    // Wave 4 Task 5, wire 2 — multiple grants per visit are correct (the batch cap already
    // bounds it); accumulated and presented as ONE card once the whole batch closes.
    const pending: number[] = [];
    try {
      for (let i = 0; i < batch.length; i++) {
        await services.showAmendment(batch[i], { last: i === batch.length - 1 });
        await services.amendments.witness(batch[i].old.id);
        pending.push(...grantXp('amendment'));
      }
      await this.presentPendingLevelUp(pending);
    } catch {
      /* amendments/encounters may be stubs; never block the Clerk's own conversation */
    } finally {
      this.input.keyboard!.enabled = true;
      this.input.keyboard!.resetKeys();
      this.refreshAmendments();
    }
  }

  /** Recompute the pending set and re-dress the Records Office (pulse + hover line). */
  private refreshAmendments(): void {
    try {
      this.amendedPending = this.provinces.flatMap((pv) => services.amendments.pending(pv.id));
    } catch {
      this.amendedPending = []; // stub/offline amendments service — no pulse, no cards
    }
    const pending = this.amendedPending.length > 0;
    this.recordsPulse?.setVisible(pending);
    const label = this.labels.get('records');
    const loc = this.map.locations.find((l) => l.id === 'records');
    // §2's hover line, on the map location's own label — verbatim, and only while pending.
    if (label && loc) label.setText(pending ? `${loc.name}\nThe Clerk has amendments.` : loc.name);
  }

  private async doCottage(): Promise<void> {
    const now = new Date();
    let lastHearthAt: string | undefined;
    let lvl = 1;
    try {
      const save = services.save.get();
      lastHearthAt = save.lastHearthAt;
      lvl = save.level ?? 1;
    } catch {
      /* no save yet — never rested, canRestTonight(undefined, now) already says so */
    }

    if (canRestTonight(lastHearthAt, now)) {
      // Ch. VII amendment — the Vigil break law: a missed calendar hearth-night snaps the
      // chain, detected lazily right here at the next rest (never enforced eagerly). Reuses
      // canRestTonight's OWN day-boundary math (imported, never re-derived): last rested
      // wasn't YESTERDAY either means at least one full night was skipped. Absent
      // lastHearthAt (never rested) is legacy grace, not a break — short-circuits below
      // before canRestTonight is even asked about yesterday.
      //
      // Final review M2 — an ABNORMAL stamp is grace too, not a break. `!!lastHearthAt` is
      // true for garbage, and canRestTonight deliberately returns true for an unparseable
      // stamp ("Unparseable stamps never brick the Hearth" — rest/embers.ts), so the naive
      // read inverted that helper's own philosophy and snapped the chain on a corrupt value.
      // A future-dated stamp (clock skew, or a save written while the system clock ran ahead)
      // is neither today nor yesterday and broke identically. Both now require the same thing
      // a real break does: a stamp we can actually believe. Only a VALID, non-future stamp
      // with a genuine skipped night breaks the chain — the alternative is a destructive
      // write to state/ on evidence we know is bad.
      const stamp = lastHearthAt ? new Date(lastHearthAt) : null;
      const believable = stamp !== null && !isNaN(stamp.getTime()) && stamp.getTime() <= now.getTime();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const broken = believable && canRestTonight(lastHearthAt, yesterday);
      let vigil: 'broken' | 'warded' | undefined;
      let brokenStreak: number | undefined;
      if (broken) {
        let warded = false;
        try {
          // Ward of Focus — passive, never armed (combat/aids.ts's AidKind deliberately
          // excludes it); its only mechanism is this remove. The remove IS the check: false
          // (no write) means none held — atomic, so this doubles as spend-before-benefit.
          warded = await services.inventory.removeItem('ward-of-focus', 1);
        } catch {
          /* inventory may be a stub — no ward available */
        }
        if (warded) {
          // Controller ruling (fix round 1): the ward RESTORES THE STATUS QUO — it holds
          // the chain, it never grows it. No normal unbroken rest increments streak either
          // (grantXp('hearth-streak') below is XP-only), so a ward-saved night gets the
          // same "untouched" treatment: brokenStreak stays undefined, no streak key rides
          // the patch below.
          vigil = 'warded';
        } else {
          vigil = 'broken';
          brokenStreak = 0;
        }
      }

      try {
        // Wave 4 — the hearth-rest patch goes level-keyed: the old flat HP/Ember caps died,
        // replaced by the single seam every cap reads (progression/xp.ts).
        await services.save.save({
          hp: maxHpForLevel(lvl),
          embers: emberMaxForLevel(lvl),
          lastHearthAt: now.toISOString(),
          lastPlayed: now.toISOString(),
          // Ch. IV — banking the hearth night grants the ONE Lantern-light (binary:
          // true stays true, no stockpiling). Grant lives in THIS patch only — never
          // in grantXp (xp/level single-writer) and never keyed off save.streak
          // (Wellspring/boss's counter is a different mechanic; controller ruling W5).
          lanternLight: true,
          // Ch. VII amendment — the break law rides this SAME patch (single-write law);
          // absent (no streak key at all) when the vigil wasn't broken tonight, OR when
          // the ward caught the break — either way, untouched, exactly as shipped.
          ...(brokenStreak === undefined ? {} : { streak: brokenStreak }),
        });
      } catch {
        /* save may be a stub */
      }
      // Wave 4 Task 5, wire 6 (RULING CORRECTED 2026-08-13) — the +30 fires here and ONLY
      // here, one grant per banked hearth night, immediately after the rest patch carrying
      // lastHearthAt lands. This wire touches save.streak in NO direction.
      const pending = grantXp('hearth-streak');
      await this.dialogue.run(hearthRestConv(vigil));
      await this.presentPendingLevelUp(pending);
      return;
    }

    try {
      await services.save.save({
        scene: 'hamlet',
        pos: { x: this.player.x, y: this.player.y },
        lastPlayed: new Date().toISOString(),
      });
    } catch {
      /* save may be a stub */
    }
    await this.dialogue.run(cottageConv(true));
  }

  /** Wave 4 Task 5 — presents the level-up ceremony for any levels accumulated this beat
   *  (Constraint 6: ONE card, every level gained). Best-effort, matching runNightLedger's own
   *  tolerance (DungeonScene.ts): a missing/stub overlay service must never strand the
   *  surrounding hamlet flow. No-op when nothing was gained (levelUpRows returns null). */
  private async presentPendingLevelUp(levels: number[]): Promise<void> {
    const ceremony = levelUpRows(levels);
    if (!ceremony) return;
    try {
      await services.showLevelUp(ceremony.rows);
    } catch {
      /* best-effort: never block the surrounding beat */
    }
  }

  /** M3 — packs + (fix round 1) cross-pack encountersOf for previewPick's would-be resolution
   *  check, mirroring encounters/register.ts's runEncounter resolution exactly: the same
   *  packless→FIXTURE_PACK fallback (now isPack-guarded, matching loadPacks() rather than a
   *  bare cast), AND the same crossPack gate resolveCrossPack() uses. Without this, a
   *  same-pack-only preview can predict "different encounter" for a due-queue hit that only
   *  resolves through a foreign pack, when the real (cross-pack) resolution would actually
   *  re-present the SAME one — a wasted spend, the exact failure M3 exists to prevent
   *  (task-7-review.md §5(a)). getPacks() is the bridge fetch (bridge/client); indexReady()/
   *  isEmpty()/encountersOf() are plain index reads — the draw census tracks only due()/fresh()
   *  (Global Constraint 3), and isEmpty() is already called elsewhere in this scene (doWellspring
   *  → services.draw.isEmpty(), pre-existing) without being treated as a draw. */
  private async previewPackPool(): Promise<{ packs: Pack[]; encountersOf?: (factId: string) => Encounter[] }> {
    const { packs: entries } = await getPacks();
    const installed = entries.map((p) => p.pack).filter(isPack);
    const packs = installed.length ? installed : [FIXTURE_PACK];
    let crossPack = false;
    try {
      await services.draw.indexReady();
      crossPack = !services.draw.isEmpty();
    } catch { /* index down — the single-pack preview above is still honest */ }
    return { packs, encountersOf: crossPack ? services.draw.encountersOf : undefined };
  }

  private async doWellspring(): Promise<void> {
    this.wellspringSurfaced = [];
    const drawReady = await wellspringDrawReady();
    // Wave-1 draw service: gate on the GLOBAL index's own emptiness once it's up; only
    // fall back to the legacy provinces[0] check (this.packId) if the index itself
    // failed to load (see wellspringDrawReady()) — same player-visible "no fables yet"
    // copy either way.
    if (drawReady ? services.draw.isEmpty() : !this.packId) {
      await this.dialogue.run(wellspringEmpty());
      return;
    }
    // crucible V1-17 — the resolved choice used to be discarded entirely, so Escape (or
    // any other close) proceeded into the graded drill exactly like choosing to begin —
    // the one place in the hamlet where "never mind" silently committed you anyway,
    // writing an unconsented SRS grade. Capture it and bail on cancel, like doGate()/
    // doFactor() already do.
    const choice = await this.dialogue.run(wellspringIntro());
    if (!choice || choice === '__cancel__') return;
    // Wave 4 Task 5 — accumulated across all 3 rounds below; ONE ceremony card presents after
    // the drill's own overlay (wellspringOutro) closes, not per-round.
    const pending: number[] = [];
    try {
      // Legacy per-province plumbing — computed only as the fallback path's input when
      // the draw index is down; the global path below never touches pv/baseFactIds.
      let pv: Province | undefined;
      let baseFactIds: string[] = [];
      let initialDue: string[] = [];
      if (!drawReady) {
        pv = this.provinces.find((p) => p.id === this.packId);
        // supersession-reteach.md §4 — dueQueue filters suspended facts itself, but the
        // empty-queue fallback below hands out this raw pack-order list directly, so it has to
        // be filtered at the source or an unwitnessed amendment's new truth could be drilled
        // with no ceremony (and a retired old truth re-asked).
        baseFactIds = eligibleOf(pv?.factIds ?? []);
        initialDue = services.srs.dueQueue(this.packId ?? '', baseFactIds);
      }
      for (let i = 0; i < 3; i++) {
        const roundSeed = (this.seed + i * 7 + 1) >>> 0;
        let ordered: string[];
        if (drawReady) {
          // Global schedule-first draw (services.draw.due, wave-1 interleaving) — due
          // queue drives selection (Goal 5) across EVERY installed pack, never one
          // province's raw order. Recomputed each pass so the burst advances through
          // DISTINCT facts (a fact recorded below drops out of "due" next pass). Once
          // NOTHING is due anywhere the round introduces new material instead
          // (services.draw.fresh — unseen, prereq-clear facts, round-robined by source).
          // Three tiers, mirroring CombatScene.globalDraw()'s shape (same tier semantics;
          // NOT a byte-identical pool — this draws across every installed pack, that one
          // draws within a battle's own scope) so a burst can never run dry against a
          // fully exhausted pool: every fact recorded AND none currently due (e.g. right
          // after a big review session, before any box's interval re-elapses) — due() AND
          // fresh() both legitimately return [] then. Tier 3 falls back to a shuffle over
          // EVERY installed fact (services.draw.allFactIds()), visit-constant seed like
          // this method's own legacy tier-3 below. Never throws: a draw-service fault this
          // round (due()/fresh() themselves erroring, not just returning empty) also falls
          // through to the shuffle.
          let due: string[] = [];
          let fresh: string[] = [];
          try {
            const now = Date.now();
            due = services.draw.due({ count: WELLSPRING_DRAW_COUNT, seed: roundSeed, now });
            if (!due.length) fresh = services.draw.fresh({ count: WELLSPRING_DRAW_COUNT, seed: roundSeed, now });
          } catch {
            /* index down mid-drill — the shuffle below is still honest */
          }
          ordered = due.length
            ? due
            : fresh.length
              ? fresh
              : seededShuffle(eligibleOf(services.draw.allFactIds()), mulberry32(this.seed ^ 0x5eed));
        } else {
          // Draw-index-down fallback: the pre-wave-1 single-province chain, verbatim.
          // Due queue drives selection (Goal 5), never raw pack order. Recompute each
          // pass so the burst advances through DISTINCT facts — a fact recorded below
          // drops out of "due" next pass. If the live queue empties (fewer than three
          // due), fall back to the initial queue so the burst gracefully repeats due
          // facts rather than stalling on nothing; if that's ALSO empty (nothing was
          // due/unseen even at the start), seed-shuffle the raw pack order instead of
          // handing it out verbatim (mirrors CombatScene.dueFactIds()'s fallback).
          // Same tier SHAPE as the global branch above (schedule → introduce → shuffle-
          // as-last-resort) — not a byte-identical pool (one province vs. every installed
          // pack) by design. Change both together when the shape itself changes.
          const live = services.srs.dueQueue(this.packId ?? '', baseFactIds);
          ordered = live.length
            ? live
            : initialDue.length
              ? initialDue
              : seededShuffle(baseFactIds, mulberry32(this.seed ^ 0x5eed));
        }
        // §recency — whichever tier wins, push anything asked already this drill (or
        // a prior Wellspring visit this session) behind fresh alternatives, so a
        // stale snapshot can't just re-ask what an earlier pass already covered.
        const factIds = partitionByRecency(ordered, wellspringRecentFactIds);
        // Ch. IV — guarded read (T4 review ruling; C6 — extracted to lantern.ts's
        // heldLanternLight): a save fault means "no lantern", it must never surface as a
        // thrown round.
        const held = heldLanternLight();
        let res = await services.runEncounter({
          context: 'drill',
          packId: this.packId ?? '', // @deprecated (EncounterRequest) — resolution is per-fact once drawReady
          seed: roundSeed,
          factIds,
          lanternLight: held,
        });
        if (res.redraw) {
          // Ch. IV — re-present from this round's own pool minus the shown facts (census law).
          let plan = planRedraw(res.redraw.shownFactIds, factIds);
          if (plan.consume) {
            // M3 — the naive remainder can still resolve to the SAME encounter (e.g. a single-
            // encounter fallback the narrowed factIds never touch, or — fix round 1 — a due-queue
            // hit that only resolves cross-pack, which Wellspring's own global draw makes
            // especially live here): preview the would-be re-present BEFORE spending, and fall
            // back to fate-holds if nothing would change.
            const { packs, encountersOf } = await this.previewPackPool();
            const wouldBe = previewPick(
              { context: 'drill', packId: this.packId ?? '', seed: roundSeed, factIds: plan.factIds },
              packs,
              encountersOf,
            );
            if (wouldBe === res.encounterId) plan = { consume: false, factIds };
          }
          if (plan.consume) await services.save.save({ lanternLight: false });
          res = await services.runEncounter({
            context: 'drill',
            packId: this.packId ?? '',
            seed: roundSeed,
            factIds: plan.factIds,
            lanternLight: false,
            notice: plan.consume ? undefined : FATE_HOLDS_LINE,
          });
        }
        for (const fid of res.factIds) {
          // factOf() resolves type globally (fid may be from any installed pack); pv's own
          // factTypes map is pack-scoped and only valid on the legacy fallback path.
          const factType = drawReady ? services.draw.factOf(fid)?.type : pv?.factTypes?.[fid];
          await services.srs.record(fid, res.quality, res.encounterId, factType);
          wellspringRecentFactIds.add(fid);
          this.wellspringSurfaced.push(fid);
        }
        // Wave 4 Task 5, wire 1 — correct = quality === 1 ONLY (0.5 partials don't pay); one
        // grant per round, not per fact_id (an encounter can cover several facts at once).
        if (res.quality === 1) pending.push(...grantXp('renewal', { applyHp: true }));
      }
      const s = services.save.get();
      await services.save.save({ streak: s.streak + 1, lastPlayed: new Date().toISOString() });
    } catch {
      /* encounters/srs may be stubs or mid-implementation */
    }
    await this.dialogue.run(wellspringOutro(this.streak()));
    await this.presentPendingLevelUp(pending);
  }

  private async doGate(): Promise<void> {
    const choice = await this.dialogue.run(alderConv(this.provinces));
    if (!choice || choice === '__cancel__') return;
    await this.dialogue.run(alderFarewell());
    await this.persist();
    this.scene.start('vaults', { packId: choice });
  }

  /** Mira the Factor: dismiss on cancel, or open her shop (inventory-handoff §9). */
  private async doFactor(): Promise<void> {
    const choice = await this.dialogue.run(factorConv());
    if (choice !== 'shop') return;
    this.input.keyboard!.enabled = false;
    await openShopPane();
    this.input.keyboard!.enabled = true;
    this.input.keyboard!.resetKeys();
  }

  /** Press I anywhere in the hamlet to check the Satchel (inventory-handoff §9). */
  private async openSatchel(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      this.input.keyboard!.enabled = false;
      await openInventoryPane();
      this.input.keyboard!.enabled = true;
      this.input.keyboard!.resetKeys();
    } finally {
      this.busy = false;
    }
  }

  // --------------------------------------------------------------------- helpers

  private computeDue(): number {
    try {
      return this.provinces.reduce((sum, pv) => sum + services.srs.dueQueue(pv.id, pv.factIds).length, 0);
    } catch {
      return 0;
    }
  }

  private streak(): number {
    try {
      return services.save.get().streak;
    } catch {
      return 0;
    }
  }

  private lastPlayed(): string {
    try {
      return services.save.get().lastPlayed;
    } catch {
      return '';
    }
  }

  private async persist(): Promise<void> {
    try {
      await services.save.save({
        scene: 'hamlet',
        pos: { x: this.player.x, y: this.player.y },
        lastPlayed: new Date().toISOString(),
      });
    } catch {
      /* ignore */
    }
  }
}

/** Move the Keeper's feet against the solid grid (per-axis, no corner snag). */
function resolveMoveFeet(
  solid: number[][],
  x: number,
  y: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const r = resolveMove(solid, x, y - FOOT, dx, dy, HW, HH);
  return { x: r.x, y: r.y + FOOT };
}

let warnedWellspringDrawFailure = false;

/**
 * Wave-1 draw service readiness gate for doWellspring() — mirrors encounters/register.ts's
 * resolveCrossPack() discipline exactly: await ONLY services.draw.indexReady() (never the
 * fuller ready(), which can reject early on an unrelated srs/amendments failure while the
 * index itself is still mid-build), catch, warn once, and let the caller fall back to the
 * legacy per-province drill rather than throw or hang.
 */
async function wellspringDrawReady(): Promise<boolean> {
  try {
    await services.draw.indexReady();
    return true;
  } catch {
    if (!warnedWellspringDrawFailure) {
      warnedWellspringDrawFailure = true;
      console.warn('[wellspring] services.draw index failed to load — falling back to the legacy per-province drill');
    }
    return false;
  }
}

/** supersession-reteach.md §4 — the suspension filter, tolerant of a stub/offline service
 *  (an unavailable amendments provider must never empty a drill's candidate list). */
function eligibleOf(factIds: string[]): string[] {
  try {
    return services.amendments.eligible(factIds);
  } catch {
    return factIds;
  }
}

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
