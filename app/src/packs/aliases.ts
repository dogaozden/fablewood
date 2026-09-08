/**
 * Pure helpers for the pack-level duplicate relationship.
 *
 * A duplicate is an addressable fact record whose learning identity remains its
 * own id, while `duplicate_of` points directly at a canonical fact in the same
 * pack. The publisher and validators reject malformed declarations; consumers
 * use this tolerant index at runtime because a bad pack must not hide unrelated
 * facts.
 */

/** The small portion of a fact needed to resolve duplicate declarations. */
export interface AliasFactLike {
  id?: unknown;
  duplicate_of?: unknown;
  supersedes?: unknown;
  superseded_by?: unknown;
}

export interface AliasPackLike {
  id: string;
  facts: readonly AliasFactLike[];
}

export interface FactAliasIndex {
  /** Fact ids whose declarations resolved to a direct canonical target. */
  aliases: Set<string>;
  /** alias fact id -> canonical fact id. */
  canonicalByAlias: Map<string, string>;
  /** canonical fact id -> all direct aliases, in pack declaration order. */
  aliasesByCanonical: Map<string, string[]>;
}

export function emptyFactAliasIndex(): FactAliasIndex {
  return {
    aliases: new Set(),
    canonicalByAlias: new Map(),
    aliasesByCanonical: new Map(),
  };
}

function localFacts(facts: readonly AliasFactLike[] | unknown): Map<string, AliasFactLike> {
  const byId = new Map<string, AliasFactLike>();
  if (!Array.isArray(facts)) return byId;
  for (const fact of facts) {
    if (typeof fact?.id !== 'string' || fact.id.length === 0 || byId.has(fact.id)) continue;
    byId.set(fact.id, fact);
  }
  return byId;
}

function hasSupersession(fact: AliasFactLike): boolean {
  return fact.supersedes !== undefined || fact.superseded_by !== undefined;
}

/**
 * Resolve only safe direct aliases.
 *
 * Fact ids are globally keyed by the SRS file and the draw index uses the first
 * installed pack on collisions. The owner pre-pass mirrors that rule, so a
 * later colliding pack cannot mark the first pack's unrelated fact as an alias.
 * A target carrying any `duplicate_of` or supersession declaration is treated as
 * non-canonical; this rejects chains, cycles, and mixed relationships by
 * construction while keeping malformed input inert for runtime consumers.
 */
export function buildFactAliasIndex(
  packs: ReadonlyArray<AliasPackLike>,
): FactAliasIndex {
  const index = emptyFactAliasIndex();
  const locals = packs.map((pack) => localFacts(pack.facts));
  const ownerByFactId = new Map<string, number>();

  for (let packIndex = 0; packIndex < locals.length; packIndex++) {
    for (const id of locals[packIndex].keys()) {
      if (!ownerByFactId.has(id)) ownerByFactId.set(id, packIndex);
    }
  }

  for (let packIndex = 0; packIndex < locals.length; packIndex++) {
    const facts = locals[packIndex];
    for (const fact of facts.values()) {
      if (ownerByFactId.get(fact.id as string) !== packIndex) continue;

      const targetId = fact.duplicate_of;
      if (typeof targetId !== 'string' || targetId.length === 0) continue;
      if (hasSupersession(fact)) continue;
      if (targetId === fact.id) continue;

      const target = facts.get(targetId);
      if (!target || ownerByFactId.get(targetId) !== packIndex) continue;
      // A target with the field present is an alias (valid or malformed), so it
      // cannot become a canonical endpoint and cannot create a chain/cycle.
      if (target.duplicate_of !== undefined || hasSupersession(target)) continue;

      index.aliases.add(fact.id as string);
      index.canonicalByAlias.set(fact.id as string, targetId);
      const aliases = index.aliasesByCanonical.get(targetId);
      if (aliases) aliases.push(fact.id as string);
      else index.aliasesByCanonical.set(targetId, [fact.id as string]);
    }
  }

  return index;
}
