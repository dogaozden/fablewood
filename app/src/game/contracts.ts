/**
 * Cross-agent contracts for the wave-2 game systems. ORCHESTRATOR-OWNED — do not edit.
 * Provider modules (encounters, srs) implement these and install into `services` from
 * their register.ts (side-effect imported in scenes/index.ts). Consumers (hamlet,
 * dungeon, combat) use `services.*` only — never import provider internals.
 */

export type Quality = 0 | 0.5 | 1;
export type EncounterKind = 'mcq' | 'free_recall' | 'scenario_branch' | 'match' | 'order';

export interface EncounterRequest {
  /** where this fires from — affects presentation + kind defaults */
  context: 'combat' | 'parley' | 'drill' | 'boss';
  /** allowed kinds for this action (combat action determines it); omit = any */
  kinds?: EncounterKind[];
  /** preferred fact ids (due queue first); picker may fall back to new facts */
  factIds?: string[];
  /** force a specific encounter (boss phases, parley gates) */
  encounterId?: string;
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
}

/** Opens the encounter overlay (DOM over canvas), resolves when answered. Combat pauses meanwhile. */
export type RunEncounter = (req: EncounterRequest) => Promise<EncounterResult>;

export interface JudgeVerdict {
  verdict: 'pass' | 'partial' | 'fail';
  line: string;
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
}

// ---------------------------------------------------------------- srs & save

export interface SrsApi {
  /** resolve cached state from state/srs.json — call before sync reads */
  ready(): Promise<void>;
  /** due fact ids (overdue first, then lowest box), then unseen in prereq order */
  dueQueue(packId: string, factIds: string[], now?: number): string[];
  record(factId: string, quality: Quality, encounterId: string): Promise<void>;
  /** Leitner box 1-5; 0 = unseen */
  boxOf(factId: string): number;
  /** avg box across facts (mastery-bound companion scaling), 0-5 */
  masteryAvg(factIds: string[]): number;
}

export interface SaveData {
  scene: string;
  pos?: { x: number; y: number };
  dungeon?: { roomIndex: number; cleared: string[] };
  hp: number;
  streak: number;
  lastPlayed: string;
}

export interface SaveApi {
  ready(): Promise<void>;
  get(): SaveData;
  save(patch: Partial<SaveData>): Promise<void>;
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
  get(): { muted: boolean };
  set(patch: Partial<{ muted: boolean }>): Promise<void>;
}

export interface Services {
  runEncounter: RunEncounter;
  judge: Judge;
  srs: SrsApi;
  save: SaveApi;
  settings: SettingsApi;
  /** teach-and-test: modal "discovered documents" cards, resolves on dismiss (encounters agent owns UI) */
  showTeaching: (facts: FactLite[]) => Promise<void>;
}

/**
 * Mutable registry. Stubs are installed by encounters/register.ts and srs/register.ts;
 * real implementations overwrite them on module import (same files, rewritten by their owners).
 */
export const services: Services = {} as Services;
