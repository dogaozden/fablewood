/**
 * Difficulty-classification provenance sidecar (difficulty-rewards.md §8, director veto item 10).
 *
 * The classification pipeline writes ONE JSON sidecar per pack, next to pack.json —
 * never INTO pack.json, whose fact/encounter IDs and shape stay byte-for-byte frozen
 * (state/ is precious; IDs referenced by SRS history never move). The loader
 * (bridge/plugin.ts `listPacks`) reads the sidecar off disk and folds each encounter's
 * resolved tier into the in-memory pack, so `difficultyOf()` returns the real tier and
 * the reward rider comes alive — with zero change to the committed pack.json.
 *
 * Absent/empty sidecar → no-op: every encounter stays unmarked (difficultyOf → Lantern 2)
 * and `meta.difficultyClassified` stays falsy, so the rider is fully dormant and the
 * zero-packs build is untouched (§5's hard gate, §6's honesty principle).
 */
import type { EncounterDifficulty } from '../packs/types';

/** Sidecar filename, resolved next to each pack's pack.json (packs/<id>/…). */
export const DIFFICULTY_SIDECAR_FILE = 'difficulty.provenance.json';

/** One encounter's classification: the resolved tier + a one-line rationale + who set it, when. */
export interface DifficultyProvenanceEntry {
  difficulty: EncounterDifficulty; // 1 Ember | 2 Lantern | 3 Beacon
  rationale: string;
  source: 'heuristic' | 'llm' | 'human';
  model: string;
  date: string;
}

export interface DifficultyProvenance {
  pack: string;
  generatedAt?: string;
  verb?: string;
  encounters: Record<string, DifficultyProvenanceEntry>;
}

/** Structural minimum the merge needs — deliberately loose so it accepts the raw parsed pack.json
 *  (PackEntry.pack is `unknown`). */
interface MergeablePack {
  meta?: { difficultyClassified?: boolean } & Record<string, unknown>;
  encounters?: Array<{ id?: unknown; difficulty?: EncounterDifficulty } & Record<string, unknown>>;
}

function validTier(d: unknown): d is EncounterDifficulty {
  return d === 1 || d === 2 || d === 3;
}

/**
 * Fold a difficulty sidecar into a freshly-parsed pack, in place, and return it.
 *  - Each encounter carrying a valid sidecar entry takes that tier — the eyebrow glyph then
 *    shows the ACTUAL drawn difficulty (§6/§7), never a tier it didn't earn.
 *  - `meta.difficultyClassified` flips true ONLY at full coverage — every encounter carries an
 *    entry (§5's hard gate; §8: "flips true once every encounter has a provenance entry").
 *    Partial coverage applies what it has but leaves the flag falsy, so the rider stays dormant.
 * A null / absent / malformed sidecar leaves the pack untouched (rider dormant, all → Lantern 2).
 */
export function applyDifficultySidecar(
  pack: MergeablePack,
  sidecar: DifficultyProvenance | null | undefined,
): MergeablePack {
  const entries = sidecar?.encounters;
  if (!entries || typeof entries !== 'object') return pack;
  const encs = Array.isArray(pack.encounters) ? pack.encounters : [];
  let covered = encs.length > 0;
  for (const e of encs) {
    const entry = typeof e.id === 'string' ? entries[e.id] : undefined;
    if (entry && validTier(entry.difficulty)) e.difficulty = entry.difficulty;
    else covered = false;
  }
  if (covered && pack.meta) pack.meta.difficultyClassified = true;
  return pack;
}
