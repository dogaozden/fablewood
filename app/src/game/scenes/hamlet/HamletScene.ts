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
  wellspringEmpty,
  wellspringIntro,
  wellspringOutro,
  type Province,
} from './content';

type Facing = 'up' | 'down' | 'left' | 'right';
type Key = Phaser.Input.Keyboard.Key;

const SPEED = 78; // world px / second
const HW = 5;
const HH = 5;
const FOOT = 5; // collision box sits around the feet
const INTERACT_DIST = 22;
const LABEL_FONT = 'Georgia, "Times New Roman", serif';

interface RawPack {
  meta?: { id?: string; title?: string };
  facts?: { id: string }[];
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

  private dialogue!: DialogueBox;
  private labels = new Map<LocationId, Phaser.GameObjects.Text>();
  private prompt!: Phaser.GameObjects.Text;

  private facing: Facing = 'down';
  private walkT = 0;
  private busy = false;
  private saveAccum = 0;
  private provinces: Province[] = [];
  private packId?: string;

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

    // Follow camera over the zoomed world.
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    cam.setZoom(3);
    cam.setDeadzone(46, 32);
    cam.startFollow(this.player, true, 0.12, 0.12);
    cam.roundPixels = true;

    this.buildUi();
    this.setupInput();

    // Second camera: native-resolution UI overlay. Main ignores UI; UI ignores world.
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCam.setScroll(0, 0);
    this.uiCam.setName('ui');
    cam.ignore(this.uiRoot);
    this.uiCam.ignore(this.worldGroup.getChildren());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      void this.persist();
      this.dialogue.destroy();
    });

    void this.bootstrap();

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
      .setAlpha(0.28)
      .setScale(2.6);
    this.worldGroup.add(plaza);
    this.tweens.add({ targets: plaza, alpha: 0.36, scale: 2.8, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    this.map.lanterns.forEach((l, i) => {
      const img = this.add
        .image(l.x, l.y, 'fx.glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(-800)
        .setAlpha(0.5)
        .setScale(1.1);
      this.worldGroup.add(img);
      this.tweens.add({
        targets: img,
        alpha: 0.66,
        scale: 1.25,
        duration: 1300 + i * 130,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    });
  }

  private buildProps(): void {
    for (const p of this.map.props) {
      const img = this.add.image(p.x, p.y, p.key).setOrigin(p.ox, p.oy).setDepth(p.y);
      this.worldGroup.add(img);
    }
  }

  private buildNpcs(): void {
    const defs: { key: string; x: number; y: number }[] = [
      { key: 'char.berry', x: 262, y: 70 },
      { key: 'char.clerk', x: 44, y: 180 },
      { key: 'char.alder', x: 236, y: 198 },
    ];
    for (const d of defs) {
      const npc = this.add.sprite(d.x, d.y, d.key).setOrigin(0.5, 1).setDepth(d.y);
      this.worldGroup.add(npc);
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

  private buildUi(): void {
    this.uiRoot = this.add.container(0, 0).setDepth(10000);

    for (const loc of this.map.locations) {
      const t = this.add
        .text(0, 0, loc.name, {
          fontFamily: LABEL_FONT,
          fontSize: '15px',
          color: '#fff1c6',
          stroke: '#2a1d13',
          strokeThickness: 4,
        })
        .setOrigin(0.5, 1)
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
  }

  // ---------------------------------------------------------------- async data

  private async bootstrap(): Promise<void> {
    try {
      await Promise.all([services.save.ready(), services.srs.ready(), services.settings.ready()]);
    } catch {
      /* stubs/real impls both fine; ignore readiness errors */
    }

    try {
      const res = await getPacks();
      this.provinces = res.packs.map((p) => {
        const rp = p.pack as RawPack;
        return { id: p.id, title: rp?.meta?.title ?? p.id, factIds: (rp?.facts ?? []).map((f) => f.id) };
      });
      this.packId = this.provinces[0]?.id;
    } catch {
      this.provinces = [];
    }

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
    if (!locked) this.handleMovement(delta);
    else this.idleAnimate();

    this.updateLabels(locked);
    this.updatePromptAndInteract(locked);
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
    } else {
      this.walkT += dt * 12;
      const s = Math.sin(this.walkT);
      this.player.setScale(1 - s * 0.05, 1 + s * 0.06);
    }
  }

  private idleAnimate(): void {
    if (this.player.anims.isPlaying) this.player.anims.stop();
    const breathe = 1 + Math.sin(this.time.now / 520) * 0.015;
    this.player.scaleX = Phaser.Math.Linear(this.player.scaleX, 1, 0.2);
    this.player.scaleY = Phaser.Math.Linear(this.player.scaleY, breathe, 0.2);
  }

  private updateLabels(locked: boolean): void {
    const cam = this.cameras.main;
    for (const loc of this.map.locations) {
      const label = this.labels.get(loc.id)!;
      const sx = (loc.label.x - cam.worldView.x) * cam.zoom;
      const sy = (loc.label.y - cam.worldView.y) * cam.zoom;
      label.setPosition(sx, Math.max(14, sy));
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, loc.center.x, loc.center.y);
      const target = !locked && d < 66 ? 1 : 0;
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
          await this.dialogue.run(clerkConv(this.computeDue(), this.lastPlayed()));
          break;
        case 'wellspring':
          await this.doWellspring();
          break;
        case 'gate':
          await this.doGate();
          break;
      }
    } finally {
      this.busy = false;
    }
  }

  private async doCottage(): Promise<void> {
    try {
      await services.save.save({
        scene: 'hamlet',
        pos: { x: this.player.x, y: this.player.y },
        lastPlayed: new Date().toISOString(),
      });
    } catch {
      /* save may be a stub */
    }
    await this.dialogue.run(cottageConv());
  }

  private async doWellspring(): Promise<void> {
    if (!this.packId) {
      await this.dialogue.run(wellspringEmpty());
      return;
    }
    await this.dialogue.run(wellspringIntro());
    try {
      const pv = this.provinces.find((p) => p.id === this.packId);
      const factIds = pv?.factIds ?? [];
      for (let i = 0; i < 3; i++) {
        const res = await services.runEncounter({
          context: 'drill',
          packId: this.packId,
          seed: (this.seed + i * 7 + 1) >>> 0,
          factIds,
        });
        for (const fid of res.factIds) await services.srs.record(fid, res.quality, res.encounterId);
      }
      const s = services.save.get();
      await services.save.save({ streak: s.streak + 1, lastPlayed: new Date().toISOString() });
    } catch {
      /* encounters/srs may be stubs or mid-implementation */
    }
    await this.dialogue.run(wellspringOutro(this.streak()));
  }

  private async doGate(): Promise<void> {
    const choice = await this.dialogue.run(alderConv(this.provinces));
    if (!choice || choice === '__cancel__') return;
    await this.dialogue.run(alderFarewell());
    await this.persist();
    this.scene.start('vaults', { packId: choice });
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

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
