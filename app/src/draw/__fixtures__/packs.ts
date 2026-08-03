import type { Fact, Encounter } from '../../packs/types';
import type { InstalledPack } from '../types';

function fact(id: string, prereqs?: string[]): Fact {
  return {
    id,
    type: 'concept',
    statement: `Fixture statement for ${id}`,
    source_ref: { file: 'fixture.md', loc: 1, quote: `Fixture quote for ${id}` },
    as_of: '2026-01-01',
    source_version: '1.0.0',
    difficulty: 1,
    ...(prereqs ? { prereqs } : {}),
  };
}

function mcq(id: string, factId: string): Encounter {
  return { id, fact_ids: [factId], kind: 'mcq', prompt: `Fixture MCQ prompt for ${factId}` };
}

function order(id: string, factId: string): Encounter {
  return { id, fact_ids: [factId], kind: 'order', prompt: `Fixture order prompt for ${factId}` };
}

const alphaFacts: Fact[] = [
  fact('fx.a.one'),
  fact('fx.a.two', ['fx.a.one']),
  fact('fx.a.three'),
  fact('fx.a.four'),
];

const alphaEncounters: Encounter[] = [
  mcq('fx.a.one.mcq', 'fx.a.one'),
  mcq('fx.a.two.mcq', 'fx.a.two'),
  mcq('fx.a.three.mcq', 'fx.a.three'),
  mcq('fx.a.four.mcq', 'fx.a.four'),
  order('fx.a.four.order', 'fx.a.four'),
];

export const PACK_ALPHA: InstalledPack = {
  id: 'fx-alpha',
  pack: {
    meta: { id: 'fx-alpha', title: 'Fixture Pack Alpha', version: '1.0.0', sources: [{ title: 'Fixture Source Alpha' }] },
    facts: alphaFacts,
    encounters: alphaEncounters,
    quests: [],
    metaphor_map: {},
  },
};

const betaFacts: Fact[] = [
  fact('fx.b.one'),
  fact('fx.b.two'),
  fact('fx.b.three'),
  fact('fx.b.four'),
];

const betaEncounters: Encounter[] = [
  mcq('fx.b.one.mcq', 'fx.b.one'),
  mcq('fx.b.two.mcq', 'fx.b.two'),
  mcq('fx.b.three.mcq', 'fx.b.three'),
  mcq('fx.b.four.mcq', 'fx.b.four'),
];

export const PACK_BETA: InstalledPack = {
  id: 'fx-beta',
  pack: {
    meta: { id: 'fx-beta', title: 'Fixture Pack Beta', version: '1.0.0', sources: [{ title: 'Fixture Source Beta' }] },
    facts: betaFacts,
    encounters: betaEncounters,
    quests: [],
    metaphor_map: {},
  },
};
