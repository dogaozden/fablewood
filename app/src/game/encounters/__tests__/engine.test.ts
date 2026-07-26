import { describe, it, expect } from 'vitest';
import { pick, reskin, scoreMatch, scoreOrder, stampDifficulty } from '../engine';
import type { Encounter, Pack } from '../../../packs/types';
import type { EncounterRequest, EncounterResult } from '../../contracts';

function mkPack(encounters: Encounter[]): Pack {
  return {
    meta: { id: 't', title: 'Test', version: '1', sources: [{ title: 's' }] },
    facts: [],
    encounters,
    quests: [],
    metaphor_map: {},
  };
}

const req = (over: Partial<EncounterRequest>): EncounterRequest => ({
  context: 'combat',
  packId: 't',
  seed: 1,
  ...over,
});

const PACK = mkPack([
  { id: 'e-a', fact_ids: ['f1'], kind: 'mcq', prompt: 'a', options: ['x'], answer: 'x' },
  { id: 'e-b', fact_ids: ['f2'], kind: 'mcq', prompt: 'b', options: ['x'], answer: 'x' },
  { id: 'e-c', fact_ids: ['f3'], kind: 'free_recall', prompt: 'c', rubric: 'r' },
]);

describe('pick — the due queue drives selection', () => {
  it('returns the encounter for the EARLIEST due fact (factIds is priority order)', () => {
    expect(pick(req({ factIds: ['f2', 'f1'], kinds: ['mcq'] }), [PACK])?.id).toBe('e-b');
    expect(pick(req({ factIds: ['f1', 'f2'], kinds: ['mcq'] }), [PACK])?.id).toBe('e-a');
  });

  it('skips due facts whose only encounter is the wrong kind', () => {
    // f3 → e-c (free_recall, filtered out); falls through to f1 → e-a
    expect(pick(req({ factIds: ['f3', 'f1'], kinds: ['mcq'] }), [PACK])?.id).toBe('e-a');
  });

  it('honours a forced encounterId over the due queue', () => {
    expect(pick(req({ encounterId: 'e-c', factIds: ['f1'], kinds: ['mcq'] }), [PACK])?.id).toBe('e-c');
  });

  it('falls back to any kind-match, then any encounter', () => {
    expect(pick(req({ factIds: [], kinds: ['free_recall'] }), [PACK])?.id).toBe('e-c');
    expect(pick(req({ factIds: [], kinds: ['order'] }), [PACK])?.id).toBe('e-a'); // no order → first encounter
  });

  it('returns null when there are no encounters', () => {
    expect(pick(req({}), [mkPack([])])).toBeNull();
  });
});

describe('stampDifficulty — encounter result producer', () => {
  const result: EncounterResult = {
    encounterId: 'result', kind: 'mcq', factIds: ['f'], quality: 1,
  };

  it('stamps a marked encounter with its declared difficulty', () => {
    expect(stampDifficulty(result, {
      id: 'marked', fact_ids: ['f'], kind: 'mcq', prompt: 'marked', difficulty: 3,
    }).difficulty).toBe(3);
  });

  it('stamps an unmarked encounter with the Lantern default', () => {
    expect(stampDifficulty(result, {
      id: 'unmarked', fact_ids: ['f'], kind: 'mcq', prompt: 'unmarked',
    }).difficulty).toBe(2);
  });
});

describe('pick — difficulty filter (§3 difficulty-rewards.md)', () => {
  const difficultyPack = (...difficulties: Array<1 | 2 | 3>): Pack => mkPack(
    difficulties.map((difficulty, index) => ({
      id: `e-d${index + 1}`,
      fact_ids: [`f${index + 1}`],
      kind: 'mcq' as const,
      prompt: `difficulty ${difficulty}`,
      options: ['x'],
      answer: 'x',
      difficulty,
    })),
  );

  it('Tier 1 is a true no-op across a mixed-difficulty pool', () => {
    const pack = difficultyPack(1, 2, 3);
    const withoutTier = pick(req({ factIds: ['f1', 'f3', 'f2'], kinds: ['mcq'] }), [pack]);
    const tier1 = pick(req({ factIds: ['f1', 'f3', 'f2'], kinds: ['mcq'], spellTier: 1 }), [pack]);

    expect(tier1).toBe(withoutTier);
    expect(tier1?.id).toBe('e-d1');
  });

  it('Tier 2 is a hard floor while preserving due-order inside the eligible pool', () => {
    const pack = difficultyPack(1, 2);

    // f1 is more due but its only mcq is below the floor, so selection advances to f2.
    expect(pick(req({ factIds: ['f1', 'f2'], kinds: ['mcq'], spellTier: 2 }), [pack])?.id).toBe('e-d2');
  });

  it('Tier 2 keeps the more-due fact when its encounter already clears the floor', () => {
    const pack = difficultyPack(2, 2);

    expect(pick(req({ factIds: ['f1', 'f2'], kinds: ['mcq'], spellTier: 2 }), [pack])?.id).toBe('e-d1');
  });

  it('Tier 3 falls back to the kind-only pool when no difficulty-3 encounter exists', () => {
    const pack = difficultyPack(1, 2);

    // The preference is empty, so honest fallback restores the un-narrowed due-order winner.
    expect(pick(req({ factIds: ['f1', 'f2'], kinds: ['mcq'], spellTier: 3 }), [pack])?.id).toBe('e-d1');
  });

  it('Tier 3 binds to a difficulty-3 encounter when the preference can be met', () => {
    const pack = difficultyPack(3, 1, 2);

    expect(pick(req({ factIds: ['f1', 'f2', 'f3'], kinds: ['mcq'], spellTier: 3 }), [pack])?.id).toBe('e-d1');
  });
});

describe('reskin — deterministic surface randomization', () => {
  const enc: Encounter = {
    id: 'm',
    fact_ids: ['f'],
    kind: 'mcq',
    template_vars: { moss: ['lantern-moss', 'glimmer-moss'] },
    prompt: 'When does {{moss}} glow brightest?',
    options: ['first', 'second', 'third', 'never'],
    answer: 'third',
  };

  it('is stable: same seed → identical output', () => {
    expect(reskin(enc, 42)).toEqual(reskin(enc, 42));
  });

  it('does not mutate the input encounter', () => {
    const before = structuredClone(enc);
    reskin(enc, 99);
    expect(enc).toEqual(before);
  });

  it('resolves template vars and leaves no {{tokens}}', () => {
    const r = reskin(enc, 7);
    expect(r.prompt).not.toContain('{{');
    expect(['lantern-moss', 'glimmer-moss'].some((m) => r.prompt.includes(m))).toBe(true);
  });

  it('shuffles options but the correct answer stays present and identifiable', () => {
    const withVar: Encounter = {
      id: 'm2',
      fact_ids: ['f'],
      kind: 'mcq',
      template_vars: { week: ['third'] },
      prompt: 'when?',
      options: ['first', 'second', '{{week}}', 'never'],
      answer: '{{week}}',
    };
    const r = reskin(withVar, 3);
    expect(r.answer).toBe('third'); // substituted
    expect((r.options as string[]).includes('third')).toBe(true); // survives the shuffle
    expect(r.options).toHaveLength(4);
    expect([...(r.options as string[])].sort()).toEqual(['first', 'never', 'second', 'third']);
  });

  it('shuffles each match column independently', () => {
    const m: Encounter = {
      id: 'mm',
      fact_ids: ['f'],
      kind: 'match',
      prompt: 'pair',
      options: [['A', 'B', 'C'], ['1', '2', '3']],
      answer: [['A', '1'], ['B', '2'], ['C', '3']],
    };
    const r = reskin(m, 5);
    const [l, rr] = r.options as string[][];
    expect([...l].sort()).toEqual(['A', 'B', 'C']);
    expect([...rr].sort()).toEqual(['1', '2', '3']);
  });

  it('never presents an order encounter pre-solved, for any seed', () => {
    const ord: Encounter = {
      id: 'oo',
      fact_ids: ['f'],
      kind: 'order',
      prompt: 'sequence',
      options: ['a', 'b', 'c', 'd'],
      answer: ['a', 'b', 'c', 'd'],
    };
    for (let seed = 0; seed < 200; seed++) {
      const r = reskin(ord, seed);
      expect(r.options).not.toEqual(r.answer); // the ritual always needs work
      expect([...(r.options as string[])].sort()).toEqual(['a', 'b', 'c', 'd']);
    }
  });
});

describe('scoreMatch', () => {
  const answer: Array<[string, string]> = [['A', '1'], ['B', '2'], ['C', '3'], ['D', '4']];
  it('all correct → 1', () => {
    expect(scoreMatch(answer, answer)).toBe(1);
  });
  it('at least half → 0.5', () => {
    expect(scoreMatch([['A', '1'], ['B', '2'], ['C', '9'], ['D', '9']], answer)).toBe(0.5);
  });
  it('fewer than half → 0', () => {
    expect(scoreMatch([['A', '1'], ['B', '9'], ['C', '9'], ['D', '9']], answer)).toBe(0);
  });
});

describe('scoreOrder — longest correct prefix', () => {
  const answer = ['a', 'b', 'c', 'd'];
  it('full sequence → 1', () => {
    expect(scoreOrder(['a', 'b', 'c', 'd'], answer)).toBe(1);
  });
  it('half the prefix → 0.5', () => {
    expect(scoreOrder(['a', 'b', 'x', 'y'], answer)).toBe(0.5);
  });
  it('short prefix → 0', () => {
    expect(scoreOrder(['a', 'x', 'c', 'd'], answer)).toBe(0);
  });
  it('first wrong → 0', () => {
    expect(scoreOrder(['z', 'b', 'c', 'd'], answer)).toBe(0);
  });
});
