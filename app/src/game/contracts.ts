/**
 * Cross-agent contracts for the wave-2 game systems. ORCHESTRATOR-OWNED — do not edit.
 * Provider modules (encounters, srs) implement these and install into `services` from
 * their register.ts (side-effect imported in scenes/index.ts). Consumers (hamlet,
 * dungeon, combat) use `services.*` only — never import provider internals.
 */
import type { Fact, Encounter } from '../packs/types';

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
  /** Ch. IV — caller holds a lit Lantern-light: show the overlay's re-draw affordance.
   *  Absent/false = no affordance (gates, boss phases, trim, teaching never pass it). */
  lanternLight?: boolean;
  /** One italic line under the eyebrow (e.g. lantern.ts FATE_HOLDS_LINE on a re-present).
   *  Absent = none. */
  notice?: string;
  /** Ch. VII Mira's Stall — Scrivener's Hint fired: the mcq renderer strikes one wrong option.
   *  CombatScene sets this at its two cast sites only; absent/false = no strike (every other
   *  caller, and every cast with no Hint armed, never passes it). */
  strikeOneFalse?: boolean;
  /** casting spell's tier — biases pick()'s difficulty filter. Absent (Strike/Satchel) = no filtering. */
  spellTier?: 1 | 2 | 3;
  /** @deprecated resolution is per-fact via the draw index */
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
  /** Ch. IV — the player raised the lantern INSTEAD of answering: nothing was judged, and
   *  nothing may be recorded/granted from this result (factIds is deliberately [] and
   *  quality 0 so a caller that forgets to branch stays inert). The presented-but-unanswered
   *  encounter's fact ids ride here for the caller's exclusion list. Optional, additive. */
  redraw?: { shownFactIds: string[] };
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

/** Ch. VIII (the Bestiary) grows the closed enum from four to seven — lurker/husk/pall.
 *  Runtime membership lives with the stats that define it: combat/units.ts's isEnemyArchetype,
 *  whose `Record<EnemyArchetype, StatBlock>` backing makes it exhaustive by construction. */
export type EnemyArchetype = 'wisp' | 'wraith' | 'construct' | 'warden' | 'lurker' | 'husk' | 'pall';

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
  /** Historically: the tags the follow-up free_recall "cite your authority" strike drew from.
   *  Since wave 1 (design §5) tags have left the draw path entirely — combat draws globally,
   *  narrowed only by encounter kind — so this is parsed and schema-tolerated, never read. */
  recallTags?: string[];
}

export interface BossSpec {
  name: string;
  shields: number; // 3 for the Vault-Warden
  phases: BossPhase[];
  /** magic-combat-depth.md §9.5/§13 (ADDITIVE, optional — accept-if-absent): a pack may
   *  relabel the Warden's three engine-generic moves in its own register. The engine's
   *  SCRIPT is unchanged either way — this is flavor text only, never a mechanic (S5), and
   *  packs should mirror each label in their metaphor_map. Keys are combat/boss.ts's
   *  WardenMove union. */
  moveLabels?: { seizure?: string; injunction?: string; summon?: string };
  /** Ch. IX Provenance — the relic this boss grants on defeat (a catalog id of type 'relic').
   *  Validated at load by specResolve's relicError; absent = the Warden's Signet fallback. */
  relicId?: string;
}

export interface DungeonRoom {
  id: string;
  name: string;
  blurb?: string;
  /** Historically: the fact ids shown as discovered documents on room entry (teach-and-test).
   *  Since wave 1 (design §5) teaching draws globally instead — services.draw.fresh() picks
   *  the next new material from any installed pack — so these ids are parsed and
   *  schema-tolerated but never read for content; only .length still tunes how many facts
   *  the room introduces (DungeonScene.teachingFacts()). */
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
  /** 'wipe' = Death's Door exhausted (Concordance Ch. I). Was a 2-member union; precedent for
   *  a 3rd member set by `NightLedgerData.outcome`'s `'camp'`. */
  outcome: 'victory' | 'retreat' | 'wipe';
  /** The pooled HP delta to subtract on return. A DELTA, not a ledger: the scene re-anchors it
   *  to 0 whenever it rewrites save.hp mid-battle (satchel heal, death's-door revival, a
   *  level-up's pool bump), so `hpLost === 0` means "nothing lost since that re-anchor" and must
   *  NOT be read as "the party was never bloodied" — use `damageTaken` for that. */
  hpLost: number;
  results: EncounterResult[];
  /** §3.2 Night's Ledger run tallies — facts reclaimed from the Fade (§3.1) and facts newly
   *  welded (crossed into box ≥ 4, the weld-edge mastery level) this run. Optional: the packless
   *  sim victory omits them, and
   *  consumers read `?? 0`. */
  reclaimed?: number;
  newWelds?: number;
  /** Death's Door wipe detail — absent on victory/retreat. Optional, additive: old consumers
   *  unaffected, same `?? `-default pattern as `reclaimed?`/`newWelds?`. */
  wipeReport?: { keepsakeId: string | null };
  /** Wave 4 — levels gained MID-BATTLE (renewal grants at CombatScene's record() choke point),
   *  carried out so the post-battle beat folds them into its ONE ceremony card rather than
   *  firing a second one from inside combat (leveling.spec.ts's beat law). Present on every
   *  outcome, wipe included: XP is never lost (Constraint 5). Optional, additive, same
   *  `?? []`-default pattern as `wipeReport?` above. */
  levelsGained?: number[];
  /** Wave 4 — total party HP lost across the WHOLE battle, never re-anchored: the honest
   *  "was the party ever bloodied" ledger `hpLost` cannot be (see above). Read this, not
   *  hpLost, for the flawless-clear grant. Optional, additive, same `?? `-default family as its
   *  siblings — absent reads as 0/untouched, which is exactly right for the two synthetic
   *  outcomes that omit it (the sim victory and the gate-pending resume), neither of which
   *  fought a battle in which damage could have been taken. */
  damageTaken?: number;
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
  /** True once the fact has any SRS record (boxOf(factId) > 0) — i.e. has been introduced.
   *  draw/register.ts's fresh()/due() adapters read this to gate "unseen" facts. */
  hasRecord(factId: string): boolean;
  /** epoch-ms next-due of a recorded fact; undefined if no record */
  nextDueOf(factId: string): number | undefined;
}

export interface SaveData {
  scene: string;
  pos?: { x: number; y: number };
  /** `gatePending` = the room whose combat is won but whose gate has not opened (roomFlow). */
  dungeon?: { roomIndex: number; cleared: string[]; gatePending?: string };
  hp: number;
  streak: number;
  /** chosen retinue for the next crawl; absent = 'mira'. Primitive on purpose — the save
   *  merge is shallow one-level; nested objects clobber on partial writes. */
  companion?: 'mira' | 'alder';
  /** held Wellspring boon (e.g. 'trimmed-wick'), consumed at battle create(); absent/null = none */
  boon?: string | null;
  /** Hearth rest currency — Embers. Undefined = full pool at the save's level (rest/embers.ts
   *  embersOf → progression/xp.ts emberMaxForLevel, since Wave 4 retired EMBER_MAX). NOT
   *  the combat Art 'kindling'. */
  embers?: number;
  /** ISO stamp of the last Hearth night-rest; absence = never rested. W4's Lantern-light
   *  consumes this. */
  lastHearthAt?: string;
  /** Lantern-light held (Concordance Ch. IV): ONE stored inspiration token, banked by the
   *  hearth night-rest (HamletScene.doCottage — the lastHearthAt event above). Binary, no
   *  stockpiling; absent = false = no light. Spent on a drill re-draw or a loot-rarity
   *  advantage; game/lantern.ts + the spend sites own the rules. Optional, additive: old
   *  consumers unaffected, same `?? `-default pattern as `xp?`/`level?`. */
  lanternLight?: boolean;
  /** Concordance Ch. IX — the Second Wick relic's once-per-rest-cycle catch: true once the
   *  catch has fired this cycle (the Wick already re-banked one spend since the last hearth
   *  rest). Reset to false at every hearth rest (HamletScene.doCottage, beside lanternLight's
   *  own grant) — game/lantern.ts's spendLanternLight() owns the read+write. Absent = false =
   *  catch available (correct default for saves predating the relic — nobody is mid-cycle).
   *  Optional, additive, same `?? `-default pattern as lanternLight itself. */
  wickCaught?: boolean;
  /** Cumulative XP (Concordance Ch. III). Absent = 0 — legacy saves start the spine at L1
   *  with no catch-up grant (W4 controller ruling). progression/xp.ts owns every number. */
  xp?: number;
  /** Current level 1-10, always derivable as levelForXp(xp) — persisted so save readers
   *  (HUD, hamlet status) never import the table. Absent = 1. */
  level?: number;
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
  /** the one relic whose passive is live, or null if none borne (Concordance Ch. IX) */
  bornRelicId: string | null;
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
  /** choose the one live relic passive, or null to set it down — swap costs nothing
   *  (Concordance Ch. IX); false (no write) if id isn't an owned relic */
  bearRelic(id: string | null): Promise<boolean>;
  /** the currently borne relic id, or null */
  bornRelic(): string | null;
}

// ---------------------------------------------------------------- draw

/**
 * Query params for services.draw.due()/fresh(). Deliberately mirrors draw/types.ts's
 * DrawOpts (kept in sync by hand, same relationship FactLite has to packs/types's Fact) —
 * contracts.ts stays free of any import from a provider's own module (draw/, srs/,
 * encounters/), only ever from the foundational packs/types.ts.
 */
export interface DrawOpts {
  count: number;
  seed: number;
  now: number;
  kinds?: EncounterKind[];
}

/**
 * Global cross-pack question picker (wave-1 interleaving). Wraps draw/index.ts's pure
 * buildDrawIndex/drawDue/drawNew with the real installed packs (bridge getPacks) and the
 * real SRS/amendment services — see draw/register.ts. Every wave-1+ draw site (Wellspring,
 * combat casts, dungeon teaching) calls through this instead of a scene's own packId-scoped
 * picker.
 */
export interface DrawServiceApi {
  /** Pulls installed packs and builds the draw index (memoized — one getPacks round). */
  ready(): Promise<void>;
  /**
   * Resolves once the draw index ITSELF has settled — independent of the srs/amendments
   * legs ready() also awaits via Promise.all. isEmpty()/factOf()/encountersOf() only ever
   * read the index, so a caller that needs just those safe to call (not due()/fresh(),
   * which also need srs/amendments) should await this instead: ready() can reject early on
   * an unrelated srs/amendments failure while the index is still mid-build, which would
   * leave isEmpty() reading the still-default (empty) index even with real packs installed.
   */
  indexReady(): Promise<void>;
  /** Global schedule-first draw: eligible, due-first, capped at opts.count. */
  due(opts: DrawOpts): string[];
  /** Introduction-pacing draw: eligible, unseen, prereq-clear facts (drawNew). */
  fresh(opts: DrawOpts): string[];
  /**
   * Every indexed fact id, across all installed packs, in index order (installation
   * order; a duplicate id is held by its first-installed pack only). For a caller that
   * must ENUMERATE the global pool rather than draw from it — combat's once-per-battle
   * rank/mastery reads, which have to describe the same widened pool due() draws from.
   */
  allFactIds(): string[];
  /** Which installed pack a fact belongs to. */
  sourceOf(factId: string): string | undefined;
  factOf(factId: string): Fact | undefined;
  encountersOf(factId: string): Encounter[];
  /** True with zero packs installed. */
  isEmpty(): boolean;
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

// ---------------------------------------------------------------- the ledger amended

/** One superseded→superseding pair: the Clerk's amendment (supersession-reteach.md §3). */
export interface Amendment {
  /** the old truth — struck through on the card, and excluded from every draw once witnessed */
  old: FactLite;
  /** the new truth, carrying its own verbatim source quote */
  next: FactLite;
}

/**
 * "The Ledger Amended" (supersession-reteach.md §4) — witness state + the ONE suspension
 * predicate every draw/scheduling surface funnels through. Sync after ready(), like SrsApi.
 *
 * An amendment suspends BOTH truths until it is witnessed: the superseded fact retires at
 * pack load (permanently), and the superseding fact is gated out of play until the Clerk
 * has amended the record. After the witness beat the new fact enters play as a normal new
 * fact — due immediately, box 1.
 */
export interface AmendmentsApi {
  /** resolve cached state from state/amendments.json + the pack supersession index */
  ready(): Promise<void>;
  /** has this superseded fact's amendment card been read and witnessed? */
  isWitnessed(supersededFactId: string): boolean;
  /** §4 THE predicate: retired (superseded) or gated (superseding, unwitnessed) */
  isSuspended(factId: string): boolean;
  /** isSuspended over a list, preserving order — what draw surfaces call */
  eligible(factIds: readonly string[]): string[];
  /** §2 amendments awaiting the Clerk in this pack, pack order (uncapped; the scene batches) */
  pending(packId: string): Amendment[];
  /** the witness beat — persists, and the new truth enters play from here on */
  witness(supersededFactId: string): Promise<void>;
  /** §5 the mercy rule: which of these facts (if any) is a superseding fact on its FIRST
   *  graded appearance. Read BEFORE record() — a fresh history disarms it. */
  firstAmendedAppearance(factIds: readonly string[]): string | null;
}

// ---------------------------------------------------------------- the second telling

/** One delivered story moment («Onward» design §5): a parchment card's worth of the
 *  canonical text (docs/story/onward/), curated verbatim — never paraphrased. */
export interface StoryBeat {
  id: string;
  title: string;
  /** card pages, advanced like teaching-card pages */
  pages: string[];
  /** the Clerk's dated margin, rendered small beneath the last page (optional) */
  margin?: string;
}

/** The T1 trigger surfaces. An arc's beats fire at existing seams — scenes ask, the
 *  story provider decides; scenes never hold story logic (design §9 "triggers"). */
export type StorySurface = 'hamlet-entry' | 'south-gate' | 'tavern';

/** The «Onward» story spine: beat delivery + the Records Office reading desk.
 *  Sync reads after ready(), like SrsApi. state/story.json is additive-only. */
export interface StoryApi {
  /** resolve cached state from state/story.json — call before sync reads */
  ready(): Promise<void>;
  isSeen(beatId: string): boolean;
  /** The one beat (if any) that fires at this surface right now, canon order, seen
   *  beats excluded. Pure given (store, save) — the eligibility table lives in
   *  story/beats.ts. */
  nextBeatFor(surface: StorySurface, save: SaveData): StoryBeat | null;
  /** Show one beat's parchment card; marks it seen BEFORE resolving (a crash after
   *  dismiss never refires it). `auto` mirrors showNightLedger's auto-drive. */
  showBeat(beat: StoryBeat, opts?: { auto?: boolean }): Promise<void>;
  /** The Records Office reading desk (both books); resolves on close. */
  openDesk(opts?: { auto?: boolean }): Promise<void>;
}

// ---------------------------------------------------------------- night's ledger

/**
 * §3.2 — the run-harvest screen's data. Rows render only when their stat is nonzero, EXCEPT
 * `held` which always shows; the empty-harvest sign-off is used when held/welds/reclaimed/gold
 * are all zero (streak, a standing counter, does not count toward emptiness).
 */
export interface NightLedgerData {
  outcome: 'victory' | 'retreat' | 'camp' | 'wipe';
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
  /** Optional, additive — the card's zero-suppressed "Keepsake taken" row reads it; absent
   *  for non-wipe outcomes. */
  keepsakeId?: string | null;
}

export interface Services {
  runEncounter: RunEncounter;
  judge: Judge;
  srs: SrsApi;
  save: SaveApi;
  settings: SettingsApi;
  inventory: InventoryApi;
  amendments: AmendmentsApi;
  draw: DrawServiceApi;
  story: StoryApi;
  /** teach-and-test: modal "discovered documents" cards, resolves on dismiss (encounters agent owns UI) */
  showTeaching: (facts: FactLite[]) => Promise<void>;
  /** §3.2 the Night's Ledger run-harvest screen (encounters agent owns UI); resolves on dismiss.
   *  `opts.auto` (dev/e2e auto-drive) auto-advances after a beat so the pipeline never hangs. */
  showNightLedger: (data: NightLedgerData, opts?: { auto?: boolean }) => Promise<void>;
  /** "The Ledger Amended" card (supersession-reteach.md §3; encounters agent owns UI); resolves
   *  when the player confirms "Read and witnessed ▸". `last` adds the batch sign-off. */
  showAmendment: (card: Amendment, opts?: { last?: boolean; auto?: boolean }) => Promise<void>;
  /** "The Lantern Burns Brighter" level-up ceremony (Wave 4 Task 5; Night-Ledger family, same
   *  UI ownership); resolves when the player confirms "Onward ▸". `rows` is
   *  progression/ceremony.ts's levelUpRows(...)?.rows — callers skip this call entirely when
   *  that's null (nothing gained). `opts.auto` mirrors showNightLedger's auto-drive. */
  showLevelUp: (rows: string[], opts?: { auto?: boolean }) => Promise<void>;
}

/**
 * Mutable registry. Stubs are installed by encounters/register.ts and srs/register.ts;
 * real implementations overwrite them on module import (same files, rewritten by their owners).
 */
export const services: Services = {} as Services;
