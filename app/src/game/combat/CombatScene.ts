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
  type Quality,
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
import { CombatHud, type TierRow, type OverglowRow } from './hud';
import { fixtureLaunch, FIXTURE_FACTS, FIXTURE_PACK_ID } from './fixtures';
import { P, hex } from './palette';
import { music } from '../../music/instance';
import { usableSatchelItems, resolveHealUse } from './satchel';
import { itemById } from '../../inventory/catalog';
import { openCombatSatchelPane } from '../../inventory/ui/combatSatchelPane';
import {
  SPELLBOOK, resolveSpell, spellsForArt, qualitySlot, type SpellDef, type SpellId, type BoardOp, type ResolveSpellOpts,
} from './spells';
import {
  ARTS, computeRank, GLOW_CAP, glowGain, glowSpend, canOverglow, dueRenewalSurge, seenDueIds, weldBonus,
  type ArtRanks, type GlowState,
} from './arts';

const ORIGIN = { x: (960 - GRID_W * CELL) / 2, y: 48 }; // 192, 48 → grid spans y 48..432

type Phase = 'boot' | 'playerMove' | 'playerTarget' | 'playerTier' | 'resolving' | 'enemy' | 'over';

/**
 * §6 dev/e2e harness override: `?rank=1|2|3` beside `?demo=1`/`?boss=1`/`?kit=1` — tiers
 * must be testable without a seeded SRS. Any other value (absent, malformed, out of range)
 * falls back to null (the computed rank governs, per computeRank/arts.ts).
 */
export function parseRankOverride(raw: string | null): 1 | 2 | 3 | null {
  const n = Number(raw);
  return n === 1 || n === 2 || n === 3 ? n : null;
}

/** The five Arts' T1 action buttons — the only ones a tier flyout (§12.2) can open. */
const ART_ACTIONS: ReadonlySet<ActionKind> = new Set(['smite', 'weave', 'sequence', 'cast', 'parley']);

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

  // §2/§5/§6 the Five Arts & Glow (Phase 2 — magic-combat-depth.md)
  /** dev/e2e harness override (?rank=1|2|3); null = use the computed rank. */
  private rankOverride: 1 | 2 | 3 | null = null;
  /** cached ONCE per battle (loadContent, after allFactIds is built) — never recomputed mid-battle. */
  private rank: 1 | 2 | 3 = 1;
  private rankInfo: ArtRanks = { rank: 1, welded3: 0, welded4: 0 };
  /** party-shared, per-battle, reset in create() — NEVER persisted (§13/§14). */
  private glow: GlowState = { pips: 0 };
  /** the concrete spell about to be cast; set only when a T2/T3 tier is chosen via the
   *  flyout. Null (T1/strike) means runPlayerAction's untouched Phase-1/T1 path applies. */
  private pendingSpell: SpellDef | null = null;
  /** which Art button opened the currently-open tier flyout (state==='playerTier' only). */
  private flyoutAction: ActionKind | null = null;
  /** §5.3 Overglow per-cast toggle ('o' in the flyout); reset whenever the flyout (re)opens. */
  private overglowOn = false;
  /** the action-bar items last shown (showMenu) — lets the flyout anchor above the right button. */
  private menuItems: Array<{ action: ActionKind; enabled: boolean; reason?: string }> = [];
  /** the tier flyout's most recently rendered rows/Overglow state (e2e debug reads only —
   *  the flyout itself is Phaser-drawn, not DOM, so tests can't inspect it via a locator). */
  private lastFlyoutRows: TierRow[] = [];
  private lastFlyoutOverglow: OverglowRow | null = null;

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
    this.rankOverride = parseRankOverride(params.get('rank'));
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
    this.rank = 1;
    this.rankInfo = { rank: 1, welded3: 0, welded4: 0 };
    this.glow = { pips: 0 };
    this.pendingSpell = null;
    this.flyoutAction = null;
    this.overglowOn = false;
    this.menuItems = [];
    this.lastFlyoutRows = [];
    this.lastFlyoutOverglow = null;

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
      this.hud.setRankLine(this.rank, this.rankInfo.welded4);
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

    // §6 — one global rank off Leitner box distribution, computed ONCE per battle (cached in
    // this.rank/this.rankInfo — trap 1, never recomputed mid-battle) over the battle's full
    // fact pool. ?rank= overrides the computed value so e2e/dev never needs a seeded SRS.
    this.rankInfo = computeRank((id) => this.boxOfSafe(id), [...this.allFactIds]);
    this.rank = this.rankOverride ?? this.rankInfo.rank;
  }

  /** `services.srs.boxOf`, tolerant of an offline/stub SRS (0 = unseen, the honest default). */
  private boxOfSafe(id: string): number {
    try { return services.srs.boxOf(id); } catch { return 0; }
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
      // crucible v1 #7 — a skipped (Staggered) turn never reached endPlayerTurn/doAttack (the
      // only other callers of endTurnDecay), so any status CO-APPLIED with Staggered (e.g.
      // Parley-good's own Staggered(1)+Weakened(2)) missed a full round of turn-end decay.
      // §3 rule 3 has no carve-out for a skipped turn — decay still runs at this unit's own
      // turn end, whether or not it got to act.
      this.endTurnDecay(unit);
      this.hud.showBanner(`${unit.name} is staggered — it loses its turn.`, P.duskPeach);
      this.time.delayedCall(650, () => this.advanceTurn());
      return;
    }
    if (unit.team === 'party') {
      // §5.1 Glow source 2 — a party unit starting ITS turn on a lit lantern tile grants +1
      // Glow. Checked exactly once, right here at turn start, so no stacking trick is possible;
      // a unit felled by Kindled or Staggered above never reaches this branch, so a lost turn
      // grants nothing (matches "starts ITS turn", not "stood on a tile at some point"). Reuses
      // the existing Glow-gain path (glowGain + refreshParty), same as brazier-lit/due-renewal.
      if (this.tileTypeOf(unit) === 'lantern') {
        this.glow = glowGain(this.glow, 'lantern-turn-start');
        this.refreshParty();
      }
      this.beginPlayerTurn(unit);
    } else this.time.delayedCall(320, () => this.runEnemyTurn(unit));
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
    this.pendingSpell = null;
    this.overglowOn = false;
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
   *  becoming 'lantern' is itself the once-only gate). §5.1 Glow source — wires the Phase-1
   *  no-op hook: lighting a brazier grants the party +1 Glow immediately. */
  private tryLightBrazier(unit: UnitState): void {
    const co = this.layout.braziers.find(
      (b) => this.layout.tiles[b.r][b.c] === 'brazier' && manhattan(unit, b) === 1,
    );
    if (!co) return;
    this.layout.tiles[co.r][co.c] = 'lantern';
    const img = this.tileImages.get(key(co.c, co.r));
    if (img) img.setTexture(TILE_KEYS.lantern);
    this.glow = glowGain(this.glow, 'brazier-lit');
    this.refreshParty();
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
        this.pendingSpell = null; // autopilot always drives the T1 anchor action, never a flyout tier
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
      return { action, enabled: targets.length > 0, reason: targets.length ? undefined : 'no foe within reach' };
    });
    this.menuItems = items;
    this.hud.showActionMenu(items, (a) => this.onPickAction(unit, a));
  }

  private onPickAction(unit: UnitState, action: ActionKind): void {
    if (this.state !== 'playerMove' && this.state !== 'playerTarget') return;
    if (unit.id !== this.activeId) return;
    if (action === 'wait') { this.hud.showBanner('Holding position.', P.stoneGrey); this.endPlayerTurn(); return; }
    if (action === 'satchel') { void this.openSatchel(unit); return; }
    // §12.2 — Rank≥2 pressing an Art opens the tier flyout instead of casting T1 directly.
    // At Rank 1 this branch never taken: today's exact flow, zero regression.
    if (ART_ACTIONS.has(action) && this.rank >= 2) { this.openTierFlyout(unit, action); return; }
    this.pendingSpell = null; // T1/strike: the untouched Phase-1 resolveAction/applyOutcome path
    const targets = this.validTargets(unit, action);
    if (!targets.length) { this.hud.showBanner(`${ACTIONS[action].label}: no foe within reach.`, P.stoneGrey); return; }
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
    const label = this.pendingSpell?.label ?? ACTIONS[action].label;
    this.hud.showBanner(`${label} — choose a target. (Esc cancels)`, ACTIONS[action].tint);
  }

  private cancelTargeting(unit: UnitState): void {
    this.state = 'playerMove';
    this.pendingAction = null;
    this.pendingSpell = null;
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

  // ---- tier flyout (§12.2, Rank 2+) --------------------------------------

  /** Target legality for a SPECIFIC spell (any tier) — used by the flyout's row-enabling and
   *  by a T2/T3 cast's own targeting phase. T1 rows reuse this too (numbers match validTargets
   *  exactly by design — spellsForArt(art)[0] IS the shipped T1 SpellDef). */
  private validTargetsForSpell(unit: UnitState, spell: SpellDef): UnitState[] {
    const enemies = this.units.filter((u) => u.alive && u.team === 'enemy');
    switch (spell.shape) {
      case 'single':
        if (spell.id === 'parley') return enemies.filter((e) => e.parley && manhattan(unit, e) <= spell.range);
        return enemies.filter((e) => manhattan(unit, e) <= spell.range);
      case 'cross':
        return enemies.filter((e) => manhattan(unit, e) <= spell.range);
      case 'line':
        return enemies.filter((e) => hasLineOfFire(unit, e, spell.range, this.layout.tiles));
      case 'burst1':
        return enemies.filter((e) => manhattan(unit, e) === 1);
      case 'self':
        return [];
      case 'ally':
        return this.units.filter((u) => u.alive && u.team === 'party' && manhattan(unit, u) <= spell.range);
      default: {
        const exhaustive: never = spell.shape;
        return exhaustive;
      }
    }
  }

  /** One flyout row: greys with a reason via Rank, Glow, then target availability, in that order. */
  private tierRow(unit: UnitState, spell: SpellDef): TierRow {
    const costText = spell.glowCost === 0 ? 'free' : `◈${spell.glowCost}`;
    if (spell.tier > this.rank) {
      return { tier: spell.tier, label: spell.label, costText, enabled: false, reason: `needs Rank ${spell.tier}` };
    }
    if (this.glow.pips < spell.glowCost) {
      return { tier: spell.tier, label: spell.label, costText, enabled: false, reason: `needs ${spell.glowCost} glow` };
    }
    if (spell.shape === 'self') {
      return { tier: spell.tier, label: spell.label, costText, enabled: true };
    }
    const targets = this.validTargetsForSpell(unit, spell);
    return targets.length
      ? { tier: spell.tier, label: spell.label, costText, enabled: true }
      : { tier: spell.tier, label: spell.label, costText, enabled: false, reason: 'no foe within reach' };
  }

  /** Rank≥2 pressing an Art opens this instead of casting T1 directly. Phaser-drawn (container,
   *  like showActionMenu) — never a DOM pane, so it must not quiet the keyboard. */
  private openTierFlyout(unit: UnitState, action: ActionKind): void {
    this.state = 'playerTier';
    this.flyoutAction = action;
    this.overglowOn = false;
    this.hud.hideActionMenu();
    this.renderFlyout(unit, action);
    const art = SPELLBOOK[action as SpellId].art;
    this.hud.showBanner(`${ARTS[art].label} — choose a tier. (Esc closes)`, ACTIONS[action].tint);
  }

  private renderFlyout(unit: UnitState, action: ActionKind): void {
    const spells = spellsForArt(SPELLBOOK[action as SpellId].art);
    const rows: TierRow[] = spells.map((s) => this.tierRow(unit, s));
    // §12.2 — the Overglow toggle is offered "when a damaging tier is highlighted"; this
    // flyout has no live hover-tracking, so the default/focus tier is the highest one
    // currently unlocked (rank-derived) — matches spec's own worked example (Rank 3 Kindling
    // defaults to Lanternfall, correctly greying Overglow for a burst spell per the phase2-
    // spells decision: burst spells can't multiply).
    const focusTier = Math.min(this.rank, 3) as 1 | 2 | 3;
    const focusSpell = spells.find((s) => s.tier === focusTier) ?? spells[0];
    // crucible v1 #9 — gate on the tier's OWN POST-COST remainder, not the wholesale total:
    // castGatedSpell already rechecks canOverglow against glowSpend's post-cost state (line
    // ~1123 below), so a wholesale-total gate here silently disagreed exactly when
    // glow.pips === focusSpell.glowCost — the flyout armed a toggle castGatedSpell would then
    // drop with no warning. Offering it only when a real pip survives paying the tier's own
    // cost keeps the two checks (and the player's expectation) in sync.
    const focusRemainder: GlowState = { pips: this.glow.pips - focusSpell.glowCost };
    const overglow: OverglowRow | null = canOverglow(this.rank, focusRemainder)
      ? {
          enabled: focusSpell.shape !== 'burst1',
          on: this.overglowOn,
          reason: focusSpell.shape === 'burst1' ? "won't multiply a burst" : undefined,
        }
      : null;
    this.lastFlyoutRows = rows;
    this.lastFlyoutOverglow = overglow;
    const x = this.hud.getActionButtonX(this.menuItems, action);
    this.hud.showTierFlyout(
      x, rows, overglow,
      (tier) => this.pickTierKey(unit, tier),
      () => this.toggleOverglowKey(unit),
    );
  }

  private closeTierFlyout(unit: UnitState): void {
    this.flyoutAction = null;
    this.hud.hideTierFlyout();
    this.state = 'playerMove';
    if (!this.moved) this.drawMoveRange();
    this.showMenu(unit);
  }

  private toggleOverglowKey(unit: UnitState): void {
    if (this.state !== 'playerTier' || !this.flyoutAction) return;
    const action = this.flyoutAction;
    const spells = spellsForArt(SPELLBOOK[action as SpellId].art);
    const focusTier = Math.min(this.rank, 3) as 1 | 2 | 3;
    const focusSpell = spells.find((s) => s.tier === focusTier) ?? spells[0];
    // crucible v1 #9 — same post-cost-remainder gate as renderFlyout's Overglow row, so a
    // toggle keyed off a stale (still-armed) row can never fire this once the row itself has
    // been correctly regreyed.
    const focusRemainder: GlowState = { pips: this.glow.pips - focusSpell.glowCost };
    if (!canOverglow(this.rank, focusRemainder) || focusSpell.shape === 'burst1') return; // greyed — no-op
    this.overglowOn = !this.overglowOn;
    this.renderFlyout(unit, action);
  }

  private pickTierKey(unit: UnitState, tier: 1 | 2 | 3): void {
    if (this.state !== 'playerTier' || !this.flyoutAction) return;
    const action = this.flyoutAction;
    const spell = spellsForArt(SPELLBOOK[action as SpellId].art).find((s) => s.tier === tier);
    if (!spell) return;
    const row = this.tierRow(unit, spell);
    if (!row.enabled) return;
    const overglow = this.overglowOn;
    this.flyoutAction = null;
    this.hud.hideTierFlyout();
    this.pendingSpell = spell;
    // §5.3 — Overglow never applies to a burst1 spell (Lanternfall); carrying `false` through
    // rather than leaving it `true`-but-inert keeps castGatedSpell's own bookkeeping honest.
    this.overglowOn = overglow && spell.shape !== 'burst1';

    if (spell.shape === 'self' || spell.shape === 'burst1') {
      // No tile to choose (self/self-anchored burst) — resolves immediately, like Wait/Satchel.
      void this.runPlayerAction(unit, action, { c: unit.c, r: unit.r });
      return;
    }
    const targets = this.validTargetsForSpell(unit, spell);
    this.enterTargeting(action, targets);
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
        // crucible v1 #6 — flank must be evaluated against the tile `mover` is leaving
        // (`vacated`), not `mover`'s live c/r — both call sites (movePlayerTo, the enemy-move
        // branch of runEnemyTurn) already mutate unit.c/r to the LANDING tile before calling
        // this method, so `mover` here reads as already-arrived; passing `vacated` instead
        // restores "flank geometry evaluated relative to the tile being left" (§4.1/§4.2).
        const flank = isFlanked(striker, vacated, striker.team, this.units);
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
      const dealt = before - this.enemyHpSum();
      this.actionLog.push({ action: 'strike', dmg: dealt, overlay: false });
      // §5.1 Glow source 1 — a Strike that deals damage grants the party +1 Glow. `dealt` is
      // the same before/after enemy-hp delta actionLog uses above: already resolved past flank
      // (computeHit, inside meleeHit) and past absorption (wardenAbsorbs/Warded), so "> 0" means
      // exactly "actually dealt ≥1 damage after all modifiers/absorption". `unit` is always the
      // active PARTY unit here (T1 strike only ever runs from a party turn via runPlayerAction),
      // but the team guard stays explicit — Glow must never flow from an enemy action. Reuses
      // the existing Glow-gain path (glowGain + the refreshParty just below), so the cap and the
      // pip +pulse (hud.ts) apply unchanged.
      if (unit.team === 'party' && dealt > 0) this.glow = glowGain(this.glow, 'strike');
      this.refreshParty();
      this.time.delayedCall(440, () => this.endPlayerTurn());
      return;
    }

    // §12.2 — a T2/T3 spell chosen via the flyout resolves through the SpellDef/BoardOp
    // pipeline (castGatedSpell) instead of the T1 resolveAction/applyOutcome chain below,
    // which stays byte-for-byte untouched (adapter-equivalence proven in combat.test.ts's
    // "adapter equivalence — resolveAction over resolveSpell" suite) — Rank 1 sees today's
    // exact flow, since pendingSpell is only ever non-null after a flyout tier pick, and the
    // flyout itself never opens below Rank 2.
    if (this.pendingSpell && this.pendingSpell.tier > 1) {
      await this.castGatedSpell(unit, action, this.pendingSpell, tile);
      return;
    }

    // GATED POWER MOVES: answering the question IS the cast. Each hits far harder than a
    // free Strike — that payoff is what the friction now buys. (T1 only — a T2/T3 tier
    // chosen via the flyout is routed to castGatedSpell below, BEFORE this branch runs.)
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
    // §5.1 Glow source 4 (trap 14): snapshot due-ness BEFORE record() mutates the queue.
    // This applies to every T1 cast too, not just T2/T3 — the SRS loop is the mana engine
    // regardless of which tier answering the question happens to buy.
    const dueSetAtCast = this.snapshotDueSet();
    // Record FIRST — the learning record is sacred: never dropped, even if the
    // scene tears down mid-overlay (record() is pure service work, safe when dead).
    this.results.push(result);
    await this.record(result);
    if (this.destroyed) return;
    this.hud.setDeliberating(false);
    if (dueRenewalSurge(result.quality, result.factIds, dueSetAtCast)) {
      this.glow = glowGain(this.glow, 'due-renewal');
      this.refreshParty();
    }

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

  /**
   * §12.2/§2 — a T2/T3 spell's full resolution: spend Glow (+ Overglow), run the encounter
   * (with `flair` for the overlay eyebrow, §12.4), snapshot-then-record SRS (due-renewal +
   * weld edge both captured pre-record, trap 14), resolve the board geometry, dispatch through
   * resolveSpell, and apply the resulting BoardOps generically (applySpellOps) — the
   * SpellDef/BoardOp-driven pipeline §16 trap 4 describes, scoped to T2/T3 only so the T1
   * path above stays byte-for-byte untouched.
   */
  private async castGatedSpell(unit: UnitState, action: ActionKind, spell: SpellDef, tile: Coord): Promise<void> {
    const target = spell.shape === 'ally' ? this.unitAt(tile) : this.enemyAt(tile);
    const vsBoss = !!(target && target.team === 'enemy' && target.isBoss);
    const artKind = ARTS[spell.art].encounter;
    const factIds = this.dueFactIds(this.roomTags);
    const context = spell.art === 'courtcraft' ? 'parley' : vsBoss ? 'boss' : 'combat';

    // Spend Glow up front — the flyout only ever offered an enabled row when this would
    // succeed, but re-check defensively rather than trust stale UI state across the awaits below.
    const spend = glowSpend(this.glow, spell.glowCost);
    if (!spend.ok) {
      this.hud.showBanner(`${spell.label}: needs ${spell.glowCost} glow.`, P.stoneGrey);
      this.returnToActionMenu(unit);
      return;
    }
    const overglow = this.overglowOn && spell.shape !== 'burst1' && canOverglow(this.rank, spend.state);
    const afterOverglow = overglow ? glowSpend(spend.state, 1) : spend;
    this.glow = afterOverglow.ok ? afterOverglow.state : spend.state;
    this.overglowOn = false;
    this.refreshParty();

    const dueSetAtCast = this.snapshotDueSet();

    if (artKind === 'free_recall') this.hud.setDeliberating(true);
    let result: EncounterResult;
    try {
      result = await services.runEncounter({
        context, kinds: [artKind], factIds, packId: this.launch.packId, seed: this.encSeed++, flair: spell.label,
      });
    } catch {
      result = { encounterId: `local-${spell.id}`, kind: artKind, factIds: factIds.slice(0, 1), quality: 0.5, detail: 'offline' };
    }
    // §5.5 the weld edge: capture every involved fact's box BEFORE record() mutates it (trap
    // 14 — same capture-before-record duty as the due-renewal snapshot above).
    const factBoxesAtCast = result.factIds.map((id) => this.boxOfSafe(id));
    this.results.push(result);
    await this.record(result);
    if (this.destroyed) return;
    if (artKind === 'free_recall') this.hud.setDeliberating(false);

    if (dueRenewalSurge(result.quality, result.factIds, dueSetAtCast)) {
      this.glow = glowGain(this.glow, 'due-renewal');
      this.refreshParty();
    }

    let dmgQuality = result.quality;
    if (dmgQuality === 0 && this.graceAvailable && this.tileTypeOf(unit) === 'lantern') {
      dmgQuality = 0.5;
      this.graceAvailable = false;
      this.hud.showBanner('The lantern steadies you — the miss becomes a graze.', P.lanternGold);
    }
    // Courtcraft's quality IS the branch outcome (kinds.ts renderScenario): good=1/neutral=0.5/
    // bad=0 — same mapping damage.ts's resolveAction adapter uses for T1 Parley.
    const quality: Quality = spell.art === 'courtcraft'
      ? (result.branchTag === 'good' ? 1 : result.branchTag === 'bad' ? 0 : 0.5)
      : dmgQuality;

    const miraBonus = unit.id === 'mira' && this.miraBonusActive() ? 1 : 0;
    const weld = weldBonus(factBoxesAtCast) === 1;
    const geometry = this.spellGeometry(unit, spell, tile, quality);
    const opts: ResolveSpellOpts = {
      primaryTargetId: geometry.primaryId,
      aoeTargetIds: geometry.aoeIds,
      partyIds: this.units.filter((u) => u.team === 'party' && u.alive).map((u) => u.id),
      enemyIds: this.units.filter((u) => u.team === 'enemy' && u.alive).map((u) => u.id),
      dir: geometry.dir,
      overglow,
      weld,
      miraBonus,
      vsBoss,
    };
    const ops = resolveSpell(spell, quality, opts);

    if (spell.shape !== 'self' && spell.shape !== 'burst1') this.attackerTell(unit, tile, ACTIONS[action].tint);
    const before = this.enemyHpSum();
    const bannerOp = ops.find((o): o is Extract<BoardOp, { op: 'banner' }> => o.op === 'banner');
    this.applySpellOps(unit, action, ops);
    this.actionLog.push({ action, dmg: before - this.enemyHpSum(), overlay: true });

    // §9 trap 10 — the shield gate stays string-matched on the ActionKind (unchanged boss.ts,
    // Phase 3's job to generalize): since Attested Ward/Verbatim Decree both live behind the
    // 'cast' button, wardenAbsorbs('cast',...) already lets every Attestation tier pierce,
    // exactly like T1 Cast — no boss.ts edit needed this phase.
    if (spell.bossRider === 'strip-shield' && quality === 1 && vsBoss && this.boss) {
      this.shields = reduceShields(this.shields, 1);
      this.floatText(this.boss, '−shield', P.waterLight);
      this.syncBoss();
    }

    if (bannerOp) this.hud.showBanner(bannerOp.text, quality > 0 ? ACTIONS[action].tint : P.duskRose);
    this.refreshParty();
    this.time.delayedCall(620, () => this.endPlayerTurn());
  }

  /** Resolves a spell's board geometry (primary/aoe target ids + push direction) from its
   *  OWN shape/range (which may differ from its Art's T1 anchor action, e.g. Snare-Knot is
   *  range-3 single where Weave is range-2 cross) — the "caller resolves ids, board-aware"
   *  half of resolveSpell's contract (spells.ts's ResolveSpellOpts doc). */
  private spellGeometry(
    unit: UnitState, spell: SpellDef, tile: Coord, quality: Quality,
  ): { primaryId?: string; aoeIds: string[]; dir?: Dir } {
    switch (spell.shape) {
      case 'single': {
        const t = this.enemyAt(tile);
        return { primaryId: t?.id, aoeIds: [] };
      }
      case 'ally': {
        const t = this.unitAt(tile);
        return { primaryId: t && t.team === 'party' ? t.id : undefined, aoeIds: [] };
      }
      case 'cross': {
        const primary = this.enemyAt(tile);
        const aoeIds: string[] = [];
        for (const co of crossTiles(tile)) {
          if (co.c === tile.c && co.r === tile.r) continue;
          const e = this.enemyAt(co);
          if (e) aoeIds.push(e.id);
        }
        return { primaryId: primary?.id, aoeIds };
      }
      case 'line': {
        const dir = this.dirTo(unit, tile) ?? undefined;
        if (!dir) return { aoeIds: [] };
        const depth = spell.effects[qualitySlot(quality)].lineDepth;
        let primaryId: string | undefined;
        const aoeIds: string[] = [];
        for (const [i, co] of lineTiles(unit, dir, depth).entries()) {
          const e = this.enemyAt(co);
          if (e) { if (i === 0) primaryId = e.id; else aoeIds.push(e.id); }
          // §4.4 — mist (and walls) block Ritecraft lines, same as sequence's own handling.
          if (blocksSight(this.tileTypeOf(co))) break;
        }
        return { primaryId, aoeIds, dir };
      }
      case 'burst1': {
        const aoeIds: string[] = [];
        for (const co of crossTiles(unit)) {
          if (co.c === unit.c && co.r === unit.r) continue;
          const e = this.enemyAt(co);
          if (e) aoeIds.push(e.id);
        }
        return { aoeIds };
      }
      case 'self':
        return { aoeIds: [] };
      default: {
        const exhaustive: never = spell.shape;
        return exhaustive;
      }
    }
  }

  /**
   * Applies a resolveSpell BoardOp[] to the live board — the scene-side half of spells.ts's
   * documented contract: 'damage' ops route through computeHit AGAIN with the REAL live
   * attacker/target statuses (overglow/weld already baked into the op's amount, so
   * `overglow:false, weld:false` here — never double-counted); flank is always false (spells
   * never flank, §4.1). The 'banner' op is intentionally skipped — the caller shows it with
   * a quality-derived tint, mirroring the T1 path's own banner call.
   */
  private applySpellOps(caster: UnitState, action: ActionKind, ops: BoardOp[]): void {
    for (const op of ops) {
      if (op.op === 'banner') continue;
      if (op.op === 'fade') { this.damageParty(op.amount, caster); continue; }
      if (op.op === 'damage') {
        const target = this.unitById(op.targetId);
        if (!target?.alive) continue;
        if (wardenAbsorbs(action, target.isBoss, this.shields)) { this.floatText(target, 'shielded', P.waterLight); continue; }
        const result = computeHit({
          base: op.amount, attackerStatuses: caster.statuses, targetStatuses: target.statuses,
          flank: false, overglow: false, weld: false,
        });
        target.statuses = result.targetStatuses;
        if (result.hpDamage > 0) this.damageUnit(target, result.hpDamage, ACTIONS[action].tint);
        else if (result.absorbed > 0) this.floatText(target, 'warded', P.waterBlue);
        continue;
      }
      if (op.op === 'status') {
        const target = this.unitById(op.targetId);
        if (!target?.alive) continue;
        // §8 Bond-proof: constructs shrug Bound off — applyStatus already no-ops the state
        // change; the scene surfaces the exact banner text the construct-immunity spec wants.
        if (op.id === 'bound' && target.kind === 'construct') {
          this.hud.showBanner('Nothing in it to bind.', P.stoneGrey);
          continue;
        }
        target.statuses = applyStatus(target, op.id, op.turns, op.magnitude);
        this.drawHpBar(target);
        this.floatText(target, STATUS_DEFS[op.id].label, STATUS_DEFS[op.id].tint);
        continue;
      }
      if (op.op === 'push') {
        const target = this.unitById(op.targetId);
        if (target?.alive) this.pushUnit(caster, target, op.dir, action);
        continue;
      }
      if (op.op === 'heal') {
        const target = this.unitById(op.targetId);
        if (target?.alive) this.healUnit(target, op.amount);
      }
    }
  }

  /** §4.3 forced movement, applied to a spell's push (Cinder-Rebuke/Processional): same
   *  forceMove + bump-damage rules as construct's Vault-Slam (enemyStrike below). */
  private pushUnit(caster: UnitState, target: UnitState, dir: Dir, action: ActionKind): void {
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
      return;
    }
    if (!res.bump) return;
    if (wardenAbsorbs(action, target.isBoss, this.shields)) { this.floatText(target, 'shielded', P.waterLight); return; }
    const result = computeHit({
      base: 1, attackerStatuses: caster.statuses, targetStatuses: target.statuses,
      flank: false, overglow: false, weld: false,
    });
    target.statuses = result.targetStatuses;
    if (result.hpDamage > 0) {
      this.damageUnit(target, result.hpDamage, P.berry);
      this.actionLog.push({ action: 'bump', dmg: result.hpDamage, overlay: false });
    }
  }

  /** Injunction-bad's enemy mend — a simple, un-gated heal-up (no SRS/death implications). */
  private healUnit(target: UnitState, amount: number): void {
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    if (target.hp > before) this.floatText(target, `+${target.hp - before}`, P.moss);
    this.drawHpBar(target);
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
    if (!item) { this.returnToActionMenu(unit); return; }

    // §11.1 — the two Glow items (wick-tallow/lantern-brand): combat-only, so unlike heals
    // there is no services.save write at all — Glow is scene-side, per-battle, never
    // persisted (§13). services.inventory.removeItem is the SAME stack-decrement choke point
    // useItem's own heal branch calls internally (store.remove); consume.ts's useItem itself
    // always refuses 'glow' (it has no battle to grant into), so this bypasses it deliberately.
    if (item.effect.kind === 'glow') {
      if (this.glow.pips >= GLOW_CAP) {
        this.hud.showBanner('The wick is already bright.', P.stoneGrey);
        this.returnToActionMenu(unit);
        return;
      }
      let removed = false;
      try { removed = await services.inventory.removeItem(id, 1); } catch { removed = false; }
      if (this.destroyed) return;
      if (!removed) {
        this.hud.showBanner('You have none left.', P.stoneGrey);
        this.returnToActionMenu(unit);
        return;
      }
      this.glow = glowGain(this.glow, id === 'lantern-brand' ? 'lantern-brand' : 'wick-tallow');
      this.refreshParty();
      this.hud.showBanner(`${item.name} — the wick brightens.`, P.lanternGold);
      this.actionLog.push({ action: 'satchel', dmg: 0, overlay: false });
      this.time.delayedCall(560, () => this.endPlayerTurn());
      return;
    }

    const keeper = this.unitById('keeper');
    const mira = this.unitById('mira');
    if (!keeper || !mira) { this.returnToActionMenu(unit); return; }

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
    // §12.2 — a T2/T3 spell's shape/range can differ from its Art's T1 anchor action (e.g.
    // Snare-Knot is range-3 single where Weave is range-2 cross); prefer pendingSpell's own
    // shape/range when a tier was chosen via the flyout, else fall back to the action's
    // (T1/strike, unchanged).
    const shape = this.pendingSpell?.shape ?? ACTIONS[this.pendingAction].shape;
    if (shape === 'cross') for (const co of crossTiles(tile)) mark(co, P.orchid);
    else if (shape === 'line') {
      const dir = this.dirTo(unit, tile);
      const maxDepth = this.pendingSpell?.effects.q1.lineDepth ?? 3;
      if (dir) for (const co of lineTiles(unit, dir, maxDepth)) mark(co, P.waterBlue);
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
      // §12.2 — the tier flyout owns its own small key set (1/2/3 pick, 'o' toggles Overglow,
      // Esc closes back to the action menu) and swallows everything else while open, so a
      // stray '1'-'7' press can never double-fire as a normal action-bar hotkey underneath it.
      if (this.state === 'playerTier') {
        if (e.key === 'Escape') { this.closeTierFlyout(unit); return; }
        if (e.key === 'o') { this.toggleOverglowKey(unit); return; }
        if (e.key === '1' || e.key === '2' || e.key === '3') { this.pickTierKey(unit, Number(e.key) as 1 | 2 | 3); return; }
        return;
      }
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

  /** §5.1 source 4 / trap 14 — the "at cast time" due-set snapshot dueRenewalSurge needs,
   *  MUST be captured before record() mutates dueQueue membership. seenDueIds (arts.ts)
   *  disambiguates dueQueue's mixed seen-due/unseen result via boxOf. */
  private snapshotDueSet(): Set<string> {
    try {
      const due = services.srs.dueQueue(this.launch.packId, [...this.allFactIds]);
      return seenDueIds(due, (id) => this.boxOfSafe(id));
    } catch { return new Set(); }
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
      this.hud.showToast('The foe falls, Keeper.', P.lanternGold);
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
      glow: this.glow.pips,
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
    /** §6/§5 — e2e-only reads for Phase 2 (rank cache + Glow pips), same "read-only debug
     *  surface" spirit as everything else in this section. */
    rank: number; welded3: number; welded4: number; glow: number;
  } {
    return {
      state: this.state,
      activeTeam: this.unitById(this.activeId)?.team ?? null,
      activeId: this.activeId,
      enemyHp: this.enemyHpSum(),
      partyHp: this.units.filter((u) => u.team === 'party').reduce((s, u) => s + Math.max(0, u.hp), 0),
      log: this.actionLog.slice(),
      rank: this.rank,
      welded3: this.rankInfo.welded3,
      welded4: this.rankInfo.welded4,
      glow: this.glow.pips,
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
    // e2e test setup (crucible v1 #6 verification): repositioning the unit whose move menu is
    // ALREADY open would otherwise leave moveField/reachable stale (computed from the
    // pre-teleport tile) — refresh them so a test can debugSetPos the active unit into a
    // specific pincer/geometry and then click a real move destination relative to its new spot.
    if (id === this.activeId && this.state === 'playerMove') {
      this.moveField = computeMoveField(u, this.moveBudgetFor(u), this.layout.tiles, this.blockedFor(u.id));
      this.reachable.clear();
      for (const t of reachableTiles(this.moveField, u)) this.reachable.set(key(t.c, t.r), t);
      this.drawMoveRange();
    }
  }

  /** Debug: current layout — tiles grid + brazier/mist coords (e2e-only; screenshots and the
   *  brazier-interact / mist-lane assertions need to locate these without guessing seeds). */
  layoutDebug(): { tiles: TileType[][]; braziers: Coord[]; mist: Coord[] } {
    return { tiles: this.layout.tiles, braziers: this.layout.braziers, mist: this.layout.mist };
  }

  /** Debug: set Glow directly, bypassing sources (e2e-only test setup — a T2/T3 cast e2e
   *  spec needs a pip in hand without fighting a brazier/due-fact precondition, the same
   *  spirit as debugApplyStatus/debugSetPos). Clamped to [0, GLOW_CAP]. */
  debugSetGlow(pips: number): void {
    this.glow = { pips: Math.max(0, Math.min(GLOW_CAP, Math.floor(pips))) };
    this.refreshParty();
  }

  /** Debug: the tier flyout's current rows/Overglow state, if open (e2e-only — the flyout is
   *  Phaser-drawn, not DOM, so a spec can't reach it via a locator; proves greying — e.g.
   *  "needs Rank 3", Overglow greyed for Lanternfall — without depending on click side effects). */
  flyoutDebug(): { rows: TierRow[]; overglow: OverglowRow | null } | null {
    return this.state === 'playerTier' ? { rows: this.lastFlyoutRows, overglow: this.lastFlyoutOverglow } : null;
  }
}
