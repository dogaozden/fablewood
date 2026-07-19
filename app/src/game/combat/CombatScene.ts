/**
 * GRID-TACTICS COMBAT (slice-blueprint §3–4). The scene is a thin driver over the
 * pure logic modules (grid/initiative/damage/boss/ai): it renders the board,
 * runs the initiative turn loop, takes player input, fires knowledge encounters
 * through `services.runEncounter` (awaiting the DOM overlay agnostically — combat
 * input pauses meanwhile), records every result to SRS (always, even on retreat),
 * and resolves back to the caller via the `combat:resolved` game event.
 *
 * Launch: scene.start('combat', CombatLaunch). Harness boot (?scene=combat&seed=n,
 * +&boss=1) builds a fantasy-generic dev fixture so combat is testable standalone.
 */
import Phaser from 'phaser';
import { markReady } from '../ready';
import {
  services, type CombatLaunch, type CombatOutcome, type EncounterResult, type EncounterKind,
} from '../contracts';
import type { Pack } from '../../packs/types';
import { getPacks } from '../../bridge/client';
import {
  GRID_W, GRID_H, CELL, ACTIONS, key, manhattan, type ActionKind, type UnitState, type Coord, type Dir,
} from './types';
import {
  buildLayout, computeMoveField, reachableTiles, pathTo, crossTiles, lineTiles,
  type Layout, type MoveField,
} from './grid';
import { buildInitiative, nextInOrder } from './initiative';
import { resolveAction } from './damage';
import { applyBranch, reduceShields, bossDefeated } from './boss';
import { decideEnemy, occupancyExcept } from './ai';
import { makeKeeper, makeMira, makeEnemy, makeBoss, MIRA_MASTERY_GATE } from './units';
import { ensureTextures, TILE_KEYS, UNIT_KEYS } from './textures';
import { CombatHud } from './hud';
import { fixtureLaunch, FIXTURE_FACTS } from './fixtures';
import { P } from './palette';
import { music } from '../../music/instance';

const ORIGIN = { x: (960 - GRID_W * CELL) / 2, y: 48 }; // 192, 48 → grid spans y 48..432

type Phase = 'boot' | 'playerMove' | 'playerTarget' | 'resolving' | 'enemy' | 'over';

interface UnitView {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  hp: Phaser.GameObjects.Graphics;
}

export class CombatScene extends Phaser.Scene {
  private launch!: CombatLaunch;
  private layout!: Layout;
  private hud!: CombatHud;

  private units: UnitState[] = [];
  private views = new Map<string, UnitView>();
  private order: string[] = [];
  private orderIndex = -1;

  private state: Phase = 'boot';
  private moved = false;
  private activeId = '';
  private moveField: MoveField | null = null;
  private reachable = new Map<string, Coord>();
  private targetTiles = new Map<string, UnitState>();
  private pendingAction: ActionKind | null = null;

  private rangeGfx!: Phaser.GameObjects.Graphics;
  private hoverGfx!: Phaser.GameObjects.Graphics;

  private results: EncounterResult[] = [];
  private hpLost = 0;
  private graceAvailable = true;
  private encSeed = 0;
  private destroyed = false;
  private demo = false; // ?demo=1 → autopilot the party (screenshots + e2e)

  // content resolution
  private allFactIds = new Set<string>();
  private tagToIds = new Map<string, string[]>();
  private roomTags: string[] = [];

  // boss
  private boss: UnitState | null = null;
  private shields = 0;
  private phaseIndex = 0;
  private pendingBossPhase = false;

  constructor() {
    super('combat');
  }

  init(data: (CombatLaunch & { seed?: number }) | { seed?: number }): void {
    const params = new URLSearchParams(window.location.search);
    this.demo = params.get('demo') === '1';
    if (data && 'room' in data && data.room) {
      this.launch = data as CombatLaunch;
    } else {
      const seed = (data && 'seed' in data && typeof data.seed === 'number') ? data.seed : 1;
      this.launch = fixtureLaunch(seed, params.get('boss') === '1');
    }
  }

  create(): void {
    this.destroyed = false;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.destroyed = true; });

    this.encSeed = this.launch.seed | 0;
    this.drawBackdrop();
    ensureTextures(this);
    this.layout = buildLayout(this.launch.room.id, this.launch.seed);
    this.renderGrid();

    this.rangeGfx = this.add.graphics().setDepth(4);
    this.hoverGfx = this.add.graphics().setDepth(5);

    this.spawnUnits();
    this.order = buildInitiative(this.units);
    for (const u of this.units) this.makeUnitView(u);

    this.hud = new CombatHud(this, this.launch.room.name);
    this.hud.setTurnOrder(this.units.map((u) => ({ id: u.id, kind: u.kind, team: u.team })));
    this.refreshParty();

    this.roomTags = [...new Set((this.launch.room.enemies ?? []).flatMap((e) => e.tags ?? []))];
    if (this.launch.room.boss) {
      this.shields = this.launch.room.boss.shields;
      this.pendingBossPhase = true;
    }

    this.wireInput();

    // Battle leitmotif (fire-and-forget; the shell handles gesture-resume + mute).
    try { music.play('battle'); } catch { /* audio context may be locked pre-gesture */ }

    // markReady MUST fire at the end of create() or shots/e2e hang.
    markReady({ scene: 'combat', title: 'FABLEWOOD', seed: this.launch.seed });

    // Load content (packs → fact ids) then start the loop, so create() has already
    // returned and __FABLEWOOD_READY is set before any encounter overlay opens.
    this.loadContent().then(() => {
      if (this.destroyed) return;
      this.applyPoolHp(); // split the saved pooled HP onto Keeper/Mira (save is ready now)
      this.refreshParty();
      this.time.delayedCall(320, () => this.advanceTurn());
    });
  }

  // ---- setup ------------------------------------------------------------

  private drawBackdrop(): void {
    this.cameras.main.setBackgroundColor('#1b1526');
    const g = this.add.graphics().setDepth(-10);
    g.fillGradientStyle(P.duskDeep, P.duskDeep, P.shadowPlum, P.shadowPlum, 1);
    g.fillRect(0, 0, 960, 540);
    // soft warm vignette top-left (the lantern key) + cool corners
    g.fillStyle(P.duskViolet, 0.12).fillCircle(300, 140, 260);
    g.fillStyle(P.voidBlack, 0.35).fillRect(0, 500, 960, 40);
  }

  private renderGrid(): void {
    for (let r = 0; r < GRID_H; r++) {
      for (let c = 0; c < GRID_W; c++) {
        const t = this.layout.tiles[r][c];
        const p = this.tileToScreen({ c, r });
        const img = this.add.image(p.x, p.y, TILE_KEYS[t]).setDepth(0);
        img.setScale(CELL / img.frame.realWidth); // placeholder 48px→×1, 16-native art→×3
      }
    }
  }

  private spawnUnits(): void {
    const ps = this.layout.partySpawns;
    const es = this.layout.enemySpawns;
    const keeper = makeKeeper(ps[0]?.c ?? 1, ps[0]?.r ?? 3);
    const mira = makeMira(ps[1]?.c ?? 1, ps[1]?.r ?? 4);
    this.units.push(keeper, mira);

    const enemies = this.launch.room.enemies ?? [];
    enemies.forEach((spec, i) => {
      const at = es[i % es.length] ?? { c: GRID_W - 2, r: 2 + i };
      this.units.push(makeEnemy(spec, i, at.c, at.r));
    });

    if (this.launch.room.boss) {
      const at = es[enemies.length % Math.max(es.length, 1)] ?? { c: GRID_W - 2, r: 3 };
      this.boss = makeBoss(this.launch.room.boss, at.c, at.r);
      this.units.push(this.boss);
    }
  }

  /**
   * The save holds ONE pooled party HP (max 16 = Keeper 10 + Mira 6). Split it
   * proportionally onto the units on launch; the camp heals the pool back to 16.
   * hpLost (the pooled delta) is reported in CombatOutcome for the dungeon/camp.
   */
  private applyPoolHp(): void {
    let pool = 16;
    try { pool = services.save.get()?.hp ?? 16; } catch { /* offline → full */ }
    pool = Math.max(0, Math.min(16, pool));
    const keeper = this.unitById('keeper');
    const mira = this.unitById('mira');
    if (keeper) { keeper.hp = pool > 0 ? Math.max(1, Math.min(10, Math.ceil((pool * 10) / 16))) : 0; keeper.alive = keeper.hp > 0; this.drawHpBar(keeper); }
    if (mira) { mira.hp = pool > 0 ? Math.max(1, Math.min(6, Math.floor((pool * 6) / 16))) : 0; mira.alive = mira.hp > 0; this.drawHpBar(mira); }
  }

  private makeUnitView(u: UnitState): void {
    const p = this.tileToScreen(u);
    const container = this.add.container(p.x, p.y).setDepth(10 + u.r);
    const shadow = this.add.ellipse(0, CELL / 2 - 5, CELL * 0.6, 10, P.voidBlack, 0.35);
    // Origin bottom-centre, feet at the cell's bottom edge, so taller real sprites
    // (16×24 / up to 24×32 native, baked at 3×) overhang UPWARD — the tactics look.
    // displayScale = CELL / frame width: 48px placeholder bakes → ×1, 16-native art → ×3.
    const sprite = this.add.sprite(0, CELL / 2 - 4, UNIT_KEYS[u.kind]).setOrigin(0.5, 1);
    sprite.setScale(CELL / sprite.frame.realWidth);
    sprite.setFlipX(u.team === 'enemy');
    // Play the shipped 2-frame idle (gentle breathe/flicker) when real art registered
    // one; placeholder bakes have no anim, so the guard leaves them as static poses.
    const idleAnim = UNIT_KEYS[u.kind] + '.idle';
    if (this.anims.exists(idleAnim)) sprite.play(idleAnim);
    const hp = this.add.graphics();
    container.add([shadow, sprite, hp]);
    this.views.set(u.id, { container, sprite, hp });
    this.drawHpBar(u);
  }

  private drawHpBar(u: UnitState): void {
    const v = this.views.get(u.id);
    if (!v) return;
    const g = v.hp;
    g.clear();
    const w = 38;
    // Float the bar just above the sprite's displayed top (origin bottom-centre),
    // so it clears any sprite height (placeholder 48px or taller real art).
    const y = Math.round(v.sprite.y - v.sprite.displayHeight - 6);
    // boss shield pips, centred above the hp bar
    if (u.isBoss && u.maxShields) {
      for (let i = 0; i < u.maxShields; i++) {
        const filled = i < this.shields;
        const px = (i - (u.maxShields - 1) / 2) * 13;
        const py = y - 12;
        g.lineStyle(1.5, P.outline, 1).fillStyle(filled ? P.waterLight : P.shadowPlum, 1).fillCircle(px, py, 5.5);
        g.strokeCircle(px, py, 5.5);
        if (filled) g.fillStyle(P.glowCore, 0.9).fillCircle(px - 1.5, py - 1.5, 2);
      }
    }
    g.fillStyle(P.shadowPlum, 0.9).fillRect(-w / 2, y, w, 5);
    const frac = Math.max(0, u.hp) / u.maxHp;
    const col = u.team === 'party' ? P.moss : P.berry;
    g.fillStyle(col, 1).fillRect(-w / 2, y, w * frac, 5);
    g.lineStyle(1, P.outline, 1).strokeRect(-w / 2, y, w, 5);
  }

  private tileToScreen(co: Coord): { x: number; y: number } {
    return { x: ORIGIN.x + co.c * CELL + CELL / 2, y: ORIGIN.y + co.r * CELL + CELL / 2 };
  }

  private screenToTile(x: number, y: number): Coord | null {
    const c = Math.floor((x - ORIGIN.x) / CELL);
    const r = Math.floor((y - ORIGIN.y) / CELL);
    if (c < 0 || c >= GRID_W || r < 0 || r >= GRID_H) return null;
    return { c, r };
  }

  private async loadContent(): Promise<void> {
    try { await services.srs.ready(); } catch { /* stub or offline */ }
    try { await services.save.ready(); } catch { /* stub or offline */ }
    try {
      const { packs } = await getPacks();
      const entry = packs.find((pk) => pk.id === this.launch.packId);
      if (entry) {
        const pack = entry.pack as Pack;
        for (const f of pack.facts ?? []) {
          this.allFactIds.add(f.id);
          for (const t of f.tags ?? []) {
            const arr = this.tagToIds.get(t) ?? [];
            arr.push(f.id);
            this.tagToIds.set(t, arr);
          }
        }
      }
    } catch { /* static build has no bridge */ }
    if (this.allFactIds.size === 0) for (const id of FIXTURE_FACTS) this.allFactIds.add(id);
  }

  // ---- turn loop --------------------------------------------------------

  private advanceTurn(): void {
    if (this.destroyed || this.state === 'over') return;
    const end = this.checkEnd();
    if (end) { this.resolveBattle(end); return; }

    if (this.boss && this.pendingBossPhase && this.boss.alive && this.phaseIndex < (this.launch.room.boss?.phases.length ?? 0)) {
      this.pendingBossPhase = false;
      void this.openBossPhase(this.phaseIndex);
      return;
    }

    const nxt = nextInOrder(this.order, this.orderIndex, (id) => this.isAlive(id));
    if (!nxt) { this.resolveBattle(this.checkEnd() ?? 'victory'); return; }
    this.orderIndex = nxt.index;
    const unit = this.unitById(nxt.id)!;
    this.activeId = unit.id;
    this.hud.setActive(unit.id, this.aliveIds());
    this.focusCue(unit);

    if (unit.skipNextTurn) {
      unit.skipNextTurn = false;
      this.hud.showBanner(`${unit.name} is staggered — it loses its turn.`, P.duskPeach);
      this.time.delayedCall(650, () => this.advanceTurn());
      return;
    }
    if (unit.team === 'party') this.beginPlayerTurn(unit);
    else this.time.delayedCall(320, () => this.runEnemyTurn(unit));
  }

  private focusCue(unit: UnitState): void {
    const v = this.views.get(unit.id);
    if (!v) return;
    // small hop from the rest anchor (bottom-centre at CELL/2 - 4)
    this.tweens.add({ targets: v.sprite, y: CELL / 2 - 10, duration: 220, yoyo: true, ease: 'Sine.easeInOut' });
  }

  // ---- player turn ------------------------------------------------------

  private beginPlayerTurn(unit: UnitState): void {
    this.state = 'playerMove';
    this.moved = false;
    this.pendingAction = null;
    this.moveField = computeMoveField(unit, unit.move, this.layout.tiles, this.blockedFor(unit.id));
    this.reachable.clear();
    for (const t of reachableTiles(this.moveField, unit)) this.reachable.set(key(t.c, t.r), t);
    this.drawMoveRange();
    this.showMenu(unit);
    this.hud.showBanner(`${unit.name}'s turn — move, then act.`, P.parchment);
    if (this.demo) this.time.delayedCall(520, () => this.autoStep(unit));
  }

  /** Dev autopilot (?demo=1): act if a target is in range, else close in, else wait. */
  private autoStep(unit: UnitState): void {
    if (this.destroyed || this.state === 'over' || unit.id !== this.activeId) return;
    for (const a of ['cast', 'sequence', 'weave', 'strike', 'parley'] as ActionKind[]) {
      const targets = this.validTargets(unit, a);
      if (targets.length) {
        const tgt = targets.sort((x, y) => manhattan(unit, x) - manhattan(unit, y))[0];
        this.state = 'playerTarget';
        this.pendingAction = a;
        void this.runPlayerAction(unit, a, { c: tgt.c, r: tgt.r });
        return;
      }
    }
    const enemies = this.units.filter((u) => u.alive && u.team === 'enemy');
    if (enemies.length && !this.moved && this.moveField) {
      const near = enemies.reduce((b, e) => (manhattan(unit, e) < manhattan(unit, b) ? e : b), enemies[0]);
      let best: Coord | null = null;
      let bestD = manhattan(unit, near);
      for (const co of this.reachable.values()) {
        const d = manhattan(co, near);
        if (d < bestD) { bestD = d; best = co; }
      }
      if (best) { this.movePlayerTo(unit, best); return; }
    }
    this.hud.showBanner('Holding position.', P.stoneGrey);
    this.endPlayerTurn();
  }

  private showMenu(unit: UnitState): void {
    const items = (Object.keys(ACTIONS) as ActionKind[]).map((action) => {
      if (action === 'wait') return { action, enabled: true };
      const targets = this.validTargets(unit, action);
      return { action, enabled: targets.length > 0, reason: targets.length ? undefined : 'no target in range' };
    });
    this.hud.showActionMenu(items, (a) => this.onPickAction(unit, a));
  }

  private onPickAction(unit: UnitState, action: ActionKind): void {
    if (this.state !== 'playerMove' && this.state !== 'playerTarget') return;
    if (unit.id !== this.activeId) return;
    if (action === 'wait') { this.hud.showBanner('Holding position.', P.stoneGrey); this.endPlayerTurn(); return; }
    const targets = this.validTargets(unit, action);
    if (!targets.length) { this.hud.showBanner(`${ACTIONS[action].label}: no target in range.`, P.stoneGrey); return; }
    this.enterTargeting(action, targets);
  }

  private enterTargeting(action: ActionKind, targets: UnitState[]): void {
    this.state = 'playerTarget';
    this.pendingAction = action;
    this.targetTiles.clear();
    for (const t of targets) this.targetTiles.set(key(t.c, t.r), t);
    this.rangeGfx.clear();
    this.hoverGfx.clear();
    this.drawTargets();
    this.hud.hideActionMenu();
    this.hud.showBanner(`${ACTIONS[action].label} — choose a target. (Esc cancels)`, ACTIONS[action].tint);
  }

  private cancelTargeting(unit: UnitState): void {
    this.state = 'playerMove';
    this.pendingAction = null;
    this.targetTiles.clear();
    this.hoverGfx.clear();
    if (!this.moved) this.drawMoveRange();
    this.showMenu(unit);
  }

  private validTargets(unit: UnitState, action: ActionKind): UnitState[] {
    const enemies = this.units.filter((u) => u.alive && u.team === 'enemy');
    switch (action) {
      case 'strike': return enemies.filter((e) => manhattan(unit, e) <= 1);
      case 'weave': return enemies.filter((e) => manhattan(unit, e) <= 2);
      case 'cast': return enemies.filter((e) => manhattan(unit, e) <= 3);
      case 'parley': return enemies.filter((e) => e.parley && manhattan(unit, e) <= 1);
      case 'sequence':
        return enemies.filter((e) => (e.c === unit.c || e.r === unit.r) && manhattan(unit, e) <= 3);
      default: return [];
    }
  }

  private movePlayerTo(unit: UnitState, tile: Coord): void {
    if (this.moved || !this.moveField) return;
    const path = pathTo(this.moveField, tile);
    if (!path || path.length < 2) return;
    this.moved = true;
    this.state = 'resolving';
    this.rangeGfx.clear();
    this.hoverGfx.clear();
    this.hud.hideActionMenu();
    if (tile.c < unit.c) this.views.get(unit.id)!.sprite.setFlipX(true);
    else if (tile.c > unit.c) this.views.get(unit.id)!.sprite.setFlipX(false);
    unit.c = tile.c; unit.r = tile.r;
    this.tweenAlongPath(unit, path, () => {
      if (this.destroyed) return;
      this.state = 'playerMove';
      this.showMenu(unit);
      this.hud.showBanner('Moved. Choose an action.', P.parchment);
      if (this.demo) this.time.delayedCall(340, () => this.autoStep(unit));
    });
  }

  private tweenAlongPath(unit: UnitState, path: Coord[], onDone: () => void): void {
    const v = this.views.get(unit.id)!;
    const steps = path.slice(1).map((co) => {
      const s = this.tileToScreen(co);
      return { x: s.x, y: s.y, duration: 150, ease: 'Linear' };
    });
    v.container.setDepth(10 + unit.r);
    this.tweens.chain({ targets: v.container, tweens: steps, onComplete: onDone });
  }

  // ---- resolving a player action ---------------------------------------

  private async runPlayerAction(unit: UnitState, action: ActionKind, tile: Coord): Promise<void> {
    this.state = 'resolving';
    this.rangeGfx.clear();
    this.hoverGfx.clear();
    this.hud.hideActionMenu();

    const meta = ACTIONS[action];
    const kind = meta.encounter as EncounterKind;
    const target = this.enemyAt(tile);
    const vsBoss = !!target?.isBoss;
    const isBossCast = action === 'cast' && vsBoss;
    const tags = isBossCast ? this.launch.room.boss?.phases[this.phaseIndex]?.recallTags : this.roomTags;
    const factIds = this.dueFactIds(tags);
    const context = action === 'parley' ? 'parley' : vsBoss ? 'boss' : 'combat';

    if (action === 'cast') this.hud.setDeliberating(true);
    let result: EncounterResult;
    try {
      result = await services.runEncounter({ context, kinds: [kind], factIds, packId: this.launch.packId, seed: this.encSeed++ });
    } catch {
      result = { encounterId: `local-${action}`, kind, factIds: factIds.slice(0, 1), quality: 0.5, detail: 'offline' };
    }
    // Record FIRST — the learning record is sacred: never dropped, even if the
    // scene tears down mid-overlay (record() is pure service work, safe when dead).
    this.results.push(result);
    await this.record(result);
    if (this.destroyed) return;
    this.hud.setDeliberating(false);

    // Lantern grace: standing on a lantern can soften a whiff for DAMAGE only —
    // the SRS record stays honest (we record result.quality, above).
    let dmgQuality = result.quality;
    if (dmgQuality === 0 && this.graceAvailable && this.tileTypeOf(unit) === 'lantern') {
      dmgQuality = 0.5;
      this.graceAvailable = false;
      this.hud.showBanner('The lantern steadies you — the miss becomes a graze.', P.lanternGold);
    }

    const miraBonus = unit.id === 'mira' && this.miraBonusActive() ? 1 : 0;
    const outcome = resolveAction(action, dmgQuality, { miraBonus, vsBoss, branchTag: result.branchTag });
    this.applyOutcome(unit, action, tile, outcome, target);
    this.hud.showBanner(outcome.banner, outcome.hits > 0 || outcome.weaken ? ACTIONS[action].tint : P.duskRose);

    if (isBossCast) {
      this.phaseIndex += 1;
      this.pendingBossPhase = this.phaseIndex < (this.launch.room.boss?.phases.length ?? 0);
    }

    this.refreshParty();
    this.time.delayedCall(620, () => this.endPlayerTurn());
  }

  private applyOutcome(actor: UnitState, action: ActionKind, tile: Coord, o: ReturnType<typeof resolveAction>, target: UnitState | null): void {
    if (action === 'strike' || action === 'cast') {
      if (target && o.hits > 0) this.damageUnit(target, o.hits, ACTIONS[action].tint);
      if (o.extraShield && target?.isBoss) { this.shields = reduceShields(this.shields, -o.extraShield); this.floatText(target, '−shield', P.waterLight); this.syncBoss(); }
      if (o.fade > 0) this.damageParty(o.fade, actor);
    } else if (action === 'weave') {
      if (target && o.hits > 0) this.damageUnit(target, o.hits, ACTIONS.weave.tint);
      if (o.aoeHit > 0) {
        for (const co of crossTiles(tile)) {
          if (co.c === tile.c && co.r === tile.r) continue;
          const e = this.enemyAt(co);
          if (e) this.damageUnit(e, o.aoeHit, ACTIONS.weave.tint);
        }
      }
    } else if (action === 'sequence') {
      const dir = this.dirTo(actor, tile);
      if (dir) {
        lineTiles(actor, dir, o.lineDepth).forEach((co, i) => {
          const e = this.enemyAt(co);
          if (e) this.damageUnit(e, i === 0 ? o.hits : o.aoeHit, ACTIONS.sequence.tint);
        });
      }
    } else if (action === 'parley') {
      if (o.weaken && target) { target.skipNextTurn = true; target.attack = Math.max(0, target.attack - 1); this.floatText(target, 'weakened', P.blossom); }
      if (o.partyHit > 0) this.damageParty(o.partyHit, actor);
    }
    if (o.selfChip > 0) this.damageUnit(actor, o.selfChip, P.berry);
  }

  private endPlayerTurn(): void {
    if (this.destroyed) return;
    this.state = 'resolving';
    this.hud.hideActionMenu();
    const end = this.checkEnd();
    if (end) { this.resolveBattle(end); return; }
    this.advanceTurn();
  }

  // ---- boss phase -------------------------------------------------------

  private async openBossPhase(i: number): Promise<void> {
    if (!this.boss || this.destroyed) return;
    this.state = 'resolving';
    const phase = this.launch.room.boss!.phases[i];
    this.hud.showBanner('The Warden proposes his terms…', P.berry);
    let result: EncounterResult;
    try {
      result = await services.runEncounter({
        context: 'boss', kinds: ['scenario_branch'], encounterId: phase.branchEncounterId,
        factIds: this.dueFactIds(phase.recallTags), packId: this.launch.packId, seed: this.encSeed++,
      });
    } catch {
      result = { encounterId: phase.branchEncounterId, kind: 'scenario_branch', factIds: [], quality: 0.5, branchTag: 'neutral' };
    }
    // Record FIRST — the learning record is sacred (see runPlayerAction).
    this.results.push(result);
    await this.record(result);
    if (this.destroyed) return;

    const eff = applyBranch(result.branchTag);
    if (eff.shieldDelta) { this.shields = reduceShields(this.shields, eff.shieldDelta); }
    if (eff.wardenHeal) { this.boss.hp = Math.min(this.boss.maxHp, this.boss.hp + eff.wardenHeal); this.floatText(this.boss, `+${eff.wardenHeal}`, P.moss); }
    if (eff.stagger) this.boss.skipNextTurn = true;
    if (eff.partyDelta < 0) this.damageParty(-eff.partyDelta);
    this.drawHpBar(this.boss);
    this.syncBoss();
    this.hud.showBanner(eff.banner, eff.shieldDelta < 0 ? P.waterLight : P.berry);
    this.refreshParty();

    this.time.delayedCall(900, () => {
      if (this.destroyed) return;
      const end = this.checkEnd();
      if (end) this.resolveBattle(end);
      else this.advanceTurn();
    });
  }

  private syncBoss(): void {
    if (this.boss && this.shields <= 0 && this.boss.alive) {
      // shields gone: the vault opens even if the Warden still stands
      this.boss.alive = false;
      this.fadeDead(this.boss);
    }
    if (this.boss) this.drawHpBar(this.boss);
  }

  // ---- enemy turn -------------------------------------------------------

  private runEnemyTurn(unit: UnitState): void {
    if (this.destroyed) return;
    if (!unit.alive) { this.advanceTurn(); return; }
    this.state = 'enemy';
    const party = this.units.filter((u) => u.team === 'party');
    const intent = decideEnemy(unit, party, this.layout.tiles, occupancyExcept(this.units, unit.id));

    const doAttack = () => {
      if (this.destroyed) return;
      if (intent.attackTargetId) {
        const tgt = this.unitById(intent.attackTargetId);
        if (tgt && tgt.alive) this.enemyStrike(unit, tgt);
      }
      this.time.delayedCall(460, () => this.advanceTurn());
    };

    if (intent.moveTo) {
      const field = computeMoveField(unit, unit.move, this.layout.tiles, this.blockedFor(unit.id));
      const path = pathTo(field, intent.moveTo);
      const v = this.views.get(unit.id)!;
      if (intent.moveTo.c < unit.c) v.sprite.setFlipX(false);
      else if (intent.moveTo.c > unit.c) v.sprite.setFlipX(true);
      unit.c = intent.moveTo.c; unit.r = intent.moveTo.r;
      if (path && path.length >= 2) this.tweenAlongPath(unit, path, doAttack);
      else doAttack();
    } else {
      this.time.delayedCall(200, doAttack);
    }
  }

  private enemyStrike(attacker: UnitState, target: UnitState): void {
    if (this.destroyed) return;
    if (attacker.ranged) {
      const line = this.add.graphics().setDepth(39);
      const a = this.tileToScreen(attacker); const b = this.tileToScreen(target);
      line.lineStyle(3, P.waterLight, 0.9).lineBetween(a.x, a.y, b.x, b.y);
      this.tweens.add({ targets: line, alpha: 0, duration: 320, onComplete: () => line.destroy() });
    } else {
      const v = this.views.get(attacker.id)!;
      const dx = Math.sign(target.c - attacker.c) * 8;
      const dy = Math.sign(target.r - attacker.r) * 8;
      this.tweens.add({ targets: v.container, x: v.container.x + dx, y: v.container.y + dy, duration: 90, yoyo: true });
    }
    this.damageUnit(target, attacker.attack, P.berry);
    this.hud.showBanner(`${attacker.name} strikes ${target.name} (−${attacker.attack}).`, P.berry);
  }

  // ---- damage / death ---------------------------------------------------

  private damageUnit(unit: UnitState, amount: number, color: number): void {
    if (this.destroyed || amount <= 0 || !unit.alive) return;
    const before = unit.hp;
    unit.hp = Math.max(0, unit.hp - amount);
    if (unit.team === 'party') this.hpLost += before - unit.hp; // actual loss = pooled delta
    this.floatText(unit, `−${amount}`, color);
    this.cameras.main.shake(90, 0.004);
    if (unit.hp <= 0) { unit.alive = false; this.fadeDead(unit); }
    this.drawHpBar(unit);
  }

  private damageParty(amount: number, prefer?: UnitState): void {
    const living = this.units.filter((u) => u.team === 'party' && u.alive);
    if (!living.length) return;
    const target = (prefer && prefer.alive && prefer.team === 'party')
      ? prefer
      : living.sort((a, b) => b.hp - a.hp)[0];
    this.damageUnit(target, amount, P.berry);
  }

  private fadeDead(unit: UnitState): void {
    if (this.destroyed) return;
    const v = this.views.get(unit.id);
    if (!v) return;
    this.tweens.add({ targets: v.container, alpha: 0.18, scaleX: 0.8, scaleY: 0.8, angle: unit.team === 'enemy' ? 12 : -8, duration: 340 });
    this.hud.setActive(this.activeId, this.aliveIds());
  }

  private floatText(unit: UnitState, text: string, color: number): void {
    if (this.destroyed) return;
    const p = this.tileToScreen(unit);
    const t = this.add.text(p.x, p.y - 16, text, {
      fontFamily: 'Georgia, serif', fontSize: '16px', color: '#' + color.toString(16).padStart(6, '0'), fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(40).setShadow(0, 2, '#1b1526', 3);
    this.tweens.add({ targets: t, y: p.y - 42, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  // ---- overlays / input -------------------------------------------------

  private drawMoveRange(): void {
    this.rangeGfx.clear();
    this.rangeGfx.fillStyle(P.moss, 0.18);
    this.rangeGfx.lineStyle(1, P.leafHi, 0.5);
    for (const co of this.reachable.values()) {
      const p = this.tileToScreen(co);
      this.rangeGfx.fillRect(p.x - CELL / 2 + 2, p.y - CELL / 2 + 2, CELL - 4, CELL - 4);
      this.rangeGfx.strokeRect(p.x - CELL / 2 + 2, p.y - CELL / 2 + 2, CELL - 4, CELL - 4);
    }
  }

  private drawTargets(): void {
    this.hoverGfx.clear();
    for (const t of this.targetTiles.values()) {
      const p = this.tileToScreen(t);
      this.hoverGfx.lineStyle(2, P.berry, 0.9).strokeRect(p.x - CELL / 2 + 3, p.y - CELL / 2 + 3, CELL - 6, CELL - 6);
      this.hoverGfx.fillStyle(P.berry, 0.14).fillRect(p.x - CELL / 2 + 3, p.y - CELL / 2 + 3, CELL - 6, CELL - 6);
    }
  }

  private previewAoe(unit: UnitState, tile: Coord): void {
    if (!this.pendingAction) return;
    this.drawTargets();
    const mark = (co: Coord, col: number) => {
      const p = this.tileToScreen(co);
      this.hoverGfx.fillStyle(col, 0.3).fillRect(p.x - CELL / 2 + 4, p.y - CELL / 2 + 4, CELL - 8, CELL - 8);
    };
    if (this.pendingAction === 'weave') for (const co of crossTiles(tile)) mark(co, P.orchid);
    else if (this.pendingAction === 'sequence') {
      const dir = this.dirTo(unit, tile);
      if (dir) for (const co of lineTiles(unit, dir, 3)) mark(co, P.waterBlue);
    } else mark(tile, ACTIONS[this.pendingAction].tint);
  }

  private wireInput(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pt: Phaser.Input.Pointer) => {
      const unit = this.unitById(this.activeId);
      if (!unit || unit.team !== 'party') return;
      const tile = this.screenToTile(pt.x, pt.y);
      if (!tile) return;
      if (this.state === 'playerMove' && !this.moved && this.reachable.has(key(tile.c, tile.r))) {
        this.movePlayerTo(unit, tile);
      } else if (this.state === 'playerTarget' && this.pendingAction) {
        if (pt.rightButtonDown()) { this.cancelTargeting(unit); return; }
        if (this.targetTiles.has(key(tile.c, tile.r))) {
          const action = this.pendingAction;
          void this.runPlayerAction(unit, action, tile);
        }
      }
    });

    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pt: Phaser.Input.Pointer) => {
      const unit = this.unitById(this.activeId);
      if (!unit || unit.team !== 'party') return;
      const tile = this.screenToTile(pt.x, pt.y);
      if (!tile) { this.hoverGfx.clear(); if (this.state === 'playerTarget') this.drawTargets(); return; }
      if (this.state === 'playerMove' && !this.moved && this.moveField) {
        this.hoverGfx.clear();
        if (this.reachable.has(key(tile.c, tile.r))) {
          const path = pathTo(this.moveField, tile);
          if (path) {
            this.hoverGfx.fillStyle(P.lanternGold, 0.85);
            for (const co of path.slice(1)) { const p = this.tileToScreen(co); this.hoverGfx.fillCircle(p.x, p.y, 4); }
          }
        }
      } else if (this.state === 'playerTarget') {
        if (this.targetTiles.has(key(tile.c, tile.r))) this.previewAoe(unit, tile);
        else this.drawTargets();
      }
    });

    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      const unit = this.unitById(this.activeId);
      if (!unit || unit.team !== 'party') return;
      if (e.key === 'Escape' && this.state === 'playerTarget') { this.cancelTargeting(unit); return; }
      if (this.state !== 'playerMove' && this.state !== 'playerTarget') return;
      const action = (Object.keys(ACTIONS) as ActionKind[]).find((a) => ACTIONS[a].hotkey === e.key);
      if (action) this.onPickAction(unit, action);
    });
  }

  // ---- content resolution ----------------------------------------------

  private dueFactIds(tags?: string[]): string[] {
    const cand = new Set<string>();
    for (const t of tags ?? []) {
      if (this.allFactIds.has(t)) cand.add(t);
      for (const id of this.tagToIds.get(t) ?? []) cand.add(id);
    }
    if (cand.size === 0) for (const id of this.allFactIds) cand.add(id);
    const arr = [...cand];
    try {
      const due = services.srs.dueQueue(this.launch.packId, arr);
      return due.length ? due : arr;
    } catch { return arr; }
  }

  private miraBonusActive(): boolean {
    try { return services.srs.masteryAvg([...this.allFactIds]) >= MIRA_MASTERY_GATE; }
    catch { return false; }
  }

  private async record(result: EncounterResult): Promise<void> {
    try {
      await Promise.all(result.factIds.map((id) => services.srs.record(id, result.quality, result.encounterId)));
    } catch { /* recording is best-effort; combat proceeds */ }
  }

  // ---- outcome ----------------------------------------------------------

  private checkEnd(): 'victory' | 'retreat' | null {
    if (!this.units.some((u) => u.team === 'party' && u.alive)) return 'retreat';
    if (this.boss) return bossDefeated(this.shields, this.boss.hp) ? 'victory' : null;
    return this.units.some((u) => u.team === 'enemy' && u.alive) ? null : 'victory';
  }

  private resolveBattle(outcome: 'victory' | 'retreat'): void {
    if (this.state === 'over') return;
    this.state = 'over';
    this.hud.hideActionMenu();
    this.rangeGfx.clear();
    this.hoverGfx.clear();

    if (outcome === 'victory') {
      this.hud.showToast('The vault opens — Victory!', P.lanternGold);
      this.hud.showBanner('Loot secured. Streak climbs.', P.moss);
      void this.bumpStreak();
      this.cameras.main.flash(280, 247, 206, 107);
    } else {
      this.hud.showToast('The Fade closes in…', P.duskRose);
      this.hud.showBanner('You wake at the hamlet camp — progress kept, loot forfeit.', P.duskRose);
      this.cameras.main.flash(280, 90, 40, 60);
    }

    const payload: CombatOutcome = { outcome, hpLost: this.hpLost, results: this.results };
    // Fire the event now (listeners registered before launch catch it) AND hand the
    // outcome to the return scene's init data (listeners registered on resume catch it).
    this.game.events.emit('combat:resolved', payload);

    this.time.delayedCall(1600, () => {
      if (this.destroyed) return;
      const back = this.launch.returnScene;
      if (back && this.scene.get(back)) this.scene.start(back, { seed: this.launch.seed, combatOutcome: payload });
    });
  }

  private async bumpStreak(): Promise<void> {
    try {
      const cur = services.save.get();
      await services.save.save({ streak: (cur?.streak ?? 0) + 1 });
      this.refreshParty();
    } catch { /* no save bridge offline */ }
  }

  // ---- small helpers ----------------------------------------------------

  private refreshParty(): void {
    const keeper = this.unitById('keeper');
    const mira = this.unitById('mira');
    let streak = 0;
    try { streak = services.save.get()?.streak ?? 0; } catch { /* offline */ }
    this.hud.updateParty(keeper, mira, {
      graceAvailable: this.graceAvailable,
      miraBonusActive: this.miraBonusActive(),
      streak,
    });
  }

  private blockedFor(id: string): Set<string> {
    return occupancyExcept(this.units, id);
  }

  private enemyAt(co: Coord): UnitState | null {
    return this.units.find((u) => u.alive && u.team === 'enemy' && u.c === co.c && u.r === co.r) ?? null;
  }

  private tileTypeOf(co: Coord) {
    return this.layout.tiles[co.r]?.[co.c];
  }

  private dirTo(a: Coord, b: Coord): Dir | null {
    if (a.c === b.c) return b.r < a.r ? 'up' : 'down';
    if (a.r === b.r) return b.c < a.c ? 'left' : 'right';
    return null;
  }

  private unitById(id: string): UnitState | undefined { return this.units.find((u) => u.id === id); }
  private isAlive(id: string): boolean { return this.unitById(id)?.alive ?? false; }
  private aliveIds(): Set<string> { return new Set(this.units.filter((u) => u.alive).map((u) => u.id)); }
}
