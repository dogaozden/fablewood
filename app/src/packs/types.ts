// TS mirror of pack.schema.json (Fable_SPEC.md §4). The schema is the source of
// truth for validation; these types are for engine/pipeline consumers.

export type FactType = 'rule' | 'concept' | 'advice' | 'do' | 'dont' | 'number' | 'story';
export type EncounterKind = 'mcq' | 'free_recall' | 'scenario_branch' | 'match' | 'order';
export type EncounterDifficulty = 1 | 2 | 3; // Ember | Lantern | Beacon

export interface Source {
  id?: string;
  title: string;
  author?: string;
  file?: string;
  loc?: string | number;
  url?: string;
  version?: string;
}

export interface PackMeta {
  id: string;
  title: string;
  version: string;
  sources: Source[];
  /**
   * True once every encounter has passed the later difficulty-classification pipeline.
   * Gates the reward rider; absent/false keeps it fully inert. P1 never sets this true.
   */
  difficultyClassified?: boolean;
}

export interface SourceRef {
  file: string;
  loc: string | number;
  quote: string;
}

export interface Fact {
  id: string;
  type: FactType;
  statement: string;
  detail?: string;
  source_ref: SourceRef;
  as_of: string;
  source_version: string;
  tags?: string[];
  difficulty: number; // 1..5
  prereqs?: string[];
}

export interface EncounterBranch {
  label: string;
  outcome?: string;
  correct?: boolean;
}

export interface Encounter {
  id: string;
  fact_ids: string[];
  kind: EncounterKind;
  /** Optional; absent = Lantern (2). NOT Fact.difficulty's axis (§1.1). */
  difficulty?: EncounterDifficulty;
  template_vars?: Record<string, unknown>;
  prompt: string;
  options?: unknown[];
  branches?: EncounterBranch[];
  answer?: string | number | boolean | unknown[] | Record<string, unknown>;
  rubric?: string | Record<string, unknown>;
  trap_notes?: string;
}

export interface Quest {
  id: string;
  title: string;
  region: string;
  encounter_ids: string[];
  dialogue?: Array<string | Record<string, unknown>>;
  reward?: string | Record<string, unknown>;
}

export interface Npc {
  id: string;
  name: string;
  role?: string;
  blurb?: string;
}

export type MetaphorMap =
  | Record<string, unknown>
  | Array<{ game: string; real: string; note?: string }>;

export interface Pack {
  meta: PackMeta;
  facts: Fact[];
  encounters: Encounter[];
  quests: Quest[];
  npcs?: Npc[];
  metaphor_map: MetaphorMap;
}
