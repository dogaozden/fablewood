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
import { GLOW_CAP } from './arts';

const FONT = 'Georgia, serif';
const W = 960;
/** The banner's default screen-centre Y (its constructor position). Named so the tier-flyout
 *  clearance logic (crucible v1 #10) and hideTierFlyout's restore always agree on one value. */
const BANNER_Y = 446;

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
  /** §12.3 — party-shared Glow pips (0..GLOW_CAP), additive to the existing status shape. */
  glow: number;
  /** Ch. IV — Lantern-light held (Concordance): the HUD glyph beside the streak count is
   *  lit when true, guttered when false. Additive to the existing status shape. */
  lanternLight: boolean;
  /** Final review I1 — Ch. VI's ratified HUD readout ("the HUD shows the remainder ('Move
   *  3/5') beside the action menu"): the ACTIVE unit's own turn budget. */
  moveLeft: number;
  moveTotal: number;
}

/** §12.2 — one row of the tier flyout. */
export interface TierRow {
  tier: 1 | 2 | 3;
  label: string;
  /** 'free' for tier 1, else '◈N' */
  costText: string;
  /** Short policy badge: '+' means a floor, '?' means T3's soft preference. */
  difficultyGlyph: string;
  difficultyTint: number;
  enabled: boolean;
  reason?: string;
}

/** §12.2 — the Overglow toggle row (offered only when rank≥2 and ≥1 pip is available). */
export interface OverglowRow {
  enabled: boolean;
  on: boolean;
  reason?: string;
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
  private rankText: Phaser.GameObjects.Text;
  private glowPips: Phaser.GameObjects.Graphics;
  private lanternGlyph: Phaser.GameObjects.Graphics;
  private lastMenuButtonWidth = 0;
  private lastGlowPips = -1;
  private flyout: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, roomName: string) {
    this.scene = scene;
    this.strip = scene.add.container(0, 0).setDepth(50);
    this.banner = scene.add.container(W / 2, BANNER_Y).setDepth(60).setAlpha(0);
    this.toast = scene.add.container(W / 2, 210).setDepth(80).setAlpha(0);
    this.veil = scene.add.container(0, 0).setDepth(70).setVisible(false);
    this.menu = scene.add.container(0, 502).setDepth(55).setVisible(false);
    this.flyout = scene.add.container(0, 502).setDepth(56).setVisible(false);
    this.panel = scene.add.container(8, 66).setDepth(50);

    scene.add.text(12, 8, roomName.toUpperCase(), {
      fontFamily: FONT, fontSize: '13px', color: hex(P.parchment),
    }).setDepth(50);
    // §12.3 — the Rank line, directly under the room name (the retention hook rendered visible).
    this.rankText = scene.add.text(12, 24, '', {
      fontFamily: FONT, fontSize: '11px', color: hex(P.lanternGold),
    }).setDepth(50);

    // party panel frame (bg is re-sized to fit content in updateParty)
    this.panelBg = scene.add.graphics();
    this.panelText = scene.add.text(12, 10, '', { fontFamily: FONT, fontSize: '13px', color: hex(P.parchment), lineSpacing: 5 });
    this.graceDot = scene.add.circle(160, 128, 5, P.lanternGold);
    this.glowPips = scene.add.graphics();
    this.lanternGlyph = scene.add.graphics();
    this.panel.add([this.panelBg, this.panelText, this.graceDot, this.glowPips, this.lanternGlyph]);
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

  // ---- rank line (§12.3) -------------------------------------------------

  /** `welded4` (facts at box≥4) feeds the pre-rank-3 carrot; ignored once rank 3 is reached.
   *  `rank` is the COMPOSED tier gate (Wave 4) — what the Keeper can actually cast at, mastery
   *  and level together — and `level` prefixes it, this line being the HUD's one progression
   *  readout. The rank half's format is unchanged. */
  setRankLine(rank: 1 | 2 | 3, welded4: number, level: number): void {
    const roman = rank === 1 ? 'I' : rank === 2 ? 'II' : 'III';
    const carrot = rank < 3 ? ` — ${welded4}/8 welded toward Rank III` : '';
    this.rankText.setText(`Lv ${level} · Keeper's Rank ${roman}${carrot}`);
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
    const padX = 14;
    const padY = 8;
    const boxHeight = label.height + padY * 2;
    const boxY = -boxHeight / 2;
    const bg = this.scene.add.graphics();
    bg.fillStyle(P.shadowPlum, 0.9).fillRoundedRect(-label.width / 2 - padX, boxY, label.width + padX * 2, boxHeight, 8);
    bg.lineStyle(1, tint, 0.6).strokeRoundedRect(-label.width / 2 - padX, boxY, label.width + padX * 2, boxHeight, 8);
    this.banner.add([bg, label]);
    this.scene.tweens.killTweensOf(this.banner);
    this.banner.setAlpha(0).setScale(0.96);
    this.scene.tweens.add({ targets: this.banner, alpha: 1, scale: 1, duration: 140 });
    this.scene.tweens.add({ targets: this.banner, alpha: 0, delay: 1900, duration: 400 });
  }

  /** Debug: the banner's current raw text (e2e-only — crucible v1 #14/#19: proves the
   *  banner's wording reflects the actual outcome rather than a static template regardless
   *  of it, e.g. a cap-clamped Glow gain or an honest non-success message). */
  bannerText(): string {
    return (this.banner.getAt(1) as Phaser.GameObjects.Text | undefined)?.text ?? '';
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
    const gap = 4;
    // Fit the row to the canvas: 6 actions keep the 148px button; the 7th (Smite) shrinks
    // them just enough to stay on-screen (≈132px) rather than overflow the 960px width.
    const bw = Math.min(148, Math.floor((W - 12 - (items.length - 1) * gap) / items.length));
    this.lastMenuButtonWidth = bw;
    // Task 5 — the row's floor at the full 10-button count (Ch. VI's Press On + Brace):
    // labels must still render WHOLE (no "End Tu…"), so the label font itself shrinks a
    // notch once bw can no longer spare 13px's worth of room, same spirit as bw's own
    // shrink-to-fit above. Hints (below) stay free to ellipsize — that's still acceptable.
    const labelSize = bw >= 130 ? 13 : bw >= 100 ? 12 : 11;
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
      const icon = this.scene.add.image(-bw / 2 + 18, 0, ICON_KEYS[item.action]).setScale(0.9);
      // crucible v1 #11 — yesterday's Satchel-action commit made this an 8-button row (112px
      // each, down from 129px at 7); 3 of 8 labels and all 8 hint lines overflowed with no
      // visual indication of the cut. Clamp both to the button's own inner width, ellipsizing
      // rather than letting later buttons' opaque backgrounds silently paint over the tail.
      // Task 5 — the icon/text split tightened (was 22/40, pad 6) to reclaim width toward
      // labelSize's own fix above; the icon's own position/scale are unchanged, so its
      // clearance from the text is preserved, just shifted left with it.
      const availW = bw / 2 - 4 - (-bw / 2 + 36);
      const label = this.scene.add.text(-bw / 2 + 36, -9, '', {
        fontFamily: FONT, fontSize: `${labelSize}px`, color: hex(item.enabled ? P.parchment : P.stoneGrey),
      });
      fitText(label, meta.label, availW);
      const key = this.scene.add.text(-bw / 2 + 36, 5, '', {
        fontFamily: FONT, fontSize: '9px', color: hex(item.enabled ? P.lanternGold : P.stoneGrey),
      });
      fitText(key, `[${meta.hotkey}] ${item.reason ?? meta.blurb}`, availW);
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

  /** Debug: each action-menu button's rendered label/hint text + measured width vs the
   *  button's own width (e2e-only — crucible v1 #11: proves neither ever visually overflows
   *  its button, truncating with an ellipsis instead when the button is too narrow). */
  actionMenuDebug(): Array<{ label: string; labelWidth: number; hint: string; hintWidth: number; buttonWidth: number }> {
    return this.menu.list.map((btn) => {
      const c = btn as Phaser.GameObjects.Container;
      const label = c.getAt(2) as Phaser.GameObjects.Text;
      const hint = c.getAt(3) as Phaser.GameObjects.Text;
      return { label: label.text, labelWidth: label.width, hint: hint.text, hintWidth: hint.width, buttonWidth: this.lastMenuButtonWidth };
    });
  }

  // ---- party panel ------------------------------------------------------

  updateParty(keeper: UnitState | undefined, mira: UnitState | undefined, status: PartyStatus): void {
    const lines: string[] = ['THE RETINUE'];
    if (keeper) lines.push(`Keeper  ${bar(keeper)} ${keeper.hp}/${keeper.maxHp}`);
    if (mira) lines.push(`Mira    ${bar(mira)} ${mira.hp}/${mira.maxHp}`);
    lines.push(status.miraBonusActive ? 'Mira: fighting fiercer (mastery)' : 'Mira: no bonus yet');
    // Final review I1 — chapter's exact quoted format: "Move 3/5" (remainder/total, no colon).
    lines.push(`Move ${status.moveLeft}/${status.moveTotal}`);
    lines.push(`Vigil: ${status.streak}`);
    lines.push(`Solace: ${status.graceAvailable ? 'ready' : 'spent'}`);
    this.panelText.setText(lines.join('\n'));

    const h = this.panelText.height + 20;
    this.panelBg.clear();
    this.panelBg.fillStyle(P.shadowPlum, 0.75).fillRoundedRect(0, 0, 176, h, 8);
    this.panelBg.lineStyle(2, P.bark, 1).strokeRoundedRect(0, 0, 176, h, 8);
    const lh = this.panelText.height / lines.length;
    this.graceDot.setFillStyle(status.graceAvailable ? P.lanternGold : P.stoneGrey)
      .setPosition(160, 10 + (lines.length - 0.5) * lh);
    const si = lines.findIndex((l) => l.startsWith('Vigil'));
    if (this.streakIcon) {
      this.streakIcon.setVisible(status.streak > 0).setPosition(88, 10 + (si + 0.5) * lh);
    }

    // §12.3 — 3 diamond Glow pips beside the streak line: lantern-gold filled / shadow-plum
    // empty, +pulse on GAIN only (never on spend, so it reads as "you earned this").
    const py = 10 + (si + 0.5) * lh;
    const pipR = 5;
    const pipGap = 4;
    const startX = 122;
    this.glowPips.clear();
    for (let i = 0; i < GLOW_CAP; i++) {
      const px = startX + i * (pipR * 2 + pipGap);
      const filled = i < status.glow;
      diamond(this.glowPips, px, py, pipR, filled ? P.lanternGold : P.shadowPlum, true);
      diamond(this.glowPips, px, py, pipR, P.outline, false);
    }
    if (status.glow > this.lastGlowPips && this.lastGlowPips >= 0) {
      this.scene.tweens.killTweensOf(this.glowPips);
      this.glowPips.setScale(1.5);
      this.scene.tweens.add({ targets: this.glowPips, scale: 1, duration: 260, ease: 'Back.easeOut' });
    }
    this.lastGlowPips = status.glow;

    // Ch. IV — the lantern glyph beside the streak count: lit when held, guttered when
    // spent (chapter UI text). Drawn, not textured: a stroked ring with a diamond flame,
    // the glow-pip idiom at glyph scale.
    const lx = 166;
    this.lanternGlyph.clear();
    const lit = status.lanternLight;
    this.lanternGlyph.lineStyle(1.5, lit ? P.lanternGold : P.stoneGrey, lit ? 1 : 0.5)
      .strokeCircle(lx, py, 6);
    diamond(this.lanternGlyph, lx, py, 3.5, lit ? P.lanternGold : P.shadowPlum, true);
    this.lanternGlyph.setAlpha(lit ? 1 : 0.55);
  }

  /** Debug: the party panel's current raw text (e2e-only — verifies the sidebar reflects
   *  live hp rather than a stale snapshot, e.g. crucible #10's enemy-turn refresh gap). */
  partyPanelText(): string {
    return this.panelText.text;
  }

  /** Debug: the banner's current absolute bounding box (e2e-only — crucible v1 #10: proves it
   *  clears the tier flyout's own box rather than overlapping it at a fixed screen position). */
  bannerBounds(): { top: number; bottom: number; left: number; right: number } {
    const b = this.banner.getBounds();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
  }

  // ---- tier flyout (§12.2, Rank 2+) ---------------------------------------

  /** Recomputes an action button's screen-space centre X from the same items+width math
   *  showActionMenu uses above — lets the tier flyout anchor itself above the pressed Art's
   *  button without showActionMenu needing to expose any new state. */
  getActionButtonX(items: ActionItem[], action: ActionKind): number {
    // Task 5 — gap/margin MUST mirror showActionMenu's own bw math exactly (byte-for-byte),
    // or this anchors above the wrong button once the row's width changes.
    const gap = 4;
    const bw = Math.min(148, Math.floor((W - 12 - (items.length - 1) * gap) / items.length));
    const total = items.length * bw + (items.length - 1) * gap;
    let x = W / 2 - total / 2;
    for (const item of items) {
      if (item.action === action) return x + bw / 2;
      x += bw + gap;
    }
    return W / 2;
  }

  /** Phaser-drawn (container, like showActionMenu) — NOT a DOM pane, so it never quiets the
   *  keyboard. One row per unlocked tier + an optional Overglow toggle row. */
  showTierFlyout(
    anchorX: number,
    rows: TierRow[],
    overglow: OverglowRow | null,
    onPickTier: (tier: 1 | 2 | 3) => void,
    onToggleOverglow: () => void,
  ): void {
    this.flyout.removeAll(true);
    const rowH = 28;
    const rowW = 196;
    const n = rows.length + (overglow ? 1 : 0);
    const totalH = n * rowH + 12;
    const top = -totalH - 14;

    const bg = this.scene.add.graphics();
    bg.fillStyle(P.shadowPlum, 0.97).fillRoundedRect(-rowW / 2, top, rowW, totalH, 8);
    bg.lineStyle(2, P.bark, 1).strokeRoundedRect(-rowW / 2, top, rowW, totalH, 8);
    this.flyout.add(bg);

    let y = top + 6;
    const addRow = (
      keyLabel: string,
      text: string,
      trailing: string,
      enabled: boolean,
      on: boolean,
      onClick: () => void,
      badge?: { text: string; tint: number },
    ): void => {
      const cy = y + rowH / 2;
      const row = this.scene.add.container(0, cy);
      const rbg = this.scene.add.graphics();
      const draw = (hovered: boolean): void => {
        rbg.clear();
        if (!enabled) return;
        rbg.fillStyle(on ? P.bark : hovered ? P.darkBark : P.shadowPlum, on ? 1 : 0.85)
          .fillRoundedRect(-rowW / 2 + 4, -rowH / 2 + 2, rowW - 8, rowH - 4, 5);
        if (on) rbg.lineStyle(1.5, P.lanternGold, 0.9).strokeRoundedRect(-rowW / 2 + 4, -rowH / 2 + 2, rowW - 8, rowH - 4, 5);
      };
      draw(false);
      const label = this.scene.add.text(-rowW / 2 + 10, -9, `[${keyLabel}] ${text}`, {
        fontFamily: FONT, fontSize: '11px', color: hex(enabled ? P.parchment : P.stoneGrey),
      });
      const badgeText = badge
        ? this.scene.add.text(rowW / 2 - 10, -9, badge.text, {
            fontFamily: FONT, fontSize: '9px', color: hex(badge.tint),
          }).setOrigin(1, 0)
        : null;
      const trail = this.scene.add.text(
        badgeText ? rowW / 2 - 16 - badgeText.width : rowW / 2 - 10,
        -9,
        trailing,
        {
        fontFamily: FONT, fontSize: '9px', color: hex(enabled ? P.lanternGold : P.stoneGrey),
        },
      ).setOrigin(1, 0);
      row.add([rbg, label, trail, ...(badgeText ? [badgeText] : [])]);
      if (enabled) {
        row.setInteractive(new Phaser.Geom.Rectangle(-rowW / 2, -rowH / 2, rowW, rowH), Phaser.Geom.Rectangle.Contains);
        row.on('pointerover', () => draw(true));
        row.on('pointerout', () => draw(false));
        row.on('pointerdown', onClick);
      }
      this.flyout.add(row);
      y += rowH;
    };

    for (const row of rows) {
      addRow(
        String(row.tier),
        row.label,
        row.enabled ? row.costText : (row.reason ?? row.costText),
        row.enabled,
        false,
        () => onPickTier(row.tier),
        { text: row.difficultyGlyph, tint: row.difficultyTint },
      );
    }
    if (overglow) {
      addRow('o', 'Overglow +1', overglow.enabled ? '◈1' : (overglow.reason ?? '◈1'), overglow.enabled, overglow.on, onToggleOverglow);
    }

    this.flyout.setPosition(anchorX, 502);
    this.flyout.setVisible(true);

    // crucible v1 #10 — the fixed screen-centre banner (446) overlapped this dynamically-sized,
    // differently-anchored flyout on 4 of 5 Arts (only Kindling's button sits far enough left
    // to escape it). Clear the flyout's own top edge instead of a hardcoded position — `top` is
    // negative, so 502+top is the flyout's real top edge, and this only ever moves the banner
    // UP from its default, never lower. Any banner shown while the flyout is open (the
    // "choose a tier" text itself, or a status hover-line) inherits the cleared position.
    const flyoutTopY = 502 + top;
    this.banner.setY(Math.min(BANNER_Y, flyoutTopY - 26));
  }

  hideTierFlyout(): void {
    this.flyout.setVisible(false);
    this.banner.setY(BANNER_Y);
  }

  /** Debug: the tier flyout's current absolute bounding box, if open (e2e-only — crucible v1
   *  #10; Phaser-drawn, not DOM, so a spec can't read this via a locator). */
  flyoutBounds(): { top: number; bottom: number; left: number; right: number } | null {
    if (!this.flyout.visible) return null;
    const b = this.flyout.getBounds();
    return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
  }
}

/** crucible v1 #11 — sets `label`'s text to `full`, trimming from the end with a trailing
 *  ellipsis until it fits `maxWidth` (Phaser recomputes `.width` synchronously after
 *  setText(), so this needs no render pass). A no-op when `full` already fits. */
function fitText(label: Phaser.GameObjects.Text, full: string, maxWidth: number): void {
  label.setText(full);
  if (label.width <= maxWidth) return;
  let trimmed = full;
  while (trimmed.length > 1 && label.width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
    label.setText(trimmed + '…');
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

/** A small diamond (rotated square) at (x,y) — the Glow pip glyph (§12.3). `fill:true` fills
 *  with `color`; `fill:false` strokes the outline in `color` instead (paired calls draw one pip). */
function diamond(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, color: number, fill: boolean): void {
  const pts = [{ x, y: y - r }, { x: x + r, y }, { x, y: y + r }, { x: x - r, y }];
  if (fill) g.fillStyle(color, 1).fillPoints(pts, true);
  else g.lineStyle(1, color, 1).strokePoints(pts, true);
}
