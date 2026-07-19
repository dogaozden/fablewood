import { describe, it, expect } from 'vitest';
import { pick, reskin, scoreMatch, scoreOrder } from '../engine';
import type { Encounter, Pack } from '../../../packs/types';
import type { EncounterRequest } from '../../contracts';

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
