import Phaser from 'phaser';
import type { Conversation, DialogueChoice } from './types';
import { paginate } from './pagination';

/**
 * A cozy, reusable Phaser-drawn dialogue box (slice-blueprint §5). Parchment-dark
 * panel, speaker nameplate, typewriter body (skippable), multi-page text, and an
 * optional choice list (up/down + enter, or mouse). Meant to live in a UI-camera
 * container so it renders crisp at native resolution over the zoomed world.
 *
 * Usage:  await new DialogueBox(scene, uiRoot).run({ speaker, pages, choices });
 * Resolves with the chosen choice value, or undefined (no choices / ESC).
 */

// Native UI space — matches the game config resolution (Scale.FIT keeps pointer.x
// in these coordinates too, which is how mouse hit-testing stays camera-proof).
const UI_W = 960;
const UI_H = 540;
const M = 46;
const PANEL_X = M;
const PANEL_W = UI_W - M * 2;
const PANEL_H = 170;
const PANEL_Y = UI_H - PANEL_H - 26;
const PAD = 26;
const MAX_COLS = 52;
const MAX_ROWS = 3;
const CHOICE_H = 24;
const FONT = 'Georgia, "Times New Roman", serif';

// Speaker portrait (128x128 native — no Phaser scale, so nearest/linear filtering never
// matters). Shown in a bark+gold framed mat in the panel's left column when the speaker
// has one; the text/choice column shifts right and narrows to make room. `MAX_COLS_PORTRAIT`
// is MAX_COLS rescaled to the narrower wrap width, so paginate() still fits MAX_ROWS lines.
const PORTRAIT_SIZE = 128;
const PORTRAIT_MAT = 4;
const PORTRAIT_GAP = 14;
const PORTRAIT_BLOCK = PORTRAIT_SIZE + PORTRAIT_MAT * 2 + PORTRAIT_GAP;
const TEXT_X = PANEL_X + PAD;
const TEXT_X_PORTRAIT = TEXT_X + PORTRAIT_BLOCK;
const WRAP_W = PANEL_W - PAD * 2;
const WRAP_W_PORTRAIT = WRAP_W - PORTRAIT_BLOCK;
const MAX_COLS_PORTRAIT = Math.round((MAX_COLS * WRAP_W_PORTRAIT) / WRAP_W);

const CSS = {
  text: '#ebd9b2',
  name: '#fff1c6',
  hint: '#b9a986',
  choice: '#d3c19c',
  choiceOn: '#fff1c6',
};

export class DialogueBox {
  private scene: Phaser.Scene;
  private root: Phaser.GameObjects.Container;
  private panel: Phaser.GameObjects.Graphics;
  private nameplate: Phaser.GameObjects.Graphics;
  private nameText: Phaser.GameObjects.Text;
  private bodyText: Phaser.GameObjects.Text;
  private hintText: Phaser.GameObjects.Text;
  private choiceTexts: Phaser.GameObjects.Text[] = [];
  private portraitFrame: Phaser.GameObjects.Graphics;
  private portraitImage: Phaser.GameObjects.Image;

  isOpen = false;
  private pages: string[] = [];
  private pageIdx = 0;
  private choices: DialogueChoice[] = [];
  private selected = 0;
  private hasPortrait = false;
  private showingChoices = false;
  private typing = false;
  private full = '';
  private shown = 0;
  private timer?: Phaser.Time.TimerEvent;
  private resolver?: (v: string | undefined) => void;
  private openedAt = 0;

  constructor(scene: Phaser.Scene, uiParent: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.root = scene.add.container(0, 0);

    this.panel = scene.add.graphics();
    this.drawPanel();

    this.nameplate = scene.add.graphics();
    this.nameText = scene.add
      .text(PANEL_X + PAD, PANEL_Y - 16, '', { fontFamily: FONT, fontSize: '16px', color: CSS.name })
      .setOrigin(0, 0.5);

    this.bodyText = scene.add.text(PANEL_X + PAD, PANEL_Y + PAD - 4, '', {
      fontFamily: FONT,
      fontSize: '18px',
      color: CSS.text,
      lineSpacing: 7,
      wordWrap: { width: PANEL_W - PAD * 2 },
    });

    this.hintText = scene.add
      .text(PANEL_X + PANEL_W - PAD, PANEL_Y + PANEL_H - 16, '', {
        fontFamily: FONT,
        fontSize: '13px',
        color: CSS.hint,
      })
      .setOrigin(1, 0.5);

    this.portraitFrame = scene.add.graphics();
    this.drawPortraitFrame();
    this.portraitFrame.setVisible(false);
    // texture key is swapped per-run via setTexture() in run() — which does NOT
    // resize the object, so setDisplaySize() must be re-applied there too, against
    // the REAL frame each time (calling it here, against '__DEFAULT' (32x32), would
    // lock in a stale 4x scale that a later setTexture() would inherit unchanged).
    this.portraitImage = scene.add
      .image(TEXT_X + PORTRAIT_MAT, PANEL_Y + (PANEL_H - PORTRAIT_SIZE) / 2, '__DEFAULT')
      .setOrigin(0, 0)
      .setVisible(false);

    this.root.add([
      this.panel,
      this.nameplate,
      this.nameText,
      this.portraitFrame,
      this.portraitImage,
      this.bodyText,
      this.hintText,
    ]);
    this.root.setVisible(false);
    uiParent.add(this.root);

    scene.input.keyboard?.on('keydown', this.onKey, this);
    scene.input.on('pointerdown', this.onPointerDown, this);
    scene.input.on('pointermove', this.onPointerMove, this);
  }

  run(conv: Conversation, instant = false): Promise<string | undefined> {
    this.timer?.remove();

    // Portrait first — it decides the text column's x/width, so pagination and the
    // choice list below both need to know before they lay out. Absent/missing texture
    // (e.g. a speaker with no portrait, or a 404'd asset) → identical to today's layout.
    this.hasPortrait = !!(conv.portrait && this.scene.textures.exists(conv.portrait));
    this.layoutForPortrait();
    if (this.hasPortrait) {
      this.portraitImage
        .setTexture(conv.portrait!)
        .setDisplaySize(PORTRAIT_SIZE, PORTRAIT_SIZE)
        .setVisible(true);
      this.portraitFrame.setVisible(true);
    } else {
      this.portraitImage.setVisible(false);
      this.portraitFrame.setVisible(false);
    }

    this.pages = conv.pages.flatMap((p) =>
      paginate(p, this.hasPortrait ? MAX_COLS_PORTRAIT : MAX_COLS, MAX_ROWS),
    );
    if (this.pages.length === 0) this.pages = [''];
    this.choices = conv.choices ?? [];
    this.pageIdx = 0;
    this.selected = 0;
    this.buildChoiceTexts();

    if (conv.speaker) {
      this.nameText.setText(conv.speaker).setVisible(true);
      this.drawNameplate(this.nameText.width + 24);
      this.nameplate.setVisible(true);
    } else {
      this.nameText.setVisible(false);
      this.nameplate.setVisible(false);
    }

    this.root.setVisible(true);
    this.isOpen = true;
    this.openedAt = this.scene.time.now;
    this.showPage(instant);
    return new Promise((res) => (this.resolver = res));
  }

  /** Shift/narrow the text column to make room for the portrait mat (or restore full width). */
  private layoutForPortrait(): void {
    this.bodyText
      .setX(this.hasPortrait ? TEXT_X_PORTRAIT : TEXT_X)
      .setWordWrapWidth(this.hasPortrait ? WRAP_W_PORTRAIT : WRAP_W);
  }

  private showPage(instant: boolean): void {
    this.hideChoices();
    this.full = this.pages[this.pageIdx] ?? '';
    this.timer?.remove();
    this.timer = undefined;
    if (instant) {
      this.shown = this.full.length;
      this.typing = false;
      this.bodyText.setText(this.full);
      this.onPageComplete();
    } else {
      this.shown = 0;
      this.typing = true;
      this.bodyText.setText('');
      this.timer = this.scene.time.addEvent({
        delay: 14,
        loop: true,
        callback: () => {
          this.shown += 1;
          this.bodyText.setText(this.full.slice(0, this.shown));
          if (this.shown >= this.full.length) {
            this.typing = false;
            this.timer?.remove();
            this.timer = undefined;
            this.onPageComplete();
          }
        },
      });
    }
    this.updateHint();
  }

  private onPageComplete(): void {
    if (this.isLastPage() && this.choices.length) this.showChoices();
    this.updateHint();
  }

  private advance(): void {
    if (this.scene.time.now - this.openedAt < 140) return; // swallow the opening keypress
    if (this.typing) {
      this.timer?.remove();
      this.timer = undefined;
      this.typing = false;
      this.shown = this.full.length;
      this.bodyText.setText(this.full);
      this.onPageComplete();
      return;
    }
    if (!this.isLastPage()) {
      this.pageIdx += 1;
      this.showPage(false);
      return;
    }
    if (this.choices.length) {
      this.confirmChoice();
      return;
    }
    this.close(undefined);
  }

  private confirmChoice(): void {
    this.close(this.choices[this.selected]?.value);
  }

  private moveChoice(delta: number): void {
    if (!this.showingChoices) return;
    const n = this.choices.length;
    this.selected = (this.selected + delta + n) % n;
    this.restyleChoices();
  }

  private close(value: string | undefined): void {
    if (!this.isOpen) return;
    this.timer?.remove();
    this.timer = undefined;
    this.isOpen = false;
    this.showingChoices = false;
    this.root.setVisible(false);
    const r = this.resolver;
    this.resolver = undefined;
    r?.(value);
  }

  // -------------------------------------------------------------- choices layout

  private buildChoiceTexts(): void {
    for (const t of this.choiceTexts) t.destroy();
    this.choiceTexts = [];
    const startY = PANEL_Y + PANEL_H - PAD - this.choices.length * CHOICE_H + 6;
    const x = (this.hasPortrait ? TEXT_X_PORTRAIT : TEXT_X) + 6;
    this.choices.forEach((_c, i) => {
      const t = this.scene.add
        .text(x, startY + i * CHOICE_H, '', {
          fontFamily: FONT,
          fontSize: '17px',
          color: CSS.choice,
        })
        .setVisible(false);
      this.root.add(t);
      this.choiceTexts.push(t);
    });
  }

  private showChoices(): void {
    this.showingChoices = true;
    this.choiceTexts.forEach((t) => t.setVisible(true));
    this.restyleChoices();
  }

  private hideChoices(): void {
    this.showingChoices = false;
    this.choiceTexts.forEach((t) => t.setVisible(false));
  }

  private restyleChoices(): void {
    this.choiceTexts.forEach((t, i) => {
      const on = i === this.selected;
      t.setText((on ? '▶ ' : '   ') + this.choices[i].label);
      t.setColor(on ? CSS.choiceOn : CSS.choice);
    });
  }

  private choiceIndexAt(y: number): number {
    if (!this.showingChoices) return -1;
    for (let i = 0; i < this.choiceTexts.length; i++) {
      const t = this.choiceTexts[i];
      if (y >= t.y - 4 && y <= t.y + CHOICE_H - 4) return i;
    }
    return -1;
  }

  private updateHint(): void {
    if (this.showingChoices) this.hintText.setText('▲▼ choose · enter');
    else if (this.typing) this.hintText.setText('space to skip');
    else this.hintText.setText(this.isLastPage() ? 'space to close' : 'space ▸');
  }

  private isLastPage(): boolean {
    return this.pageIdx >= this.pages.length - 1;
  }

  // ------------------------------------------------------------------ rendering

  private drawPanel(): void {
    const g = this.panel;
    g.clear();
    g.fillStyle(0x2a1d13, 0.95);
    g.fillRoundedRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 10);
    g.lineStyle(2, 0xf7ce6b, 0.95);
    g.strokeRoundedRect(PANEL_X, PANEL_Y, PANEL_W, PANEL_H, 10);
    g.lineStyle(1, 0xebd9b2, 0.12);
    g.strokeRoundedRect(PANEL_X + 4, PANEL_Y + 4, PANEL_W - 8, PANEL_H - 8, 8);
  }

  private drawNameplate(w: number): void {
    const g = this.nameplate;
    const h = 26;
    const x = PANEL_X + PAD - 10;
    const y = PANEL_Y - 16 - h / 2;
    g.clear();
    g.fillStyle(0x8c5c34, 1);
    g.fillRoundedRect(x, y, w, h, 6);
    g.lineStyle(2, 0xf7ce6b, 0.95);
    g.strokeRoundedRect(x, y, w, h, 6);
  }

  /** Fixed-geometry mat + frame behind the portrait slot — same bark/gold hairline
   *  recipe as drawPanel(), drawn once (its bounds never move; only visibility toggles). */
  private drawPortraitFrame(): void {
    const g = this.portraitFrame;
    const fw = PORTRAIT_SIZE + PORTRAIT_MAT * 2;
    const fx = TEXT_X;
    const fy = PANEL_Y + (PANEL_H - fw) / 2;
    g.clear();
    g.fillStyle(0x2a1d13, 0.95).fillRoundedRect(fx, fy, fw, fw, 8);
    g.lineStyle(2, 0xf7ce6b, 0.95).strokeRoundedRect(fx, fy, fw, fw, 8);
    g.lineStyle(1, 0xebd9b2, 0.16).strokeRoundedRect(fx + 3, fy + 3, fw - 6, fw - 6, 6);
  }

  // --------------------------------------------------------------------- input

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen) return;
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.moveChoice(-1);
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.moveChoice(1);
        break;
      case 'Escape':
        this.close(undefined);
        break;
      case 'Enter':
      case 'Space':
      case 'KeyE':
        this.advance();
        break;
    }
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (!this.isOpen) return;
    const idx = this.choiceIndexAt(p.y);
    if (idx >= 0) {
      this.selected = idx;
      this.restyleChoices();
      this.confirmChoice();
      return;
    }
    this.advance();
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (!this.isOpen || !this.showingChoices) return;
    const idx = this.choiceIndexAt(p.y);
    if (idx >= 0 && idx !== this.selected) {
      this.selected = idx;
      this.restyleChoices();
    }
  }

  destroy(): void {
    this.timer?.remove();
    this.scene.input.keyboard?.off('keydown', this.onKey, this);
    this.scene.input.off('pointerdown', this.onPointerDown, this);
    this.scene.input.off('pointermove', this.onPointerMove, this);
    this.root.destroy();
  }
}
