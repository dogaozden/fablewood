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
  type Quality, type EnemySpec,
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
import { resolveAction, isFlanked, applyAmendedMercy, stripPartyHarmOps, AMENDED_MERCY_LINE } from './damage';
import {
  applyBranch, reduceShields, bossDefeated, wardenAbsorbs, wardenObjects, wardenMove, wardenMoveLabel,
  shieldStripDelta, OBJECTION_BANNER, OBJECTION_RIPOSTE, type WardenMove,
} from './boss';
import { decideEnemy, occupancyExcept, carefulStepMove, opportunityStrikers } from './ai';
import { makeKeeper, makeMira, makeEnemy, makeBoss, MIRA_MASTERY_GATE } from './units';
import { ensureTextures, TILE_KEYS, UNIT_KEYS, CHIP_KEYS } from './textures';
import { tickTurnStart, decayTurnEnd, applyStatus, computeHit, effectiveMove, STATUS_DEFS, type StatusId } from './status';
import { CombatHud, type TierRow, type OverglowRow } from './hud';
import { fixtureLaunch, FIXTURE_FACTS, FIXTURE_PACK_ID } from './fixtures';
import { P, hex } from './palette';
import { music } from '../../music/instance';
import { usableSatchelItems, resolveHealUse } from './satchel';
import { enterDoor, recordAnswer, type DeathsDoorState } from './deathsdoor';
// Direct import, not services.* — presentHoldTheLine is brand new to Task 7, both this file and
// overlay.ts are in this task's own file list, and contracts.ts (the services.* registry's
// shape) is header-marked "ORCHESTRATOR-OWNED — do not edit" and outside that list. Flagged in
// the task report as a deviation from the codebase's usual services-locator pattern.
import { presentHoldTheLine, type HoldTheLineHandle } from '../encounters/overlay';
import { pickKeepsake } from '../inventory/keepsake';
import { itemById } from '../../inventory/catalog';
import { openCombatSatchelPane } from '../../inventory/ui/combatSatchelPane';
import {
  SPELLBOOK, resolveSpell, spellsForArt, qualitySlot, type SpellDef, type SpellId, type BoardOp, type ResolveSpellOpts,
} from './spells';
import {
  ARTS, computeRank, GLOW_CAP, glowGain, glowSpend, canOverglow, dueRenewalSurge, seenDueIds, weldBonus, riderBonus,
  graceAppliesTo, isBossPhaseCast,
  type ArtRanks, type GlowState,
} from './arts';
import { grantXp } from '../progression/grant';
import { maxHpForLevel, strikeBonusForLevel, tierForLevel } from '../progression/xp';
import { reclaimedFactIds } from '../../srs/redemption';
import { mulberry32, layoutSeed } from './rng';
import { partitionByRecency, seededShuffle } from '../recency';
import { DIFFICULTY_DEFS, difficultyPolicyGlyph } from '../encounters/engine';

const ORIGIN = { x: (960 - GRID_W * CELL) / 2, y: 48 }; // 192, 48 → grid spans y 48..432

/**
 * Recency memory for dueFactIds() (director: "am I not over-asked the same things
 * in a row?"). Module-level (not an instance field) so it survives across battles —
 * CombatScene is added to Phaser's scene manager once (PhaserGame.tsx) and reused via
 * scene.start() for every fight, but a shell tab-away-and-back tears the whole
 * Phaser.Game down and rebuilds it, which re-evaluates this module fresh. That's the
 * intended lifetime: "this page session," never persisted (state/ untouched, absent
 * from SaveData) — a hard reload starts empty. Only ever grows via record() below;
 * partitionByRecency deprioritizes, it never excludes, so a saturated set just
 * degrades to the prior (due/shuffled) order rather than breaking anything.
 */
const sessionRecentFactIds = new Set<string>();

/**
 * services.draw.due()/fresh() cap for combat draws (wave-1 draw service; HamletScene's
 * WELLSPRING_DRAW_COUNT is the same cushion for the same reason). encounters/engine.ts's
 * pick() walks these ids in order and takes the first whose fact carries a kind-matching
 * encounter — and due() has already applied that same `kinds` filter — so this needs headroom
 * only over "the most-due few were all just asked" (partitionByRecency reorders within the
 * window), not an exhaustive count.
 */
const COMBAT_DRAW_COUNT = 20;

/**
 * Death's Door deals PLAIN gradeable drills only (Concordance Ch. I — "hold the line with
 * what you know"): one prompt, one answer, one 0/0.5/1 verdict. `match`/`order` are multi-step
 * surface manipulations and `scenario_branch` is the boss/parley setpiece kind — none of the
 * three is a recall save. Unlike the Wellspring's deal this is deliberately NOT kind-blind:
 * services.draw.due() with `kinds` unset can hand back a fact whose only encounter is one of
 * those, and the door has no cast to fall back to when the question turns out undrillable.
 */
const DD_KINDS: EncounterKind[] = ['free_recall', 'mcq'];

/** The door's own name, carried into the drill overlay's eyebrow so the player can see what
 *  the question is FOR (encounters/overlay.ts's `flair` slot). Task 7 lands the full frame. */
const DEATHS_DOOR_TITLE = 'The Ledger Holds Your Line';

let warnedCombatDrawFailure = false;

/**
 * Wave-1 draw service readiness gate for a battle's draws — mirrors encounters/register.ts's
 * resolveCrossPack() and HamletScene's wellspringDrawReady(): await ONLY
 * services.draw.indexReady() (never the fuller ready(), which can reject early on an unrelated
 * srs/amendments failure while the index is still mid-build), catch, warn once, and let
 * loadContent() fall back to the pre-wave-1 single-pack pool rather than throw or hang. A
 * battle must never stall on the picker.
 *
 * Also false for the FIXTURE_PACK_ID launch — the standalone `?scene=combat` dev/e2e fixture
 * and DungeonScene's `dev=1` crawl, which deliberately forces that same sentinel (crucible
 * V1-16) so a fight is launched all-fixture or all-real, never a mix. Widening its pool to the
 * installed packs' real facts would rebuild exactly the hybrid that invariant exists to
 * prevent. Zero packs installed reaches this as `true` and draws an empty index — the
 * FIXTURE_FACTS fallback in loadContent() then applies unchanged (check:zero-packs).
 */
async function combatDrawReady(packId: string): Promise<boolean> {
  if (packId === FIXTURE_PACK_ID) return false;
  try {
    await services.draw.indexReady();
    return true;
  } catch {
    if (!warnedCombatDrawFailure) {
      warnedCombatDrawFailure = true;
      console.warn('[combat] services.draw index failed to load — falling back to the legacy single-pack draw');
    }
    return false;
  }
}

type Phase = 'boot' | 'playerMove' | 'playerTarget' | 'playerTier' | 'resolving' | 'enemy' | 'over' | 'deathsdoor';

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
  /** Wave 4 — the battle's TRUE damage-taken ledger, and hpLost's opposite number. hpLost is a
   *  re-anchoring DELTA: the satchel heal, the death's-door revival and a level-up's pool bump
   *  each legally zero it when they rewrite save.hp mid-battle, so `hpLost === 0` means "nothing
   *  lost since the last re-anchor", never "never bloodied". This grows at the same point and no
   *  re-anchor may touch it, so the flawless-clear grant can ask the question it actually means.
   *  Reset only in create() (trap 1, reused scene instance). */
  private damageTaken = 0;
  /** §3.2 Night's Ledger per-run tallies (consumed by the harvest card on run end): facts
   *  reclaimed from the Fade (§3.1), and facts newly welded (crossed into box ≥ 4) this run.
   *  Both are counted in record(), the single choke point every SRS-recorded encounter passes. */
  private reclaimed = 0;
  private newWelds = 0;
  private graceAvailable = true;
  /** Death's Door (Concordance Ch. I) — the live recall-save run; null whenever the door is shut. */
  private dd: DeathsDoorState | null = null;
  /** Outlives `dd` being cleared: the welded revival is once per BATTLE, not once per door. */
  private ddRevivedUsed = false;
  /** The hold-the-line status card (Task 7); open exactly while `dd` is non-null. */
  private ddFrame: HoldTheLineHandle | null = null;
  private encSeed = 0;
  private destroyed = false;
  private demo = false; // ?demo=1 → autopilot the party (screenshots + e2e)
  // DEV/e2e testability: an optional pilot action preference and a log of resolved player
  // actions (what fired, damage dealt, whether it opened a question overlay). Read-only surface,
  // mirrors the hamlet's debug reads; inert in normal play (nothing sets the preference).
  private debugPrefer: ActionKind | null = null;
  private actionLog: Array<{ action: string; dmg: number; overlay: boolean }> = [];
  // crucible #10 drift-hunt instrumentation: a monotonic count of refreshParty() calls and
  // the most recent party-hp mutation, so an e2e poll can prove whether an apparent hp/HUD
  // mismatch is a genuine desync or just two separate reads straddling one synchronous update.
  private refreshSeq = 0;
  private lastHpEvent: { unitId: string; kind: 'damage' | 'heal'; amount: number; seq: number } | null = null;

  // §4 board mechanics (Phase 1 — magic-combat-depth.md)
  /** tile Image refs so a lit brazier can swap its texture to `tile.lantern` in place. */
  private tileImages = new Map<string, Phaser.GameObjects.Image>();
  /** §4.2 — per-turn toggle ('c'): half move, provokes no opportunity strikes. Reset each turn. */
  private carefulStepOn = false;
  /** debounces the status hover-line banner so POINTER_MOVE doesn't retrigger it every pixel. */
  private hoveredStatusUnitId: string | null = null;

  // content resolution
  private allFactIds = new Set<string>();
  private factTypeById = new Map<string, string>();
  /** wave 1 — whether THIS battle's draws go through the global draw index (every installed
   *  pack) or the pre-wave-1 single-pack chain. Decided once, in loadContent(); see
   *  combatDrawReady() for the two ways it lands false (index down, fixture launch). */
  private drawGlobal = false;

  // §2/§5/§6 the Five Arts & Glow (Phase 2 — magic-combat-depth.md)
  /** dev/e2e harness override (?rank=1|2|3); null = use the computed rank. */
  private rankOverride: 1 | 2 | 3 | null = null;
  /** cached ONCE per battle (loadContent, after allFactIds is built) — never recomputed mid-battle. */
  private rank: 1 | 2 | 3 = 1;
  private rankInfo: ArtRanks = { rank: 1, welded3: 0, welded4: 0 };

  // Wave 4 leveling (Concordance Ch. III). All three reads are cached ONCE per battle beside
  // the rank, under the same trap-1 law: a level gained mid-fight pays its +2 HP immediately,
  // but its tier floor and Strike bonus arm the NEXT battle, never this one.
  /** the Keeper's level at battle create (`save.level ?? 1`). */
  private level = 1;
  /** tierForLevel(level) — the LEVEL half of the hybrid tier gate, kept separately from the
   *  composed `rank` so progressionSnapshot() can report the two apart. */
  private tierFloor: 1 | 2 | 3 = 1;
  /** strikeBonusForLevel(level) — free-lane steel only (the Strike and party opportunity
   *  strikes); the Arts are gated by the tier ladder instead. */
  private strikeBonus = 0;
  /** levels gained mid-battle, carried out on CombatOutcome so DungeonScene folds them into
   *  the post-battle beat's ONE ceremony card (leveling.spec.ts's beat law). */
  private pendingLevelUps: number[] = [];
  /** cached ONCE per battle (loadContent, where pack.meta is in scope) — never recomputed
   *  mid-battle; reset in create() (Trap-1, reused scene instance — see rankInfo above). */
  private packDifficultyClassified = false;
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
  /** §9.3 — Objection! is a once-per-ROUND reaction: set when it fires, cleared at every round
   *  boundary (advanceTurn's newRound branch, §3 rule 5) and at battle start (trap 1). */
  private objectionSpent = false;
  /** §9.4 — 1-based count of the Warden's own turns this battle; drives the "every OTHER
   *  Warden turn" Crown Injunction cadence (trap 1). */
  private wardenTurns = 0;
  /** §9.4 — the once-per-battle Call the Clause, and the id of the wisp it spawned (max one
   *  clause-wisp alive at a time). Both per-battle only, never persisted (trap 1, §14). */
  private clauseSpawned = false;
  private clauseWispId: string | null = null;
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
    // A full Game teardown (PhaserGame.tsx's unmount — e.g. the shell switching away from
    // the "Game" tab mid-battle) does NOT emit SHUTDOWN: Phaser's SceneManager.destroy()
    // calls every scene's Systems.destroy() directly, skipping shutdown() entirely. Without
    // this twin listener the flag stayed false on that path, so every `if (this.destroyed)`
    // guard below failed open — including the ones protecting the delayed calls and the
    // awaited encounter overlays, which resolve on their own setTimeout (encounters/kinds.ts)
    // long after the scene is gone. Same idiom HamletScene uses for its own DESTROY path.
    this.events.once(Phaser.Scenes.Events.DESTROY, () => { this.destroyed = true; });

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
    this.damageTaken = 0;
    this.reclaimed = 0;
    this.newWelds = 0;
    this.graceAvailable = true;
    this.dd = null;
    this.ddRevivedUsed = false;
    this.closeDdFrame();
    this.debugPrefer = null;
    this.actionLog = [];
    this.refreshSeq = 0;
    this.lastHpEvent = null;
    this.allFactIds.clear();
    this.factTypeById.clear();
    this.drawGlobal = false;
    this.boss = null;
    this.shields = 0;
    this.phaseIndex = 0;
    this.pendingBossPhase = false;
    this.objectionSpent = false;
    this.wardenTurns = 0;
    this.clauseSpawned = false;
    this.clauseWispId = null;
    this.bossReveal = null;
    this.tileImages.clear();
    this.carefulStepOn = false;
    this.hoveredStatusUnitId = null;
    this.rank = 1;
    this.rankInfo = { rank: 1, welded3: 0, welded4: 0 };
    this.level = 1;
    this.tierFloor = 1;
    this.strikeBonus = 0;
    this.pendingLevelUps = [];
    this.packDifficultyClassified = false;
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
      this.hud.setRankLine(this.rank, this.rankInfo.welded4, this.level);
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

  /** Undo fadeDead's death tween (used when a Satchel heal or the Death's Door revival stands a
   *  fainted ally back up). Also restores the depth fadeDead permanently lowered it to (`r + 6`,
   *  see fadeDead below) back to the same `10 + r` every living unit's container uses — without
   *  this a revived unit stayed sunk beneath a same-row living unit exactly when the game is
   *  showing off the revival (Task 5 review, finding M-1). */
  private reviveView(u: UnitState): void {
    const v = this.views.get(u.id);
    if (!v) return;
    this.tweens.killTweensOf(v.container);
    v.container.setAlpha(1).setScale(1).setAngle(0).setDepth(10 + u.r);
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

    // crucible v1 #23 — chips are center-anchored (Phaser Images default), so their true top
    // edge is chipY minus half their own 10px height; y+7 (the pre-fix base case) left that
    // edge 3px above the HP bar's own bottom edge (y+5) instead of flush with/below it. The
    // Warded case's y+10 was already correct (it also has to clear the ward underline drawn at
    // y+6..y+8) — using that same offset unconditionally fixes the base case too, with no
    // visible change to the Warded case it was already right for.
    this.drawStatusChips(u, v, y + 10);
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
    // Wave 1 — decided ONCE per battle, before anything reads the pool (combatDrawReady()).
    this.drawGlobal = await combatDrawReady(this.launch.packId);
    try {
      const { packs } = await getPacks();
      const entry = packs.find((pk) => pk.id === this.launch.packId);
      // difficulty-rewards.md §5's gate must describe the pack the PICKER actually draws
      // from, not the launch's nominal packId. encounters/engine.ts's pick() resolves its
      // source as `packs.find(id) ?? packs[0]`, so a fixture launch (packId 'dev-mosslore',
      // installed nowhere) still draws real, classified encounters and stampDifficulty()
      // stamps that pack's genuine tier into result.difficulty. Reading the flag off
      // `entry` alone left the rider structurally dormant against real classified content —
      // a live tier on the board with a dead gate behind it. Empty packs → undefined → false,
      // so the zero-packs build is unchanged.
      const gatePack = (entry ?? packs[0])?.pack as Pack | undefined;
      this.packDifficultyClassified = gatePack?.meta?.difficultyClassified ?? false;
      if (this.drawGlobal) {
        // Wave 1 — the battle's fact pool is the GLOBAL draw index (every installed pack),
        // not this.launch.packId's alone. dueFactIds() draws across packs now, so what is
        // derived from the pool below — the §6 rank, Mira's mastery gate, the fact→type map
        // record() writes with — describes the SAME widened pool, or a cast could surface a
        // fact the rank was never computed over. Fact→type comes from the index too (factOf),
        // since a drawn id may belong to any installed pack. No tag map is built: draws no
        // longer scope by tags at all (design §5, "enemy.tags and phase.recallTags leave the
        // draw path").
        //
        // ONE EXCEPTION, deliberate and known: packDifficultyClassified (just above) did NOT
        // widen — it still reads off the LAUNCH pack. With 2+ packs of differing classification
        // coverage that is a real seam: pick()'s tier 2 can resolve an encounter owned by an
        // unclassified pack, whose difficultyOf falls back to Lantern (`?? 2`), and the launch
        // pack's flag arms riderBonus to treat that default as a genuine tier. Latent today
        // (one real pack installed, and the fixture packs classify nothing), so nothing is
        // mis-stamped in practice. The fix is a BEHAVIORAL ruling — stamp per RESOLVED pack,
        // not per launch pack — deliberately deferred to the Task 10 sweep rather than smuggled
        // into this call-site conversion.
        for (const id of services.draw.allFactIds()) {
          this.allFactIds.add(id);
          const type = services.draw.factOf(id)?.type;
          if (type) this.factTypeById.set(id, type);
        }
      } else if (entry) {
        // Draw-index-down fallback: the pre-wave-1 single-pack pool, verbatim but for the
        // tag map, which has left the draw path on BOTH branches.
        const pack = entry.pack as Pack;
        for (const f of pack.facts ?? []) {
          this.allFactIds.add(f.id);
          this.factTypeById.set(f.id, f.type);
        }
      }
      if (!entry && this.launch.packId === FIXTURE_PACK_ID && this.launch.room.boss && packs.length) {
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
    // Feeds legacyDraw()'s dueQueue call when drawGlobal is false (unchanged, recordless
    // order preserved); a real launch over a truly-empty global index shuffles instead
    // (globalDraw's fallback tier) — FIXTURE_FACTS is no longer dueQueue-ordered there.
    if (this.allFactIds.size === 0) for (const id of FIXTURE_FACTS) this.allFactIds.add(id);

    // §6 — one global rank off Leitner box distribution, computed ONCE per battle (cached in
    // this.rank/this.rankInfo — trap 1, never recomputed mid-battle) over the battle's full
    // fact pool. ?rank= overrides the computed value so e2e/dev never needs a seeded SRS.
    this.rankInfo = computeRank((id) => this.boxOfSafe(id), [...this.allFactIds]);

    // Wave 4 — the hybrid tier gate (Concordance Ch. III): SRS mastery and the Keeper's level
    // each open tiers on their own, so the live gate is the HIGHER of the two. Composed HERE
    // and only here — all six existing `this.rank` read-sites inherit it untouched, which is
    // the whole point of a single seam. ?rank= stays absolute above both halves: a dev tool
    // beats the level floor. Same read-the-save-once, tolerate-offline shape as applyPoolHp().
    let level = 1;
    try { level = services.save.get()?.level ?? 1; } catch { /* offline → L1 */ }
    this.level = level;
    this.tierFloor = tierForLevel(level);
    this.strikeBonus = strikeBonusForLevel(level);
    this.rank = this.rankOverride ?? (Math.max(this.rankInfo.rank, this.tierFloor) as 1 | 2 | 3);
  }

  /** `services.srs.boxOf`, tolerant of an offline/stub SRS (0 = unseen, the honest default). */
  private boxOfSafe(id: string): number {
    try { return services.srs.boxOf(id); } catch { return 0; }
  }

  /** `services.srs.historyQualities`, tolerant of an offline/stub SRS (empty = unseen). Read
   *  BEFORE record() to see a fact's PRIOR history — the redemption bell's contract (§3.1). */
  private historyQualitiesSafe(id: string): Quality[] {
    try { return services.srs.historyQualities(id); } catch { return []; }
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
    // 'deathsdoor' freezes the board exactly the way 'over' does: the door's rounds are
    // question-beats, not combat turns, so a delayed turn-tick scheduled BEFORE the party fell
    // (the 360/420/650ms advanceTurn hops below) must never step the fight on mid-door.
    if (this.destroyed || this.state === 'over' || this.state === 'deathsdoor') return;
    const end = this.checkEnd();
    if (end === 'retreat') { this.enterDeathsDoor(); return; }
    if (end) { this.resolveBattle(end); return; }

    if (this.boss && this.pendingBossPhase && this.boss.alive && this.phaseIndex < (this.launch.room.boss?.phases.length ?? 0)) {
      this.pendingBossPhase = false;
      void this.openBossPhase(this.phaseIndex);
      return;
    }

    const nxt = nextInOrder(this.order, this.orderIndex, (id) => this.isAlive(id));
    if (!nxt) { this.resolveBattle(this.checkEnd() ?? 'victory'); return; }
    // §3 rule 5 round boundary (initiative.ts nextInOrder flags a wrap): reset every unit's
    // oaSpent AND re-arm the Warden's Objection (§9.3 — "passive, resets each round").
    if (nxt.newRound) {
      for (const u of this.units) u.oaSpent = false;
      this.objectionSpent = false;
    }
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
    if (this.destroyed || this.state === 'over' || this.state === 'deathsdoor' || unit.id !== this.activeId) return;
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
    // crucible-2 rank1-shielded-noop — Rank 2+ already refuses to arm an Art against a
    // shield-absorbed target before a question is spent (crucible v1 #19, via tierRow/
    // pickTierKey). Rank 1 never opens a flyout, so its T1 Arts skipped that filter entirely:
    // a Smite at the shielded Warden cost a full turn AND a question for a guaranteed bounce,
    // with "no foe within reach" as the only (wrong) explanation available. Free Strike is
    // deliberately NOT filtered — it costs no question, and §9.3's Objection is its answer.
    const inReach = this.validTargets(unit, action);
    const spell = this.spellForAction(action);
    const targets = spell ? this.strikableTargets(inReach, spell) : inReach;
    if (!targets.length) {
      // Reuses the flyout's own shipped reason vocabulary rather than inventing a new line.
      const reason = inReach.length ? 'shielded' : 'no foe within reach';
      this.hud.showBanner(`${ACTIONS[action].label}: ${reason}.`, P.stoneGrey);
      return;
    }
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

  /** crucible v1 #19 — the Warden's shield absorbs every non-Attestation action (boss.ts
   *  wardenAbsorbs); excluding shield-absorbed targets here — instead of only discovering that
   *  after Glow is already spent — keeps a T2/T3 cast from being armed against a target it can
   *  never actually damage. Attestation still pierces normally, since wardenAbsorbs itself
   *  exempts every `bossRider: 'strip-shield'` SpellDef. A no-op whenever no target is a
   *  shielded boss (every other Art/room), so this changes nothing outside a shielded boss
   *  fight. */
  private strikableTargets(targets: UnitState[], spell: SpellDef | null): UnitState[] {
    return targets.filter((t) => !wardenAbsorbs(spell, t.isBoss, this.shields));
  }

  /**
   * §9.2/§9.3 — the SpellDef a T1 Art button casts, or `null` for the FREE lane (Strike,
   * Satchel, Wait; and by extension opportunity strikes and push-bump damage, which no spell
   * owns). This one null/SpellDef split IS both of the Warden's rules: `wardenAbsorbs` lets
   * through only a `bossRider: 'strip-shield'` SpellDef, and `wardenObjects` lawyers only the
   * null lane — so no Art can ever be Objected (soul S4), by construction rather than by list.
   */
  private spellForAction(action: ActionKind): SpellDef | null {
    return ART_ACTIONS.has(action) ? SPELLBOOK[action as SpellId] : null;
  }

  /**
   * §9.3 Objection! — the Warden lawyers away the FIRST free-lane blow aimed at him each round
   * and ripostes for 1. Call this ONLY from the free lane (Strike, opportunity strikes): the
   * hard-coded `null` first argument is what makes soul guarantee S4 structural — an Art never
   * reaches this method at all, and could not trigger it if it did.
   *
   * Deliberately checked BEFORE the shield gate: the shields answer spells, the Objection
   * answers steel. (Ordering it after `wardenAbsorbs` would make it unreachable — while
   * shields stand every free blow is already absorbed, and the instant they fall syncBoss ends
   * the fight.) Returns true when the blow was negated; the caller must then apply no damage.
   */
  private wardenObjection(attacker: UnitState, target: UnitState): boolean {
    if (!wardenObjects(null, target.isBoss, this.objectionSpent)) return false;
    this.objectionSpent = true;
    // Banner only — the spec names a banner, and a float here sat directly over the riposte's
    // own −1 on the adjacent attacker (they collided illegibly in the first e2e screenshot).
    // The negation already reads on the board: the Warden's HP bar simply does not move.
    this.hud.showBanner(OBJECTION_BANNER, P.berry);
    this.actionLog.push({ action: 'objection', dmg: 0, overlay: false });
    this.damageUnit(attacker, OBJECTION_RIPOSTE, P.berry);
    return true;
  }

  /** One flyout row: greys with a reason via Rank, Glow, shield, then target availability, in
   *  that order. */
  private tierRow(unit: UnitState, spell: SpellDef): TierRow {
    const costText = spell.glowCost === 0 ? 'free' : `◈${spell.glowCost}`;
    const difficulty = DIFFICULTY_DEFS[spell.tier];
    const rowMeta = { difficultyGlyph: difficultyPolicyGlyph(spell.tier), difficultyTint: difficulty.tint };
    if (spell.tier > this.rank) {
      return { tier: spell.tier, label: spell.label, costText, enabled: false, reason: `needs Rank ${spell.tier}`, ...rowMeta };
    }
    if (this.glow.pips < spell.glowCost) {
      return { tier: spell.tier, label: spell.label, costText, enabled: false, reason: `needs ${spell.glowCost} glow`, ...rowMeta };
    }
    if (spell.shape === 'self') {
      return { tier: spell.tier, label: spell.label, costText, enabled: true, ...rowMeta };
    }
    const rawTargets = this.validTargetsForSpell(unit, spell);
    const targets = this.strikableTargets(rawTargets, spell);
    if (targets.length) return { tier: spell.tier, label: spell.label, costText, enabled: true, ...rowMeta };
    // "shielded" (not a longer sentence): the flyout row's trailing-reason slot is right-
    // anchored in a fixed ~196px row (hud.ts addRow) — a longer string here visibly collided
    // with the label text, the exact kind of legibility bug crucible v1 #10 already covers
    // for this same flyout. Short reasons ("no foe within reach", "won't multiply a burst")
    // already established the width budget this stays inside.
    return {
      tier: spell.tier, label: spell.label, costText, enabled: false,
      reason: rawTargets.length ? 'shielded' : 'no foe within reach',
      ...rowMeta,
    };
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
    // crucible v1 #19 — the SAME shield filter tierRow's greying used to decide row.enabled;
    // in a mixed fight (shielded boss + other valid targets) the row can be enabled while the
    // boss's own tile must still never be offered as a clickable target for a non-Attestation
    // spell (else Glow spends against it anyway, just via a different foe making the row live).
    const targets = this.strikableTargets(this.validTargetsForSpell(unit, spell), spell);
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
        // §9.3 — an opportunity strike is free-lane steel, so the Warden's Objection answers it
        // exactly like a Strike: negated, riposted, and the striker's one-per-round is still
        // spent (they did swing).
        if (this.wardenObjection(striker, mover)) { striker.oaSpent = true; continue; }
        // crucible v1 #6 — flank must be evaluated against the tile `mover` is leaving
        // (`vacated`), not `mover`'s live c/r — both call sites (movePlayerTo, the enemy-move
        // branch of runEnemyTurn) already mutate unit.c/r to the LANDING tile before calling
        // this method, so `mover` here reads as already-arrived; passing `vacated` instead
        // restores "flank geometry evaluated relative to the tile being left" (§4.1/§4.2).
        const flank = isFlanked(striker, vacated, striker.team, this.units);
        // Wave 4 — an opportunity strike is free-lane steel (§9.3 above), so the Keeper's level
        // Strike bonus rides it too. The team guard is explicit for the same reason the Strike's
        // own Glow gain guards: this method resolves BOTH directions (enemies strike a party
        // mover as readily as the reverse), and the Fade never swings with the Keeper's level.
        const result = computeHit({
          base: 1 + (striker.team === 'party' ? this.strikeBonus : 0),
          attackerStatuses: striker.statuses, targetStatuses: mover.statuses,
          flank, overglow: false, weld: false, rider: false,
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
      const outcome = resolveAction('strike', 1, {
        miraBonus, vsBoss: !!target?.isBoss, strikeBonus: this.strikeBonus,
      });
      const before = this.enemyHpSum();
      this.attackerTell(unit, tile, ACTIONS.strike.tint);
      // §9.3 — if the Warden Objected to this swing, HIS banner is the outcome; the Strike's
      // own "a quick blow" line would otherwise overwrite it in the same frame and the player
      // would never see why nothing happened. `objectionSpent` flipping across applyOutcome is
      // exactly "the Objection was spent BY this action" (it is re-armed only at a round
      // boundary, never mid-turn).
      const objectedBefore = this.objectionSpent;
      this.applyOutcome(unit, 'strike', tile, outcome, target);
      const objected = this.objectionSpent && !objectedBefore;
      if (!objected) this.hud.showBanner(outcome.banner, ACTIONS.strike.tint);
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
    // Wave 1 — the draw is global and no longer scoped by the room's enemy tags (nor, on the
    // boss branch, by the phase's recallTags): the Art's own encounter kind is the ONLY
    // narrowing, which is mechanical variety, not a subject lock. isBossCast is untouched —
    // it still drives the phase advance below, exactly as before.
    const factIds = this.dueFactIds([kind]);
    const context = action === 'parley' ? 'parley' : vsBoss ? 'boss' : 'combat';

    if (action === 'cast') this.hud.setDeliberating(true);
    let result: EncounterResult;
    try {
      result = await services.runEncounter({
        context, kinds: [kind], factIds, packId: this.launch.packId, seed: this.encSeed++, spellTier: 1,
      });
    } catch {
      result = { encounterId: `local-${action}`, kind, factIds: factIds.slice(0, 1), quality: 0.5, detail: 'offline' };
    }
    // §5.1 Glow source 4 (trap 14): snapshot due-ness BEFORE record() mutates the queue.
    // This applies to every T1 cast too, not just T2/T3 — the SRS loop is the mana engine
    // regardless of which tier answering the question happens to buy.
    const dueSetAtCast = this.snapshotDueSet();
    // §5.5 the weld edge, same capture-before-record duty (trap 14): every fact's box must be
    // read BEFORE record() moves it. castGatedSpell already did this for T2/T3; the T1 path
    // never did, which is half of why a T1 cast could never weld (the other half was
    // ResolveOpts having no `weld` field at all — crucible-2 weld-T1-unreachable).
    const factBoxesAtCast = result.factIds.map((id) => this.boxOfSafe(id));
    // supersession-reteach.md §5 — same capture-before-record duty (the mercy reads the
    // superseding fact's PRIOR history, which record() is about to make non-empty).
    const mercy = this.amendedFirstMiss(result);
    // Record FIRST — the learning record is sacred: never dropped, even if the
    // scene tears down mid-overlay (record() is pure service work, safe when dead).
    this.results.push(result);
    const { reclaimedId } = await this.record(result);
    if (this.destroyed) return;
    this.hud.setDeliberating(false);
    if (dueRenewalSurge(result.quality, result.factIds, dueSetAtCast)) {
      this.glow = glowGain(this.glow, 'due-renewal');
      this.refreshParty();
    }
    // §3.1 — reclaiming a fact from the Fade grants Glow alongside due-renewal (same §5.1
    // family). record() already read the pre-record history + counted the run tally.
    if (reclaimedId) {
      this.glow = glowGain(this.glow, 'redemption');
      this.refreshParty();
    }

    // Lantern grace: standing on a lantern can soften a whiff for DAMAGE only —
    // the SRS record stays honest (we record result.quality, above). graceAppliesTo excludes
    // Courtcraft, whose outcome comes from branchTag and never from this quality: softening it
    // there changed nothing while still burning the once-per-battle charge and claiming it had
    // helped (crucible-2 lantern-grace-false-banner).
    let dmgQuality = result.quality;
    const graceArt = this.spellForAction(action)?.art;
    if (graceArt && graceAppliesTo(graceArt)
        && dmgQuality === 0 && this.graceAvailable && this.tileTypeOf(unit) === 'lantern') {
      dmgQuality = 0.5;
      this.graceAvailable = false;
      this.hud.showBanner('The lantern steadies you — the miss becomes a graze.', P.lanternGold);
    }

    // Courtcraft's quality is the branch outcome, not the lantern-grace-adjusted quality
    // passed to the legacy adapter. Keep the rider gate aligned with resolveAction's Parley
    // adapter, which derives its spell slot from branchTag for the same reason.
    const quality: Quality = action === 'parley'
      ? (result.branchTag === 'good' ? 1 : result.branchTag === 'bad' ? 0 : 0.5)
      : dmgQuality;
    const rider = quality === 1 && riderBonus(1, result.difficulty ?? 2, this.packDifficultyClassified) === 1;
    const weld = quality === 1 && weldBonus(factBoxesAtCast) === 1;
    const miraBonus = unit.id === 'mira' && this.miraBonusActive() ? 1 : 0;
    const base = resolveAction(action, dmgQuality, { miraBonus, vsBoss, branchTag: result.branchTag, rider, weld });
    // §5 the one mercy rule — 0 HP to the party on the amended fact's first miss, Clerk's
    // line composed after the base copy. The SRS record above stays honest.
    const outcome = mercy ? applyAmendedMercy(base) : base;
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
    // §9 — a T2/T3 Attestation at the Warden is the SAME negotiation beat as a T1 Cast, so it
    // draws from the current phase's recallTags and advances the phase below. Without this a
    // Rank-2/3 player casting only through the flyout stripped shields while phases 2 and 3
    // never re-armed, skipping the mandatory branch questions (crucible-2
    // attestation-phase-skip).
    const isBossCast = isBossPhaseCast(spell.art, vsBoss);
    // Wave 1 — global draw, kind-narrowed only (see runPlayerAction's T1 twin). isBossCast
    // keeps its full §9 duty below: the phase advance, unchanged.
    const factIds = this.dueFactIds([artKind]);
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
        spellTier: spell.tier,
      });
    } catch {
      result = { encounterId: `local-${spell.id}`, kind: artKind, factIds: factIds.slice(0, 1), quality: 0.5, detail: 'offline' };
    }
    // §5.5 the weld edge: capture every involved fact's box BEFORE record() mutates it (trap
    // 14 — same capture-before-record duty as the due-renewal snapshot above).
    const factBoxesAtCast = result.factIds.map((id) => this.boxOfSafe(id));
    // supersession-reteach.md §5 — the amendment mercy, captured before record() too.
    const mercy = this.amendedFirstMiss(result);
    this.results.push(result);
    const { reclaimedId } = await this.record(result);
    if (this.destroyed) return;
    if (artKind === 'free_recall') this.hud.setDeliberating(false);

    if (dueRenewalSurge(result.quality, result.factIds, dueSetAtCast)) {
      this.glow = glowGain(this.glow, 'due-renewal');
      this.refreshParty();
    }
    // §3.1 — redemption Glow, alongside due-renewal (see runPlayerAction).
    if (reclaimedId) {
      this.glow = glowGain(this.glow, 'redemption');
      this.refreshParty();
    }

    // Grace is meaningless for Courtcraft here too — see runPlayerAction's own note.
    let dmgQuality = result.quality;
    if (graceAppliesTo(spell.art)
        && dmgQuality === 0 && this.graceAvailable && this.tileTypeOf(unit) === 'lantern') {
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
    // §5.5 scopes the weld edge to "a q1 cast"; weldBonus itself only reads boxes, so the
    // quality gate is stated here the same way `rider` states it below. resolveSpell enforces
    // it again at the point of consumption — this line is the readable half of that contract.
    const weld = quality === 1 && weldBonus(factBoxesAtCast) === 1;
    const rider = quality === 1 && riderBonus(spell.tier, result.difficulty ?? 2, this.packDifficultyClassified) === 1;
    const geometry = this.spellGeometry(unit, spell, tile, quality);
    const opts: ResolveSpellOpts = {
      primaryTargetId: geometry.primaryId,
      aoeTargetIds: geometry.aoeIds,
      partyIds: this.units.filter((u) => u.team === 'party' && u.alive).map((u) => u.id),
      enemyIds: this.units.filter((u) => u.team === 'enemy' && u.alive).map((u) => u.id),
      dir: geometry.dir,
      overglow,
      weld,
      rider,
      miraBonus,
      vsBoss,
    };
    // §5 the one mercy rule at the T2/T3 seam: strip every party-facing cost from the
    // resolved ops (the ActionOutcome equivalent is damage.ts's applyAmendedMercy).
    const resolved = resolveSpell(spell, quality, opts);
    const ops = mercy ? stripPartyHarmOps(resolved, opts.partyIds ?? []) : resolved;

    if (spell.shape !== 'self' && spell.shape !== 'burst1') this.attackerTell(unit, tile, ACTIONS[action].tint);
    const before = this.enemyHpSum();
    const baseBanner = ops
      .filter((o): o is Extract<BoardOp, { op: 'banner' }> => o.op === 'banner')
      .map((o) => o.text)
      .join('\n');
    // the Clerk's line composes AFTER the base copy (§5)
    const bannerText = mercy ? (baseBanner ? `${baseBanner}\n${AMENDED_MERCY_LINE}` : AMENDED_MERCY_LINE) : baseBanner;
    this.applySpellOps(unit, action, spell, ops);
    this.actionLog.push({ action, dmg: before - this.enemyHpSum(), overlay: true });

    // §9.2 trap 10 — the shield gate now reads the SpellDef's own `bossRider` (boss.ts
    // wardenAbsorbs), not the ActionKind: Attested Ward and Verbatim Decree pierce on their
    // own rider rather than by happening to share the 'cast' button. The SIGNED delta comes
    // from shieldStripDelta, which owns the sign — this site used to hand reduceShields a
    // literal `1`, and since reduceShields ADDS its delta that GRANTED the Warden a shield on
    // every apex cast while the float still read "−shield".
    const shieldDelta = shieldStripDelta(spell, quality, vsBoss);
    if (shieldDelta !== 0 && this.boss) {
      this.shields = reduceShields(this.shields, shieldDelta);
      this.floatText(this.boss, '−shield', P.waterLight);
      this.syncBoss();
    }

    // §9 — advance the negotiation, mirroring the T1 path's own block exactly (unconditional
    // on quality: engaging the Warden with an Attestation IS the beat, pass or fail).
    if (isBossCast) {
      this.phaseIndex += 1;
      this.pendingBossPhase = this.phaseIndex < (this.launch.room.boss?.phases.length ?? 0);
    }

    if (bannerText) this.hud.showBanner(bannerText, quality > 0 ? ACTIONS[action].tint : P.duskRose);
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
   *
   * `spell` is the SpellDef these ops came from — it (never the ActionKind) is what the §9.2
   * shield gate reads, so Attested Ward and Verbatim Decree pierce on their own rider rather
   * than by sharing the 'cast' button (trap 10).
   */
  private applySpellOps(caster: UnitState, action: ActionKind, spell: SpellDef, ops: BoardOp[]): void {
    for (const op of ops) {
      if (op.op === 'banner') continue;
      if (op.op === 'fade') { this.damageParty(op.amount, caster); continue; }
      if (op.op === 'damage') {
        const target = this.unitById(op.targetId);
        if (!target?.alive) continue;
        if (wardenAbsorbs(spell, target.isBoss, this.shields)) { this.floatText(target, 'shielded', P.waterLight); continue; }
        const result = computeHit({
          base: op.amount, attackerStatuses: caster.statuses, targetStatuses: target.statuses,
          flank: false, overglow: false, weld: false, rider: false,
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
        if (target?.alive) this.pushUnit(caster, target, op.dir, spell);
        continue;
      }
      if (op.op === 'heal') {
        const target = this.unitById(op.targetId);
        if (target?.alive) this.healUnit(target, op.amount);
      }
    }
  }

  /** §4.3 forced movement, applied to a spell's push (Cinder-Rebuke/Processional): same
   *  forceMove + bump-damage rules as the construct's Vault-Slam and the Warden's Writ of
   *  Seizure (enemyStrike below). `spell` carries the §9.2 shield gate for the bump damage —
   *  null when the push came from an enemy kit rather than a cast. */
  private pushUnit(caster: UnitState, target: UnitState, dir: Dir, spell: SpellDef | null): void {
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
    if (wardenAbsorbs(spell, target.isBoss, this.shields)) { this.floatText(target, 'shielded', P.waterLight); return; }
    const result = computeHit({
      base: 1, attackerStatuses: caster.statuses, targetStatuses: target.statuses,
      flank: false, overglow: false, weld: false, rider: false,
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
    // crucible #10 hardening — healUnit is a SECOND hp-mutation path alongside damageUnit.
    // Every heal effect in today's content targets the enemy (Injunction-bad's own "mend"),
    // so this was never observed live, but nothing in the type system stopped a future
    // party-targeting heal from raising hp here while the sidebar stayed silent — the exact
    // failure class this spec exists to catch. Route party targets through the same choke
    // point damageUnit already uses.
    if (target.team === 'party') {
      this.refreshParty();
      this.lastHpEvent = { unitId: target.id, kind: 'heal', amount, seq: this.refreshSeq };
    }
  }

  private applyOutcome(actor: UnitState, action: ActionKind, tile: Coord, o: ReturnType<typeof resolveAction>, target: UnitState | null): void {
    if (action === 'strike') {
      // §3 rule 4 / §4.1 — Strike is the one melee player action; it routes through the
      // computeHit modifier pipeline (flank) instead of a flat subtraction (see meleeHit).
      if (target && o.hits > 0) this.meleeHit(actor, target, o.hits, ACTIONS.strike.tint);
    } else if (action === 'cast' || action === 'smite') {
      const spell = this.spellForAction(action);
      if (target && o.hits > 0) this.hitEnemy(target, o.hits, ACTIONS[action].tint, spell);
      if (o.extraShield && target?.isBoss) { this.shields = reduceShields(this.shields, -o.extraShield); this.floatText(target, '−shield', P.waterLight); this.syncBoss(); }
      if (o.fade > 0) this.damageParty(o.fade, actor);
    } else if (action === 'weave') {
      const spell = this.spellForAction(action);
      if (target && o.hits > 0) this.hitEnemy(target, o.hits, ACTIONS.weave.tint, spell);
      if (o.aoeHit > 0) {
        for (const co of crossTiles(tile)) {
          if (co.c === tile.c && co.r === tile.r) continue;
          const e = this.enemyAt(co);
          if (e) this.hitEnemy(e, o.aoeHit, ACTIONS.weave.tint, spell);
        }
      }
    } else if (action === 'sequence') {
      const dir = this.dirTo(actor, tile);
      const spell = this.spellForAction(action);
      if (dir) {
        for (const [i, co] of lineTiles(actor, dir, o.lineDepth).entries()) {
          const e = this.enemyAt(co);
          if (e) this.hitEnemy(e, i === 0 ? o.hits : o.aoeHit, ACTIONS.sequence.tint, spell);
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
   *  flank via isFlanked; overglow/weld are folded in upstream, always false here. Strike is
   *  the free lane, so it passes `null` for the spell — §9.3's Objection is armed against it
   *  and §9.2's shield gate never lets it pierce. */
  private meleeHit(attacker: UnitState, target: UnitState, base: number, color: number): void {
    if (this.wardenObjection(attacker, target)) return;
    if (wardenAbsorbs(null, target.isBoss, this.shields)) {
      this.floatText(target, 'shielded', P.waterLight);
      return;
    }
    const flank = isFlanked(attacker, target, attacker.team, this.units);
    const result = computeHit({
      base, attackerStatuses: attacker.statuses, targetStatuses: target.statuses,
      flank, overglow: false, weld: false, rider: false,
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
    if (end === 'retreat') { this.enterDeathsDoor(); return; }
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
      const beforePips = this.glow.pips;
      this.glow = glowGain(this.glow, id === 'lantern-brand' ? 'lantern-brand' : 'wick-tallow');
      const gained = this.glow.pips - beforePips;
      this.refreshParty();
      // crucible v1 #14 — mirror the sibling heal branch's own pattern below (dynamic banner
      // text + a floating amount keyed off the ACTUAL, possibly cap-clamped gain) instead of a
      // static template that reads as a full success even when the cap silently absorbed part
      // of the item's value (e.g. +2 into a cap 1 pip away nets only +1).
      this.floatText(unit, `+${gained}`, P.lanternGold);
      const clamped = gained < item.effect.amount;
      this.hud.showBanner(
        clamped
          ? `${item.name} — the wick brightens, but the lantern was nearly full (+${gained} glow).`
          : `${item.name} — the wick brightens.`,
        P.lanternGold,
      );
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
        // The phase's branchEncounterId is an AUTHORED setpiece and still forces the encounter
        // outright (pick() tier 1, pack-scoped) — these factIds only ever feed pick()'s later
        // tiers. Wave 1: they come from the global draw, kind-narrowed to the same
        // 'scenario_branch' asked for above; phase.recallTags no longer scope them (design §5).
        context: 'boss', kinds: ['scenario_branch'], encounterId: phase.branchEncounterId,
        factIds: this.dueFactIds(['scenario_branch']), packId: this.launch.packId, seed: this.encSeed++,
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
      if (end === 'retreat') this.enterDeathsDoor();
      else if (end) this.resolveBattle(end);
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
    // §9.4 — his own turn counter drives the "every OTHER Warden turn" Injunction cadence.
    if (unit.isBoss) this.wardenTurns += 1;
    const party = this.units.filter((u) => u.team === 'party');
    // §3 Bound/Dimmed feed the AI's OWN move budget without editing ai.ts: hand decideEnemy a
    // shallow clone whose `.move` is already the effective value (ai.ts stays pure/untouched).
    const effMove = effectiveMove(unit.move, unit.statuses);
    const selfForAi = effMove === unit.move ? unit : { ...unit, move: effMove };
    const intent = decideEnemy(selfForAi, party, this.layout.tiles, occupancyExcept(this.units, unit.id));

    const doAttack = () => {
      if (this.destroyed) return;
      // §9.4 — on the turns his phase script fires (Crown Injunction / Call the Clause) the
      // Warden spends his whole action on it; otherwise he falls through to his base kit, the
      // Writ of Seizure (enemyStrike's push branch below).
      if (!(unit.isBoss && this.runWardenScript(unit))) {
        if (intent.attackTargetId) {
          const tgt = this.unitById(intent.attackTargetId);
          if (tgt && tgt.alive) this.enemyStrike(unit, tgt);
        }
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

  // ---- §9.4 the Warden's phase script ------------------------------------

  /** §9.5 — the label to SHOW for one of the Warden's moves: the pack's optional relabel
   *  (`BossSpec.moveLabels`) when present, else the engine-generic default. Flavor only —
   *  the script itself is engine data (S5). */
  private wardenLabel(move: WardenMove): string {
    return wardenMoveLabel(move, this.launch.room.boss?.moveLabels);
  }

  /**
   * §9.4 — runs the Warden's deterministic phase script for THIS turn. Returns true when the
   * script consumed his action (the caller then skips his ordinary attack); false means "base
   * kit", i.e. fall through to the Writ of Seizure melee.
   *
   * The decision itself is pure (`wardenMove` in boss.ts); everything here is the scene-side
   * application — targeting, board mutation, presentation.
   */
  private runWardenScript(unit: UnitState): boolean {
    const move = wardenMove({
      phaseIndex: this.phaseIndex,
      wardenTurns: this.wardenTurns,
      clauseAvailable: this.clauseAvailable(),
    });
    if (move === 'summon') return this.callTheClause(unit);
    if (move === 'injunction') return this.crownInjunction(unit);
    return false; // 'seizure' — his base kit, applied by enemyStrike's push branch
  }

  /**
   * §9.4 Crown Injunction (phase 2+, every other Warden turn): Bound(1) on the highest-HP
   * party unit within range 3 — no line-of-fire needed (a writ does not need to see you).
   *
   * Bound is movement denial ONLY: §3's Bound explicitly leaves acting untouched, so the
   * player can still answer every question on their turn (souls S2/S4 — no mechanic may deny
   * or discourage a question). Falls through to his ordinary attack when nobody is in range,
   * so the turn is never wasted.
   */
  private crownInjunction(unit: UnitState): boolean {
    const target = this.units
      .filter((u) => u.team === 'party' && u.alive && manhattan(unit, u) <= 3)
      .sort((a, b) => b.hp - a.hp)[0];
    if (!target) return false;
    target.statuses = applyStatus(target, 'bound', 1);
    this.drawHpBar(target);
    this.floatText(target, STATUS_DEFS.bound.label, STATUS_DEFS.bound.tint);
    this.attackerTell(unit, target, STATUS_DEFS.bound.tint);
    this.hud.showBanner(this.wardenLabel('injunction'), P.orchid);
    this.actionLog.push({ action: 'injunction', dmg: 0, overlay: false });
    this.refreshParty();
    return true;
  }

  /** §9.4 — is the once-per-battle summon available? Once per battle, at most one clause-wisp
   *  alive at a time, and only when a free enemy-spawn tile actually exists. */
  private clauseAvailable(): boolean {
    if (this.clauseSpawned) return false;
    const living = this.clauseWispId ? this.unitById(this.clauseWispId) : null;
    if (living?.alive) return false;
    return this.freeEnemySpawn() !== null;
  }

  /** The first enemy-spawn tile with no living unit standing on it (walls are never spawns). */
  private freeEnemySpawn(): Coord | null {
    const taken = new Set(this.units.filter((u) => u.alive).map((u) => key(u.c, u.r)));
    return this.layout.enemySpawns.find((t) => !taken.has(key(t.c, t.r))) ?? null;
  }

  /** §9.4 Call the Clause (phase 3+, once per battle): the Warden cites a clause into being. */
  private callTheClause(unit: UnitState): boolean {
    const at = this.freeEnemySpawn();
    if (!at) return false;
    const wisp = this.spawnReinforcement({ archetype: 'wisp' }, at);
    if (!wisp) return false;
    this.clauseSpawned = true;
    this.clauseWispId = wisp.id;
    this.attackerTell(unit, at, P.orchid);
    this.hud.showBanner(this.wardenLabel('summon'), P.orchid);
    this.actionLog.push({ action: 'summon', dmg: 0, overlay: false });
    return true;
  }

  /**
   * §9.4 — the small mid-battle spawn machinery: build the unit + its view and APPEND its id
   * to the initiative order.
   *
   * Appending is wrap-safe with `nextInOrder` (initiative.ts:25-39) because that function reads
   * `order.length` fresh on every call and normalizes its cursor with `idx -= order.length`
   * only after the bounds test — a grown array can therefore never leave `orderIndex` dangling
   * past the end, and the wrap that flags `newRound` simply happens one slot later. The new
   * unit takes the LAST initiative slot rather than a speed-sorted one, which is the point:
   * a summon should never jump the queue ahead of units that have already acted.
   *
   * Everything it creates is per-battle only — the unit, its view, and the appended order entry
   * all die with `create()`'s reset block (trap 1); nothing here is persisted (§14).
   */
  private spawnReinforcement(spec: EnemySpec, at: Coord): UnitState | null {
    if (this.destroyed) return null;
    // `units.length` is strictly greater than every index makeEnemy has already consumed
    // (spawnUnits indexes off `room.enemies`, which is always a prefix of `units`), so this
    // id can never collide with an existing one.
    const unit = makeEnemy(spec, this.units.length, at.c, at.r);
    this.units.push(unit);
    this.makeUnitView(unit);
    this.order.push(unit.id);
    this.hud.setTurnOrder(this.units.map((u) => ({ id: u.id, kind: u.kind, team: u.team })));
    this.hud.setActive(this.activeId, this.aliveIds());
    return unit;
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
    // §8 construct Vault-Slam and §9.4 the Warden's Writ of Seizure are the same primitive: a
    // melee hit that pushes 1, +1 bump damage when the destination is blocked.
    if (attacker.kind === 'construct' || attacker.isBoss) {
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
      flank, overglow: false, weld: false, rider: false,
    });
    target.statuses = result.targetStatuses;
    if (attacker.kind === 'wraith' && result.hpDamage > 0) {
      target.statuses = applyStatus(target, 'dimmed', 1);
    }
    if (result.hpDamage > 0) this.damageUnit(target, result.hpDamage, P.berry);
    if (bumpBonus > 0) this.actionLog.push({ action: 'bump', dmg: result.hpDamage, overlay: false });
    // §9.4/§9.5 — the Warden's ordinary blow IS the Writ of Seizure, so it announces itself by
    // its (pack-relabelable) move name; the damage still reads off the target's own −N float,
    // exactly as it does for every other hit.
    this.hud.showBanner(
      attacker.isBoss ? this.wardenLabel('seizure') : `${attacker.name} strikes ${target.name} (−${result.hpDamage}).`,
      P.berry,
    );
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
   * shielded, only an Attestation carrying `bossRider: 'strip-shield'` wounds it
   * (wardenAbsorbs) — so a free Strike (or any un-gated move) can never brute-force the boss
   * to its fallback-victory and skip the mandatory phase questions. Regular enemies take the
   * hit normally. `spell` is null for the free lane (§9.2).
   */
  private hitEnemy(enemy: UnitState, amount: number, color: number, spell: SpellDef | null): void {
    if (wardenAbsorbs(spell, enemy.isBoss, this.shields)) {
      this.floatText(enemy, 'shielded', P.waterLight);
      return;
    }
    this.damageUnit(enemy, amount, color);
  }

  private damageUnit(unit: UnitState, amount: number, color: number): void {
    if (this.destroyed || amount <= 0 || !unit.alive) return;
    const before = unit.hp;
    unit.hp = Math.max(0, unit.hp - amount);
    if (unit.team === 'party') {
      this.hpLost += before - unit.hp; // actual loss = pooled delta (re-anchored on every hp sync)
      this.damageTaken += before - unit.hp; // the run's honest total — never re-anchored
    }
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
    if (unit.team === 'party') {
      this.refreshParty();
      this.lastHpEvent = { unitId: unit.id, kind: 'damage', amount, seq: this.refreshSeq };
    }
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

  /**
   * The candidate fact ids for one cast, most-wanted first. `kinds` is the Art's own encounter
   * kind and is the ONLY narrowing applied — draws are no longer scoped by the room's enemy
   * tags or a boss phase's recallTags (wave-1 design §5: those leave the draw path entirely,
   * so a battle asks whatever is genuinely due across every installed pack).
   *
   * Two sources, chosen once per battle by loadContent (drawGlobal): the global draw service,
   * or the pre-wave-1 single-pack chain when the draw index is down or this is a fixture launch.
   *
   * §recency applies to BOTH: stable-partition recently-asked ids behind fresh ones, so a
   * source that legitimately re-offers what was just asked (an empty due queue falling back to
   * the shuffled pool) doesn't repeat the same few facts back-to-back for the rest of the
   * battle. partitionByRecency only reorders — a due fact that was just asked still appears,
   * just after other due facts that weren't.
   */
  private dueFactIds(kinds?: EncounterKind[]): string[] {
    const ordered = this.drawGlobal ? this.globalDraw(kinds) : this.legacyDraw();
    return partitionByRecency(ordered, sessionRecentFactIds);
  }

  /**
   * Wave-1 global draw (services.draw): the due-first schedule across EVERY installed pack,
   * narrowed to `kinds` — the Art's own encounter kind — and nothing else. The
   * amendment-suspension filter already lives inside the draw service (its `eligible`
   * adapter), so this must NOT re-apply eligibleFactIds over the result.
   *
   * Three tiers, mirroring the pre-wave-1 chain's shape so a battle can never run out of
   * questions mid-fight: schedule (due) → introduction (fresh: unseen, prereq-clear) →
   * seed-shuffled pool. That last tier matters more here than it does in the Wellspring:
   * dueFactIds() is recomputed on EVERY cast, so once a battle has answered everything due,
   * due() and fresh() both legitimately empty and only the shuffle keeps the casts asking.
   * It stays deliberately kind-blind, exactly as the pre-wave-1 fallback was — pick() still
   * receives the same `kinds` and enforces it downstream.
   *
   * Never throws: a draw-service fault mid-battle falls through to the same shuffled pool.
   */
  private globalDraw(kinds?: EncounterKind[]): string[] {
    try {
      const now = Date.now();
      // The draw seed VARIES per cast — encSeed advances once per encounter, and is READ here,
      // never incremented, so the seeds runEncounter/reskin consume are untouched. It has to
      // vary: draw/index.ts's sourceSpread decides which pack leads a run of equally-due facts
      // by seed-shuffling the installed pack ids, and pick()'s tier-2 loop takes the FIRST
      // drawn fact that carries a kind-matching encounter. Under a battle-constant seed the
      // same pack therefore wins the head of every list and every cast of the fight — the
      // interleave would exist in the drawn array and nowhere the player can see. (Measured:
      // with a constant seed, three consecutive casts drew a correctly interleaved
      // [fx.a.f004, fx.b.f004, …] and surfaced fx.a all three times.) HamletScene's Wellspring
      // varies its own per-round seed for exactly this reason.
      const seed = this.encSeed;
      const due = services.draw.due({ kinds, count: COMBAT_DRAW_COUNT, seed, now });
      if (due.length) return due;
      // drawNew applies no kind filter (draw/index.ts) — introduction pacing is deliberately
      // kind-blind, and pick() enforces `kinds` downstream either way.
      const fresh = services.draw.fresh({ count: COMBAT_DRAW_COUNT, seed, now });
      if (fresh.length) return fresh;
    } catch { /* index down mid-battle — the pool below is still honest */ }
    // The last tier keeps the pre-wave-1 battle-constant shuffle seed, verbatim.
    return seededShuffle(
      this.eligibleFactIds([...this.allFactIds]),
      mulberry32(layoutSeed('recency-fallback', this.launch.seed)),
    );
  }

  /** The pre-wave-1 chain, verbatim over whatever pool loadContent() built (single-pack when
   *  the draw index is down, the fixture facts on the packless dev path). Tags are gone from
   *  BOTH branches — they left the draw path, not just the global one. */
  private legacyDraw(): string[] {
    // supersession-reteach.md §4 — dueQueue filters suspended facts itself, but the
    // empty-queue fallback below serves this raw list directly, so filter at the source.
    const arr = this.eligibleFactIds([...this.allFactIds]);
    let due: string[] = [];
    try { due = services.srs.dueQueue(this.launch.packId, arr); } catch { due = []; }
    return due.length ? due : seededShuffle(arr, mulberry32(layoutSeed('recency-fallback', this.launch.seed)));
  }

  /** §4 suspension filter, tolerant of a stub/offline amendments service. */
  private eligibleFactIds(ids: string[]): string[] {
    try { return services.amendments.eligible(ids); } catch { return ids; }
  }

  /** §5 — the superseding fact on its FIRST graded appearance, or null. MUST be read before
   *  record() writes the fact's own first history row and disarms the mercy. */
  private amendedFirstMiss(result: EncounterResult): boolean {
    if (result.quality !== 0) return false;
    try { return services.amendments.firstAmendedAppearance(result.factIds) !== null; }
    catch { return false; }
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

  private async record(result: EncounterResult): Promise<{ reclaimedId: string | null }> {
    // §recency — the fact was asked regardless of whether the SRS write below
    // succeeds, so this is unconditional (mirrors "recording is best-effort" not
    // extending to whether we remember it was just asked).
    for (const id of result.factIds) sessionRecentFactIds.add(id);
    // §3.1/§3.2 Night's Ledger tallies — read the pre-record signals BEFORE record() mutates
    // history/boxes (trap 14, the capture-before-record duty due-renewal / the weld edge keep):
    // a redemption reads PRIOR history; a new weld compares box across the write.
    // The BELL takes the first qualifier (stable Clerk-line hash); the run TALLY takes them
    // all. Driving the tally off the singular id undercounted every multi-fact reclamation to
    // 1, while its sibling `newWelds` below already counted per fact (crucible-2
    // reclaimed-undercount).
    const reclaimedIds = reclaimedFactIds(result.factIds, result.quality, (id) => this.historyQualitiesSafe(id));
    const reclaimedId = reclaimedIds[0] ?? null;
    const beforeBoxes = result.factIds.map((id) => this.boxOfSafe(id));
    try {
      await Promise.all(result.factIds.map((id) =>
        services.srs.record(id, result.quality, result.encounterId, this.factTypeById.get(id)),
      ));
    } catch { /* recording is best-effort; combat proceeds */ }
    // Count the harvest AFTER the write settles the box (store.record awaits its persist, then
    // updates the cache boxOfSafe reads). A failed best-effort write leaves boxes untouched, so
    // nothing false is tallied. "Newly welded" = a fact that crossed INTO box ≥ 4 on this write —
    // the weld-edge mastery level (weldBonus / welded4, magic-combat-depth.md), not mere "learning"
    // (box 2). A rarer, milestone-worthy row; zero-suppression hides it on the common run.
    result.factIds.forEach((id, i) => {
      if (beforeBoxes[i] < 4 && this.boxOfSafe(id) >= 4) this.newWelds++;
    });
    this.reclaimed += reclaimedIds.length;
    // Wave 4 — the mid-fight renewal (Concordance Ch. III). EVERY quality-1 pass through this
    // choke point pays +5: a cast and a death's-door save alike, since a correct answer under
    // pressure is still a correct renewal. Once per GRADED ENCOUNTER, not per fact — record()
    // runs once per answered prompt, so a multi-fact cast pays +5 once, matching the
    // Wellspring's one-fact-one-round economy.
    if (result.quality === 1) await this.payRenewal();
    return { reclaimedId };
  }

  /**
   * The renewal grant and its live-pool consequence.
   *
   * grantXp writes xp/level itself but skips the hp patch (`applyHp: false`) — mid-battle the
   * SCENE's pool is authoritative and grant.ts's hp would be clobbered by the scene's own next
   * `{hp: …}` sync (grant.ts names both sync sites). So the +2/level lands here instead, on the
   * same re-anchor the Satchel heal performs (crucible #3): write the raised pool, then zero
   * hpLost — a running total DungeonScene subtracts on return, which would otherwise charge the
   * pre-bump damage a second time against a base that already reflects it — then re-split
   * through applyPoolHp(), which stands a fainted ally back up with the pool exactly as a
   * Satchel heal does.
   *
   * The cap reads the LAST level gained, not `services.save.get().level`: the save store only
   * updates its cache after the write settles (srs/store.ts, ObjectStore.save), so a get() here
   * would still see the PRE-grant level and clamp the bump away. levelsGained is OPTIMISTIC by
   * grant.ts's design — a failed persist still returns levels — and this bump and the ceremony
   * card inherit that consequence deliberately.
   *
   * The one place the pool is not the scene's to raise is the door: enterDeathsDoor only runs
   * with the whole party down, so applyPoolHp() would stand them back up mid-door, outside the
   * machine that decides whether they rise — and reviveAtDoor writes `{hp: 1}` over it anyway.
   * The XP, the level and the ceremony card are all still paid there; only the live-pool bump
   * waits, and the level's bigger maximum is already persisted for the next heal.
   */
  private async payRenewal(): Promise<void> {
    const gained = grantXp('renewal', { applyHp: false });
    if (!gained.length) return;
    this.pendingLevelUps.push(...gained);
    if (this.dd) return;
    const pool = (this.unitById('keeper')?.hp ?? 0) + (this.unitById('mira')?.hp ?? 0);
    const raised = Math.min(pool + 2 * gained.length, maxHpForLevel(gained[gained.length - 1]));
    try { await services.save.save({ hp: raised }); } catch { /* offline */ }
    if (this.destroyed) return;
    this.hpLost = 0;
    this.applyPoolHp();
    this.refreshParty();
  }

  // ---- outcome ----------------------------------------------------------

  private checkEnd(): 'victory' | 'retreat' | null {
    if (!this.units.some((u) => u.team === 'party' && u.alive)) return 'retreat';
    if (this.boss) return bossDefeated(this.shields, this.boss.hp) ? 'victory' : null;
    return this.units.some((u) => u.team === 'enemy' && u.alive) ? null : 'victory';
  }

  private resolveBattle(outcome: 'victory' | 'retreat' | 'wipe', wipeKeepsakeId: string | null = null): void {
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
    } else if (outcome === 'wipe') {
      // Death's Door exhausted — heavier than a retreat: the Fade collects, and the run's
      // progress is still kept (Fable_SPEC.md:31 — a wipe costs the loot roll, never story).
      this.hud.showToast('The Fade takes its due.', P.duskRose);
      this.hud.showBanner('You wake at the hamlet camp — the Ledger holds what matters.', P.duskRose);
      this.cameras.main.flash(280, 90, 40, 60);
    } else {
      this.hud.showToast('The Fade closes in…', P.duskRose);
      this.hud.showBanner('You wake at the hamlet camp — progress kept, loot forfeit.', P.duskRose);
      this.cameras.main.flash(280, 90, 40, 60);
    }

    const payload: CombatOutcome = {
      outcome, hpLost: this.hpLost, damageTaken: this.damageTaken, results: this.results,
      reclaimed: this.reclaimed, newWelds: this.newWelds,
    };
    // Present on a wipe and only on a wipe (`keepsakeId: null` = nothing eligible was carried,
    // which is a real, reportable outcome — distinct from "this wasn't a wipe").
    if (outcome === 'wipe') payload.wipeReport = { keepsakeId: wipeKeepsakeId };
    // Wave 4 — mid-fight renewals ride home on EVERY outcome, victory to wipe: the XP is
    // already banked (grantXp persists on the spot), and this is only its ceremony card
    // asking to be shown at the return scene's next safe beat. Copied, not aliased — the
    // consumer merges it into its own accumulator.
    if (this.pendingLevelUps.length) payload.levelsGained = [...this.pendingLevelUps];
    // Fire the event now (listeners registered before launch catch it) AND hand the
    // outcome to the return scene's init data (listeners registered on resume catch it).
    this.game.events.emit('combat:resolved', payload);

    this.time.delayedCall(1600, () => {
      if (this.destroyed) return;
      const back = this.launch.returnScene;
      if (back && this.scene.get(back)) this.scene.start(back, { seed: this.launch.seed, combatOutcome: payload });
    });
  }

  // ---- death's door (Concordance Ch. I, "The Ledger Holds Your Line") -----

  /**
   * The party is down. checkEnd()'s 'retreat' no longer resolves the battle outright — the
   * Fade presses close and the Keeper holds the line with what they know: a run of recall
   * drills, scored by the pure machine in deathsdoor.ts, decides whether the run STABILIZES
   * (three held → the old retreat, unchanged), WIPES (three marks → the Fade takes a keepsake),
   * or REVIVES (one welded fact, box ≥ 4, answered clean → you stand back up at 1 pool hp,
   * once per battle).
   *
   * The board is frozen for the door's whole run: `state` is 'deathsdoor', which every input
   * handler already refuses on exactly the same "not one of my Phases" convention it uses to
   * refuse 'over', and advanceTurn() returns early on it. No enemy acts between rounds — the
   * door's rounds are question-beats, not combat turns.
   */
  private enterDeathsDoor(): void {
    if (this.state === 'deathsdoor' || this.state === 'over') return;
    this.state = 'deathsdoor';
    this.hud.hideActionMenu();
    this.rangeGfx.clear();
    this.hoverGfx.clear();
    this.dd = enterDoor(this.ddRevivedUsed);
    // Task 7's frame: the entry line now lives on the persistent card (title + entry + the two
    // 3-slot counters), not a transient Phaser banner — see presentHoldTheLine.
    this.ddFrame = presentHoldTheLine();
    void this.runDeathsDoorRound();
  }

  /**
   * One death-save fact. The full three-tier ladder — schedule (due) → introduction (fresh) →
   * seed-shuffled pool — in one try/catch, exactly like globalDraw(): a count-1 deal must never
   * dead-end on a veteran save where everything has been answered and nothing has come due yet.
   *
   * Deliberately NOT routed through dueFactIds()/drawGlobal. combatDrawReady()'s FIXTURE_PACK_ID
   * gate exists to keep a fantasy-generic fixture fight from mixing in a real pack's facts; a
   * death save is not part of that fight's dressing, it asks what the PLAYER actually knows, and
   * services.draw's index spans every installed pack regardless of the launch's nominal packId.
   * Gating here would starve the door of every real fact on a dev/e2e launch.
   *
   * But that same gate is ALSO the only thing that ever builds the index inside a battle (it
   * short-circuits on FIXTURE_PACK_ID before awaiting), and the dev crawl never builds it either
   * — DungeonScene.loadSpecAndFacts() returns on `if (this.dev) return this.useFixture()` before
   * reaching its own dungeonDrawReady(). So an "unconditional" due() on that launch would read an
   * EMPTY index, return nothing, and slide silently down to the shuffle tier over the fixture
   * facts. Build it here first, with the discipline every other scene's gate uses: await ONLY
   * indexReady() (never the fuller ready(), which can reject on an unrelated srs/amendments fault
   * while the index is still fine), and never stall — a failure just falls to the ladder below.
   */
  private async ddDraw(): Promise<string | null> {
    // Read encSeed; the paired runEncounter below consumes this.encSeed++ (one round, one seed).
    const seed = this.encSeed;
    try { await services.draw.indexReady(); } catch { /* index down — the ladder below still holds */ }
    const now = Date.now();
    let due: string[] = [];
    let fresh: string[] = [];
    try {
      due = services.draw.due({ kinds: DD_KINDS, count: 1, seed, now });
      if (!due.length) fresh = services.draw.fresh({ count: 1, seed, now });
    } catch { /* service fault falls through to the shuffle tier, like globalDraw */ }
    const pick = due[0] ?? fresh[0]
      ?? seededShuffle(this.eligibleFactIds([...this.allFactIds]), mulberry32(layoutSeed('deathsdoor-fallback', seed)))[0];
    return pick ?? null;
  }

  /** One round at the door: deal a fact, ask it, score it, route the machine's verdict. */
  private async runDeathsDoorRound(): Promise<void> {
    if (this.destroyed || !this.dd) return;
    const id = await this.ddDraw();
    if (this.destroyed || !this.dd) return;
    // No fact exists anywhere (packless/fixture edge). Never trap the player behind a question
    // that cannot be asked — an unanswerable door stabilizes, which is the old retreat.
    if (!id) { this.stabilizeAtDoor(); return; }
    let result: EncounterResult;
    try {
      result = await services.runEncounter({
        context: 'drill', kinds: DD_KINDS, factIds: [id], packId: this.launch.packId,
        seed: this.encSeed++, flair: DEATHS_DOOR_TITLE,
      });
    } catch {
      result = { encounterId: 'local-deathsdoor', kind: 'free_recall', factIds: [id], quality: 0, detail: 'offline' };
    }
    if (this.destroyed) return;
    // The revive gate reads the box the fact carried BEFORE the answer is recorded: record()
    // can promote it, and a fact welded BY this very answer is not what stands you back up.
    const box = Math.max(0, ...result.factIds.map((fid) => this.boxOfSafe(fid)));
    // Death saves are real drills — the learning record is sacred here too (same order as every
    // other encounter site: push the result, then record, before anything reads the outcome).
    this.results.push(result);
    await this.record(result);
    if (this.destroyed || !this.dd) return;

    const { next, event } = recordAnswer(this.dd, { quality: result.quality, box });
    this.dd = next;
    this.ddRevivedUsed = next.revivedUsed;
    // Task 7's frame: the per-round beat (FINAL copy, unchanged from Task 5) now updates the
    // persistent card instead of firing a standalone Phaser banner. Shown on every non-revive
    // round, including the terminal one, so the 3rd flame/mark is visible before the card
    // closes — omitted on 'revived' (recordAnswer never touches successes/failures for it, and
    // the door closes straight into reviveAtDoor's own bigger celebration banner instead).
    const beat = { text: result.quality === 1 ? 'The lantern holds.' : 'A mark of the Fade.', good: result.quality === 1 };
    switch (event) {
      case 'revived':
        await this.reviveAtDoor();
        return;
      case 'stabilized':
        this.ddFrame?.update(next, beat);
        this.stabilizeAtDoor();
        return;
      case 'wiped':
        this.ddFrame?.update(next, beat);
        await this.wipeAtDoor();
        return;
      default:
        this.ddFrame?.update(next, beat);
        this.time.delayedCall(650, () => { if (!this.destroyed) void this.runDeathsDoorRound(); });
    }
  }

  /** Three held: the Clerk walks you out. This is the pre-door retreat, byte-for-byte. */
  private stabilizeAtDoor(): void {
    this.dd = null;
    this.closeDdFrame();
    this.hud.showBanner('Steady now. The Ledger holds your line — we walk out with what matters.', P.parchment);
    // A beat so the Clerk's line is readable before resolveBattle's own retreat banner replaces it.
    this.time.delayedCall(900, () => { if (!this.destroyed) this.resolveBattle('retreat'); });
  }

  /** Three marks: the Fade takes its due — one carried trinket, seeded, relics never touched. */
  private async wipeAtDoor(): Promise<void> {
    this.dd = null;
    this.closeDdFrame();
    let keepsakeId: string | null = null;
    try {
      keepsakeId = pickKeepsake(
        services.inventory.snapshot().stacks,
        (id) => itemById(id),
        layoutSeed('keepsake', this.launch.seed),
      );
      // The strip lands BEFORE resolveBattle so the payload describes post-strip reality. A
      // failed strip (offline store, or the stack moved underfoot) degrades to "nothing taken"
      // rather than blocking the resolution — the run has to end either way.
      if (keepsakeId && !(await services.inventory.removeItem(keepsakeId, 1))) keepsakeId = null;
    } catch { keepsakeId = null; }
    if (this.destroyed) return;
    this.resolveBattle('wipe', keepsakeId);
  }

  /**
   * A welded fact answered clean: you stand back up at 1 pool hp. splitPooledHp(1) puts that
   * single point on the Keeper and leaves the companion down at 0 — intended: the door stands
   * the KEEPER up, not the party. Once per battle is already enforced by the machine.
   */
  private async reviveAtDoor(): Promise<void> {
    this.dd = null;
    this.closeDdFrame();
    const keeper = this.unitById('keeper');
    if (!keeper) { this.stabilizeAtDoor(); return; }
    const pool = 1;
    const split = splitPooledHp(pool);
    keeper.hp = split.keeper;
    keeper.alive = keeper.hp > 0;
    keeper.statuses = [];
    this.reviveView(keeper); // undo fadeDead's death tween, same as a Satchel revival
    this.drawHpBar(keeper);
    // The pool moved with no battle event to account for it — the same re-anchor the Satchel
    // heal performs (crucible #3): save.hp went stale the instant combat damage started, and
    // hpLost is a running total the dungeon subtracts on return, so without this the damage
    // this revival just superseded would be charged a second time.
    try { await services.save.save({ hp: pool }); } catch { /* offline */ }
    if (this.destroyed) return;
    this.hpLost = 0;
    this.refreshParty();
    this.hud.showBanner('A welded memory flares — you stand again, lantern-lit.', P.lanternGold);
    this.cameras.main.flash(240, 247, 206, 107);
    // Back into the normal turn flow at the Keeper's own turn — the same activeId/setActive/
    // beginPlayerTurn trio advanceTurn() runs for a party unit, without the round-wrap bookkeeping
    // and turn-start status ticks a genuinely NEW turn fires: the door interrupted this turn, it
    // did not consume it.
    const idx = this.order.indexOf(keeper.id);
    if (idx >= 0) this.orderIndex = idx;
    this.activeId = keeper.id;
    this.hud.setActive(keeper.id, this.aliveIds());
    this.beginPlayerTurn(keeper);
  }

  /** Close the hold-the-line frame, if open. Idempotent — every door exit path calls this,
   *  including the two edge cases that reach stabilizeAtDoor()/reviveAtDoor() directly rather
   *  than through runDeathsDoorRound's switch, so the card can never outlive the door. */
  private closeDdFrame(): void {
    this.ddFrame?.close();
    this.ddFrame = null;
  }

  // ---- small helpers ----------------------------------------------------

  private refreshParty(): void {
    this.refreshSeq++; // crucible #10 drift-hunt: every HUD-text write bumps this
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

  /** Debug: single-`page.evaluate()` atomic read of both units' live hp + the HUD's raw text
   *  (e2e-only — crucible #10, 2026-07-21 drift-hunt: the ORIGINAL version of this spec read
   *  unitDebug('keeper'), unitDebug('mira'), and hudPartyText() as three SEPARATE
   *  page.evaluate() round trips via Promise.all. That's not atomic — each is an independent
   *  CDP call, and a legitimate enemy-turn damageUnit→refreshParty update can land in the real
   *  gap between them, making an older hp read look "ahead of" a newer, fully-correct hud-text
   *  read. Confirmed live: a 3-call poll caught keeper hp=3 (pre-hit) against hud text "2/10"
   *  (post-hit) — refreshSeq had advanced from 15 to 16 strictly between the two reads, proving
   *  a real damageUnit call landed in the gap, not a genuine desync. This getter is the fix:
   *  ONE synchronous function (no await inside) reading everything in the same tick, so it can
   *  never straddle a damageUnit/healUnit→refreshParty update the way split reads can. */
  hudDriftDebug(): {
    keeperHp: number | null; miraHp: number | null; hudText: string; refreshSeq: number;
    lastHpEvent: { unitId: string; kind: string; amount: number; seq: number } | null;
    pool: number; state: string; activeId: string;
  } {
    return {
      keeperHp: this.unitById('keeper')?.hp ?? null,
      miraHp: this.unitById('mira')?.hp ?? null,
      hudText: this.hud.partyPanelText(),
      refreshSeq: this.refreshSeq,
      lastHpEvent: this.lastHpEvent,
      pool: this.units.filter((u) => u.team === 'party').reduce((s, u) => s + Math.max(0, u.hp), 0),
      state: this.state,
      activeId: this.activeId,
    };
  }

  /** Debug: the encounterId the most recently resolved encounter answered against
   *  (e2e-only — crucible #11: proves a boss phase resolved the pack's own authored
   *  encounter rather than encounters/engine.ts's generic candidates[0] fallback). */
  lastEncounterId(): string | null {
    return this.results.length ? this.results[this.results.length - 1].encounterId : null;
  }

  /** Debug: what this battle's encounters actually surfaced, in the order they were asked —
   *  each entry pairing the RESOLVED encounter id with the fact ids it carried (e2e-only —
   *  wave 1 "the Draw Service": proves a cast drew from EVERY installed pack, not just
   *  this.launch.packId's. Mirrors HamletScene's wellspringDrillDebug(); reads the existing
   *  `results` log, so it adds no state of its own).
   *
   *  The encounterId is what makes the pairing worth reading rather than the fact ids alone:
   *  runPlayerAction/castGatedSpell's offline fallbacks synthesize `local-<action>` results
   *  that ECHO BACK the drawn factIds without an encounter ever resolving, so a spec asserting
   *  on fact ids alone could be handed a green by a thrown runEncounter. Callers should require
   *  a genuinely pack-resolved id (not `local-*`, not the empty-archive `none`). */
  castSurfacedDebug(): Array<{ encounterId: string; factIds: string[] }> {
    return this.results.map((r) => ({ encounterId: r.encounterId, factIds: r.factIds }));
  }

  /** Debug: the door's live state (e2e-only — same family as combatSnapshot()/bossRevealActive()). */
  deathsDoorSnapshot(): { active: boolean; successes: number; failures: number; revivedUsed: boolean } {
    return {
      active: this.dd !== null,
      successes: this.dd?.successes ?? 0,
      failures: this.dd?.failures ?? 0,
      revivedUsed: this.ddRevivedUsed,
    };
  }

  combatSnapshot(): {
    state: string; activeTeam: string | null; activeId: string; enemyHp: number; partyHp: number;
    log: Array<{ action: string; dmg: number; overlay: boolean }>;
    /** §6/§5 — e2e-only reads for Phase 2 (rank cache + Glow pips), same "read-only debug
     *  surface" spirit as everything else in this section. §3.1/§3.2 add the run tallies. */
    rank: number; welded3: number; welded4: number; glow: number;
    reclaimed: number; newWelds: number;
  } {
    return {
      state: this.state,
      activeTeam: this.unitById(this.activeId)?.team ?? null,
      activeId: this.activeId,
      enemyHp: this.enemyHpSum(),
      partyHp: this.units.filter((u) => u.team === 'party').reduce((s, u) => s + Math.max(0, u.hp), 0),
      log: this.actionLog.slice(),
      // Wave 4 — this field reports the MASTERY rank (the SRS welds, with ?rank= still absolute
      // over it, exactly the value it carried before levels existed). `this.rank` is now the
      // COMPOSED gate; progressionSnapshot().composedTier reports that half. leveling.spec.ts's
      // Pin C pins precisely this split: level 6 with an empty srs.json reads rank 1 here and
      // composedTier 3 there.
      rank: this.rankOverride ?? this.rankInfo.rank,
      welded3: this.rankInfo.welded3,
      welded4: this.rankInfo.welded4,
      glow: this.glow.pips,
      reclaimed: this.reclaimed,
      newWelds: this.newWelds,
    };
  }

  /** Debug: the Wave 4 progression state (e2e-only — same family as combatSnapshot()/
   *  deathsDoorSnapshot()). `tierFloor` is the level half of the hybrid gate alone;
   *  `composedTier` is the live gate every rank read-site actually uses, so a test can prove
   *  a level opened a tier the SRS rank never reached. `xp` reads the save (the scene caches
   *  a level, never a running xp total), tolerant of an offline store like its siblings. */
  progressionSnapshot(): { xp: number; level: number; tierFloor: 1 | 2 | 3; composedTier: 1 | 2 | 3 } {
    let xp = 0;
    try { xp = services.save.get()?.xp ?? 0; } catch { /* offline → 0 */ }
    return { xp, level: this.level, tierFloor: this.tierFloor, composedTier: this.rank };
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

  /** Debug: the live initiative order, by unit id (e2e-only — §9.4: proves Call the Clause's
   *  reinforcement was really APPENDED to `order` and is really reachable by the turn loop,
   *  which a unit count alone would not show). */
  orderDebug(): string[] {
    return this.order.slice();
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

  /** Debug: force the §5 classification gate (e2e-only, same spirit as debugSetGlow — isolates
   *  the rider's math from whether a classified pack happens to be installed). loadContent()
   *  normally derives this from `pack.meta.difficultyClassified`, which only resolves when the
   *  launch packId matches an installed pack — never true for the dev/e2e fixture launch. */
  debugSetPackReady(ready: boolean): void {
    this.packDifficultyClassified = ready;
  }

  /** Debug: the tier flyout's current rows/Overglow state, if open (e2e-only — the flyout is
   *  Phaser-drawn, not DOM, so a spec can't reach it via a locator; proves greying — e.g.
   *  "needs Rank 3", Overglow greyed for Lanternfall — without depending on click side effects). */
  flyoutDebug(): { rows: TierRow[]; overglow: OverglowRow | null } | null {
    return this.state === 'playerTier' ? { rows: this.lastFlyoutRows, overglow: this.lastFlyoutOverglow } : null;
  }

  /** Debug: the HUD banner's + tier flyout's current absolute bounding boxes (e2e-only —
   *  crucible v1 #10: proves the "choose a tier" banner never visually overlaps the flyout). */
  bannerBounds(): { top: number; bottom: number; left: number; right: number } {
    return this.hud.bannerBounds();
  }

  flyoutBounds(): { top: number; bottom: number; left: number; right: number } | null {
    return this.hud.flyoutBounds();
  }

  /** Debug: the action menu's rendered button label/hint text + widths (e2e-only — crucible
   *  v1 #11: proves the 8-button row never overflows a button, ellipsizing instead). */
  actionMenuDebug(): Array<{ label: string; labelWidth: number; hint: string; hintWidth: number; buttonWidth: number }> {
    return this.hud.actionMenuDebug();
  }

  /** Debug: the HUD banner's current text (e2e-only — crucible v1 #14/#19: proves the
   *  banner's wording reflects the actual outcome rather than a static template). */
  bannerText(): string {
    return this.hud.bannerText();
  }

  /** Debug: the first status chip's true (center-anchored) top edge vs the HP bar's own
   *  bottom edge, both in the unit's container-LOCAL coordinate space so they're directly
   *  comparable (e2e-only — crucible v1 #23: proves the chip row no longer overlaps the bar).
   *  null if the unit has no chip rendered (no status applied). */
  chipHpGapDebug(id: string): { chipTopY: number; hpBarBottomY: number } | null {
    const v = this.views.get(id);
    if (!v || !v.chips.length) return null;
    const chip = v.chips[0];
    const chipTopY = chip.y - chip.displayHeight / 2; // Images/Text both default-origin at 0.5 vertically
    const hpBarBottomY = Math.round(v.sprite.y - v.sprite.displayHeight - 6) + 5; // mirrors drawHpBar's own y + bar height
    return { chipTopY, hpBarBottomY };
  }
}
