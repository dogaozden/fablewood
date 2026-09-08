import { describe, expect, it } from 'vitest';
import type { Fact } from '../packs/types';
import {
  AMENDMENT_BATCH_CAP,
  buildAmendmentIndex,
  eligibleFactIds,
  emptyAmendmentIndex,
  firstAmendedAppearance,
  isSuspended,
  pendingAmendments,
} from './amendments';

/**
 * "The Ledger Amended" — the pure selection rules (docs/design/supersession-reteach.md §4/§5).
 * §4 amended 2026-08-01: an amendment suspends BOTH truths until witnessed — the superseded
 * fact retires at pack LOAD (not at witness), the superseding fact is gated until witnessed.
 */

function fact(id: string, extra: Partial<Fact> = {}): Fact {
  return {
    id,
    type: 'rule',
    statement: `statement for ${id}`,
    source_ref: { file: 'raw/fixture.md', loc: 'p.1', quote: `quote for ${id}` },
    as_of: '2026-01-01',
    source_version: '1.0',
    difficulty: 2,
    ...extra,
  };
}

/** One superseded pair (old → new) plus an ordinary bystander fact. */
const OLD = fact('fx-old', { superseded_by: 'fx-new' });
const NEW = fact('fx-new', { supersedes: 'fx-old', as_of: '2026-06-01' });
const PLAIN = fact('fx-plain');
const PACK = [{ id: 'fx', facts: [OLD, NEW, PLAIN] }];

const never = () => false;
const always = () => true;
const witnessedSet = (...ids: string[]) => (id: string) => ids.includes(id);

describe('buildAmendmentIndex', () => {
  it('indexes a declared pair in both directions and keeps the pack-ordered pairs', () => {
    const index = buildAmendmentIndex(PACK);
    expect([...index.superseded]).toEqual(['fx-old']);
    expect(index.supersedes.get('fx-new')).toBe('fx-old');
    const pairs = index.pairsByPack.get('fx')!;
    expect(pairs).toHaveLength(1);
    expect(pairs[0].old.id).toBe('fx-old');
    expect(pairs[0].next.id).toBe('fx-new');
    // the card needs the new truth's verbatim source quote (§3)
    expect(pairs[0].next.source_ref?.quote).toBe('quote for fx-new');
  });

  it('a pack with no supersession metadata produces an empty index (vc-law, zero packs)', () => {
    const index = buildAmendmentIndex([{ id: 'plain', facts: [PLAIN, fact('b'), fact('c')] }]);
    expect(index.superseded.size).toBe(0);
    expect(index.supersedes.size).toBe(0);
    expect(index.pairsByPack.get('plain')).toEqual([]);
  });

  it('tolerates absent/dangling/self/unpaired pointers rather than suspending a fact nothing can free', () => {
    const dangling = fact('d-old', { superseded_by: 'nobody' });
    const selfRef = fact('s-old', { superseded_by: 's-old' });
    const oneWay = fact('o-old', { superseded_by: 'o-new' }); // successor never answers back
    const oneWayNext = fact('o-new');
    const index = buildAmendmentIndex([
      { id: 'broken', facts: [dangling, selfRef, oneWay, oneWayNext] },
    ]);
    expect(index.superseded.size).toBe(0);
    expect(index.pairsByPack.get('broken')).toEqual([]);
  });

  it('survives a non-string superseded_by (hand-edited/NaN content)', () => {
    const weird = { ...fact('w-old'), superseded_by: 7 as unknown as string };
    const index = buildAmendmentIndex([{ id: 'weird', facts: [weird] }]);
    expect(index.superseded.size).toBe(0);
  });

  it('indexes two direct aliases while retaining their distinct ids', () => {
    const canonical = fact('fx-canonical');
    const aliasA = fact('fx-alias-a', { duplicate_of: canonical.id });
    const aliasB = fact('fx-alias-b', { duplicate_of: canonical.id });
    const index = buildAmendmentIndex([{ id: 'aliases', facts: [canonical, aliasA, aliasB] }]);
    expect([...index.aliases]).toEqual(['fx-alias-a', 'fx-alias-b']);
    expect(index.canonicalByAlias.get('fx-alias-a')).toBe('fx-canonical');
    expect(index.aliasesByCanonical.get('fx-canonical')).toEqual(['fx-alias-a', 'fx-alias-b']);
    expect(isSuspended('fx-alias-a', index, never)).toBe(true);
    expect(isSuspended('fx-alias-b', index, never)).toBe(true);
    expect(isSuspended('fx-canonical', index, never)).toBe(false);
  });

  it('ignores malformed aliases at runtime so they cannot suppress another fact', () => {
    const canonical = fact('fx-canonical');
    const valid = fact('fx-valid', { duplicate_of: canonical.id });
    const missing = fact('fx-missing', { duplicate_of: 'ghost' });
    const self = fact('fx-self', { duplicate_of: 'fx-self' });
    const chain = fact('fx-chain', { duplicate_of: 'fx-valid' });
    const mixed = fact('fx-mixed', { duplicate_of: canonical.id, supersedes: 'fx-other' });
    const targetMixed = fact('fx-target-mixed', { superseded_by: 'fx-later' });
    const aliasToTargetMixed = fact('fx-alias-target-mixed', { duplicate_of: targetMixed.id });
    const index = buildAmendmentIndex([{
      id: 'aliases',
      facts: [canonical, valid, missing, self, chain, mixed, targetMixed, aliasToTargetMixed],
    }]);
    expect([...index.aliases]).toEqual(['fx-valid']);
    expect(isSuspended('fx-canonical', index, never)).toBe(false);
    expect(isSuspended('fx-missing', index, never)).toBe(false);
    expect(isSuspended('fx-self', index, never)).toBe(false);
    expect(isSuspended('fx-chain', index, never)).toBe(false);
    expect(isSuspended('fx-mixed', index, never)).toBe(false);
    expect(isSuspended('fx-alias-target-mixed', index, never)).toBe(false);
    expect(isSuspended('fx-target-mixed', index, never)).toBe(false);
  });
});

describe('§4 isSuspended — the one predicate', () => {
  const index = buildAmendmentIndex(PACK);

  it('retires the SUPERSEDED fact from load, before any witness', () => {
    expect(isSuspended('fx-old', index, never)).toBe(true);
  });

  it('keeps the superseded fact retired after the witness too — permanently', () => {
    expect(isSuspended('fx-old', index, witnessedSet('fx-old'))).toBe(true);
  });

  it('gates the SUPERSEDING fact while its amendment is unwitnessed', () => {
    expect(isSuspended('fx-new', index, never)).toBe(true);
  });

  it('releases the superseding fact once the amendment is witnessed', () => {
    expect(isSuspended('fx-new', index, witnessedSet('fx-old'))).toBe(false);
  });

  it('never suspends an ordinary fact, witnessed or not', () => {
    expect(isSuspended('fx-plain', index, never)).toBe(false);
    expect(isSuspended('fx-plain', index, always)).toBe(false);
  });

  it('an empty index suspends nothing (packless engine)', () => {
    expect(isSuspended('anything', emptyAmendmentIndex(), never)).toBe(false);
  });
});

describe('§4 eligibleFactIds — what every draw surface calls', () => {
  const index = buildAmendmentIndex(PACK);
  const ids = ['fx-plain', 'fx-old', 'fx-new'];

  it('drops BOTH truths before the witness, preserving order', () => {
    const out = eligibleFactIds(ids, (id) => isSuspended(id, index, never));
    expect(out).toEqual(['fx-plain']);
  });

  it('after the witness the new truth is back in play and the old one is not', () => {
    const out = eligibleFactIds(ids, (id) => isSuspended(id, index, witnessedSet('fx-old')));
    expect(out).toEqual(['fx-plain', 'fx-new']);
  });

  it('is identity for a pack with no amendments', () => {
    const plainIndex = buildAmendmentIndex([{ id: 'p', facts: [PLAIN] }]);
    expect(eligibleFactIds(ids, (id) => isSuspended(id, plainIndex, never))).toEqual(ids);
  });
});

describe('§2 pendingAmendments + batch cap', () => {
  const pairs = buildAmendmentIndex(PACK).pairsByPack.get('fx')!;

  it('is pending while unwitnessed and the new truth has never been taught', () => {
    expect(pendingAmendments(pairs, never, never)).toHaveLength(1);
  });

  it('drops out once witnessed — the reload-mid-batch guarantee', () => {
    expect(pendingAmendments(pairs, witnessedSet('fx-old'), never)).toEqual([]);
  });

  it('drops out if the superseding fact already carries SRS history (never re-teach)', () => {
    expect(pendingAmendments(pairs, never, (id) => id === 'fx-new')).toEqual([]);
  });

  it('caps a visit at 3 cards and leaves the overflow pending', () => {
    const many = [];
    for (let i = 0; i < 5; i++) {
      many.push(fact(`m${i}-old`, { superseded_by: `m${i}-new` }));
      many.push(fact(`m${i}-new`, { supersedes: `m${i}-old` }));
    }
    const all = buildAmendmentIndex([{ id: 'many', facts: many }]).pairsByPack.get('many')!;
    expect(all).toHaveLength(5);

    const first = pendingAmendments(all, never, never).slice(0, AMENDMENT_BATCH_CAP);
    expect(AMENDMENT_BATCH_CAP).toBe(3);
    expect(first.map((a) => a.old.id)).toEqual(['m0-old', 'm1-old', 'm2-old']);

    // next visit: the three witnessed ones are gone, the overflow is still waiting
    const witnessed = witnessedSet('m0-old', 'm1-old', 'm2-old');
    const second = pendingAmendments(all, witnessed, never);
    expect(second.map((a) => a.old.id)).toEqual(['m3-old', 'm4-old']);
  });
});

describe('§5 firstAmendedAppearance — the one mercy rule', () => {
  const index = buildAmendmentIndex(PACK);
  const noHistory = () => 0;

  it('fires for the superseding fact with no history yet', () => {
    expect(firstAmendedAppearance(['fx-new'], index, noHistory)).toBe('fx-new');
  });

  it('does NOT fire on the second appearance — full teeth after one free read-again', () => {
    expect(firstAmendedAppearance(['fx-new'], index, () => 1)).toBeNull();
  });

  it('never fires for an ordinary fact, however fresh', () => {
    expect(firstAmendedAppearance(['fx-plain'], index, noHistory)).toBeNull();
  });

  it('never fires for the superseded fact itself', () => {
    expect(firstAmendedAppearance(['fx-old'], index, noHistory)).toBeNull();
  });

  it('finds the amended fact among several teaching facts', () => {
    expect(firstAmendedAppearance(['fx-plain', 'fx-new'], index, noHistory)).toBe('fx-new');
  });

  it('is null on an empty index / empty fact list', () => {
    expect(firstAmendedAppearance([], index, noHistory)).toBeNull();
    expect(firstAmendedAppearance(['fx-new'], emptyAmendmentIndex(), noHistory)).toBeNull();
  });
});
