import { describe, it, expect } from 'vitest';
import { buildDrawIndex, drawNew } from '../index';
import { PACK_ALPHA, PACK_BETA } from '../__fixtures__/packs';
import type { DrawDeps } from '../types';
import type { Fact } from '../../packs/types';

const idx = buildDrawIndex([PACK_ALPHA, PACK_BETA]);
// dueOf is undefined throughout: drawNew surfaces UNSEEN facts, which have no next_due.
const deps = (seen: string[]): DrawDeps => ({
  dueOrder: ids => ids, eligible: () => true, hasRecord: id => seen.includes(id), dueOf: () => undefined,
});

describe('drawNew', () => {
  it('introduces only unseen facts, rotating across packs', () => {
    const out = drawNew(idx, deps([]), { count: 4, seed: 3, now: 0 });
    expect(out.length).toBe(4);
    const seq = out.map(id => idx.packIdByFactId.get(id));
    expect(seq[0]).not.toBe(seq[1]); // strict alternation with two packs
    expect(seq[2]).not.toBe(seq[3]);
  });

  it('holds back prereq-gated facts until the prereq is seen', () => {
    const none = drawNew(idx, deps([]), { count: 8, seed: 1, now: 0 });
    expect(none).not.toContain('fx.a.two'); // prereq fx.a.one unseen
    const after = drawNew(idx, deps(['fx.a.one']), { count: 8, seed: 1, now: 0 });
    expect(after).toContain('fx.a.two');
  });

  it('never returns already-seen facts', () => {
    const out = drawNew(idx, deps(['fx.a.one', 'fx.b.one']), { count: 8, seed: 9, now: 0 });
    expect(out).not.toContain('fx.a.one');
    expect(out).not.toContain('fx.b.one');
  });

  it('excludes ineligible facts even when unseen and prereq-clear (amendment suspension)', () => {
    const eligDeps: DrawDeps = {
      dueOrder: ids => ids, eligible: id => id !== 'fx.a.three', hasRecord: () => false, dueOf: () => undefined,
    };
    const out = drawNew(idx, eligDeps, { count: 8, seed: 1, now: 0 });
    expect(out).not.toContain('fx.a.three');
  });

  it('excludes aliases and accepts a canonical record or alias history for alias prerequisites', () => {
    const canonical: Fact = {
      id: 'fx.canonical', type: 'concept', statement: 'canonical',
      source_ref: { file: 'fixture.md', loc: 1, quote: 'canonical' },
      as_of: '2026-01-01', source_version: '1.0.0', difficulty: 1,
    };
    const alias: Fact = {
      ...canonical, id: 'fx.alias', statement: 'duplicate', duplicate_of: canonical.id,
    };
    const dependent: Fact = {
      ...canonical, id: 'fx.dependent', statement: 'dependent', prereqs: [alias.id],
    };
    const aliasPack = {
      id: 'fx-alias',
      pack: {
        meta: { id: 'fx-alias', title: 'Alias Fixture', version: '1.0.0', sources: [{ title: 'Fixture' }] },
        facts: [canonical, alias, dependent],
        encounters: [], quests: [], metaphor_map: {},
      },
    };
    const aliasIdx = buildDrawIndex([aliasPack]);
    const draw = (seen: string[]) => drawNew(aliasIdx, {
      dueOrder: ids => ids,
      eligible: id => id !== alias.id,
      hasRecord: id => seen.includes(id),
      dueOf: () => undefined,
    }, { count: 8, seed: 1, now: 0 });

    expect(draw([canonical.id])).toContain(dependent.id);
    expect(draw([canonical.id])).not.toContain(alias.id);
    expect(draw([alias.id])).toContain(dependent.id);
  });
});
