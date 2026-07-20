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
  services, type CombatLaunch, type CombatOutcome, type EncounterResult, type EncounterKind, type UseResult,
} from '../contracts';
import type { Pack } from '../../packs/types';
import { getPacks, getPackAsset, type PackEntry } from '../../bridge/client';
import { candidateDungeonFiles, isDungeonSpec } from '../scenes/dungeon/specResolve';
import {
  GRID_W, GRID_H, CELL, ACTIONS, key, manhattan, type ActionKind, type UnitState, type Coord, type Dir,
  type TileType,
} from './types';
import {
  buildLayout, computeMoveField, reachableTiles, pathTo, crossTiles, lineTiles,
  forceMove, blocksSight, hasLineOfFire, type Layout, type MoveField, type ForceMoveBoard,
} from './grid';
import { buildInitiative, nextInOrder } from './initiative';
import { resolveAction, isFlanked } from './damage';
import { applyBranch, reduceShields, bossDefeated, wardenAbsorbs } from './boss';
import { decideEnemy, occupancyExcept, carefulStepMove, opportunityStrikers } from './ai';
import { makeKeeper, makeMira, makeEnemy, makeBoss, MIRA_MASTERY_GATE } from './units';
import { ensureTextures, TILE_KEYS, UNIT_KEYS, CHIP_KEYS } from './textures';
import { tickTurnStart, decayTurnEnd, applyStatus, computeHit, effectiveMove, STATUS_DEFS, type StatusId } from './status';
import { CombatHud } from './hud';
import { fixtureLaunch, FIXTURE_FACTS, FIXTURE_PACK_ID } from './fixtures';
import { P, hex } from './palette';
import { music } from '../../music/instance';
import { usableSatchelItems, resolveHealUse } from './satchel';
import { itemById } from '../../inventory/catalog';
import { openCombatSatchelPane } from '../../inventory/ui/combatSatchelPane';

const ORIGIN = { x: (960 - GRID_W * CELL) / 2, y: 48 }; // 192, 48 → grid spans y 48..432

type Phase = 'boot' | 'playerMove' | 'playerTarget' | 'resolving' | 'enemy' | 'over';

interface UnitView {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  hp: Phaser.GameObjects.Graphics;
  /** party-only: pulsing danger aura shown when near death */
  danger?: Phaser.GameObjects.Graphics;
  pulse?: Phaser.Tweens.Tween;
  /** §12.3 — status chip row under the HP bar; destroyed + recreated each drawHpBar call */
  chips: (Phaser.GameObjects.Image | Phaser.GameObjects.Text)[];
}

/**
 * Split the saved pooled HP (0-16) proportionally onto Keeper (max 10) / Mira (max 6).
 * Keeper's share rounds UP; Mira's is the exact remainder — this guarantees
 * `keeper + mira === pool` for every integer pool in [0,16]. (crucible #9: the previous
 * formula clamped each unit's share to a per-unit `Math.max(1, …)` floor independently,
 * which over-credited +1 total whenever the saved pool was exactly 1 or 2 — both units
 * got bumped to a minimum of 1 even though only one HP existed to share between them.)
 */
export function splitPooledHp(pool: number): { keeper: number; mira: number } {
  const clamped = Math.max(0, Math.min(16, pool));
  const keeper = Math.min(10, Math.ceil((clamped * 10) / 16));
  return { keeper, mira: clamped - keeper };
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
  // DEV/e2e testability: an optional pilot action preference and a log of resolved player
  // actions (what fired, damage dealt, whether it opened a question overlay). Read-only surface,
  // mirrors the hamlet's debug reads; inert in normal play (nothing sets the preference).
  private debugPrefer: ActionKind | null = null;
  private actionLog: Array<{ action: string; dmg: number; overlay: boolean }> = [];

  // §4 board mechanics (Phase 1 — magic-combat-depth.md)
  /** tile Image refs so a lit brazier can swap its texture to `tile.lantern` in place. */
  private tileImages = new Map<string, Phaser.GameObjects.Image>();
  /** §4.2 — per-turn toggle ('c'): half move, provokes no opportunity strikes. Reset each turn. */
  private carefulStepOn = false;
  /** debounces the status hover-line banner so POINTER_MOVE doesn't retrigger it every pixel. */
  private hoveredStatusUnitId: string | null = null;

  // content resolution
  private allFactIds = new Set<string>();
  private tagToIds = new Map<string, string[]>();
  private roomTags: string[] = [];

  // boss
  private boss: UnitState | null = null;
  private shields = 0;
  private phaseIndex = 0;
  private pendingBossPhase = false;
  /** non-null exactly while the phase-opening portrait reveal is on screen (e2e/debug read). */
  private bossReveal: Phaser.GameObjects.Container | null = null;

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
      this.launch = fixtureLaunch(seed, params.get('boss') === '1', params.get('kit') === '1');
    }
  }

  create(): void {
    this.destroyed = false;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.destroyed = true; });

    // Phaser reuses this Scene INSTANCE across scene.start('combat') calls, but the class-field
    // initializers ran only once — so every battle must begin from zero here, or the second
    // launch in a session (dungeon room 2+) inherits the previous fight's units, turn cursor,
    // and boss state (observed live as a duplicated party + a locked board).
    this.units = [];
    this.views.clear();
    this.order = [];
    this.orderIndex = -1;
    this.state = 'boot';
    this.moved = false;
    this.activeId = '';
    this.moveField = null;
    this.reachable.clear();
    this.targetTiles.clear();
    this.pendingAction = null;
    this.results = [];
    this.hpLost = 0;
    this.graceAvailable = true;
    this.debugPrefer = null;
    this.actionLog = [];
    this.allFactIds.clear();
    this.tagToIds.clear();
    this.roomTags = [];
    this.boss = null;
    this.shields = 0;
    this.phaseIndex = 0;
    this.pendingBossPhase = false;
    this.bossReveal = null;
    this.tileImages.clear();
    this.carefulStepOn = false;
    this.hoveredStatusUnitId = null;

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
    // Boss rooms open on the Vault-Warden sting (one-shot, ~11s + ring-out into held
    // silence while his shields stand); the battle loop returns at the first phase parley.
    try { music.play(this.launch.room.boss ? 'warden' : 'battle'); } catch { /* audio context may be locked pre-gesture */ }

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

  /**
   * True only for a real Preference Vaults battle launched from the dungeon
   * (`returnScene: 'vaults'`) — never the packless dev/e2e fixture (`?scene=combat`,
   * `returnScene: 'boot'`), so the backdrop stays scoped to the province it depicts.
   */
  private isVaultsBattle(): boolean {
    return this.launch.returnScene === 'vaults' && this.textures.exists('backdrop.vaults');
  }

  private drawBackdrop(): void {
    this.cameras.main.setBackgroundColor('#1b1526');
    const vaultsArt = this.isVaultsBattle();
    // Very back — behind the tile grid (depth 0) and the dimming gradient below.
    if (vaultsArt) this.add.image(480, 270, 'backdrop.vaults').setDepth(-1000);

    const g = this.add.graphics().setDepth(-10);
    if (vaultsArt) {
      // The grid tiles are opaque and already win any contrast fight; this just keeps
      // the painterly art from overpowering HUD chrome floating in the margins around
      // the board (the unboxed room-name label, the turn-order strip).
      g.fillStyle(P.shadowPlum, 0.24).fillRect(0, 0, 960, 540);
    } else {
      g.fillGradientStyle(P.duskDeep, P.duskDeep, P.shadowPlum, P.shadowPlum, 1);
      g.fillRect(0, 0, 960, 540);
    }
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
        this.tileImages.set(key(c, r), img); // §4.4 — lets a lit brazier swap to tile.lantern in place
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
   *
   * Also re-run mid-battle by the Satchel (inventory-handoff §10) after a heal raises the
   * pool — the first time HP can rise without the battle ending. Since the split always
   * gives every living-pool unit ≥1 hp, a unit that had fainted (alive:false) can come back
   * here; reviveView() undoes fadeDead's tween (alpha/scale/angle) so it doesn't stay
   * visually "dead" while alive:true and its hp bar reads a real value.
   */
  private applyPoolHp(): void {
    let pool = 16;
    try { pool = services.save.get()?.hp ?? 16; } catch { /* offline → full */ }
    const { keeper: keeperShare, mira: miraShare } = splitPooledHp(pool);
    const keeper = this.unitById('keeper');
    const mira = this.unitById('mira');
    if (keeper) {
      const wasDead = !keeper.alive;
      keeper.hp = keeperShare;
      keeper.alive = keeper.hp > 0;
      if (wasDead && keeper.alive) this.reviveView(keeper);
      this.drawHpBar(keeper);
    }
    if (mira) {
      const wasDead = !mira.alive;
      mira.hp = miraShare;
      mira.alive = mira.hp > 0;
      if (wasDead && mira.alive) this.reviveView(mira);
      this.drawHpBar(mira);
    }
  }

  /** Undo fadeDead's death tween (used only when a Satchel heal revives a fainted ally). */
  private reviveView(u: UnitState): void {
    const v = this.views.get(u.id);
    if (!v) return;
    this.tweens.killTweensOf(v.container);
    v.container.setAlpha(1).setScale(1).setAngle(0);
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

    // Party-only near-death vignette: a pulsing berry aura at the feet so a Keeper
    // or Mira in danger reads across the board (teeth-but-fair legibility).
    let danger: Phaser.GameObjects.Graphics | undefined;
    let pulse: Phaser.Tweens.Tween | undefined;
    if (u.team === 'party') {
      danger = this.add.graphics();
      danger.fillStyle(P.berry, 0.3).fillEllipse(0, CELL / 2 - 5, CELL * 1.15, 26);
      danger.fillStyle(P.berry, 0.55).fillEllipse(0, CELL / 2 - 5, CELL * 0.82, 17);
      danger.lineStyle(2, P.berry, 0.85).strokeEllipse(0, CELL / 2 - 5, CELL * 0.82, 17);
      danger.setVisible(false);
      pulse = this.tweens.add({ targets: danger, alpha: { from: 0.35, to: 1 }, duration: 620, yoyo: true, repeat: -1, paused: true });
      container.add(danger); // under shadow + sprite
    }
    container.add([shadow, sprite, hp]);
    this.views.set(u.id, { container, sprite, hp, danger, pulse, chips: [] });
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

    // §3/§12.3 — Warded renders as a thin water-blue underline sized by the remaining pool
    // (never decays by time, so it stays legible even without a chip-row turns readout).
    const warded = u.statuses.find((s) => s.id === 'warded');
    if (warded) {
      const wardPx = Math.min(w, warded.magnitude * 6);
      g.fillStyle(P.waterBlue, 0.95).fillRect(-w / 2, y + 6, wardPx, 2);
    }

    this.drawStatusChips(u, v, y + (warded ? 10 : 7));
    this.updateDanger(u);
  }

  /** §3/§12.3 — up to 3 status chips (CHIP_KEYS glyphs) under the HP bar, overflow '+'. */
  private drawStatusChips(u: UnitState, v: UnitView, chipY: number): void {
    for (const c of v.chips) c.destroy();
    v.chips = [];
    if (!u.statuses.length) return;
    const SIZE = 10;
    const GAP = 2;
    const MAX = 3;
    const shown = u.statuses.slice(0, MAX);
    const overflow = u.statuses.length > MAX;
    const n = shown.length + (overflow ? 1 : 0);
    let cx = -(n * SIZE + (n - 1) * GAP) / 2 + SIZE / 2;
    for (const s of shown) {
      const glyphKey = (CHIP_KEYS as Record<string, string>)[s.id];
      if (glyphKey && this.textures.exists(glyphKey)) {
        const img = this.add.image(cx, chipY, glyphKey).setDisplaySize(SIZE, SIZE);
        v.container.add(img);
        v.chips.push(img);
      }
      cx += SIZE + GAP;
    }
    if (overflow) {
      const t = this.add.text(cx - SIZE / 2, chipY - 6, '+', {
        fontFamily: 'Georgia, serif', fontSize: '11px', color: hex(P.parchment), fontStyle: 'bold',
      }).setOrigin(0.5);
      v.container.add(t);
      v.chips.push(t);
    }
  }

  /** Show the pulsing danger aura when a party unit drops to ≤ 1/3 HP; hide otherwise. */
  private updateDanger(u: UnitState): void {
    const v = this.views.get(u.id);
    if (!v || !v.danger || !v.pulse) return;
    const critical = u.team === 'party' && u.alive && u.hp > 0 && u.hp / u.maxHp <= 0.34;
    v.danger.setVisible(critical);
    if (critical && v.pulse.paused) v.pulse.resume();
    else if (!critical && !v.pulse.paused) { v.pulse.pause(); v.danger.setAlpha(1); }
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
    // Warms the wallet before the Satchel action can be opened — mirrors HamletScene/
    // DungeonScene's own boot-time services.inventory.ready() call. Without this, the
    // packless ?scene=combat dev/e2e harness (never visits hamlet/dungeon first) would
    // read InventoryStore's in-memory defaults instead of the persisted stacks.
    try { await services.inventory.ready(); } catch { /* stub or offline */ }
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
      } else if (this.launch.packId === FIXTURE_PACK_ID && this.launch.room.boss && packs.length) {
        // crucible #11 — the standalone dev/e2e boss fixture forces a packId/phase ids
        // ('dev-boss-phase-N') that exist in no installed pack, so encounters/engine.ts's
        // pick() silently fell back to the same generic candidate for every phase (its own
        // packId lookup misses too, defaults to packs[0], the forced encounterId misses,
        // the factIds miss — landing on candidates[0] regardless of which phase asked).
        // When a real pack IS installed, route this fixture's boss through THAT pack's own
        // authored phases (packId + branchEncounterId together, so pick()'s forced-id match
        // resolves exactly) — the regular trash-mob enemies stay fantasy-generic either way,
        // only the boss's phases (and the packId used to resolve them) are swapped in.
        await this.routeFixtureBossToInstalledPack(packs);
      }
    } catch { /* static build has no bridge */ }
    if (this.allFactIds.size === 0) for (const id of FIXTURE_FACTS) this.allFactIds.add(id);
  }

  /** crucible #11 — see loadContent's call site. Best-effort: tries every installed pack's
   *  own dungeon spec for a room with a boss; any failure just leaves the fixture's
   *  placeholder phases in place (today's pre-fix, packless-dev-safe behavior). */
  private async routeFixtureBossToInstalledPack(packs: PackEntry[]): Promise<void> {
    for (const entry of packs) {
      const pack = entry.pack as Pack;
      for (const file of candidateDungeonFiles(pack)) {
        const res = await getPackAsset(entry.id, file);
        if (!res) continue;
        const json = await res.json().catch(() => null);
        if (!isDungeonSpec(json)) continue;
        const bossRoom = json.rooms.find((r) => r.boss);
        if (bossRoom?.boss) {
          this.launch = {
            ...this.launch,
            packId: entry.id,
            room: { ...this.launch.room, boss: { ...this.launch.room.boss!, phases: bossRoom.boss.phases } },
          };
          return;
        }
      }
    }
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
    // §4.2 round boundary (initiative.ts nextInOrder flags a wrap): reset every unit's oaSpent.
    if (nxt.newRound) { for (const u of this.units) u.oaSpent = false; }
    this.orderIndex = nxt.index;
    const unit = this.unitById(nxt.id)!;
    this.activeId = unit.id;
    this.hud.setActive(unit.id, this.aliveIds());
    this.focusCue(unit);

    // §3 rule 2 — tick order at turn start: (a) Kindled damage via the damageUnit choke point
    // (may kill); (b) Staggered — consumed, turn ends here before the unit can act. Replaces
    // the old skipNextTurn read/write block (skipNextTurn itself stays on UnitState one release
    // for save-less migration ease, but nothing reads/writes it anymore — see also Parley/boss
    // migration in applyOutcome/openBossPhase).
    const tick = tickTurnStart(unit);
    unit.statuses = tick.statuses;
    let staggered = false;
    for (const op of tick.ops) {
      if (op.op === 'damage') this.damageUnit(unit, op.amount, P.ember);
      else staggered = true;
    }
    if (!unit.alive) { this.time.delayedCall(420, () => this.advanceTurn()); return; }
    if (staggered) {
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
    this.carefulStepOn = false;
    this.moveField = computeMoveField(unit, this.moveBudgetFor(unit), this.layout.tiles, this.blockedFor(unit.id));
    this.reachable.clear();
    for (const t of reachableTiles(this.moveField, unit)) this.reachable.set(key(t.c, t.r), t);
    this.drawMoveRange();
    this.showMenu(unit);
    this.hud.showBanner(`${unit.name}'s turn — move, then act.`, P.parchment);
    if (this.demo) this.time.delayedCall(520, () => this.autoStep(unit));
  }

  /** §3 Bound/Dimmed (effectiveMove) composed with §4.2 Careful Step's half-move toggle. */
  private moveBudgetFor(unit: UnitState): number {
    const eff = effectiveMove(unit.move, unit.statuses);
    return this.carefulStepOn ? carefulStepMove(eff) : eff;
  }

  /** §4.2 — 'c' toggles Careful Step while choosing a move: half move (floor, min 1), no
   *  opportunity strikes provoked. Recomputes the move field/range in place. */
  private toggleCarefulStep(unit: UnitState): void {
    if (this.moved) return;
    this.carefulStepOn = !this.carefulStepOn;
    this.moveField = computeMoveField(unit, this.moveBudgetFor(unit), this.layout.tiles, this.blockedFor(unit.id));
    this.reachable.clear();
    for (const t of reachableTiles(this.moveField, unit)) this.reachable.set(key(t.c, t.r), t);
    this.drawMoveRange();
    this.hud.showBanner(
      this.carefulStepOn ? 'Careful Step: half move, no opportunity strikes.' : 'Careful Step off.',
      this.carefulStepOn ? P.waterLight : P.parchment,
    );
  }

  /** §4.4 — free interact: light an adjacent unlit brazier (once per brazier — the tile
   *  becoming 'lantern' is itself the once-only gate). Glow hook is a NO-OP in Phase 1
   *  (Phase 2 wires the +1 pip, docs/design/magic-combat-depth.md §5.1). */
  private tryLightBrazier(unit: UnitState): void {
    const co = this.layout.braziers.find(
      (b) => this.layout.tiles[b.r][b.c] === 'brazier' && manhattan(unit, b) === 1,
    );
    if (!co) return;
    this.layout.tiles[co.r][co.c] = 'lantern';
    const img = this.tileImages.get(key(co.c, co.r));
    if (img) img.setTexture(TILE_KEYS.lantern);
    this.hud.showBanner('The brazier catches — a lantern now, for the rest of the battle.', P.lanternGold);
  }

  /** Dev autopilot (?demo=1): act if a target is in range, else close in, else wait.
   *  A pilot preference (set via setPilotPreference, e2e-only) forces one action kind. */
  private autoStep(unit: UnitState): void {
    if (this.destroyed || this.state === 'over' || unit.id !== this.activeId) return;
    const order: ActionKind[] = this.debugPrefer
      ? [this.debugPrefer]
      : (['cast', 'sequence', 'weave', 'smite', 'strike', 'parley'] as ActionKind[]);
    for (const a of order) {
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
    // When a debug preference narrows the order to ONE action kind (e.g. 'parley', which
    // only .parley-flagged enemies satisfy), approach an enemy that could eventually become a
    // valid target for THAT action once in range — not just the nearest enemy overall, which
    // may never satisfy it and strand the pilot circling forever. Generic actions (any enemy
    // qualifies for strike/smite/weave/sequence/cast) keep the original "nearest enemy" pool.
    const eligible = (e: UnitState): boolean => (this.debugPrefer === 'parley' ? !!e.parley : true);
    const pool = enemies.filter(eligible);
    const approachPool = pool.length ? pool : enemies;
    if (approachPool.length && !this.moved && this.moveField) {
      const near = approachPool.reduce((b, e) => (manhattan(unit, e) < manhattan(unit, b) ? e : b), approachPool[0]);
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
      // Self-cast, no targeting phase (inventory-handoff §10): always pickable, like Wait —
      // an empty satchel is handled inside the panel (a friendly line), not by disabling this.
      if (action === 'wait' || action === 'satchel') return { action, enabled: true };
      const targets = this.validTargets(unit, action);
      return { action, enabled: targets.length > 0, reason: targets.length ? undefined : 'no target in range' };
    });
    this.hud.showActionMenu(items, (a) => this.onPickAction(unit, a));
  }

  private onPickAction(unit: UnitState, action: ActionKind): void {
    if (this.state !== 'playerMove' && this.state !== 'playerTarget') return;
    if (unit.id !== this.activeId) return;
    if (action === 'wait') { this.hud.showBanner('Holding position.', P.stoneGrey); this.endPlayerTurn(); return; }
    if (action === 'satchel') { void this.openSatchel(unit); return; }
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
      case 'smite': return enemies.filter((e) => manhattan(unit, e) <= 2);
      case 'weave': return enemies.filter((e) => manhattan(unit, e) <= 2);
      case 'cast': return enemies.filter((e) => manhattan(unit, e) <= 3);
      case 'parley': return enemies.filter((e) => e.parley && manhattan(unit, e) <= 1);
      case 'sequence':
        // §4.4 — mist (and walls) block Ritecraft lines the same way they block LoF;
        // hasLineOfFire already encodes same-row/col + range + the intervening-tile check.
        return enemies.filter((e) => hasLineOfFire(unit, e, ACTIONS.sequence.range, this.layout.tiles));
      case 'satchel':
      case 'wait':
        return [];
      default: {
        // trap 4 — this switch is touched this phase, so it gets an exhaustiveness check
        // (full retirement of the silent-default class is Phase 2's SpellDef-driven dispatch).
        const exhaustive: never = action;
        return exhaustive;
      }
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
    this.resolveOpportunityStrikes(unit, path, this.carefulStepOn);
    if (!unit.alive) {
      // felled by an opportunity strike mid-move (rare, but the fight may be over)
      this.time.delayedCall(360, () => this.endPlayerTurn());
      return;
    }
    this.tweenAlongPath(unit, path, () => {
      if (this.destroyed) return;
      this.state = 'playerMove';
      this.showMenu(unit);
      this.hud.showBanner('Moved. Choose an action.', P.parchment);
      if (this.demo) this.time.delayedCall(340, () => this.autoStep(unit));
    });
  }

  /**
   * §4.2 opportunity strikes: for every tile `mover` vacates along `path` (excludes the final
   * resting tile), any living, non-Staggered opposing unit orthogonally adjacent to that tile
   * (and who hasn't spent its one this round — oaSpent) deals 1 flat, flank-eligible damage,
   * resolved before the move's tween starts (so it lands "before the move animation completes").
   * Careful Step provokes nothing. Pushes never call this (the mover didn't choose to move).
   */
  private resolveOpportunityStrikes(mover: UnitState, path: Coord[], carefulStep: boolean): void {
    if (carefulStep) return;
    for (const vacated of path.slice(0, -1)) {
      if (!mover.alive) return;
      for (const striker of opportunityStrikers(vacated, mover.team, this.units)) {
        if (!mover.alive) break;
        const flank = isFlanked(striker, mover, striker.team, this.units);
        const result = computeHit({
          base: 1, attackerStatuses: striker.statuses, targetStatuses: mover.statuses,
          flank, overglow: false, weld: false,
        });
        mover.statuses = result.targetStatuses;
        striker.oaSpent = true;
        if (result.hpDamage > 0) {
          this.hud.showBanner(`${striker.name} strikes as ${mover.name} withdraws.`, P.berry);
          this.damageUnit(mover, result.hpDamage, P.berry);
        }
      }
    }
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

    const target = this.enemyAt(tile);

    // FREE STRIKE (friction redesign): no encounter, no question, cannot miss. It resolves
    // synchronously — reusing the attacker lunge + hit-flash — so plain fighting FLOWS with
    // no overlay and no dead frame. Deals fixed, modest damage; no SRS record (no question).
    if (action === 'strike') {
      const miraBonus = unit.id === 'mira' && this.miraBonusActive() ? 1 : 0;
      const outcome = resolveAction('strike', 1, { miraBonus, vsBoss: !!target?.isBoss });
      const before = this.enemyHpSum();
      this.attackerTell(unit, tile, ACTIONS.strike.tint);
      this.applyOutcome(unit, 'strike', tile, outcome, target);
      this.hud.showBanner(outcome.banner, ACTIONS.strike.tint);
      this.actionLog.push({ action: 'strike', dmg: before - this.enemyHpSum(), overlay: false });
      this.refreshParty();
      this.time.delayedCall(440, () => this.endPlayerTurn());
      return;
    }

    // GATED POWER MOVES: answering the question IS the cast. Each hits far harder than a
    // free Strike — that payoff is what the friction now buys.
    const meta = ACTIONS[action];
    const kind = meta.encounter as EncounterKind;
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
    if (action === 'smite' || action === 'weave' || action === 'sequence' || action === 'cast') {
      this.attackerTell(unit, tile, ACTIONS[action].tint);
    }
    const before = this.enemyHpSum();
    this.applyOutcome(unit, action, tile, outcome, target);
    this.actionLog.push({ action, dmg: before - this.enemyHpSum(), overlay: true });
    this.hud.showBanner(outcome.banner, outcome.hits > 0 || outcome.weaken ? ACTIONS[action].tint : P.duskRose);

    if (isBossCast) {
      this.phaseIndex += 1;
      this.pendingBossPhase = this.phaseIndex < (this.launch.room.boss?.phases.length ?? 0);
    }

    this.refreshParty();
    this.time.delayedCall(620, () => this.endPlayerTurn());
  }

  private applyOutcome(actor: UnitState, action: ActionKind, tile: Coord, o: ReturnType<typeof resolveAction>, target: UnitState | null): void {
    if (action === 'strike') {
      // §3 rule 4 / §4.1 — Strike is the one melee player action; it routes through the
      // computeHit modifier pipeline (flank) instead of a flat subtraction (see meleeHit).
      if (target && o.hits > 0) this.meleeHit(actor, target, o.hits, ACTIONS.strike.tint);
    } else if (action === 'cast' || action === 'smite') {
      if (target && o.hits > 0) this.hitEnemy(target, o.hits, ACTIONS[action].tint, action);
      if (o.extraShield && target?.isBoss) { this.shields = reduceShields(this.shields, -o.extraShield); this.floatText(target, '−shield', P.waterLight); this.syncBoss(); }
      if (o.fade > 0) this.damageParty(o.fade, actor);
    } else if (action === 'weave') {
      if (target && o.hits > 0) this.hitEnemy(target, o.hits, ACTIONS.weave.tint, action);
      if (o.aoeHit > 0) {
        for (const co of crossTiles(tile)) {
          if (co.c === tile.c && co.r === tile.r) continue;
          const e = this.enemyAt(co);
          if (e) this.hitEnemy(e, o.aoeHit, ACTIONS.weave.tint, action);
        }
      }
    } else if (action === 'sequence') {
      const dir = this.dirTo(actor, tile);
      if (dir) {
        for (const [i, co] of lineTiles(actor, dir, o.lineDepth).entries()) {
          const e = this.enemyAt(co);
          if (e) this.hitEnemy(e, i === 0 ? o.hits : o.aoeHit, ACTIONS.sequence.tint, action);
          // §4.4 — mist (and walls) block Ritecraft lines: the lance can still land on
          // whatever occupies the blocking tile, but nothing beyond it.
          if (blocksSight(this.tileTypeOf(co))) break;
        }
      }
    } else if (action === 'parley') {
      // §3.6 migration — Parley-good used to set skipNextTurn + PERMANENTLY decrement attack.
      // Now: Staggered(1) + Weakened(2) via statuses, so repeated parleys never drift the
      // target's base attack downward (regression: statuses refresh, they don't stack/sum).
      if (o.weaken && target) {
        target.statuses = applyStatus(target, 'staggered', 1);
        target.statuses = applyStatus(target, 'weakened', 2);
        this.floatText(target, 'weakened', P.blossom);
      }
      if (o.partyHit > 0) this.damageParty(o.partyHit, actor);
    }
    if (o.selfChip > 0) this.damageUnit(actor, o.selfChip, P.berry);
  }

  /** §3 rule 4 / §4.1 — the one melee player action (Strike) routed through computeHit:
   *  flank via isFlanked; overglow/weld are Phase-2/2.5 concepts, always false this phase. */
  private meleeHit(attacker: UnitState, target: UnitState, base: number, color: number): void {
    if (wardenAbsorbs('strike', target.isBoss, this.shields)) {
      this.floatText(target, 'shielded', P.waterLight);
      return;
    }
    const flank = isFlanked(attacker, target, attacker.team, this.units);
    const result = computeHit({
      base, attackerStatuses: attacker.statuses, targetStatuses: target.statuses,
      flank, overglow: false, weld: false,
    });
    target.statuses = result.targetStatuses;
    if (result.hpDamage > 0) this.damageUnit(target, result.hpDamage, color);
    else if (result.absorbed > 0) this.floatText(target, 'warded', P.waterBlue);
  }

  private endPlayerTurn(): void {
    if (this.destroyed) return;
    this.state = 'resolving';
    this.hud.hideActionMenu();
    const unit = this.unitById(this.activeId);
    if (unit) this.endTurnDecay(unit);
    const end = this.checkEnd();
    if (end) { this.resolveBattle(end); return; }
    this.advanceTurn();
  }

  /** §3 rule 3 — decay at the OWNER's turn end: decrement every duration status (Warded
   *  never decays by time — see status.ts's decayTurnEnd). */
  private endTurnDecay(unit: UnitState): void {
    unit.statuses = decayTurnEnd(unit.statuses);
    this.drawHpBar(unit);
  }

  // ---- satchel (inventory-handoff §10) -----------------------------------

  /**
   * Opens the in-battle item panel. A DOM overlay (inventory/ui/combatSatchelPane.ts),
   * so the caller must quiet the game keyboard for its lifetime — same mandatory wrap
   * every Satchel/shop caller uses (inventory/ui/dom.ts's openPane doc, §7).
   */
  private async openSatchel(unit: UnitState): Promise<void> {
    // Q can fire mid-targeting too (the keydown handler allows any hotkey from
    // playerTarget, same as Wait) — leave that cleanly first, like cancelTargeting.
    this.state = 'playerMove';
    this.pendingAction = null;
    this.targetTiles.clear();
    this.hoverGfx.clear();
    this.hud.hideActionMenu();

    let usable: ReturnType<typeof usableSatchelItems> = [];
    let gold = 0;
    try {
      usable = usableSatchelItems(services.inventory.snapshot());
      gold = services.inventory.getGold();
    } catch { /* offline — empty satchel is the honest answer */ }

    this.input.keyboard!.enabled = false;
    const chosen = await openCombatSatchelPane(usable, gold);
    this.input.keyboard!.enabled = true;
    this.input.keyboard!.resetKeys();

    if (this.destroyed) return; // scene torn down while the DOM panel was open
    if (!chosen) { this.returnToActionMenu(unit); return; }

    // Lock the board out (same as every other action's async gap) for the mutation below —
    // the panel closing already re-enabled the keyboard, so this closes that re-entrancy window.
    this.state = 'resolving';
    await this.useSatchelItem(unit, chosen);
  }

  private returnToActionMenu(unit: UnitState): void {
    if (this.destroyed) return;
    this.state = 'playerMove';
    if (!this.moved) this.drawMoveRange();
    this.showMenu(unit);
  }

  /**
   * Resolves a chosen heal item through the SAME choke point camp-rest/the hamlet Satchel
   * use (services.inventory.useItem — consume.ts's clamp-and-persist), spending the action
   * only on success. services.save.hp goes stale the instant combat damage starts (nothing
   * else writes it mid-battle), so the LIVE pool (Keeper+Mira's current hp) is synced into
   * the save FIRST — resolveHealUse (pure, combat/satchel.ts) computes against that live
   * number so the scene knows the outcome before ever calling the real, async mutation.
   */
  private async useSatchelItem(unit: UnitState, id: string): Promise<void> {
    const item = itemById(id);
    const keeper = this.unitById('keeper');
    const mira = this.unitById('mira');
    if (!item || !keeper || !mira) { this.returnToActionMenu(unit); return; }

    const livePool = keeper.hp + mira.hp;
    const plan = resolveHealUse(item, livePool);
    if (!plan.ok) {
      this.hud.showBanner(plan.message, P.stoneGrey);
      this.returnToActionMenu(unit);
      return;
    }

    try { await services.save.save({ hp: livePool }); } catch { /* offline */ }
    // crucible #3 — the write above re-anchors save.hp to the CURRENT live pool (this
    // instant, before or after the heal amount itself lands makes no difference: nothing
    // else touches the pool in between). hpLost is a running total since battle start, so
    // without this reset, DungeonScene's end-of-battle applyHp(-hpLost) would subtract the
    // pre-heal damage a SECOND time from a base that already reflects it having happened —
    // resetting here makes hpLost count only damage since THIS sync, whichever way the
    // useItem call below resolves (this write already landed either way).
    this.hpLost = 0;
    let res: UseResult;
    try { res = await services.inventory.useItem(id); }
    catch { res = { ok: false, message: 'The satchel would not open.' }; }
    if (this.destroyed) return;
    if (!res.ok) {
      this.hud.showBanner(res.message, P.stoneGrey);
      this.returnToActionMenu(unit);
      return;
    }

    const before = { keeper: keeper.hp, mira: mira.hp };
    this.applyPoolHp();
    if (keeper.hp > before.keeper) this.floatText(keeper, `+${keeper.hp - before.keeper}`, P.moss);
    if (mira.hp > before.mira) this.floatText(mira, `+${mira.hp - before.mira}`, P.moss);
    this.refreshParty();
    this.hud.showBanner(res.message, P.moss);
    this.actionLog.push({ action: 'satchel', dmg: 0, overlay: false });
    this.time.delayedCall(560, () => this.endPlayerTurn());
  }

  // ---- boss phase -------------------------------------------------------

  private async openBossPhase(i: number): Promise<void> {
    if (!this.boss || this.destroyed) return;
    this.state = 'resolving';
    const phase = this.launch.room.boss!.phases[i];
    this.hud.showBanner('The Warden proposes his terms…', P.berry);
    await this.showBossReveal();
    if (this.destroyed) return;
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
    // §3 table — "Warden concession (boss.ts:21)" is a Staggered applier same as Parley-good;
    // migrated off skipNextTurn (nothing reads that field anymore, see advanceTurn).
    if (eff.stagger) this.boss.statuses = applyStatus(this.boss, 'staggered', 1);
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

    // The sting has said its piece — bring the battle loop back under the fight.
    // 'battle' loops, so repeat phase calls no-op; an unfinished ring-out tears down cleanly.
    try { music.play('battle'); } catch { /* audio optional */ }
  }

  /**
   * A brief dramatic beat at the top of every boss phase: the Vault-Warden's portrait
   * in a bark+gold frame (mirrors the dialogue box's portrait mat) over a dimming scrim,
   * timed to the "terms" banner and the one-shot Warden sting. Fully torn down (destroyed,
   * not merely hidden) before the phase's scenario_branch overlay opens — never lingers
   * into a normal turn. Named-gated (not just "any boss"): the packless dev-vaults
   * fallback reskins the boss as "The Moss-Warden" (no matching portrait), so this only
   * fires for the entity the art actually depicts. Resolves once teardown completes.
   */
  private showBossReveal(): Promise<void> {
    const key = 'portrait.vault-warden';
    const boss = this.boss;
    if (!boss || boss.name !== 'The Vault-Warden' || !this.textures.exists(key)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const SIZE = 128;
      const MAT = 5;
      const fw = SIZE + MAT * 2;
      const cx = 480;
      const cy = 260;

      const scrim = this.add.graphics().setDepth(88).setAlpha(0);
      scrim.fillStyle(P.voidBlack, 0.4).fillRect(0, 0, 960, 540);

      const frame = this.add.graphics();
      frame.fillStyle(0x2a1d13, 0.95).fillRoundedRect(-fw / 2, -fw / 2, fw, fw, 10);
      frame.lineStyle(2, P.lanternGold, 0.95).strokeRoundedRect(-fw / 2, -fw / 2, fw, fw, 10);
      frame.lineStyle(1, P.parchment, 0.18).strokeRoundedRect(-fw / 2 + 3, -fw / 2 + 3, fw - 6, fw - 6, 8);
      const img = this.add.image(0, 0, key).setOrigin(0.5);
      const nameTag = this.add
        .text(0, fw / 2 + 18, boss.name.toUpperCase(), {
          fontFamily: 'Georgia, serif', fontSize: '20px', color: '#' + P.lanternGold.toString(16).padStart(6, '0'),
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setShadow(0, 2, '#100b0a', 6);

      const c = this.add.container(cx, cy, [frame, img, nameTag]).setDepth(90).setAlpha(0).setScale(0.9);
      this.bossReveal = c;

      const teardown = (): void => {
        c.destroy();
        scrim.destroy();
        this.bossReveal = null;
        resolve();
      };

      this.tweens.add({ targets: c, alpha: 1, scale: 1, duration: 190, ease: 'Back.easeOut' });
      this.tweens.add({ targets: scrim, alpha: 1, duration: 190 });
      this.time.delayedCall(950, () => {
        if (this.destroyed) { teardown(); return; }
        this.tweens.add({ targets: [c, scrim], alpha: 0, duration: 220, onComplete: teardown });
      });
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
    // §3 Bound/Dimmed feed the AI's OWN move budget without editing ai.ts: hand decideEnemy a
    // shallow clone whose `.move` is already the effective value (ai.ts stays pure/untouched).
    const effMove = effectiveMove(unit.move, unit.statuses);
    const selfForAi = effMove === unit.move ? unit : { ...unit, move: effMove };
    const intent = decideEnemy(selfForAi, party, this.layout.tiles, occupancyExcept(this.units, unit.id));

    const doAttack = () => {
      if (this.destroyed) return;
      if (intent.attackTargetId) {
        const tgt = this.unitById(intent.attackTargetId);
        if (tgt && tgt.alive) this.enemyStrike(unit, tgt);
      }
      this.endTurnDecay(unit);
      this.time.delayedCall(460, () => this.advanceTurn());
    };

    if (intent.moveTo) {
      const field = computeMoveField(unit, effMove, this.layout.tiles, this.blockedFor(unit.id));
      const path = pathTo(field, intent.moveTo);
      const v = this.views.get(unit.id)!;
      if (intent.moveTo.c < unit.c) v.sprite.setFlipX(false);
      else if (intent.moveTo.c > unit.c) v.sprite.setFlipX(true);
      unit.c = intent.moveTo.c; unit.r = intent.moveTo.r;
      if (path && path.length >= 2) {
        this.resolveOpportunityStrikes(unit, path, intent.carefulStep);
        if (!unit.alive) { this.time.delayedCall(360, () => this.advanceTurn()); return; }
        this.tweenAlongPath(unit, path, doAttack);
      } else doAttack();
    } else {
      this.time.delayedCall(200, doAttack);
    }
  }

  /**
   * §8 enemy kits, on the same BoardOp-style primitives spells use: wraith hits apply
   * Dimmed(1) (the kite that slows pursuit); construct hits push 1 via grid.forceMove, +1
   * bump damage when the destination is blocked (wall/OOB/occupied — no domino pushes).
   * Routes through computeHit like every melee hit (§4.1 flank; ranged wraith never flanks).
   */
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

    const flank = !attacker.ranged && isFlanked(attacker, target, attacker.team, this.units);
    let bumpBonus = 0;
    if (attacker.kind === 'construct') {
      const dir = this.dirTo(attacker, target);
      if (dir) {
        const board: ForceMoveBoard = { tiles: this.layout.tiles, occupied: this.blockedFor(target.id) };
        const res = forceMove(target, dir, board);
        if (res.moved) {
          target.c = res.to.c; target.r = res.to.r;
          const v = this.views.get(target.id);
          if (v) {
            const p = this.tileToScreen(target);
            v.container.setDepth(10 + target.r);
            this.tweens.add({ targets: v.container, x: p.x, y: p.y, duration: 140 });
          }
        } else if (res.bump) {
          bumpBonus = 1;
        }
      }
    }

    const result = computeHit({
      base: attacker.attack + bumpBonus,
      attackerStatuses: attacker.statuses,
      targetStatuses: target.statuses,
      flank, overglow: false, weld: false,
    });
    target.statuses = result.targetStatuses;
    if (attacker.kind === 'wraith' && result.hpDamage > 0) {
      target.statuses = applyStatus(target, 'dimmed', 1);
    }
    if (result.hpDamage > 0) this.damageUnit(target, result.hpDamage, P.berry);
    if (bumpBonus > 0) this.actionLog.push({ action: 'bump', dmg: result.hpDamage, overlay: false });
    this.hud.showBanner(`${attacker.name} strikes ${target.name} (−${result.hpDamage}).`, P.berry);
  }

  /**
   * Player attacker "tell" — the sender's half of the hit-feedback story (the
   * struck unit's white flash is the receiver's half): a lunge toward the target
   * plus a brief cast-flash in the action's colour, so an attack visibly commits.
   */
  private attackerTell(actor: UnitState, tile: Coord, tint: number): void {
    const v = this.views.get(actor.id);
    if (!v) return;
    const from = this.tileToScreen(actor);
    const to = this.tileToScreen(tile);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    this.tweens.add({ targets: v.container, x: from.x + (dx / len) * 12, y: from.y + (dy / len) * 12, duration: 110, yoyo: true, ease: 'Quad.easeOut' });
    v.sprite.setTintFill(tint);
    this.time.delayedCall(120, () => { if (!this.destroyed) v.sprite.clearTint(); });
  }

  // ---- damage / death ---------------------------------------------------

  /**
   * Player → enemy damage, honoring the Warden's shield absorption: while the boss is
   * shielded, only Cast wounds it (wardenAbsorbs) — so a free Strike (or any un-gated
   * move) can never brute-force the boss to its fallback-victory and skip the mandatory
   * phase questions. Regular enemies take the hit normally.
   */
  private hitEnemy(enemy: UnitState, amount: number, color: number, action: ActionKind): void {
    if (wardenAbsorbs(action, enemy.isBoss, this.shields)) {
      this.floatText(enemy, 'shielded', P.waterLight);
      return;
    }
    this.damageUnit(enemy, amount, color);
  }

  private damageUnit(unit: UnitState, amount: number, color: number): void {
    if (this.destroyed || amount <= 0 || !unit.alive) return;
    const before = unit.hp;
    unit.hp = Math.max(0, unit.hp - amount);
    if (unit.team === 'party') this.hpLost += before - unit.hp; // actual loss = pooled delta
    // impact feedback: a warm glow-core hit-flash + scale-punch on the struck sprite,
    // and camera shake scaled by the damage (capped) so a big Cast lands bigger.
    const v = this.views.get(unit.id);
    if (v) {
      v.sprite.setTintFill(0xfff1c6);
      this.time.delayedCall(90, () => { if (!this.destroyed) v.sprite.clearTint(); });
      this.tweens.add({ targets: v.sprite, scale: v.sprite.scale * 1.14, duration: 70, yoyo: true, ease: 'Quad.easeOut' });
    }
    this.floatText(unit, `−${amount}`, color);
    this.cameras.main.shake(90, Math.min(0.009, 0.003 + amount * 0.001));
    // trap 11 — clear statuses on death (kindled ticks can kill); the danger-pulse aura is
    // already retired by updateDanger below since u.alive gates it.
    if (unit.hp <= 0) { unit.alive = false; unit.statuses = []; this.fadeDead(unit); }
    this.drawHpBar(unit);
    // crucible #10 — damageUnit is the ONE choke point every hp change funnels through
    // (enemy strikes, opportunity strikes, status ticks, self-chip); refreshParty here
    // (rather than only at scattered call sites) keeps the sidebar honest through the
    // enemy's own turn too, so a fainted ally can never still read "healthy" on it.
    if (unit.team === 'party') this.refreshParty();
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
    // crucible #16 — a corpse's depth otherwise freezes at its death row (10 + r, same
    // scheme living units use), so a later-arriving living unit on the same row ties and
    // can lose the draw order to the corpse (fadeDead never runs again for this unit, so
    // whatever depth it gets here is permanent). `r + 6` stays under every same-row living
    // unit's `10 + r` (6 < 10, for any r) while staying above tiles/rangeGfx/hoverGfx
    // (depths 0/4/5) so the corpse never vanishes under the floor or a move highlight.
    v.container.setDepth(unit.r + 6);
    this.tweens.add({ targets: v.container, alpha: 0.18, scaleX: 0.8, scaleY: 0.8, angle: unit.team === 'enemy' ? 12 : -8, duration: 340 });
    this.hud.setActive(this.activeId, this.aliveIds());
  }

  private floatText(unit: UnitState, text: string, color: number): void {
    if (this.destroyed) return;
    const p = this.tileToScreen(unit);
    const t = this.add.text(p.x, p.y - 16, text, {
      fontFamily: 'Georgia, serif', fontSize: '19px', color: '#' + color.toString(16).padStart(6, '0'), fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(40).setStroke('#241a14', 4).setShadow(0, 2, '#100b0a', 4);
    this.tweens.add({ targets: t, y: p.y - 42, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  // ---- overlays / input -------------------------------------------------

  private drawMoveRange(): void {
    this.rangeGfx.clear();
    this.rangeGfx.fillStyle(P.leafHi, 0.24);
    this.rangeGfx.lineStyle(2, P.leafHi, 0.9);
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
      this.hoverGfx.lineStyle(2.5, P.berry, 1).strokeRect(p.x - CELL / 2 + 3, p.y - CELL / 2 + 3, CELL - 6, CELL - 6);
      this.hoverGfx.fillStyle(P.berry, 0.26).fillRect(p.x - CELL / 2 + 3, p.y - CELL / 2 + 3, CELL - 6, CELL - 6);
    }
  }

  private previewAoe(unit: UnitState, tile: Coord): void {
    if (!this.pendingAction) return;
    this.drawTargets();
    const mark = (co: Coord, col: number) => {
      const p = this.tileToScreen(co);
      this.hoverGfx.fillStyle(col, 0.42).fillRect(p.x - CELL / 2 + 4, p.y - CELL / 2 + 4, CELL - 8, CELL - 8);
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
      // crucible #13 — right-click must be inert during movement (it already is during
      // targeting, one branch down: it cancels there). Without this guard any pointer
      // button on a reachable tile spent the turn's move, same as a deliberate left-click.
      if (this.state === 'playerMove' && !this.moved && !pt.rightButtonDown() && this.reachable.has(key(tile.c, tile.r))) {
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

    // §12.3 — hovering ANY unit (either team, any time) with active statuses shows a one-line
    // banner ("Bound 1 · Inked 2"). A separate listener from the move/target one above (which
    // early-returns outside the active party unit's own turn) so this works regardless of
    // whose turn it is; debounced on the hovered unit id so it doesn't retrigger every pixel.
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pt: Phaser.Input.Pointer) => {
      const tile = this.screenToTile(pt.x, pt.y);
      const unit = tile ? this.unitAt(tile) : undefined;
      const id = unit && unit.statuses.length ? unit.id : null;
      if (id === this.hoveredStatusUnitId) return;
      this.hoveredStatusUnitId = id;
      if (unit && id) {
        const line = unit.statuses
          .map((s) => `${STATUS_DEFS[s.id].label} ${s.id === 'warded' ? s.magnitude : s.turnsLeft}`)
          .join(' · ');
        this.hud.showBanner(`${unit.name} — ${line}`, STATUS_DEFS[unit.statuses[0].id].tint);
      }
    });

    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      const unit = this.unitById(this.activeId);
      if (!unit || unit.team !== 'party') return;
      if (e.key === 'Escape' && this.state === 'playerTarget') { this.cancelTargeting(unit); return; }
      if (e.key === 'e' && this.state === 'playerMove') { this.tryLightBrazier(unit); return; }
      if (e.key === 'c' && this.state === 'playerMove' && !this.moved) { this.toggleCarefulStep(unit); return; }
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
      this.hud.showBanner('Loot secured. Hearth streak climbs.', P.moss);
      // crucible #5 — the streak bump used to persist here immediately (fire-and-forget,
      // independent of hp/loot), while hp/loot only ever settle later when the return
      // scene resumes and recovers the pending outcome (game-event + registry PENDING_KEY
      // — the combatOutcome handed to scene.start below is a decoy nothing reads: init()
      // only destructures seed/packId). A hard reload in the 1600ms gap below kept the
      // early streak write but lost the never-reached settlement — free, no-risk progress.
      // The streak bump now travels through that SAME pending-outcome channel (see
      // DungeonScene.resolveCombat) so a reload here loses (or keeps) all three — streak,
      // loot, hp — together, never just one.
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

  /** Any LIVING unit (either team) standing on a tile — used by the status hover-line. */
  private unitAt(co: Coord): UnitState | undefined {
    return this.units.find((u) => u.alive && u.c === co.c && u.r === co.r);
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
  private enemyHpSum(): number {
    return this.units.filter((u) => u.team === 'enemy' && u.alive).reduce((s, u) => s + Math.max(0, u.hp), 0);
  }

  // ---- DEV/e2e testability surface (read-only snapshot + a pilot hint) ----------
  // Mirrors the hamlet's debug reads (window.__FABLEWOOD_GAME → getScene('combat')). The
  // combat board exposes no turn/board state otherwise, so the e2e drives + observes here.

  /** Force the ?demo autopilot to prefer one action kind (e2e only); null = default order. */
  setPilotPreference(kind: string | null): void {
    this.debugPrefer = (kind as ActionKind) || null;
  }

  /** True exactly while the boss-phase-opening portrait reveal is on screen (e2e only). */
  bossRevealActive(): boolean {
    return this.bossReveal !== null;
  }

  /** Debug: the HUD's party-panel raw text (e2e-only — crucible #10: proves the sidebar
   *  reflects live hp rather than a stale pre-damage snapshot). */
  hudPartyText(): string {
    return this.hud.partyPanelText();
  }

  /** Debug: the encounterId the most recently resolved encounter answered against
   *  (e2e-only — crucible #11: proves a boss phase resolved the pack's own authored
   *  encounter rather than encounters/engine.ts's generic candidates[0] fallback). */
  lastEncounterId(): string | null {
    return this.results.length ? this.results[this.results.length - 1].encounterId : null;
  }

  combatSnapshot(): {
    state: string; activeTeam: string | null; activeId: string; enemyHp: number; partyHp: number;
    log: Array<{ action: string; dmg: number; overlay: boolean }>;
  } {
    return {
      state: this.state,
      activeTeam: this.unitById(this.activeId)?.team ?? null,
      activeId: this.activeId,
      enemyHp: this.enemyHpSum(),
      partyHp: this.units.filter((u) => u.team === 'party').reduce((s, u) => s + Math.max(0, u.hp), 0),
      log: this.actionLog.slice(),
    };
  }

  /** Debug: full per-unit snapshot (position, hp, attack, statuses) — e2e-only. Lets Phase 1's
   *  board mechanics (Bound-blocks-move, no-permanent-attack-drift, computeHit modifiers) be
   *  asserted directly without needing Phase 2's spellcasting UI to reach them. */
  unitDebug(id: string): {
    c: number; r: number; alive: boolean; hp: number; maxHp: number; attack: number;
    /** the unit view container's current render depth (e2e-only — crucible #16: proves a
     *  corpse's frozen depth always stays below a same-row living unit's). */
    depth: number;
    statuses: Array<{ id: string; turnsLeft: number; magnitude: number }>;
  } | null {
    const u = this.unitById(id);
    if (!u) return null;
    return {
      c: u.c, r: u.r, alive: u.alive, hp: u.hp, maxHp: u.maxHp, attack: u.attack,
      depth: this.views.get(id)?.container.depth ?? 0,
      statuses: u.statuses.map((s) => ({ id: s.id, turnsLeft: s.turnsLeft, magnitude: s.magnitude })),
    };
  }

  /** Debug: apply a status directly, bypassing spellcasting (e2e-only — Phase 2 wires real
   *  casts; this exercises Phase 1's board mechanics, e.g. Bound blocking a move, without it). */
  debugApplyStatus(id: string, statusId: StatusId, turns: number, magnitude = 1): void {
    const u = this.unitById(id);
    if (!u) return;
    u.statuses = applyStatus(u, statusId, turns, magnitude);
    this.drawHpBar(u);
  }

  /** Debug: teleport a living unit (e2e-only test setup — e.g. arranging a wall-adjacent
   *  position to test forced-movement bump deterministically, the same spirit as other combat
   *  e2e specs seeding save/inventory state directly rather than fighting to a precondition). */
  debugSetPos(id: string, c: number, r: number): void {
    const u = this.unitById(id);
    if (!u || !u.alive) return;
    u.c = c; u.r = r;
    const v = this.views.get(id);
    if (v) {
      const p = this.tileToScreen(u);
      v.container.setPosition(p.x, p.y).setDepth(10 + r);
    }
  }

  /** Debug: current layout — tiles grid + brazier/mist coords (e2e-only; screenshots and the
   *  brazier-interact / mist-lane assertions need to locate these without guessing seeds). */
  layoutDebug(): { tiles: TileType[][]; braziers: Coord[]; mist: Coord[] } {
    return { tiles: this.layout.tiles, braziers: this.layout.braziers, mist: this.layout.mist };
  }
}
