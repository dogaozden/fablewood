// expand_pack.test.mjs — unit tests for the pure pieces of the expand verb
// (coverage analysis, id-immutability, and the supporting draft validators).
// Node's built-in test runner — no framework, matching pipeline/'s existing
// "node ESM + python, no frameworks" style. Runs standalone (does NOT go
// through vitest — vite.config.ts scopes vitest's root/include to app/src
// only, and this pack never touches app/):
//
//   node --test pipeline/expand_pack.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeQuote,
  quoteAppearsIn,
  defaultTopicOf,
  analyzeCoverage,
  pickCandidates,
  assignKinds,
  chapterLabel,
  splitSections,
  pickExcerpt,
  resolveSourceVersion,
  validateDraftFact,
  validateDraftEncounter,
  checkIdImmutability,
  buildMergedPack,
  firstJsonObject,
  heuristicDifficulty,
  renderPrompt,
  buildClassifyPrompt,
  mergeProvenance,
  encountersNeedingClassification,
  tierHistogram,
} from './expand_pack.mjs';

// ============================================================================
// normalizeQuote / quoteAppearsIn
// ============================================================================

test('normalizeQuote folds curly quotes/apostrophes and collapses whitespace', () => {
  assert.equal(normalizeQuote('“Hello   world’s\n\ttest”'), '"Hello world\'s test"');
});

test('quoteAppearsIn finds a verbatim substring under normalization', () => {
  const source = 'The term “liquidation preference” should pertain only to money returned first.';
  assert.equal(quoteAppearsIn('The term "liquidation   preference" should pertain', source), true);
});

test('quoteAppearsIn rejects a quote that is not actually present', () => {
  const source = 'The term liquidation preference should pertain only to money returned first.';
  assert.equal(quoteAppearsIn('this text was never in the source', source), false);
});

test('quoteAppearsIn rejects an empty quote', () => {
  assert.equal(quoteAppearsIn('   ', 'anything'), false);
});

// ============================================================================
// analyzeCoverage
// ============================================================================

function samplePack() {
  return {
    meta: { id: 'test-pack', title: 'Test Pack', version: '0.1.0', sources: [{ id: 'src1', title: 'Src', file: 'raw/test-pack/book/src.epub', version: 'v1' }] },
    facts: [
      { id: 'vc.econ.alpha.one', type: 'concept', statement: 'Alpha one.', detail: 'd', source_ref: { file: 'raw/test-pack/book-md/01-alpha.md', loc: 'Chapter 1 > A', quote: 'q' }, as_of: '2026-01-01', source_version: 'v1', tags: ['alpha'], difficulty: 1, prereqs: [] },
      { id: 'vc.econ.alpha.two', type: 'concept', statement: 'Alpha two.', detail: 'd', source_ref: { file: 'raw/test-pack/book-md/01-alpha.md', loc: 'Chapter 1 > B', quote: 'q' }, as_of: '2026-01-01', source_version: 'v1', tags: ['alpha'], difficulty: 1, prereqs: [] },
      { id: 'vc.econ.alpha.three', type: 'concept', statement: 'Alpha three.', detail: 'd', source_ref: { file: 'raw/test-pack/book-md/01-alpha.md', loc: 'Chapter 1 > C', quote: 'q' }, as_of: '2026-01-01', source_version: 'v1', tags: ['alpha'], difficulty: 1, prereqs: [] },
      { id: 'vc.econ.beta.one', type: 'concept', statement: 'Beta one — never drilled.', detail: 'd', source_ref: { file: 'raw/test-pack/book-md/02-beta.md', loc: 'Chapter 2 > A', quote: 'q' }, as_of: '2026-01-01', source_version: 'v1', tags: ['beta'], difficulty: 1, prereqs: [] },
    ],
    encounters: [
      { id: 'enc.mcq.one', fact_ids: ['vc.econ.alpha.one'], kind: 'mcq', prompt: 'Q?', options: ['a', 'b', 'c', 'd'], answer: 'a' },
      { id: 'enc.mcq.two', fact_ids: ['vc.econ.alpha.two'], kind: 'mcq', prompt: 'Q?', options: ['a', 'b', 'c', 'd'], answer: 'b' },
      { id: 'enc.mcq.three', fact_ids: ['vc.econ.alpha.three'], kind: 'mcq', prompt: 'Q?', options: ['a', 'b', 'c', 'd'], answer: 'c' },
      // beta.one is referenced by nothing -> zero-encounter fact
    ],
    quests: [],
    npcs: [],
    metaphor_map: [],
  };
}

test('analyzeCoverage ranks a bigger, unmined raw file above a smaller, well-mined one', () => {
  const pack = samplePack();
  const rawDocs = [
    { file: 'raw/test-pack/book-md/01-alpha.md', text: 'word '.repeat(50) }, // 3 facts already
    { file: 'raw/test-pack/book-md/03-gamma.md', text: 'word '.repeat(5000) }, // 0 facts, much bigger
  ];
  const coverage = analyzeCoverage({ pack, rawDocs });
  assert.equal(coverage.chapterGaps[0].file, 'raw/test-pack/book-md/03-gamma.md');
  assert.equal(coverage.chapterGaps[0].factCount, 0);
  assert.ok(coverage.chapterGaps[0].score > coverage.chapterGaps[1].score);
});

test('analyzeCoverage isTeachingFile filters out non-teaching raw files', () => {
  const pack = samplePack();
  const rawDocs = [
    { file: 'raw/test-pack/book-md/01-alpha.md', text: 'word '.repeat(50) },
    { file: 'raw/test-pack/book-md/99-glossary.md', text: 'word '.repeat(9999) },
  ];
  const coverage = analyzeCoverage({ pack, rawDocs, isTeachingFile: (f) => !f.includes('glossary') });
  assert.equal(coverage.chapterGaps.length, 1);
  assert.equal(coverage.chapterGaps[0].file, 'raw/test-pack/book-md/01-alpha.md');
});

test('analyzeCoverage identifies the thinnest kind per fact-cluster (mcq-heavy skew)', () => {
  const pack = samplePack();
  const coverage = analyzeCoverage({ pack, rawDocs: [] });
  const alpha = coverage.kindSkew.find((k) => k.topic === 'vc.econ.alpha');
  assert.ok(alpha, 'alpha cluster should be present');
  assert.equal(alpha.counts.mcq, 3);
  assert.equal(alpha.counts.free_recall, 0);
  // alpha has only 3 facts -> exactly enough for match/order (>=3), so the
  // thinnest-with-priority-to-match/order rule should pick one of those, not
  // free_recall/scenario_branch, since match/order are tied at 0 and rank
  // higher in KIND_PRIORITY.
  assert.ok(['match', 'order'].includes(alpha.targetKind));
});

test('analyzeCoverage falls back off match/order when a cluster has too few facts', () => {
  const pack = samplePack();
  // beta cluster has only 1 fact -> match/order (need >=3) must be skipped
  const coverage = analyzeCoverage({ pack, rawDocs: [] });
  const beta = coverage.kindSkew.find((k) => k.topic === 'vc.econ.beta');
  assert.ok(beta);
  assert.ok(!['match', 'order'].includes(beta.targetKind));
});

test('analyzeCoverage finds facts referenced by zero encounters', () => {
  const pack = samplePack();
  const coverage = analyzeCoverage({ pack, rawDocs: [] });
  assert.deepEqual(coverage.zeroEncounterFacts.map((z) => z.factId), ['vc.econ.beta.one']);
});

test('analyzeCoverage reports global kind counts', () => {
  const pack = samplePack();
  const coverage = analyzeCoverage({ pack, rawDocs: [] });
  assert.equal(coverage.globalKindCounts.mcq, 3);
  assert.equal(coverage.globalKindCounts.free_recall, 0);
});

test('defaultTopicOf strips the last dot-segment', () => {
  assert.equal(defaultTopicOf('vc.econ.liqpref.definition'), 'vc.econ.liqpref');
});

// ============================================================================
// pickCandidates / assignKinds
// ============================================================================

test('pickCandidates round-robins zero_encounter, chapter, kind_skew in that priority order', () => {
  const coverage = {
    zeroEncounterFacts: [{ factId: 'z1', facts: [] }],
    chapterGaps: [
      { file: 'c1.md', wordCount: 100, factCount: 0 },
      { file: 'c2.md', wordCount: 200, factCount: 0 },
    ],
    kindSkew: [
      { topic: 't1', targetKind: 'match', facts: [] },
      { topic: 't2', targetKind: 'order', facts: [] },
    ],
  };
  const picked = pickCandidates(coverage, 4);
  assert.deepEqual(
    picked.map((c) => (c.type === 'chapter' ? c.file : c.type === 'kind_skew' ? c.topic : c.factId)),
    ['z1', 'c1.md', 't1', 'c2.md'],
  );
});

test('pickCandidates stops early without looping forever when pools are exhausted', () => {
  const coverage = { zeroEncounterFacts: [], chapterGaps: [{ file: 'c1.md', wordCount: 1, factCount: 0 }], kindSkew: [] };
  const picked = pickCandidates(coverage, 10);
  assert.equal(picked.length, 1);
});

test('assignKinds never assigns match/order to a brand-new chapter fact', () => {
  const candidates = [
    { type: 'chapter', file: 'a.md' },
    { type: 'chapter', file: 'b.md' },
    { type: 'chapter', file: 'c.md' },
  ];
  const assigned = assignKinds(candidates, { mcq: 20, free_recall: 0, scenario_branch: 0, match: 0, order: 0 });
  for (const c of assigned) assert.ok(!['match', 'order'].includes(c.kind));
});

test('assignKinds diversifies away from mcq when mcq is already dominant', () => {
  const candidates = [{ type: 'chapter', file: 'a.md' }];
  const assigned = assignKinds(candidates, { mcq: 20, free_recall: 0, scenario_branch: 0, match: 0, order: 0 });
  assert.notEqual(assigned[0].kind, 'mcq');
});

test('assignKinds passes through the precomputed targetKind for non-chapter candidates', () => {
  const candidates = [{ type: 'kind_skew', topic: 't', targetKind: 'match' }];
  const assigned = assignKinds(candidates, { mcq: 0, free_recall: 0, scenario_branch: 0, match: 0, order: 0 });
  assert.equal(assigned[0].kind, 'match');
});

test('assignKinds spreads allocation across a run instead of piling onto one kind', () => {
  const candidates = [
    { type: 'chapter', file: 'a.md' },
    { type: 'chapter', file: 'b.md' },
    { type: 'chapter', file: 'c.md' },
  ];
  const assigned = assignKinds(candidates, { mcq: 20, free_recall: 0, scenario_branch: 0, match: 0, order: 0 });
  const distinctKinds = new Set(assigned.map((c) => c.kind));
  assert.ok(distinctKinds.size >= 2, `expected diversified kinds, got ${JSON.stringify(assigned.map((c) => c.kind))}`);
});

// ============================================================================
// chapterLabel / splitSections / pickExcerpt
// ============================================================================

test('chapterLabel derives "Chapter N" from a numbered chapter filename', () => {
  assert.equal(chapterLabel('raw/vc-law/book-md/14-chapter-6-control-terms-of-the-term-sheet.md'), 'Chapter 6');
});

test('chapterLabel derives "Appendix X" from an appendix filename', () => {
  assert.equal(chapterLabel('raw/vc-law/book-md/29-appendix-a-sample-term-sheet.md'), 'Appendix A');
});

test('chapterLabel recognizes the introduction', () => {
  assert.equal(chapterLabel('raw/vc-law/book-md/08-introduction-the-art-of-the-term-sheet.md'), 'Introduction');
});

test('chapterLabel falls back to a cleaned filename otherwise', () => {
  assert.equal(chapterLabel('raw/vc-law/book-md/33-glossary.md'), 'glossary');
});

test('splitSections splits on H1/H2 and keeps H3+ with its enclosing section', () => {
  const text = '# Title\npreamble\n## Section A\nshort\n### Sub A\nsub content\n## Section B\n' + 'x'.repeat(500);
  const sections = splitSections(text);
  assert.equal(sections.length, 3);
  assert.equal(sections[1].heading, 'Section A');
  assert.ok(sections[1].text.includes('Sub A'), 'H3 should stay nested inside its H2 parent section');
  assert.equal(sections[2].heading, 'Section B');
});

test('pickExcerpt returns the largest section, and it is a verbatim substring of the original text', () => {
  const text = '# Title\n## Small\nshort bit\n## Big\n' + 'meaningful content here. '.repeat(100);
  const { heading, text: excerpt } = pickExcerpt(text, 100000);
  assert.equal(heading, 'Big');
  assert.ok(text.includes(excerpt), 'excerpt must be a substring of the original file text');
});

test('pickExcerpt caps to maxChars while staying a substring', () => {
  const text = '## Only\n' + 'a'.repeat(10000);
  const { text: excerpt } = pickExcerpt(text, 50);
  assert.ok(excerpt.length <= 50);
  assert.ok(text.includes(excerpt));
});

// ============================================================================
// resolveSourceVersion
// ============================================================================

test('resolveSourceVersion returns the only source version when there is exactly one source', () => {
  const pack = { meta: { sources: [{ file: 'raw/p/book/x.epub', version: 'v1' }] } };
  assert.equal(resolveSourceVersion(pack, 'raw/p/book-md/anything.md'), 'v1');
});

test('resolveSourceVersion matches by raw/<pack>/<bucket>/ segment when multiple sources exist', () => {
  const pack = {
    meta: {
      sources: [
        { file: 'raw/p/book/x.epub', version: 'v1' },
        { file: 'raw/p/nvca/model-docs/y.md', version: 'v2' },
      ],
    },
  };
  assert.equal(resolveSourceVersion(pack, 'raw/p/nvca/some-doc.md'), 'v2');
});

test('resolveSourceVersion falls back to sources[0] when no bucket matches (book-md vs book is not a false match)', () => {
  const pack = {
    meta: {
      sources: [
        { file: 'raw/p/book/x.epub', version: 'v1' },
        { file: 'raw/p/nvca/model-docs/y.md', version: 'v2' },
      ],
    },
  };
  assert.equal(resolveSourceVersion(pack, 'raw/p/book-md/some-chapter.md'), 'v1');
});

// ============================================================================
// validateDraftFact
// ============================================================================

function validFact(overrides = {}) {
  return {
    id: 'vc.econ.newtopic.new-slug',
    type: 'concept',
    statement: 'A statement.',
    detail: 'A detail.',
    source_ref: { file: 'raw/vc-law/book-md/14-chapter-6-control-terms-of-the-term-sheet.md', loc: 'Chapter 6 > Board of Directors', quote: 'some verbatim text' },
    as_of: '2026-07-20',
    source_version: 'v1',
    tags: ['control'],
    difficulty: 2,
    prereqs: [],
    ...overrides,
  };
}

test('validateDraftFact accepts a well-formed fact', () => {
  const errors = validateDraftFact(validFact(), { knownIds: new Set() });
  assert.deepEqual(errors, []);
});

test('validateDraftFact rejects a malformed id', () => {
  const errors = validateDraftFact(validFact({ id: 'not-the-right-shape' }), { knownIds: new Set() });
  assert.ok(errors.some((e) => e.includes('not well-formed')));
});

test('validateDraftFact rejects an id collision', () => {
  const errors = validateDraftFact(validFact(), { knownIds: new Set(['vc.econ.newtopic.new-slug']) });
  assert.ok(errors.some((e) => e.includes('already in use')));
});

test('validateDraftFact rejects an invalid type', () => {
  const errors = validateDraftFact(validFact({ type: 'opinion' }), { knownIds: new Set() });
  assert.ok(errors.some((e) => e.includes('invalid fact type')));
});

test('validateDraftFact rejects out-of-range difficulty', () => {
  const errors = validateDraftFact(validFact({ difficulty: 9 }), { knownIds: new Set() });
  assert.ok(errors.some((e) => e.includes('difficulty')));
});

test('validateDraftFact rejects non-lowercase tags', () => {
  const errors = validateDraftFact(validFact({ tags: ['Control'] }), { knownIds: new Set() });
  assert.ok(errors.some((e) => e.includes('tags must be')));
});

test('validateDraftFact rejects empty tags', () => {
  const errors = validateDraftFact(validFact({ tags: [] }), { knownIds: new Set() });
  assert.ok(errors.some((e) => e.includes('tags must be')));
});

test('validateDraftFact rejects a self-referential prereq', () => {
  const errors = validateDraftFact(validFact({ prereqs: ['vc.econ.newtopic.new-slug'] }), { knownIds: new Set() });
  assert.ok(errors.some((e) => e.includes('lists itself as a prereq')));
});

test('validateDraftFact rejects an unresolvable prereq', () => {
  const errors = validateDraftFact(validFact({ prereqs: ['vc.econ.nope.missing'] }), { knownIds: new Set() });
  assert.ok(errors.some((e) => e.includes('does not resolve')));
});

test('validateDraftFact accepts a prereq that resolves against knownIds', () => {
  const errors = validateDraftFact(validFact({ prereqs: ['vc.econ.valuation.pre-vs-post-money'] }), {
    knownIds: new Set(['vc.econ.valuation.pre-vs-post-money']),
  });
  assert.deepEqual(errors, []);
});

// ============================================================================
// validateDraftEncounter
// ============================================================================

test('validateDraftEncounter accepts a well-formed mcq', () => {
  const enc = { id: 'enc.mcq.x', fact_ids: ['f1'], kind: 'mcq', prompt: 'Q?', options: ['a', 'b', 'c', 'd'], answer: 'b' };
  assert.deepEqual(validateDraftEncounter(enc, { knownFactIds: new Set(['f1']) }), []);
});

test('validateDraftEncounter rejects an mcq answer not in options', () => {
  const enc = { id: 'enc.mcq.x', fact_ids: ['f1'], kind: 'mcq', prompt: 'Q?', options: ['a', 'b'], answer: 'z' };
  const errors = validateDraftEncounter(enc, { knownFactIds: new Set(['f1']) });
  assert.ok(errors.some((e) => e.includes('mcq answer')));
});

test('validateDraftEncounter accepts a well-formed order (answer is a permutation)', () => {
  const enc = { id: 'enc.order.x', fact_ids: ['f1'], kind: 'order', prompt: 'Order?', options: ['a', 'b', 'c'], answer: ['c', 'a', 'b'] };
  assert.deepEqual(validateDraftEncounter(enc, { knownFactIds: new Set(['f1']) }), []);
});

test('validateDraftEncounter rejects an order answer that is not a permutation', () => {
  const enc = { id: 'enc.order.x', fact_ids: ['f1'], kind: 'order', prompt: 'Order?', options: ['a', 'b', 'c'], answer: ['a', 'b'] };
  const errors = validateDraftEncounter(enc, { knownFactIds: new Set(['f1']) });
  assert.ok(errors.some((e) => e.includes('permutation')));
});

test('validateDraftEncounter accepts a well-formed match', () => {
  const enc = {
    id: 'enc.match.x',
    fact_ids: ['f1'],
    kind: 'match',
    prompt: 'Match?',
    options: [['A', 'B'], ['1', '2']],
    answer: [['A', '1'], ['B', '2']],
  };
  assert.deepEqual(validateDraftEncounter(enc, { knownFactIds: new Set(['f1']) }), []);
});

test('validateDraftEncounter rejects a match pair not drawn from the two columns', () => {
  const enc = {
    id: 'enc.match.x',
    fact_ids: ['f1'],
    kind: 'match',
    prompt: 'Match?',
    options: [['A', 'B'], ['1', '2']],
    answer: [['A', '1'], ['B', 'Z']],
  };
  const errors = validateDraftEncounter(enc, { knownFactIds: new Set(['f1']) });
  assert.ok(errors.some((e) => e.includes('not drawn from the two columns')));
});

test('validateDraftEncounter accepts a free_recall with a real rubric', () => {
  const enc = { id: 'enc.fr.x', fact_ids: ['f1'], kind: 'free_recall', prompt: 'Recall?', rubric: 'Full credit if the answer names both parts.' };
  assert.deepEqual(validateDraftEncounter(enc, { knownFactIds: new Set(['f1']) }), []);
});

test('validateDraftEncounter rejects a free_recall with a too-short rubric', () => {
  const enc = { id: 'enc.fr.x', fact_ids: ['f1'], kind: 'free_recall', prompt: 'Recall?', rubric: 'short' };
  const errors = validateDraftEncounter(enc, { knownFactIds: new Set(['f1']) });
  assert.ok(errors.some((e) => e.includes('rubric')));
});

test('validateDraftEncounter accepts a scenario_branch with exactly one correct branch', () => {
  const enc = {
    id: 'enc.sb.x',
    fact_ids: ['f1'],
    kind: 'scenario_branch',
    prompt: 'Scenario?',
    branches: [
      { label: 'A', outcome: 'good', correct: true },
      { label: 'B', outcome: 'bad', correct: false },
    ],
  };
  assert.deepEqual(validateDraftEncounter(enc, { knownFactIds: new Set(['f1']) }), []);
});

test('validateDraftEncounter rejects a scenario_branch with no correct branch', () => {
  const enc = {
    id: 'enc.sb.x',
    fact_ids: ['f1'],
    kind: 'scenario_branch',
    prompt: 'Scenario?',
    branches: [
      { label: 'A', outcome: 'bad', correct: false },
      { label: 'B', outcome: 'bad', correct: false },
    ],
  };
  const errors = validateDraftEncounter(enc, { knownFactIds: new Set(['f1']) });
  assert.ok(errors.some((e) => e.includes('no correct branch')));
});

test('validateDraftEncounter rejects an unresolvable fact_ids entry', () => {
  const enc = { id: 'enc.mcq.x', fact_ids: ['ghost'], kind: 'mcq', prompt: 'Q?', options: ['a', 'b'], answer: 'a' };
  const errors = validateDraftEncounter(enc, { knownFactIds: new Set(['f1']) });
  assert.ok(errors.some((e) => e.includes('unknown fact')));
});

test('validateDraftEncounter rejects an encounter id collision', () => {
  const enc = { id: 'enc.mcq.dup', fact_ids: ['f1'], kind: 'mcq', prompt: 'Q?', options: ['a', 'b'], answer: 'a' };
  const errors = validateDraftEncounter(enc, { knownFactIds: new Set(['f1']), knownEncIds: new Set(['enc.mcq.dup']) });
  assert.ok(errors.some((e) => e.includes('already in use')));
});

test('validateDraftEncounter rejects a prompt with an undeclared template var', () => {
  const enc = { id: 'enc.mcq.x', fact_ids: ['f1'], kind: 'mcq', prompt: 'What is {{missing}}?', options: ['a', 'b'], answer: 'a' };
  const errors = validateDraftEncounter(enc, { knownFactIds: new Set(['f1']) });
  assert.ok(errors.some((e) => e.includes('{{missing}}')));
});

// ============================================================================
// checkIdImmutability / buildMergedPack
// ============================================================================

function originalPackFixture() {
  return {
    meta: { id: 'p', title: 'P' },
    facts: [{ id: 'f1', statement: 'F1' }],
    encounters: [{ id: 'e1', fact_ids: ['f1'], kind: 'mcq' }],
    quests: [{ id: 'q1', title: 'Q1', region: 'r', encounter_ids: ['e1'] }],
    npcs: [],
    metaphor_map: [],
  };
}

test('checkIdImmutability passes for a clean additive merge', () => {
  const original = originalPackFixture();
  const merged = buildMergedPack(original, [{ id: 'f2', statement: 'F2' }], [{ id: 'e2', fact_ids: ['f2'], kind: 'mcq' }]);
  const result = checkIdImmutability(original, merged);
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('checkIdImmutability catches a mutated existing fact', () => {
  const original = originalPackFixture();
  const merged = JSON.parse(JSON.stringify(original));
  merged.facts[0].statement = 'F1 but changed';
  const result = checkIdImmutability(original, merged);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('mutated: f1')));
});

test('checkIdImmutability catches an existing fact dropped from the merge', () => {
  const original = originalPackFixture();
  const merged = { ...original, facts: [], encounters: original.encounters };
  const result = checkIdImmutability(original, merged);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('missing from merged pack: f1')));
});

test('checkIdImmutability catches a draft id colliding with an existing id', () => {
  const original = originalPackFixture();
  // A "draft" that reuses id f1 with different content — buildMergedPack just
  // concatenates, so the merged facts array now legitimately has f1 twice.
  const merged = buildMergedPack(original, [{ id: 'f1', statement: 'a duplicate, not an addition' }], []);
  const result = checkIdImmutability(original, merged);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('duplicate fact id in merged pack: f1')));
});

test('checkIdImmutability catches quests/npcs/metaphor_map/meta being touched', () => {
  const original = originalPackFixture();
  const merged = { ...original, quests: [] };
  const result = checkIdImmutability(original, merged);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('pack.quests changed')));
});

test('buildMergedPack leaves the original pack object untouched', () => {
  const original = originalPackFixture();
  const originalJson = JSON.stringify(original);
  buildMergedPack(original, [{ id: 'f2' }], [{ id: 'e2' }]);
  assert.equal(JSON.stringify(original), originalJson);
});

// ============================================================================
// firstJsonObject
// ============================================================================

test('firstJsonObject parses a plain JSON object', () => {
  assert.equal(firstJsonObject('{"a":1}'), '{"a":1}');
});

test('firstJsonObject extracts JSON from a markdown fence', () => {
  assert.equal(firstJsonObject('```json\n{"a":1}\n```'), '{"a":1}');
});

test('firstJsonObject extracts JSON wrapped in prose', () => {
  assert.equal(firstJsonObject('Sure, here you go: {"a":1} — hope that helps!'), '{"a":1}');
});

test('firstJsonObject handles nested braces', () => {
  assert.equal(firstJsonObject('{"a":{"b":1}}'), '{"a":{"b":1}}');
});

test('firstJsonObject does not miscount braces that appear inside strings', () => {
  const text = '{"a":"{not really a brace}","b":2}';
  assert.equal(firstJsonObject(text), text);
});

test('firstJsonObject returns null when there is no JSON object', () => {
  assert.equal(firstJsonObject('no json here'), null);
});

// ============================================================================
// classify verb — difficulty-rewards.md §8 (+ §9.2's free_recall amendment)
// ============================================================================

test('heuristicDifficulty: mcq is Ember, every other kind is Lantern', () => {
  assert.equal(heuristicDifficulty('mcq'), 1);
  assert.equal(heuristicDifficulty('match'), 2);
  assert.equal(heuristicDifficulty('order'), 2);
  assert.equal(heuristicDifficulty('scenario_branch'), 2);
});

test('heuristicDifficulty: free_recall defaults to Lantern, NOT Beacon (§9.2 / veto 13)', () => {
  assert.equal(heuristicDifficulty('free_recall'), 2);
});

test('renderPrompt substitutes template_vars so the classifier reads the played prompt', () => {
  const enc = { prompt: '{{company}} raises {{raise}} — what now?', template_vars: { company: 'Emberforge', raise: '$2M' } };
  assert.equal(renderPrompt(enc), 'Emberforge raises $2M — what now?');
});

test('renderPrompt leaves a prompt without template_vars alone', () => {
  assert.equal(renderPrompt({ prompt: 'plain prompt' }), 'plain prompt');
});

test('buildClassifyPrompt carries the kind, the rendered prompt, the payload and the facts', () => {
  const enc = {
    kind: 'mcq',
    prompt: '{{co}} raises money.',
    template_vars: { co: 'Emberforge' },
    options: ['a', 'b'],
    answer: 'a',
    trap_notes: 'b forgets the investment',
  };
  const p = buildClassifyPrompt(enc, [{ statement: 'Post-money = pre-money + investment.' }]);
  assert.match(p, /ENCOUNTER_KIND: mcq/);
  assert.match(p, /PROMPT: Emberforge raises money\./);
  assert.match(p, /OPTIONS: \["a","b"\]/);
  assert.match(p, /TRAP_NOTES: b forgets the investment/);
  assert.match(p, /Post-money = pre-money \+ investment\./);
  // The rubric's load-bearing calibration must actually reach the model.
  assert.match(p, /RESERVED FOR A GENUINE/);
  assert.match(p, /free_recall\s+→ start at 2 \(Lantern\)/);
  assert.match(p, /"difficulty": 1, "rationale"/);
});

test('buildClassifyPrompt omits the facts block when an encounter drills none', () => {
  const p = buildClassifyPrompt({ kind: 'order', prompt: 'sort these' }, []);
  assert.ok(!p.includes('FACTS THIS DRILLS'));
});

const provEntry = (difficulty, source) => ({ difficulty, rationale: 'r', source, model: 'm', date: '2026-08-01' });

test('mergeProvenance takes the fresh pass for non-human entries', () => {
  const prev = { encounters: { a: provEntry(1, 'heuristic') } };
  const merged = mergeProvenance(prev, { a: provEntry(3, 'llm') }, ['a']);
  assert.equal(merged.a.difficulty, 3);
  assert.equal(merged.a.source, 'llm');
});

test('mergeProvenance treats a human entry as permanent — an automated pass cannot overwrite it', () => {
  const prev = { encounters: { a: provEntry(3, 'human') } };
  const merged = mergeProvenance(prev, { a: provEntry(1, 'llm') }, ['a']);
  assert.equal(merged.a.difficulty, 3);
  assert.equal(merged.a.source, 'human');
});

test('mergeProvenance keeps a previous entry the fresh pass skipped (e.g. --limit)', () => {
  const prev = { encounters: { a: provEntry(2, 'llm'), b: provEntry(1, 'llm') } };
  const merged = mergeProvenance(prev, { a: provEntry(3, 'llm') }, ['a', 'b']);
  assert.equal(merged.a.difficulty, 3);
  assert.equal(merged.b.difficulty, 1);
});

test('mergeProvenance drops entries whose encounter id no longer exists in the pack', () => {
  const prev = { encounters: { gone: provEntry(3, 'human') } };
  const merged = mergeProvenance(prev, {}, ['a']);
  assert.deepEqual(Object.keys(merged), []);
});

test('mergeProvenance handles a missing previous sidecar', () => {
  const merged = mergeProvenance(null, { a: provEntry(2, 'llm') }, ['a']);
  assert.equal(merged.a.difficulty, 2);
});

test('encountersNeedingClassification skips human-locked ids (no LLM call spent)', () => {
  const encounters = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const prev = { encounters: { b: provEntry(3, 'human'), c: provEntry(1, 'llm') } };
  assert.deepEqual(encountersNeedingClassification(encounters, prev).map((e) => e.id), ['a', 'c']);
});

test('encountersNeedingClassification returns everything when no sidecar exists yet', () => {
  const encounters = [{ id: 'a' }, { id: 'b' }];
  assert.equal(encountersNeedingClassification(encounters, null).length, 2);
});

test('tierHistogram counts each tier and ignores invalid ones', () => {
  const h = tierHistogram({
    a: provEntry(1, 'llm'), b: provEntry(2, 'llm'), c: provEntry(2, 'llm'), d: provEntry(3, 'llm'), e: provEntry(9, 'llm'),
  });
  assert.deepEqual(h, { 1: 1, 2: 2, 3: 1 });
});
