/**
 * Cross-agent contracts for the wave-2 game systems. ORCHESTRATOR-OWNED — do not edit.
 * Provider modules (encounters, srs) implement these and install into `services` from
 * their register.ts (side-effect imported in scenes/index.ts). Consumers (hamlet,
 * dungeon, combat) use `services.*` only — never import provider internals.
 */

export type Quality = 0 | 0.5 | 1;
export type EncounterKind = 'mcq' | 'free_recall' | 'scenario_branch' | 'match' | 'order';
export type EncounterDifficulty = 1 | 2 | 3;

export interface EncounterRequest {
  /** where this fires from — affects presentation + kind defaults */
  context: 'combat' | 'parley' | 'drill' | 'boss';
  /** allowed kinds for this action (combat action determines it); omit = any */
  kinds?: EncounterKind[];
  /** preferred fact ids (due queue first); picker may fall back to new facts */
  factIds?: string[];
  /** force a specific encounter (boss phases, parley gates) */
  encounterId?: string;
  /** spell title for the overlay eyebrow ("✦ Cinder-Rebuke · Multiple Choice") — T2+ casts only */
  flair?: string;
  /** casting spell's tier — biases pick()'s difficulty filter. Absent (Strike/Satchel) = no filtering. */
  spellTier?: 1 | 2 | 3;
  packId: string;
  seed: number;
}

export interface EncounterResult {
  encounterId: string;
  kind: EncounterKind;
  factIds: string[];
  quality: Quality; // 1 full, 0.5 partial, 0 fail
  /** e.g. the Laconic Clerk's one line, or branch outcome text */
  detail?: string;
  /** scenario_branch only: machine-readable branch outcome tag (e.g. 'good'|'bad'|'neutral') */
  branchTag?: string;
  /**
   * Drawn encounter's resolved difficulty. Optional only for the empty-archive edge case;
   * callers read `result.difficulty ?? 2` defensively.
   */
  difficulty?: EncounterDifficulty;
}

/** Opens the encounter overlay (DOM over canvas), resolves when answered. Combat pauses meanwhile. */
export type RunEncounter = (req: EncounterRequest) => Promise<EncounterResult>;

export interface JudgeVerdict {
  verdict: 'pass' | 'partial' | 'fail';
  line: string;
  /** ms the grading call took (server-measured when the plugin served it; client-
   *  measured as a fallback for the native/offline-stub paths). Optional: older
   *  callers that only check verdict/line are unaffected. */
  latencyMs?: number;
  /** which layer produced the grade — 'warm' | 'spawn' | 'away' | 'stub-mode' (server
   *  vite-judge-plugin tiers) or 'native' | 'client-stub' (browser-side fallbacks). */
  tier?: string;
}
export type Judge = (args: { prompt: string; answer: string; rubric: string }) => Promise<JudgeVerdict>;

// ---------------------------------------------------------------- combat & dungeon

export type EnemyArchetype = 'wisp' | 'wraith' | 'construct' | 'warden';

export interface EnemySpec {
  archetype: EnemyArchetype;
  /** fact tags this enemy draws encounters from (via factIds resolution in dungeon) */
  tags?: string[];
  /** encounter kinds this enemy favors */
  kinds?: EncounterKind[];
  parley?: boolean;
}

export interface BossPhase {
  /** scenario_branch encounter id opening the phase (the Warden proposes a term) */
  branchEncounterId: string;
  /** tags to draw the follow-up free_recall "cite your authority" strike from */
  recallTags?: string[];
}

export interface BossSpec {
  name: string;
  shields: number; // 3 for the Vault-Warden
  phases: BossPhase[];
}

export interface DungeonRoom {
  id: string;
  name: string;
  blurb?: string;
  /** fact ids shown as discovered documents on room entry (teach-and-test) */
  teaching?: string[];
  enemies: EnemySpec[];
  /** free_recall (or other) gate on the door out of this room */
  gate?: { encounterId: string };
  boss?: BossSpec;
}

/** Pack-owned file: packs/<id>/assets/<slug>.dungeon.json — engine reads it generically. */
export interface DungeonSpec {
  id: string;
  name: string;
  region: string;
  packId: string;
  rooms: DungeonRoom[];
}

export interface CombatLaunch {
  packId: string;
  room: DungeonRoom;
  seed: number;
  /** scene key to resume on resolve (dungeon) */
  returnScene: string;
}

export interface CombatOutcome {
  outcome: 'victory' | 'retreat';
  hpLost: number;
  results: EncounterResult[];
  /** §3.2 Night's Ledger run tallies — facts reclaimed from the Fade (§3.1) and facts newly
   *  welded (crossed into box ≥ 4, the weld-edge mastery level) this run. Optional: the packless
   *  sim victory omits them, and
   *  consumers read `?? 0`. */
  reclaimed?: number;
  newWelds?: number;
}

// ---------------------------------------------------------------- srs & save

export interface SrsApi {
  /** resolve cached state from state/srs.json — call before sync reads */
  ready(): Promise<void>;
  /** due fact ids (overdue first, then lowest box), then unseen in prereq order */
  dueQueue(packId: string, factIds: string[], now?: number): string[];
  record(factId: string, quality: Quality, encounterId: string, factType?: string): Promise<void>;
  /** Leitner box 1-8; 0 = unseen */
  boxOf(factId: string): number;
  /** avg box across facts (mastery-bound companion scaling), 0-8 */
  masteryAvg(factIds: string[]): number;
  /** prior answer qualities for a fact, oldest first (empty if unseen). The redemption bell
   *  (§3.1) reads this BEFORE record() to see a fact's PRIOR history. */
  historyQualities(factId: string): Quality[];
}

export interface SaveData {
  scene: string;
  pos?: { x: number; y: number };
  dungeon?: { roomIndex: number; cleared: string[] };
  hp: number;
  streak: number;
  /** chosen retinue for the next crawl; absent = 'mira'. Primitive on purpose — the save
   *  merge is shallow one-level; nested objects clobber on partial writes. */
  companion?: 'mira' | 'alder';
  /** held Wellspring boon (e.g. 'trimmed-wick'), consumed at battle create(); absent/null = none */
  boon?: string | null;
  lastPlayed: string;
}

export interface SaveApi {
  ready(): Promise<void>;
  get(): SaveData;
  save(patch: Partial<SaveData>): Promise<void>;
}

// ---------------------------------------------------------------- inventory

export interface InventorySnapshot {
  gold: number;
  /** itemId → count (ids from inventory/catalog.ts; state-referenced, never renamed) */
  stacks: Record<string, number>;
}

export interface UseResult {
  ok: boolean;
  message: string;
}

export interface InventoryApi {
  /** resolve cached state from state/inventory.json — call before sync reads */
  ready(): Promise<void>;
  getGold(): number;
  snapshot(): InventorySnapshot;
  /** add (clamped ≥ 0); resolves to the new total */
  addGold(d: number): Promise<number>;
  /** false (and no deduction) if the freshest balance can't afford it */
  spendGold(cost: number): Promise<boolean>;
  grantItem(id: string, qty?: number): Promise<void>;
  /** false (and no change) if not enough are held */
  removeItem(id: string, qty?: number): Promise<boolean>;
  countOf(id: string): number;
  /** field use (heals); trial effects answer {ok:false} until the combat hook lands */
  useItem(id: string): Promise<UseResult>;
  /** atomic purchase: gold check + deduct + grant in ONE store write; false (no write) if unaffordable */
  buy(id: string, cost: number, qty?: number): Promise<boolean>;
  /** atomic sale: held check + remove + credit in ONE store write; false (no write) if not enough held */
  sell(id: string, price: number, qty?: number): Promise<boolean>;
}

// ---------------------------------------------------------------- service registry

/** minimal fact shape for teaching cards (subset of packs/types Fact) */
export interface FactLite {
  id: string;
  type: string;
  statement: string;
  detail?: string;
  source_ref?: { file: string; loc?: string | number; quote: string };
}

export interface SettingsApi {
  ready(): Promise<void>;
  get(): { muted: boolean; volume: number };
  set(patch: Partial<{ muted: boolean; volume: number }>): Promise<void>;
}

// ---------------------------------------------------------------- night's ledger

/**
 * §3.2 — the run-harvest screen's data. Rows render only when their stat is nonzero, EXCEPT
 * `held` which always shows; the empty-harvest sign-off is used when held/welds/reclaimed/gold
 * are all zero (streak, a standing counter, does not count toward emptiness).
 */
export interface NightLedgerData {
  outcome: 'victory' | 'retreat' | 'camp';
  /** facts answered q1 this run — "Held against the Fade" (always shown) */
  held: number;
  /** facts newly welded (crossed into box ≥ 4, the weld-edge mastery level) — "Newly welded" */
  welds: number;
  /** facts reclaimed from the Fade (§3.1) — "Reclaimed from the Fade" */
  reclaimed: number;
  /** gold earned this run — rendered "+N" */
  gold: number;
  /** hearth streak — rendered "N nights" (singular "1 night") */
  streak: number;
}

export interface Services {
  runEncounter: RunEncounter;
  judge: Judge;
  srs: SrsApi;
  save: SaveApi;
  settings: SettingsApi;
  inventory: InventoryApi;
  /** teach-and-test: modal "discovered documents" cards, resolves on dismiss (encounters agent owns UI) */
  showTeaching: (facts: FactLite[]) => Promise<void>;
  /** §3.2 the Night's Ledger run-harvest screen (encounters agent owns UI); resolves on dismiss.
   *  `opts.auto` (dev/e2e auto-drive) auto-advances after a beat so the pipeline never hangs. */
  showNightLedger: (data: NightLedgerData, opts?: { auto?: boolean }) => Promise<void>;
}

/**
 * Mutable registry. Stubs are installed by encounters/register.ts and srs/register.ts;
 * real implementations overwrite them on module import (same files, rewritten by their owners).
 */
export const services: Services = {} as Services;
