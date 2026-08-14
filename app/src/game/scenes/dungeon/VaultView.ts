/**
 * Presentation for the dungeon node-crawl — a cozy-dread vault map strip and the
 * cards/toasts/beats the scene raises. All Phaser, no game logic: DungeonScene
 * decides *what* happens; VaultView decides how it looks (style-contract §1: warm
 * light held inside a cool dusk). Draws colored-shape placeholders for missing
 * texture keys (tile.vault-*, prop.vault-door, prop.camp).
 */
import Phaser from 'phaser';
import type { DungeonSpec, DungeonRoom, FactLite } from '../../contracts';
import { emberMaxForLevel } from '../../progression/xp';
import { nodeState, firstUnclearedIndex, type DungeonProgress } from './roomFlow';
import { C, hex } from './palette';

const W = 960;
const H = 540;
const STRIP_Y = 300;
/** Status-line Trim button (fix round 1 — moved off the Camp card per the ratified spec:
 *  Concordance Ch. II, "between rooms in a crawl, at the room-node map"). Small on purpose —
 *  this sits beside the Ember pips in the header strip, not a card. */
const TRIM_BTN_W = 176;
const TRIM_BTN_H = 24;
const TRIM_BTN_GAP = 14;
/** Ch. IV — the lantern glyph's ring radius and its gap from the Ember pips' left edge
 *  (matches TRIM_BTN_GAP/gapFromText's 14px convention for this header-strip cluster). */
const LANTERN_GLYPH_R = 6;
const LANTERN_GLYPH_GAP = 14;
/** Match the encounters overlay's parchment type (encounters/styles.ts) so the
 * two card families read as one system. */
const FONT = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";

export interface NodeHandlers {
  onRoom: (index: number) => void;
  onCamp: () => void;
  /** Open the Satchel from the camp card (inventory-handoff §9). */
  onSatchel: () => void;
  /** Trim the Lantern — the between-rooms Ember-spend drill (rest/embers.ts, Concordance Ch. II). */
  onTrim: () => void;
}

type Toast = 'info' | 'warn' | 'good';
/** 'wait' resolves on click · 'auto' auto-advances after a beat · 'persist' stays up. */
export type CardMode = 'wait' | 'auto' | 'persist';

export class VaultView {
  private roomNodes: Phaser.GameObjects.Container[] = [];
  private nodeXs: number[] = [];
  private mapLayer?: Phaser.GameObjects.Container;
  private overlay?: Phaser.GameObjects.Container;
  private handlers?: NodeHandlers;
  private headerText?: Phaser.GameObjects.Text;
  private statusText?: Phaser.GameObjects.Text;
  private emberPips?: Phaser.GameObjects.Graphics;
  private lanternGlyph?: Phaser.GameObjects.Graphics;
  private trimButton?: Phaser.GameObjects.Container;
  private tooltipCont?: Phaser.GameObjects.Container;
  private tooltipBg?: Phaser.GameObjects.Graphics;
  private tooltipName?: Phaser.GameObjects.Text;
  private tooltipBlurb?: Phaser.GameObjects.Text;

  constructor(private scene: Phaser.Scene) {}

  // ---- chrome (built once) --------------------------------------------------

  renderChrome(onTrim: () => void): void {
    const s = this.scene;
    s.cameras.main.setBackgroundColor(hex(C.shadowPlum));

    // vertical dusk gradient, warm floor haze at the base
    const g = s.add.graphics().setDepth(0);
    g.fillGradientStyle(C.duskDeep, C.duskDeep, C.shadowPlum, C.shadowPlum, 1);
    g.fillRect(0, 0, W, H);
    g.fillStyle(C.deepEmber, 0.1);
    g.fillRect(0, H - 120, W, 120);

    // cool corner vignette so the eye falls to the lit centre
    const vig = s.add.graphics().setDepth(1);
    vig.fillStyle(C.voidBlack, 0.38);
    vig.fillRect(0, 0, W, 46);
    vig.fillRect(0, H - 40, W, 40);
    vig.fillRect(0, 0, 40, H);
    vig.fillRect(W - 40, 0, 40, H);

    this.lanterns();
    this.vaultHall();
    this.dust();

    this.headerText = s.add
      .text(W / 2, 58, '', {
        fontFamily: FONT,
        fontSize: '30px',
        color: hex(C.lanternGold),
      })
      .setOrigin(0.5)
      .setDepth(6)
      .setShadow(0, 3, hex(C.deepEmber), 8, false, true)
      .setAlpha(0);

    this.statusText = s.add
      .text(W - 20, 22, '', {
        fontFamily: FONT,
        fontSize: '14px',
        color: hex(C.parchment),
      })
      .setOrigin(1, 0.5)
      .setDepth(6);
    this.emberPips = s.add.graphics().setDepth(6);
    this.lanternGlyph = s.add.graphics().setDepth(6);
    // Trim the Lantern — beside the Ember pips it spends (fix round 1). Built once, repositioned
    // in drawLanternGlyph() alongside the pips/glyph it anchors to (same reason the pips
    // themselves recompute off statusText.width every call: hp/streak digit counts shift the
    // whole line).
    this.trimButton = this.button(0, 0, 'Trim the Lantern (1 Ember)', C.ember, onTrim, {
      w: TRIM_BTN_W,
      h: TRIM_BTN_H,
      fontSize: '11px',
    }).setDepth(6).setVisible(false); // stays hidden until drawEmberPips() places it for real

    this.buildTooltip();
  }

  /**
   * Hover/focus tooltip for map nodes (fun-review §3.6a: "names visible on hover
   * everywhere, one line of flavor per node"). Built once, retexted/repositioned per
   * hover — a parchment callout above the node, never on top of it, so it can never
   * obstruct the node's own click: Phaser only hit-tests objects that opt into
   * setInteractive() (this tooltip never does), so drawing over a node can't steal
   * its pointerdown regardless of z-order.
   */
  private buildTooltip(): void {
    const s = this.scene;
    const cont = s.add.container(0, 0).setDepth(60).setAlpha(0);
    const bg = s.add.graphics();
    const name = s.add
      .text(0, 0, '', {
        fontFamily: FONT,
        fontSize: '15px',
        color: hex(C.barkShadow),
        fontStyle: 'bold',
        align: 'center',
      })
      .setOrigin(0.5, 0);
    const blurb = s.add
      .text(0, 0, '', {
        fontFamily: FONT,
        fontSize: '12px',
        color: hex(C.darkBark),
        align: 'center',
        lineSpacing: 3,
        wordWrap: { width: 200 },
      })
      .setOrigin(0.5, 0);
    cont.add([bg, name, blurb]);
    this.tooltipCont = cont;
    this.tooltipBg = bg;
    this.tooltipName = name;
    this.tooltipBlurb = blurb;
  }

  /** Show the tooltip above a node centred at (cx,cy) with body radius r. `blurb` optional
   *  (the Camp has no pack-provided flavor — name alone still shows, "everywhere" per §3.6a). */
  private showNodeTooltip(cx: number, cy: number, r: number, name: string, blurb?: string): void {
    if (!this.tooltipCont || !this.tooltipBg || !this.tooltipName || !this.tooltipBlurb) return;
    const s = this.scene;
    this.tooltipName.setText(name);
    this.tooltipBlurb.setText(blurb ?? '').setVisible(!!blurb);
    const padX = 14;
    const padY = 10;
    const gap = blurb ? 6 : 0;
    const contentW = Math.max(this.tooltipName.width, blurb ? this.tooltipBlurb.width : 0);
    const w = Math.min(240, contentW + padX * 2);
    this.tooltipName.setWordWrapWidth(w - padX * 2);
    this.tooltipBlurb.setWordWrapWidth(w - padX * 2);
    const h = this.tooltipName.height + (blurb ? this.tooltipBlurb.height + gap : 0) + padY * 2;
    // clamp horizontally so edge nodes (camp, boss) never spill the tooltip off-canvas
    const clampedCx = Phaser.Math.Clamp(cx, w / 2 + 8, W - w / 2 - 8);
    const bottomY = cy - r - 14; // sits above the node — never over its clickable circle
    const topY = bottomY - h;

    this.tooltipBg.clear();
    this.tooltipBg.fillStyle(C.voidBlack, 0.3).fillRoundedRect(clampedCx - w / 2 - 2, topY - 2, w + 4, h + 6, 12);
    this.tooltipBg.fillStyle(C.parchment, 0.97).fillRoundedRect(clampedCx - w / 2, topY, w, h, 10);
    this.tooltipBg.lineStyle(2, C.bark, 1).strokeRoundedRect(clampedCx - w / 2, topY, w, h, 10);
    if (blurb) {
      // lanternGold accent hairline between name and blurb (goldRule's idiom, miniaturized)
      this.tooltipBg
        .fillStyle(C.lanternGold, 0.8)
        .fillRect(clampedCx - w / 2 + 12, topY + padY + this.tooltipName.height + gap / 2 - 1, w - 24, 2);
    }
    this.tooltipName.setPosition(clampedCx, topY + padY);
    this.tooltipBlurb.setPosition(clampedCx, topY + padY + this.tooltipName.height + gap);

    s.tweens.killTweensOf(this.tooltipCont);
    s.tweens.add({ targets: this.tooltipCont, alpha: 1, duration: 140, ease: 'Quad.out' });
  }

  private hideNodeTooltip(): void {
    if (!this.tooltipCont) return;
    this.scene.tweens.killTweensOf(this.tooltipCont);
    this.scene.tweens.add({ targets: this.tooltipCont, alpha: 0, duration: 120 });
  }

  /** Debug: the hover tooltip's live alpha + rendered name/blurb (e2e-only — Phaser-drawn,
   *  not DOM, so a spec can't read this via a locator; mirrors CombatHud's bannerText()/
   *  flyoutBounds() idiom). */
  tooltipDebug(): { alpha: number; name: string; blurb: string } | null {
    if (!this.tooltipCont || !this.tooltipName || !this.tooltipBlurb) return null;
    return { alpha: this.tooltipCont.alpha, name: this.tooltipName.text, blurb: this.tooltipBlurb.text };
  }

  /** Debug: the status-line Trim button's live absolute bounds (e2e-only — mirrors combat
   *  hud's bannerBounds()/flyoutBounds() precedent: Phaser-drawn, not DOM, and its x shifts
   *  with statusText's width, so a spec must read this rather than hardcode a pixel guess). */
  trimButtonBounds(): { top: number; bottom: number; left: number; right: number } | null {
    if (!this.trimButton) return null;
    const b = this.trimButton.getBounds();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
  }

  private lanterns(): void {
    const s = this.scene;
    const spots = [
      { x: 150, y: 150, r: 90 },
      { x: 810, y: 130, r: 80 },
      { x: 480, y: 470, r: 120 },
    ];
    for (const sp of spots) {
      const glow = s.add.circle(sp.x, sp.y, sp.r, C.amber, 0.14).setDepth(2);
      glow.setBlendMode(Phaser.BlendModes.ADD);
      s.tweens.add({
        targets: glow,
        alpha: { from: 0.1, to: 0.2 },
        scale: { from: 0.94, to: 1.06 },
        duration: 1400 + sp.r * 6,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }
  }

  /** A faint vaulted hall behind the node strip — arch ribs, pillars, and a floor
   * the nodes stand on — so the crawl reads as a lantern-lit path, not floating dots. */
  private vaultHall(): void {
    const s = this.scene;
    const cx = W / 2;
    const floorY = STRIP_Y + 30;
    const springY = 172;
    const halfSpan = 420;
    const rise = 78;
    const R = (halfSpan * halfSpan + rise * rise) / (2 * rise);
    const centerY = springY - rise + R;
    const aL = Math.atan2(springY - centerY, -halfSpan);
    const aR = Math.atan2(springY - centerY, halfSpan);

    const g = s.add.graphics().setDepth(2);
    // receding vault ribs
    for (let i = 0; i < 3; i++) {
      g.lineStyle(3, C.duskViolet, 0.18 - i * 0.045);
      g.beginPath();
      g.arc(cx, centerY, R - i * 22, aL, aR, false);
      g.strokePath();
    }
    // pillars flanking the strip, each with a warm sconce glow at its base
    g.fillStyle(C.duskDeep, 0.5);
    g.fillRect(cx - halfSpan - 12, springY, 24, floorY - springY);
    g.fillRect(cx + halfSpan - 12, springY, 24, floorY - springY);
    for (const px of [cx - halfSpan, cx + halfSpan]) {
      const sconce = s.add.circle(px, floorY - 18, 26, C.amber, 0.14).setDepth(3).setBlendMode(Phaser.BlendModes.ADD);
      s.tweens.add({ targets: sconce, alpha: { from: 0.08, to: 0.18 }, duration: 1500, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }

    // keystone spark at the crown (slow flicker)
    const key = s.add.circle(cx, springY - rise, 6, C.amber, 0.18).setDepth(2).setBlendMode(Phaser.BlendModes.ADD);
    s.tweens.add({ targets: key, alpha: { from: 0.1, to: 0.24 }, duration: 1700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    // vault floor the nodes stand on, with a warm lantern-lit lip
    const floor = s.add.graphics().setDepth(4);
    floor.fillStyle(C.shadowPlum, 0.55).fillRect(0, floorY, W, H - floorY);
    floor.fillStyle(C.lanternGold, 0.16).fillRect(0, floorY, W, 2);
    floor.fillStyle(C.amber, 0.05).fillRect(0, floorY, W, 14); // soft warm wash along the floor edge
  }

  private dust(): void {
    const s = this.scene;
    const rng = mulberry32(0x5eed);
    for (let i = 0; i < 16; i++) {
      const x = rng() * W;
      const y = rng() * H;
      const mote = s.add.circle(x, y, rng() * 1.6 + 0.8, C.parchment, 0.16).setDepth(3);
      s.tweens.add({
        targets: mote,
        y: y - (30 + rng() * 50),
        x: x + (rng() * 24 - 12),
        alpha: { from: 0.16, to: 0 },
        duration: 4000 + rng() * 4000,
        delay: rng() * 3000,
        repeat: -1,
        ease: 'Sine.inOut',
        onRepeat: () => {
          mote.setPosition(rng() * W, H * 0.5 + rng() * H * 0.5);
        },
      });
    }
  }

  // ---- status + header ------------------------------------------------------

  setHeader(name: string, region: string): void {
    if (!this.headerText) return;
    this.headerText.setText(name);
    this.scene.tweens.add({ targets: this.headerText, alpha: 1, duration: 700, ease: 'Quad.out' });
    if (region && region !== name) {
      this.scene.add
        .text(W / 2, 84, region, {
          fontFamily: FONT,
          fontSize: '13px',
          color: hex(C.duskRose),
        })
        .setOrigin(0.5)
        .setDepth(6);
    }
  }

  /** Wave 4 — `level` gains the status line its own `Lv {N}` readout (the recon ruling's
   *  second level display, mapped onto this existing status affordance — no new hamlet UI
   *  this wave). Also drives the Ember pip TOTAL (see drawEmberPips): the cap itself is
   *  level-keyed now, so the pip count must scale with it or a higher-level pool overflows
   *  the drawn pips. */
  setStatus(hp: number, maxHp: number, streak: number, embers: number, level: number, lanternLight: boolean): void {
    this.statusText?.setText(`Party  ${Math.max(0, hp)}/${maxHp}     Lv ${level}     Hearth Streak  ${streak}`);
    const pipsLeftEdge = this.drawEmberPips(embers, emberMaxForLevel(level));
    this.drawLanternGlyph(pipsLeftEdge, lanternLight);
  }

  /** Ember pips beside the status line — modeled on combat hud's glowPips loop
   *  (hud.ts:301-311): diamonds become small warm dots, filled up to `embers` of
   *  `emberMax` (Wave 4 — the caller's emberMaxForLevel(level) read, no longer a flat
   *  constant). Wordless (the line is already dense) and re-anchored off the status text's
   *  live width every call, so it never overlaps as hp/level/streak digit counts change.
   *  Returns the pips' own left edge — drawLanternGlyph anchors past it. */
  private drawEmberPips(embers: number, emberMax: number): number {
    if (!this.emberPips || !this.statusText) return 0;
    const pipR = 4;
    const pipGap = 3;
    const gapFromText = 14;
    const y = this.statusText.y;
    const totalW = emberMax * (pipR * 2) + (emberMax - 1) * pipGap;
    const rightEdge = this.statusText.x - this.statusText.width - gapFromText;
    const pipsLeftEdge = rightEdge - totalW;
    this.emberPips.clear();
    for (let i = 0; i < emberMax; i++) {
      const cx = pipsLeftEdge + pipR + i * (pipR * 2 + pipGap);
      const filled = i < embers;
      this.emberPips.fillStyle(filled ? C.ember : C.shadowPlum, 1).fillCircle(cx, y, pipR);
      this.emberPips.lineStyle(1, C.outline, 1).strokeCircle(cx, y, pipR);
    }
    return pipsLeftEdge;
  }

  /** Ch. IV — the lantern glyph past the Ember pips' extent: lit when Lantern-light is held,
   *  guttered when not (chapter UI text). Same ring-and-diamond glyph as combat hud's
   *  lanternGlyph (hud.ts), re-anchored off statusText's live width exactly as the pips are
   *  (via pipsLeftEdge, drawEmberPips's own return). Also repositions the Trim button — it
   *  sits beside THIS glyph now, same "growing further left" cluster layout the pips used. */
  private drawLanternGlyph(pipsLeftEdge: number, lanternLight: boolean): void {
    if (!this.lanternGlyph || !this.statusText) return;
    const y = this.statusText.y;
    const gx = pipsLeftEdge - LANTERN_GLYPH_GAP - LANTERN_GLYPH_R;
    this.lanternGlyph.clear();
    this.lanternGlyph.lineStyle(1.5, lanternLight ? C.lanternGold : C.stone, lanternLight ? 1 : 0.5)
      .strokeCircle(gx, y, LANTERN_GLYPH_R);
    diamond(this.lanternGlyph, gx, y, 3.5, lanternLight ? C.lanternGold : C.shadowPlum, true);
    this.lanternGlyph.setAlpha(lanternLight ? 1 : 0.55);

    // beside the glyph, growing further left — same right-anchored-cluster layout the pips use.
    const glyphLeftEdge = gx - LANTERN_GLYPH_R;
    this.trimButton?.setPosition(glyphLeftEdge - TRIM_BTN_GAP - TRIM_BTN_W / 2, y);
    this.trimButton?.setVisible(true); // first real placement — no longer clipped at the origin
  }

  // ---- the map strip --------------------------------------------------------

  renderMap(spec: DungeonSpec, progress: DungeonProgress, handlers: NodeHandlers): void {
    this.mapLayer?.destroy();
    this.roomNodes = [];
    this.handlers = handlers;
    const s = this.scene;
    const layer = s.add.container(0, 0).setDepth(10);
    this.mapLayer = layer;

    const count = spec.rooms.length + 1; // + camp
    const left = 96;
    const right = W - 86;
    const step = count > 1 ? (right - left) / (count - 1) : 0;
    this.nodeXs = Array.from({ length: count }, (_, i) => left + i * step);

    const currentIdx = firstUnclearedIndex(spec.rooms, progress.cleared);

    // connectors first (behind nodes): lit up to the current node, dim ahead
    for (let i = 0; i < count - 1; i++) {
      const lit = i < currentIdx + 1; // camp→r1 … up to the current room
      const line = s.add.rectangle(
        (this.nodeXs[i] + this.nodeXs[i + 1]) / 2,
        STRIP_Y,
        step - 56,
        4,
        lit ? C.amber : C.duskViolet,
        lit ? 0.7 : 0.4,
      );
      layer.add(line);
    }

    // camp node (index 0 of the strip)
    layer.add(this.campNode(this.nodeXs[0], STRIP_Y, handlers.onCamp));

    // room nodes
    spec.rooms.forEach((room, i) => {
      const x = this.nodeXs[i + 1];
      const state = nodeState(i, spec.rooms, progress.cleared);
      const node = this.roomNode(x, STRIP_Y, room, state, i === spec.rooms.length - 1, () =>
        handlers.onRoom(i),
      );
      this.roomNodes[i] = node;
      layer.add(node);
    });
  }

  private campNode(x: number, y: number, onClick: () => void): Phaser.GameObjects.Container {
    const s = this.scene;
    const c = s.add.container(x, y);
    if (s.textures.exists('prop.camp')) {
      // real art is authored bottom-origin (base/shadow at the foot) — stand it on the node
      c.add(s.add.image(0, 8, 'prop.camp').setOrigin(0.5, 1));
    } else {
      const glow = s.add.circle(0, 2, 30, C.amber, 0.22).setBlendMode(Phaser.BlendModes.ADD);
      const tent = s.add.triangle(0, 0, -20, 14, 20, 14, 0, -18, C.timber, 1).setStrokeStyle(2, C.bark);
      const fire = s.add.circle(0, 16, 4, C.lanternGold, 1);
      s.tweens.add({ targets: fire, scale: { from: 0.8, to: 1.3 }, alpha: { from: 0.8, to: 1 }, duration: 500, yoyo: true, repeat: -1 });
      c.add([glow, tent, fire]);
    }
    c.add(this.label(0, 38, 'The Camp', C.parchment));
    this.makeInteractive(c, 30, onClick, { name: 'The Camp' });
    return c;
  }

  private roomNode(
    x: number,
    y: number,
    room: DungeonRoom,
    state: 'cleared' | 'current' | 'locked',
    isBoss: boolean,
    onClick: () => void,
  ): Phaser.GameObjects.Container {
    const s = this.scene;
    const c = s.add.container(x, y);
    const r = isBoss ? 30 : 22;

    if (state === 'current') {
      const halo = s.add.circle(0, 0, r + 14, C.lanternGold, 0.28).setBlendMode(Phaser.BlendModes.ADD);
      s.tweens.add({ targets: halo, alpha: { from: 0.16, to: 0.36 }, scale: { from: 0.92, to: 1.12 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      c.add(halo);
    }

    const bodyColor = state === 'locked' ? C.stone : isBoss ? C.forest : C.leaf;
    const bodyAlpha = state === 'locked' ? 0.55 : 1;
    const ring = state === 'cleared' ? C.lanternGold : state === 'current' ? C.glowCore : C.duskViolet;
    const stone = s.add.circle(0, 0, r, bodyColor, bodyAlpha).setStrokeStyle(3, ring, state === 'locked' ? 0.6 : 1);
    c.add(stone);

    if (isBoss) {
      // a small warden-crown rune so the boss node reads as the finale
      const crown = s.add.triangle(0, -2, -10, 6, 10, 6, 0, -12, state === 'locked' ? C.stone : C.amber, 1);
      c.add(crown);
    }

    if (state === 'cleared') {
      c.add(s.add.text(0, 0, '✓', { fontFamily: FONT, fontSize: '22px', color: hex(C.glowCore) }).setOrigin(0.5));
    } else if (state === 'locked') {
      // padlock placeholder (prop.vault-door seam)
      if (s.textures.exists('prop.vault-door')) {
        // real art is bottom-origin (base/shadow at the foot) — sit it on the node,
        // scaled down from its combat size (72×96) to a map-marker that fits the node
        c.add(
          s.add
            .image(0, r + 6, 'prop.vault-door')
            .setOrigin(0.5, 1)
            .setScale((r * 2.1) / 96)
            .setAlpha(0.85),
        );
      } else {
        const shackle = s.add.arc(0, -4, 6, 180, 360, false, C.stone, 0).setStrokeStyle(2, C.parchment, 0.7);
        const body = s.add.rectangle(0, 2, 12, 9, C.darkBark, 0.9).setStrokeStyle(1, C.parchment, 0.5);
        c.add([shackle, body]);
      }
    } else if (state === 'current') {
      // a lantern spark at the lit node
      c.add(s.add.circle(0, 0, 5, C.glowCore, 1));
    }

    const labelColor = state === 'locked' ? C.stone : C.parchment;
    c.add(this.label(0, r + 16, room.name, labelColor));

    // every room node is interactive; the scene decides behaviour by state
    this.makeInteractive(c, r, onClick, { name: room.name, blurb: room.blurb });
    return c;
  }

  private label(x: number, y: number, text: string, color: number): Phaser.GameObjects.Text {
    return this.scene.add
      .text(x, y, text, {
        fontFamily: FONT,
        fontSize: '12px',
        color: hex(color),
        align: 'center',
        wordWrap: { width: 118 },
      })
      .setOrigin(0.5, 0);
  }

  private makeInteractive(
    c: Phaser.GameObjects.Container,
    r: number,
    onClick: () => void,
    tip?: { name: string; blurb?: string },
  ): void {
    c.setSize(r * 2 + 8, r * 2 + 8);
    c.setInteractive({ useHandCursor: true });
    c.on('pointerover', () => {
      c.setScale(1.07);
      if (tip) this.showNodeTooltip(c.x, c.y, r, tip.name, tip.blurb);
    });
    c.on('pointerout', () => {
      c.setScale(1);
      if (tip) this.hideNodeTooltip();
    });
    c.on('pointerdown', () => onClick());
  }

  shakeNode(index: number): void {
    const node = this.roomNodes[index];
    if (!node) return;
    const x0 = node.x;
    this.scene.tweens.add({ targets: node, x: x0 + 6, duration: 55, yoyo: true, repeat: 3, onComplete: () => node.setX(x0) });
  }

  // ---- cards ----------------------------------------------------------------

  // Parchment card matching encounters/styles.ts .fw-panel: lit top-left gradient,
  // bark border + inner gold hairline, soft ring + drop shadow, 20px radius.
  private openPanel(w: number, h: number): Phaser.GameObjects.Container {
    this.clearOverlay();
    const s = this.scene;
    const cont = s.add.container(0, 0).setDepth(200);
    const scrim = s.add.rectangle(W / 2, H / 2, W, H, C.voidBlack, 0.62).setInteractive();
    const panel = s.add.graphics();
    const x = (W - w) / 2;
    const y = (H - h) / 2;
    const r = 20;
    panel.fillStyle(C.voidBlack, 0.34).fillRoundedRect(x - 3, y - 1, w + 6, h + 12, r + 4); // drop shadow
    panel.fillStyle(C.bark, 0.32).fillRoundedRect(x - 3, y - 3, w + 6, h + 6, r + 3); // ink ring
    panel.fillGradientStyle(C.glowCore, C.parchment, C.parchment, C.pathStone, 1); // lantern-lit parchment
    panel.fillRoundedRect(x, y, w, h, r);
    panel.lineStyle(2, C.bark, 1).strokeRoundedRect(x, y, w, h, r);
    panel.lineStyle(1, C.lanternGold, 0.4).strokeRoundedRect(x + 3, y + 3, w - 6, h - 6, r - 3);
    cont.add([scrim, panel]);
    this.overlay = cont;
    cont.setAlpha(0);
    s.tweens.add({ targets: cont, alpha: 1, duration: 220 });
    return cont;
  }

  /** Overlay-style eyebrow: uppercase, letter-spaced, ember (matches .fw-eyebrow). */
  private eyebrow(cx: number, y: number, text: string): Phaser.GameObjects.Text {
    return this.scene.add
      .text(cx, y, text.toUpperCase(), { fontFamily: FONT, fontSize: '11px', color: hex(C.deepEmber), fontStyle: 'bold' })
      .setLetterSpacing(4)
      .setOrigin(0.5, 0);
  }

  /** Overlay-style rule: a gold→ember hairline (matches .fw-rule). */
  private goldRule(cx: number, y: number, width: number): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    g.fillStyle(C.amber, 0.45).fillRect(cx - width / 2, y, width, 2);
    g.fillStyle(C.lanternGold, 0.9).fillRect(cx - width * 0.32, y, width * 0.64, 2);
    return g;
  }

  clearOverlay(): void {
    this.overlay?.destroy();
    this.overlay = undefined;
  }

  /**
   * Room-entry beat: title + blurb + a light teaser of how many records wait
   * (the full "discovered documents" are services.showTeaching's job — blueprint
   * §4). mode: 'wait' resolves on click, 'auto' auto-advances, 'persist' stays up.
   */
  showBlurbCard(
    room: DungeonRoom,
    facts: FactLite[],
    opts: { mode?: CardMode; revisit?: boolean } = {},
  ): Promise<void> {
    const s = this.scene;
    const w = 560;
    const hasTeaser = facts.length > 0 && !opts.revisit;
    const h = hasTeaser ? 288 : 244;
    const cont = this.openPanel(w, h);
    const cx = W / 2;
    let ty = (H - h) / 2 + 30;

    cont.add(this.eyebrow(cx, ty, opts.revisit ? 'A chamber cleared' : 'You descend into'));
    ty += 24;
    cont.add(s.add.text(cx, ty, room.name, { fontFamily: FONT, fontSize: '27px', color: hex(C.barkShadow), fontStyle: 'bold', align: 'center', wordWrap: { width: w - 70 } }).setOrigin(0.5, 0));
    ty += 42;
    cont.add(this.goldRule(cx, ty, 220));
    ty += 16;
    if (room.blurb) {
      cont.add(s.add.text(cx, ty, room.blurb, { fontFamily: FONT, fontSize: '15px', color: hex(C.darkBark), align: 'center', wordWrap: { width: w - 90 }, lineSpacing: 4 }).setOrigin(0.5, 0));
      ty += 74;
    }
    if (hasTeaser) {
      const n = facts.length;
      cont.add(s.add.text(cx, ty, `✦  ${n} faded fable${n > 1 ? 's' : ''} wait here — the ledger will show them`, { fontFamily: FONT, fontSize: '13px', color: hex(C.bark), fontStyle: 'italic', align: 'center', wordWrap: { width: w - 80 } }).setOrigin(0.5, 0));
    }

    return this.finishCard(cont, h, opts.mode ?? 'wait', opts.revisit ? 'Withdraw ▸' : 'Descend ▸');
  }

  showCampCard(mode: CardMode = 'wait', heal?: { before: number; after: number }): Promise<void> {
    const s = this.scene;
    const w = 480;
    const h = 300;
    const cont = this.openPanel(w, h);
    const cx = W / 2;
    const top = (H - h) / 2 + 28;
    cont.add(this.eyebrow(cx, top, 'You make camp'));
    cont.add(s.add.text(cx, top + 22, 'The Camp at the Vault-Mouth', { fontFamily: FONT, fontSize: '22px', color: hex(C.barkShadow), fontStyle: 'bold' }).setOrigin(0.5, 0));
    cont.add(this.goldRule(cx, top + 56, 200));
    cont.add(s.add.text(cx, top + 70, 'Lanterns trimmed, wounds bound, the ledger set by the fire.', { fontFamily: FONT, fontSize: '15px', color: hex(C.darkBark), align: 'center', wordWrap: { width: w - 70 } }).setOrigin(0.5, 0));
    // concrete heal feedback — show the mend, not a generic line
    const healLine = !heal
      ? 'The party rests, and is restored to full.'
      : heal.before < heal.after
        ? `The hearth mends you — ${heal.before} to ${heal.after} HP.`
        : `The hearth is warm; your party is already whole — ${heal.after}/${heal.after} HP.`;
    cont.add(s.add.text(cx, top + 104, healLine, { fontFamily: FONT, fontSize: '16px', color: hex(C.deepEmber), fontStyle: 'bold', align: 'center', wordWrap: { width: w - 60 } }).setOrigin(0.5, 0));
    if (this.handlers) {
      cont.add(this.button(cx, top + 150, 'Open Satchel', C.timber, () => this.handlers!.onSatchel()));
    }
    return this.finishCard(cont, h, mode, 'Onward ▸');
  }

  /** Resume choice on re-entry. Resolves 'continue' | 'camp'. */
  showResumeChoice(roomName: string): Promise<'continue' | 'camp'> {
    const s = this.scene;
    const w = 500;
    const h = 232;
    const cont = this.openPanel(w, h);
    const cx = W / 2;
    const top = (H - h) / 2 + 28;
    cont.add(this.eyebrow(cx, top, 'The ledger remembers'));
    cont.add(s.add.text(cx, top + 22, 'Where do you take up the descent?', { fontFamily: FONT, fontSize: '20px', color: hex(C.barkShadow), fontStyle: 'bold' }).setOrigin(0.5, 0));
    cont.add(this.goldRule(cx, top + 54, 200));
    return new Promise((resolve) => {
      const pick = (v: 'continue' | 'camp') => {
        this.clearOverlay();
        resolve(v);
      };
      cont.add(this.button(cx, top + 84, `Continue from ${roomName}`, C.leaf, () => pick('continue')));
      cont.add(this.button(cx, top + 136, 'Return to the camp', C.timber, () => pick('camp')));
    });
  }

  /** Ch. IV loot-advantage prompt. Resolves 'raise' | 'keep'. */
  showLanternChoice(troveName: string): Promise<'raise' | 'keep'> {
    const s = this.scene;
    const w = 500;
    const h = 232;
    const cont = this.openPanel(w, h);
    const cx = W / 2;
    const top = (H - h) / 2 + 28;
    cont.add(this.eyebrow(cx, top, 'The lantern is lit'));
    cont.add(s.add.text(cx, top + 22, `Raise the lantern over ${troveName}?`, { fontFamily: FONT, fontSize: '20px', color: hex(C.barkShadow), fontStyle: 'bold' }).setOrigin(0.5, 0));
    cont.add(this.goldRule(cx, top + 54, 200));
    return new Promise((resolve) => {
      const pick = (v: 'raise' | 'keep') => {
        this.clearOverlay();
        resolve(v);
      };
      cont.add(this.button(cx, top + 84, 'Raise it — advantage on this trove', C.leaf, () => pick('raise')));
      cont.add(this.button(cx, top + 136, 'Keep the light', C.timber, () => pick('keep')));
    });
  }

  private finishCard(cont: Phaser.GameObjects.Container, h: number, mode: CardMode, hint: string): Promise<void> {
    const s = this.scene;
    const cy = (H + h) / 2 - 30;
    if (mode !== 'auto') {
      cont.add(s.add.text(W / 2, cy, hint, { fontFamily: FONT, fontSize: '14px', color: hex(C.deepEmber) }).setOrigin(0.5));
    }
    if (mode === 'persist') return Promise.resolve(); // leave it up (dev screenshots)
    if (mode === 'auto') {
      // auto-advance (auto-drive flows): brief hold, then dismiss
      return new Promise((resolve) => {
        s.time.delayedCall(900, () => {
          this.clearOverlay();
          resolve();
        });
      });
    }
    return new Promise((resolve) => {
      const scrim = cont.list[0] as Phaser.GameObjects.Rectangle;
      scrim.once('pointerdown', () => {
        this.clearOverlay();
        resolve();
      });
    });
  }

  private button(
    x: number,
    y: number,
    text: string,
    color: number,
    onClick: () => void,
    opts: { w?: number; h?: number; fontSize?: string } = {},
  ): Phaser.GameObjects.Container {
    const s = this.scene;
    const w = opts.w ?? 300;
    const h = opts.h ?? 40;
    const fontSize = opts.fontSize ?? '15px';
    const b = s.add.container(x, y);
    const bg = s.add.rectangle(0, 0, w, h, color, 1).setStrokeStyle(2, C.darkBark, 1);
    const t = s.add.text(0, 0, text, { fontFamily: FONT, fontSize, color: hex(C.parchment) }).setOrigin(0.5);
    b.add([bg, t]);
    b.setSize(w, h).setInteractive({ useHandCursor: true });
    b.on('pointerover', () => bg.setScale(1.04));
    b.on('pointerout', () => bg.setScale(1));
    b.on('pointerdown', onClick);
    return b;
  }

  // ---- transient beats ------------------------------------------------------

  combatFlash(room: DungeonRoom): Promise<void> {
    const s = this.scene;
    const flash = s.add.rectangle(W / 2, H / 2, W, H, C.shadowPlum, 0).setDepth(150);
    const label = s.add.text(W / 2, H / 2, `The wards of ${room.name} stir…`, { fontFamily: FONT, fontSize: '20px', color: hex(C.lanternGold) }).setOrigin(0.5).setDepth(151).setAlpha(0);
    return new Promise((resolve) => {
      s.tweens.add({ targets: flash, alpha: 0.55, duration: 200, yoyo: true, hold: 260 });
      s.tweens.add({
        targets: label,
        alpha: 1,
        duration: 220,
        yoyo: true,
        hold: 260,
        onComplete: () => {
          flash.destroy();
          label.destroy();
          resolve();
        },
      });
    });
  }

  toast(text: string, tone: Toast = 'info'): void {
    const s = this.scene;
    const color = tone === 'warn' ? C.ember : tone === 'good' ? C.leafHi : C.parchment;
    const y = H - 70;
    const t = s.add.text(W / 2, y, text, { fontFamily: FONT, fontSize: '15px', color: hex(color), backgroundColor: 'rgba(16,11,10,0.72)', padding: { x: 12, y: 7 } }).setOrigin(0.5).setDepth(120).setAlpha(0);
    s.tweens.add({ targets: t, alpha: 1, y: y - 8, duration: 220, ease: 'Quad.out' });
    s.tweens.add({ targets: t, alpha: 0, delay: 2000, duration: 500, onComplete: () => t.destroy() });
  }

  lootToast(text: string): void {
    this.toast(text, 'good');
  }

  errorToast(text: string): void {
    const s = this.scene;
    const cont = this.openPanel(520, 170);
    const cx = W / 2;
    const top = (H - 170) / 2 + 40;
    cont.add(s.add.text(cx, top, 'The way is lost.', { fontFamily: FONT, fontSize: '20px', color: hex(C.berry), fontStyle: 'bold' }).setOrigin(0.5));
    cont.add(s.add.text(cx, top + 40, text, { fontFamily: FONT, fontSize: '14px', color: hex(C.bark), align: 'center', wordWrap: { width: 440 } }).setOrigin(0.5, 0));
  }

  /** Boss finale: golden light sweep + reward. hold=true leaves it on screen. */
  vaultOpensBeat(reward: string, streak: number, opts: { hold?: boolean } = {}): Promise<void> {
    const s = this.scene;
    const cx = W / 2;
    const cy = H / 2 - 48;
    // strong scrim so the finale text reads cleanly, clear of the map strip below
    const scrim = s.add.rectangle(W / 2, H / 2, W, H, C.voidBlack, 0.9).setDepth(300).setAlpha(0);
    // celebratory warm burst behind the title
    const glow = s.add.circle(cx, cy - 26, 230, C.amber, 0).setDepth(301).setBlendMode(Phaser.BlendModes.ADD);
    const ring = s.add.circle(cx, cy - 26, 44, C.glowCore, 0).setStrokeStyle(3, C.glowCore, 0.9).setDepth(301).setBlendMode(Phaser.BlendModes.ADD);
    const sweep = s.add.rectangle(-200, H / 2, 260, H, C.glowCore, 0.85).setDepth(302).setBlendMode(Phaser.BlendModes.ADD);

    const title = s.add.text(cx, cy - 62, 'THE VAULT OPENS', { fontFamily: FONT, fontSize: '38px', color: hex(C.lanternGold) }).setOrigin(0.5).setDepth(303).setAlpha(0).setShadow(0, 3, hex(C.deepEmber), 12, false, true);
    const rule = s.add.rectangle(cx, cy - 26, 220, 2, C.amber, 0.8).setDepth(303).setAlpha(0);
    const line = s.add.text(cx, cy + 4, reward, { fontFamily: FONT, fontSize: '20px', color: hex(C.lanternGold), fontStyle: 'bold', align: 'center', wordWrap: { width: 640 } }).setOrigin(0.5).setDepth(303).setAlpha(0);
    const streakT = s.add.text(cx, cy + 48, `Hearth Streak  ${streak}`, { fontFamily: FONT, fontSize: '16px', color: hex(C.leafHi) }).setOrigin(0.5).setDepth(303).setAlpha(0);

    return new Promise((resolve) => {
      s.tweens.add({ targets: scrim, alpha: 1, duration: 300 });
      s.tweens.add({
        targets: sweep,
        x: W + 200,
        duration: 720,
        ease: 'Quad.inOut',
        onComplete: () => {
          sweep.destroy();
          // burst: warm bloom + one expanding gold ring
          s.tweens.add({ targets: glow, alpha: 0.45, duration: 420, yoyo: true, hold: 700 });
          s.tweens.add({ targets: ring, alpha: { from: 0.9, to: 0 }, scale: { from: 0.4, to: 2.6 }, duration: 720, ease: 'Quad.out' });
          // savour it: title → reward → streak, staggered
          s.tweens.add({ targets: [title, rule], alpha: 1, duration: 360 });
          s.tweens.add({ targets: line, alpha: 1, duration: 340, delay: 280 });
          s.tweens.add({ targets: streakT, alpha: 1, duration: 300, delay: 560 });
          // a deliberate extra beat to let the reward land before the hamlet return
          s.time.delayedCall(opts.hold ? 1000 : 2000, () => resolve());
        },
      });
    });
  }
}

/** A small diamond (rotated square) at (x,y) — the lantern glyph's flame, same helper as
 *  combat hud's diamond() (hud.ts). `fill:true` fills with `color`; `fill:false` strokes the
 *  outline in `color` instead. */
function diamond(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, fill: boolean): void {
  const pts = [{ x, y: y - r }, { x: x + r, y }, { x, y: y + r }, { x: x - r, y }];
  if (fill) g.fillStyle(color, 1).fillPoints(pts, true);
  else g.lineStyle(1, color, 1).strokePoints(pts, true);
}

/** Deterministic PRNG so dust/flicker are repeatable across seeded shots. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
