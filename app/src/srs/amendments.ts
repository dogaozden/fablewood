/**
 * "The Ledger Amended" — the PURE half of the supersession re-teach event
 * (docs/design/supersession-reteach.md). Which amendments still await the Clerk, which
 * facts the Realm has suspended, and the one mercy rule. No I/O and no DOM (mirrors
 * leitner.ts's discipline, so it unit-tests in the node vitest env); persistence lives in
 * ./store (AmendmentsStore) and the wiring in ./register.
 *
 * §4 (amended 2026-08-01) — an amendment suspends BOTH truths until it is witnessed:
 *   - the SUPERSEDED fact retires from every draw/scheduling surface at pack load and
 *     stays retired permanently. The pack update that supersedes it necessarily retargets
 *     its encounters (the validator forbids a live encounter from teaching a superseded
 *     fact), so leaving it schedulable would only strand it stuck-due forever.
 *   - the SUPERSEDING fact is gated out of play while its amendment is unwitnessed, or it
 *     would surface as an ordinary unseen fact and teach the new truth with no ceremony.
 *   - after the witness beat the new fact enters play as a normal new fact (due
 *     immediately, box 1) — no schedule seeding, no history migration.
 *
 * Every field this module reads is OPTIONAL on Fact (`supersedes` / `superseded_by`,
 * packs/types.ts) — a pack that never amends anything produces an empty index, zero
 * suspensions and zero pending cards, which is what keeps vc-law (and the zero-packs
 * build) untouched by this feature.
 */
import type { Amendment, FactLite } from '../game/contracts';
import type { Fact } from '../packs/types';

/** §2 — "an amendment is a beat, not a dump": at most this many cards per Records visit. */
export const AMENDMENT_BATCH_CAP = 3;

/** The teaching-card subset of a Fact (contracts.FactLite) — statement + verbatim source. */
export function toFactLite(f: Fact): FactLite {
  return { id: f.id, type: f.type, statement: f.statement, detail: f.detail, source_ref: f.source_ref };
}

/**
 * The supersession shape of the installed packs, resolved once at pack pull.
 * Cross-pack supersession is a non-goal (§7), so one index over every installed pack is
 * equivalent to one per pack and spares every caller a packId it may not have.
 */
export interface AmendmentIndex {
  /** facts a newer fact replaces — retired from play at pack load, permanently */
  superseded: Set<string>;
  /** superseding fact id → the superseded fact id it replaces (also the witness key) */
  supersedes: Map<string, string>;
  /** declared pairs per pack, pack fact order (what the Records Office batches through) */
  pairsByPack: Map<string, Amendment[]>;
}

export function emptyAmendmentIndex(): AmendmentIndex {
  return { superseded: new Set(), supersedes: new Map(), pairsByPack: new Map() };
}

/**
 * Build the index from installed packs. Reads the OLD fact's stored `superseded_by`
 * back-pointer (the validator enforces perfect bidirectional consistency,
 * pipeline/validate_pack.mjs) and tolerates a dangling or self-referential pointer by
 * skipping the pair — the engine must never fail to boot over a content typo, and a
 * half-declared pair must never suspend a fact nothing can un-suspend.
 */
export function buildAmendmentIndex(
  packs: ReadonlyArray<{ id: string; facts: readonly Fact[] }>,
): AmendmentIndex {
  const index = emptyAmendmentIndex();
  for (const { id: packId, facts } of packs) {
    const byId = new Map(facts.map((f) => [f.id, f] as const));
    const pairs: Amendment[] = [];
    for (const old of facts) {
      const nextId = old.superseded_by;
      if (typeof nextId !== 'string' || nextId === old.id) continue;
      const next = byId.get(nextId);
      // the back-pointer must be answered by the successor's own `supersedes` (validator
      // invariant); an unpaired pointer is content corruption, not an amendment
      if (!next || next.supersedes !== old.id) continue;
      index.superseded.add(old.id);
      index.supersedes.set(next.id, old.id);
      pairs.push({ old: toFactLite(old), next: toFactLite(next) });
    }
    index.pairsByPack.set(packId, pairs);
  }
  return index;
}

/**
 * §4 — is this fact suspended from play right now? The ONE predicate; every draw and
 * scheduling surface funnels through it (canonical site: the `services.srs.dueQueue`
 * wrapper in ./register, plus the two raw pack-order fallbacks that never reach it).
 *
 * A fact with no supersession metadata is never suspended, which is every fact in
 * every pack shipped today.
 */
export function isSuspended(
  factId: string,
  index: AmendmentIndex,
  isWitnessed: (supersededFactId: string) => boolean,
): boolean {
  if (index.superseded.has(factId)) return true; // the old truth: retired, permanently
  const replaces = index.supersedes.get(factId);
  if (replaces === undefined) return false; // an ordinary fact
  return !isWitnessed(replaces); // the new truth: gated until the Clerk amends the record
}

/** §4 the exclusion, in list form: drop every suspended fact, preserving order. */
export function eligibleFactIds(
  factIds: readonly string[],
  isSuspendedFn: (factId: string) => boolean,
): string[] {
  return factIds.filter((id) => !isSuspendedFn(id));
}

/**
 * §2 — amendments awaiting the Clerk: a declared pair whose card has not been witnessed
 * yet AND whose superseding fact has no SRS history (never taught). Witness is the pivot;
 * the never-taught clause keeps the ceremony from re-firing for a new truth the player has
 * somehow already been graded on. Uncapped — the caller applies AMENDMENT_BATCH_CAP.
 */
export function pendingAmendments(
  pairs: readonly Amendment[],
  isWitnessed: (supersededFactId: string) => boolean,
  hasHistory: (factId: string) => boolean,
): Amendment[] {
  return pairs.filter((a) => !isWitnessed(a.old.id) && !hasHistory(a.next.id));
}

/**
 * §5 the one mercy rule — is this the superseding fact's FIRST graded appearance?
 * The player mastered the old truth; the world changed and their diligence didn't fail,
 * so the first miss on the new truth costs no HP. Read BEFORE the answer is recorded
 * (capture-before-record, the same duty the redemption bell keeps), or the fact's own
 * fresh history will have already disarmed it. Second appearance onward: full teeth.
 */
export function firstAmendedAppearance(
  factIds: readonly string[],
  index: AmendmentIndex,
  historyLength: (factId: string) => number,
): string | null {
  for (const id of factIds) {
    if (index.supersedes.has(id) && historyLength(id) === 0) return id;
  }
  return null;
}
