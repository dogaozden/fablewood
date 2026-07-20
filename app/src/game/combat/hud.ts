/**
 * Combat HUD chrome: turn-order strip, action menu, the "why" banner, toasts,
 * the Clerk-deliberates veil, and the left party panel (Keeper/Mira HP, Mira's
 * mastery badge, the once-per-battle lantern grace, streak). Floating per-unit
 * HP bars and grid rendering live in the scene; this file owns the frame.
 */
import Phaser from 'phaser';
import { P, hex } from './palette';
import { ACTIONS, type ActionKind, type UnitState } from './types';
import { ICON_KEYS } from './textures';

const FONT = 'Georgia, serif';
const W = 960;

export interface TurnChip {
  id: string;
  kind: string;
  team: 'party' | 'enemy';
}

export interface ActionItem {
  action: ActionKind;
  enabled: boolean;
  reason?: string;
}

export interface PartyStatus {
  graceAvailable: boolean;
  miraBonusActive: boolean;
  streak: number;
}

export class CombatHud {
  private scene: Phaser.Scene;
  private strip: Phaser.GameObjects.Container;
  private chips = new Map<string, Phaser.GameObjects.Container>();
  private banner: Phaser.GameObjects.Container;
  private toast: Phaser.GameObjects.Container;
  private veil: Phaser.GameObjects.Container;
  private menu: Phaser.GameObjects.Container;
  private panel: Phaser.GameObjects.Container;
  private panelBg: Phaser.GameObjects.Graphics;
  private panelText: Phaser.GameObjects.Text;
  private graceDot: Phaser.GameObjects.Arc;
  private streakIcon: Phaser.GameObjects.Image | null = null;

  constructor(scene: Phaser.Scene, roomName: string) {
    this.scene = scene;
    this.strip = scene.add.container(0, 0).setDepth(50);
    this.banner = scene.add.container(W / 2, 446).setDepth(60).setAlpha(0);
    this.toast = scene.add.container(W / 2, 210).setDepth(80).setAlpha(0);
    this.veil = scene.add.container(0, 0).setDepth(70).setVisible(false);
    this.menu = scene.add.container(0, 502).setDepth(55).setVisible(false);
    this.panel = scene.add.container(8, 66).setDepth(50);

    scene.add.text(12, 8, roomName.toUpperCase(), {
      fontFamily: FONT, fontSize: '13px', color: hex(P.parchment),
    }).setDepth(50);

    // party panel frame (bg is re-sized to fit content in updateParty)
    this.panelBg = scene.add.graphics();
    this.panelText = scene.add.text(12, 10, '', { fontFamily: FONT, fontSize: '13px', color: hex(P.parchment), lineSpacing: 5 });
    this.graceDot = scene.add.circle(160, 128, 5, P.lanternGold);
    this.panel.add([this.panelBg, this.panelText, this.graceDot]);
    // A2's real hearth-flame beside the streak (the "flame = streak" motif). Guarded:
    // absent in a texture-less boot; the text still reads the count either way.
    if (scene.textures.exists('icon.streak')) {
      this.streakIcon = scene.add.image(0, 0, 'icon.streak').setDisplaySize(15, 15).setVisible(false);
      this.panel.add(this.streakIcon);
    }

    // deliberation veil
    const vg = scene.add.graphics();
    vg.fillStyle(P.shadowPlum, 0.55).fillRect(0, 0, W, 540);
    const vt = scene.add.text(W / 2, 270, 'the Clerk deliberates…', {
      fontFamily: FONT, fontSize: '26px', color: hex(P.glowCore), fontStyle: 'italic',
    }).setOrigin(0.5);
    this.veil.add([vg, vt]);
    this.scene.tweens.add({ targets: vt, alpha: { from: 0.5, to: 1 }, duration: 700, yoyo: true, repeat: -1 });
  }

  // ---- turn strip -------------------------------------------------------

  setTurnOrder(order: TurnChip[]): void {
    this.strip.removeAll(true);
    this.chips.clear();
    const cw = 34;
    const total = order.length * cw;
    const startX = W / 2 - total / 2 + cw / 2;
    order.forEach((c, i) => {
      const ringCol = tokenColor(c.kind);
      const chip = this.scene.add.container(startX + i * cw, 24);
      const ring = this.scene.add.circle(0, 0, 13, ringCol).setStrokeStyle(2, P.outline);
      const label = this.scene.add.text(0, 0, initial(c.kind), {
        fontFamily: FONT, fontSize: '13px', color: hex(readableText(ringCol)), fontStyle: 'bold',
      }).setOrigin(0.5);
      chip.add([ring, label]);
      this.strip.add(chip);
      this.chips.set(c.id, chip);
    });
  }

  setActive(id: string, aliveIds: Set<string>): void {
    this.chips.forEach((chip, cid) => {
      const active = cid === id;
      const dead = !aliveIds.has(cid);
      chip.setScale(active ? 1.32 : 1).setAlpha(dead ? 0.28 : 1);
      const ring = chip.getAt(0) as Phaser.GameObjects.Arc;
      ring.setStrokeStyle(active ? 3 : 2, active ? P.glowCore : P.outline);
    });
  }

  // ---- banner + toast ---------------------------------------------------

  showBanner(text: string, tint: number = P.parchment): void {
    this.banner.removeAll(true);
    const label = this.scene.add.text(0, 0, text, {
      fontFamily: FONT, fontSize: '17px', color: hex(tint), align: 'center',
    }).setOrigin(0.5).setShadow(0, 2, hex(P.voidBlack), 4);
    const pad = 14;
    const bg = this.scene.add.graphics();
    bg.fillStyle(P.shadowPlum, 0.9).fillRoundedRect(-label.width / 2 - pad, -16, label.width + pad * 2, 32, 8);
    bg.lineStyle(1, tint, 0.6).strokeRoundedRect(-label.width / 2 - pad, -16, label.width + pad * 2, 32, 8);
    this.banner.add([bg, label]);
    this.scene.tweens.killTweensOf(this.banner);
    this.banner.setAlpha(0).setScale(0.96);
    this.scene.tweens.add({ targets: this.banner, alpha: 1, scale: 1, duration: 140 });
    this.scene.tweens.add({ targets: this.banner, alpha: 0, delay: 1900, duration: 400 });
  }

  showToast(text: string, tint: number = P.lanternGold): void {
    this.toast.removeAll(true);
    const label = this.scene.add.text(0, 0, text, {
      fontFamily: FONT, fontSize: '30px', color: hex(tint), align: 'center', fontStyle: 'bold',
    }).setOrigin(0.5).setShadow(0, 3, hex(P.barkShadow), 6);
    this.toast.add(label);
    this.scene.tweens.killTweensOf(this.toast);
    this.toast.setAlpha(0).setScale(0.8);
    this.scene.tweens.add({ targets: this.toast, alpha: 1, scale: 1, duration: 260, ease: 'Back.easeOut' });
  }

  // ---- deliberation veil ------------------------------------------------

  setDeliberating(on: boolean): void {
    this.veil.setVisible(on);
  }

  // ---- action menu ------------------------------------------------------

  showActionMenu(items: ActionItem[], onPick: (a: ActionKind) => void): void {
    this.menu.removeAll(true);
    const gap = 6;
    // Fit the row to the canvas: 6 actions keep the 148px button; the 7th (Smite) shrinks
    // them just enough to stay on-screen (≈129px) rather than overflow the 960px width.
    const bw = Math.min(148, Math.floor((W - 20 - (items.length - 1) * gap) / items.length));
    const total = items.length * bw + (items.length - 1) * gap;
    let x = W / 2 - total / 2;
    for (const item of items) {
      const meta = ACTIONS[item.action];
      const btn = this.scene.add.container(x + bw / 2, 0);
      const bg = this.scene.add.graphics();
      const draw = (hovered: boolean) => {
        bg.clear();
        const fill = item.enabled ? (hovered ? P.bark : P.darkBark) : P.shadowPlum;
        bg.fillStyle(fill, 0.95).fillRoundedRect(-bw / 2, -22, bw, 44, 8);
        bg.lineStyle(2, item.enabled ? meta.tint : P.stoneGrey, item.enabled ? 1 : 0.5)
          .strokeRoundedRect(-bw / 2, -22, bw, 44, 8);
      };
      draw(false);
      const icon = this.scene.add.image(-bw / 2 + 22, 0, ICON_KEYS[item.action]).setScale(0.9);
      const label = this.scene.add.text(-bw / 2 + 40, -9, meta.label, {
        fontFamily: FONT, fontSize: '13px', color: hex(item.enabled ? P.parchment : P.stoneGrey),
      });
      const key = this.scene.add.text(-bw / 2 + 40, 5, `[${meta.hotkey}] ${item.reason ?? meta.blurb}`, {
        fontFamily: FONT, fontSize: '9px', color: hex(item.enabled ? P.lanternGold : P.stoneGrey),
      });
      btn.add([bg, icon, label, key]);
      if (item.enabled) {
        btn.setInteractive(new Phaser.Geom.Rectangle(-bw / 2, -22, bw, 44), Phaser.Geom.Rectangle.Contains);
        btn.on('pointerover', () => draw(true));
        btn.on('pointerout', () => draw(false));
        btn.on('pointerdown', () => onPick(item.action));
      } else {
        icon.setAlpha(0.4);
      }
      this.menu.add(btn);
      x += bw + gap;
    }
    this.menu.setVisible(true);
  }

  hideActionMenu(): void {
    this.menu.setVisible(false);
  }

  // ---- party panel ------------------------------------------------------

  updateParty(keeper: UnitState | undefined, mira: UnitState | undefined, status: PartyStatus): void {
    const lines: string[] = ['THE RETINUE'];
    if (keeper) lines.push(`Keeper  ${bar(keeper)} ${keeper.hp}/${keeper.maxHp}`);
    if (mira) lines.push(`Mira    ${bar(mira)} ${mira.hp}/${mira.maxHp}`);
    lines.push(status.miraBonusActive ? 'Mira: fighting fiercer (mastery)' : 'Mira: no bonus yet');
    lines.push(`Hearth: ${status.streak}`);
    lines.push(`Lantern grace: ${status.graceAvailable ? 'ready' : 'spent'}`);
    this.panelText.setText(lines.join('\n'));

    const h = this.panelText.height + 20;
    this.panelBg.clear();
    this.panelBg.fillStyle(P.shadowPlum, 0.75).fillRoundedRect(0, 0, 176, h, 8);
    this.panelBg.lineStyle(2, P.bark, 1).strokeRoundedRect(0, 0, 176, h, 8);
    const lh = this.panelText.height / lines.length;
    this.graceDot.setFillStyle(status.graceAvailable ? P.lanternGold : P.stoneGrey)
      .setPosition(160, 10 + (lines.length - 0.5) * lh);
    if (this.streakIcon) {
      const si = lines.findIndex((l) => l.startsWith('Hearth'));
      this.streakIcon.setVisible(status.streak > 0).setPosition(88, 10 + (si + 0.5) * lh);
    }
  }

  /** Debug: the party panel's current raw text (e2e-only — verifies the sidebar reflects
   *  live hp rather than a stale snapshot, e.g. crucible #10's enemy-turn refresh gap). */
  partyPanelText(): string {
    return this.panelText.text;
  }
}

/** Per-archetype token tint so the initiative queue reads at a glance. */
function tokenColor(kind: string): number {
  switch (kind) {
    case 'keeper': return P.moss;
    case 'mira': return P.orchid;
    case 'wisp': return P.waterLight;
    case 'wraith': return P.duskViolet;
    case 'construct': return P.stoneGrey;
    case 'warden': return P.ember;
    default: return P.stoneGrey;
  }
}

/** Dark initial on light tokens, parchment on dark — keeps the glyph legible. */
function readableText(bg: number): number {
  const lum = 0.299 * ((bg >> 16) & 0xff) + 0.587 * ((bg >> 8) & 0xff) + 0.114 * (bg & 0xff);
  return lum > 140 ? P.outline : P.parchment;
}

function initial(kind: string): string {
  const map: Record<string, string> = { keeper: 'K', mira: 'M', wisp: 'w', wraith: 'W', construct: 'C', warden: '★' };
  return map[kind] ?? kind[0].toUpperCase();
}

function bar(u: UnitState): string {
  const n = 6;
  const filled = Math.round((u.hp / u.maxHp) * n);
  return '▰'.repeat(filled) + '▱'.repeat(n - filled);
}
