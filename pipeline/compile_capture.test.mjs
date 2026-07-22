// compile_capture.test.mjs — unit tests for the pure/injectable pieces of the
// `capture` verb (capture-file parsing/classification, parked-draft validation,
// the LLM-layer-stubbed draft+validate loop, and the apply-time merge decision).
// Node's built-in test runner, matching pipeline/expand_pack.test.mjs's own
// "node ESM, no frameworks" style. Runs standalone (does NOT go through vitest —
// vite.config.ts scopes vitest's root/include to app/src only):
//
//   node --test pipeline/compile_capture.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCaptureFile,
  isUrlSource,
  classifyCapture,
  filterInboxFilenames,
  validateParkedDraft,
  stringifyFactsStyle,
  computeApply,
  generateForCapture,
  draftCaptures,
} from './compile_capture.mjs';
import { validateDraftFact } from './expand_pack.mjs';

// ============================================================================
// parseCaptureFile
// ============================================================================

test('parseCaptureFile splits a leading source: line from the note text', () => {
  const text = 'source: raw/vc-law/book-md/24-chapter-16.md\n\nEscrow terms matter.\nSecond line.';
  const { source, note } = parseCaptureFile(text);
  assert.equal(source, 'raw/vc-law/book-md/24-chapter-16.md');
  assert.equal(note, 'Escrow terms matter.\nSecond line.');
});

test('parseCaptureFile treats the whole file as note text when there is no source: line', () => {
  const text = 'Never take a pre-money quote at face value in a live call.';
  const { source, note } = parseCaptureFile(text);
  assert.equal(source, null);
  assert.equal(note, text);
});

test('parseCaptureFile is case-insensitive on the "source:" key and tolerates a URL value', () => {
  const text = 'Source: https://example.com/post\n\nGood point about SAFEs.';
  const { source, note } = parseCaptureFile(text);
  assert.equal(source, 'https://example.com/post');
  assert.equal(note, 'Good point about SAFEs.');
});

test('parseCaptureFile treats an empty "source:" value as no source', () => {
  const text = 'source:   \n\nJust a note.';
  const { source, note } = parseCaptureFile(text);
  assert.equal(source, null);
  assert.equal(note, 'Just a note.');
});

test('parseCaptureFile skips blank lines before and after the source line', () => {
  const text = '\n\n  source: raw/x.md  \n\n\nNote body here.';
  const { source, note } = parseCaptureFile(text);
  assert.equal(source, 'raw/x.md');
  assert.equal(note, 'Note body here.');
});

test('parseCaptureFile does not treat a non-leading "source:" mention as the source line', () => {
  const text = '# Heading\nsource: raw/x.md\nRest of note.';
  const { source, note } = parseCaptureFile(text);
  assert.equal(source, null);
  assert.equal(note, text);
});

test('parseCaptureFile normalizes CRLF line endings', () => {
  const text = 'source: raw/x.md\r\n\r\nNote body.\r\nSecond line.';
  const { source, note } = parseCaptureFile(text);
  assert.equal(source, 'raw/x.md');
  assert.equal(note, 'Note body.\nSecond line.');
});

// ============================================================================
// isUrlSource
// ============================================================================

test('isUrlSource recognizes http/https', () => {
  assert.equal(isUrlSource('https://example.com'), true);
  assert.equal(isUrlSource('http://example.com/post'), true);
});

test('isUrlSource rejects a raw/ path', () => {
  assert.equal(isUrlSource('raw/vc-law/book-md/x.md'), false);
});

test('isUrlSource rejects null/empty', () => {
  assert.equal(isUrlSource(null), false);
  assert.equal(isUrlSource(''), false);
});

// ============================================================================
// classifyCapture
// ============================================================================

test('classifyCapture flags a capture with no note text as malformed', () => {
  const result = classifyCapture({ source: null, note: '' }, { resolveLocal: () => null });
  assert.equal(result.origin, 'malformed');
  assert.ok(result.reason.includes('no note text'));
});

test('classifyCapture treats no source line as a self-note', () => {
  const result = classifyCapture({ source: null, note: 'A real note.' }, { resolveLocal: () => null });
  assert.equal(result.origin, 'self-note');
});

test('classifyCapture treats a URL source as origin "url" without touching resolveLocal', () => {
  let called = false;
  const result = classifyCapture(
    { source: 'https://example.com/x', note: 'A note.' },
    { resolveLocal: () => { called = true; return null; } },
  );
  assert.equal(result.origin, 'url');
  assert.equal(result.source, 'https://example.com/x');
  assert.equal(called, false, 'a URL source should never be filesystem-resolved');
});

test('classifyCapture treats a resolvable local source as origin "source-file"', () => {
  const result = classifyCapture(
    { source: 'raw/vc-law/book-md/x.md', note: 'A note.' },
    { resolveLocal: (s) => `/abs/${s}` },
  );
  assert.equal(result.origin, 'source-file');
  assert.equal(result.sourceAbsPath, '/abs/raw/vc-law/book-md/x.md');
});

test('classifyCapture treats an unresolvable local source as "missing-source" with a clear reason', () => {
  const result = classifyCapture(
    { source: 'raw/vc-law/book-md/nope.md', note: 'A note.' },
    { resolveLocal: () => null },
  );
  assert.equal(result.origin, 'missing-source');
  assert.ok(result.reason.includes('raw/vc-law/book-md/nope.md'));
});

// ============================================================================
// filterInboxFilenames
// ============================================================================

test('filterInboxFilenames keeps only .md/.txt files and excludes README.md case-insensitively', () => {
  const names = ['README.md', 'readme.md', 'note1.md', 'note2.txt', 'image.png', 'processed'];
  assert.deepEqual(filterInboxFilenames(names), ['note1.md', 'note2.txt']);
});

test('filterInboxFilenames returns an empty array for an empty inbox', () => {
  assert.deepEqual(filterInboxFilenames([]), []);
});

test('filterInboxFilenames sorts the result', () => {
  assert.deepEqual(filterInboxFilenames(['z.md', 'a.md', 'm.txt']), ['a.md', 'm.txt', 'z.md']);
});

// ============================================================================
// stringifyFactsStyle
// ============================================================================

test('stringifyFactsStyle collapses a short array of strings onto one line', () => {
  assert.equal(stringifyFactsStyle(['a', 'b']), '["a", "b"]');
});

test('stringifyFactsStyle expands an array of objects, one per line', () => {
  const out = stringifyFactsStyle([{ id: 'a' }, { id: 'b' }]);
  assert.equal(out, '[\n  {\n    "id": "a"\n  },\n  {\n    "id": "b"\n  }\n]');
});

test('stringifyFactsStyle renders empty arrays/objects compactly', () => {
  assert.equal(stringifyFactsStyle([]), '[]');
  assert.equal(stringifyFactsStyle({}), '{}');
  assert.equal(stringifyFactsStyle({ prereqs: [] }), '{\n  "prereqs": []\n}');
});

test('stringifyFactsStyle round-trips a realistic fact exactly like the hand-formatted facts.staging.json convention', () => {
  const fact = {
    id: 'vc.econ.alpha.one',
    type: 'concept',
    statement: 'A.',
    detail: 'd',
    source_ref: { file: 'raw/x.md', loc: 'Chapter 1', quote: 'q' },
    as_of: '2026-01-01',
    source_version: 'v1',
    tags: ['negotiation', 'valuation'],
    difficulty: 1,
    prereqs: [],
  };
  const expected = [
    '{',
    '  "id": "vc.econ.alpha.one",',
    '  "type": "concept",',
    '  "statement": "A.",',
    '  "detail": "d",',
    '  "source_ref": {',
    '    "file": "raw/x.md",',
    '    "loc": "Chapter 1",',
    '    "quote": "q"',
    '  },',
    '  "as_of": "2026-01-01",',
    '  "source_version": "v1",',
    '  "tags": ["negotiation", "valuation"],',
    '  "difficulty": 1,',
    '  "prereqs": []',
    '}',
  ].join('\n');
  assert.equal(stringifyFactsStyle(fact), expected);
});

// ============================================================================
// validateParkedDraft
// ============================================================================

function validParkedDraft(overrides = {}) {
  return { type: 'advice', statement: 'A statement.', detail: 'A detail.', tags: ['negotiation'], difficulty: 3, ...overrides };
}

test('validateParkedDraft accepts a well-formed parked draft', () => {
  assert.deepEqual(validateParkedDraft(validParkedDraft()), []);
});

test('validateParkedDraft rejects a missing statement', () => {
  const errors = validateParkedDraft(validParkedDraft({ statement: '' }));
  assert.ok(errors.some((e) => e.includes("missing/empty 'statement'")));
});

test('validateParkedDraft rejects an invalid type', () => {
  const errors = validateParkedDraft(validParkedDraft({ type: 'opinion' }));
  assert.ok(errors.some((e) => e.includes('invalid fact type')));
});

test('validateParkedDraft rejects an out-of-range difficulty', () => {
  const errors = validateParkedDraft(validParkedDraft({ difficulty: 0 }));
  assert.ok(errors.some((e) => e.includes('difficulty')));
});

test('validateParkedDraft rejects non-lowercase tags', () => {
  const errors = validateParkedDraft(validParkedDraft({ tags: ['Negotiation'] }));
  assert.ok(errors.some((e) => e.includes('tags must be')));
});

test('validateParkedDraft rejects empty tags', () => {
  const errors = validateParkedDraft(validParkedDraft({ tags: [] }));
  assert.ok(errors.some((e) => e.includes('tags must be')));
});

test('validateParkedDraft rejects a non-object draft', () => {
  assert.deepEqual(validateParkedDraft(null), ['draft is not an object']);
});

// ============================================================================
// computeApply
// ============================================================================

test('computeApply appends new facts after the existing staging facts', () => {
  const stagingFacts = [{ id: 'vc.econ.alpha.one', statement: 'A' }];
  const proposalFacts = [{ id: 'vc.econ.beta.one', statement: 'B' }];
  const { merged, added, skipped } = computeApply({ proposalFacts, existingFactIds: new Set(['vc.econ.alpha.one']), stagingFacts });
  assert.deepEqual(merged, [{ id: 'vc.econ.alpha.one', statement: 'A' }, { id: 'vc.econ.beta.one', statement: 'B' }]);
  assert.equal(added.length, 1);
  assert.equal(skipped.length, 0);
});

test('computeApply skips a proposal fact whose id already exists (pack.json or facts.staging.json)', () => {
  const stagingFacts = [{ id: 'vc.econ.alpha.one', statement: 'A' }];
  const proposalFacts = [{ id: 'vc.econ.alpha.one', statement: 'A duplicate' }, { id: 'vc.econ.beta.one', statement: 'B' }];
  const { merged, added, skipped } = computeApply({ proposalFacts, existingFactIds: new Set(['vc.econ.alpha.one']), stagingFacts });
  assert.equal(added.length, 1);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].id, 'vc.econ.alpha.one');
  assert.equal(merged.length, 2);
});

test('computeApply on an empty proposal leaves stagingFacts unchanged', () => {
  const stagingFacts = [{ id: 'vc.econ.alpha.one' }];
  const { merged, added, skipped } = computeApply({ proposalFacts: [], existingFactIds: new Set(['vc.econ.alpha.one']), stagingFacts });
  assert.deepEqual(merged, stagingFacts);
  assert.deepEqual(added, []);
  assert.deepEqual(skipped, []);
});

test('computeApply does not mutate the input stagingFacts array', () => {
  const stagingFacts = [{ id: 'vc.econ.alpha.one' }];
  const originalJson = JSON.stringify(stagingFacts);
  computeApply({ proposalFacts: [{ id: 'vc.econ.beta.one' }], existingFactIds: new Set(['vc.econ.alpha.one']), stagingFacts });
  assert.equal(JSON.stringify(stagingFacts), originalJson);
});

// ============================================================================
// generateForCapture (LLM layer stubbed via ctx.callModel)
// ============================================================================

const SOURCE_TEXT = 'Some intro text.\n\n## Escrow\n\nNormally between 10% and 20% of the purchase price is held back.\n';

function sourceCapture(overrides = {}) {
  return {
    file: 'staging/inbox/note1.md',
    origin: 'source-file',
    source: 'raw/test-pack/book-md/24-chapter-16-letters-of-intent.md',
    note: 'Escrow terms are interesting — how big and how long?',
    fileText: SOURCE_TEXT,
    excerpt: 'Normally between 10% and 20% of the purchase price is held back.',
    heading: 'Escrow',
    sourceVersion: 'v1',
    ...overrides,
  };
}

function selfNoteCapture(overrides = {}) {
  return {
    file: 'staging/inbox/note2.md',
    origin: 'self-note',
    source: null,
    note: 'Never take a pre-money quote at face value in a live call.',
    ...overrides,
  };
}

function urlCapture(overrides = {}) {
  return {
    file: 'staging/inbox/note3.md',
    origin: 'url',
    source: 'https://example.com/article',
    note: 'This article makes a good point about SAFEs.',
    ...overrides,
  };
}

function baseCtx(callModel) {
  return {
    pack: { meta: { id: 'test-pack', title: 'Test Pack' } },
    model: 'sonnet',
    timeoutMs: 1000,
    today: '2026-07-22',
    existingFactIds: new Set(['vc.econ.alpha.one']),
    draftFactIdsSoFar: new Set(),
    callModel,
  };
}

const VALID_ESCROW_RESPONSE = JSON.stringify({
  id: 'vc.econ.loi.escrow-size',
  type: 'number',
  statement: 'Escrow is typically 10-20% of the purchase price, held back 12-24 months.',
  detail: 'Protects the buyer against undisclosed post-closing issues.',
  quote: 'Normally between 10% and 20% of the purchase price is held back.',
  tags: ['escrow'],
  difficulty: 2,
});

test('generateForCapture accepts a well-formed source-file draft on the first try', async () => {
  const capture = sourceCapture();
  const calls = [];
  const callModel = async (prompt) => { calls.push(prompt); return VALID_ESCROW_RESPONSE; };
  const ctx = baseCtx(callModel);
  const r = await generateForCapture(capture, ctx);
  assert.equal(r.accepted, true);
  assert.equal(calls.length, 1);
  assert.equal(r.attempts, 1);
  assert.equal(r.fact.id, 'vc.econ.loi.escrow-size');
  assert.equal(r.fact.source_ref.file, capture.source);
  assert.equal(r.fact.source_ref.loc, 'Chapter 16 > Escrow');
  assert.equal(r.fact.source_ref.quote, 'Normally between 10% and 20% of the purchase price is held back.');
  assert.deepEqual(r.fact.prereqs, []);
  // Cross-validated against the SAME validator expand_pack.mjs uses.
  assert.deepEqual(validateDraftFact(r.fact, { knownIds: new Set() }), []);
});

test('generateForCapture rejects when the quote is not actually in the source, after one retry', async () => {
  const capture = sourceCapture();
  const calls = [];
  const callModel = async (prompt) => {
    calls.push(prompt);
    return JSON.stringify({
      id: 'vc.econ.loi.escrow-size', type: 'number', statement: 'S', detail: 'D',
      quote: 'this text was never in the source excerpt', tags: ['escrow'], difficulty: 2,
    });
  };
  const ctx = baseCtx(callModel);
  const r = await generateForCapture(capture, ctx);
  assert.equal(r.accepted, false);
  assert.equal(calls.length, 2, 'expected exactly one corrective retry');
  assert.ok(r.reason.includes('quote not found verbatim'));
});

test('generateForCapture retries once after an unparsable response, then succeeds', async () => {
  const capture = sourceCapture();
  let call = 0;
  const callModel = async () => {
    call++;
    if (call === 1) return 'not json at all, sorry';
    return VALID_ESCROW_RESPONSE;
  };
  const ctx = baseCtx(callModel);
  const r = await generateForCapture(capture, ctx);
  assert.equal(r.accepted, true);
  assert.equal(r.attempts, 2);
  assert.equal(call, 2);
});

test('generateForCapture treats a callModel rejection as a failed attempt, not a crash', async () => {
  const capture = sourceCapture();
  let call = 0;
  const callModel = async () => { call++; throw new Error('spawn ENOENT'); };
  const ctx = baseCtx(callModel);
  const r = await generateForCapture(capture, ctx);
  assert.equal(r.accepted, false);
  assert.equal(call, 2);
  assert.ok(r.reason.includes('claude -p call failed'));
});

test('generateForCapture treats an id already drafted (existingFactIds) as a collision', async () => {
  const capture = sourceCapture();
  const callModel = async () => JSON.stringify({
    id: 'vc.econ.alpha.one', type: 'concept', statement: 'S', detail: 'D',
    quote: 'Normally between 10% and 20% of the purchase price is held back.', tags: ['x'], difficulty: 2,
  });
  const ctx = baseCtx(callModel); // existingFactIds already contains vc.econ.alpha.one
  const r = await generateForCapture(capture, ctx);
  assert.equal(r.accepted, false);
  assert.ok(r.reason.includes('already in use'));
});

test('generateForCapture accepts a well-formed self-note (parked) draft', async () => {
  const capture = selfNoteCapture();
  const callModel = async () => JSON.stringify({ type: 'advice', statement: 'S', detail: 'D', tags: ['negotiation'], difficulty: 2 });
  const ctx = baseCtx(callModel);
  const r = await generateForCapture(capture, ctx);
  assert.equal(r.accepted, true);
  assert.equal(r.fact, undefined);
  assert.equal(r.draft.origin, 'self-note');
  assert.equal(r.draft.needs_ratification_as, 'insight');
  assert.equal(r.draft.source, null);
  assert.deepEqual(r.draft.prereqs, []);
});

test('generateForCapture accepts a url-origin parked draft and carries the url through', async () => {
  const capture = urlCapture();
  const callModel = async () => JSON.stringify({ type: 'concept', statement: 'S', detail: 'D', tags: ['safe'], difficulty: 2 });
  const ctx = baseCtx(callModel);
  const r = await generateForCapture(capture, ctx);
  assert.equal(r.accepted, true);
  assert.equal(r.draft.origin, 'url');
  assert.equal(r.draft.source, 'https://example.com/article');
  assert.equal(r.draft.needs_ratification_as, 'insight');
});

test('generateForCapture rejects a parked draft with an invalid type, after retry', async () => {
  const capture = selfNoteCapture();
  const calls = [];
  const callModel = async () => { calls.push(1); return JSON.stringify({ type: 'opinion', statement: 'S', detail: 'D', tags: ['x'], difficulty: 2 }); };
  const ctx = baseCtx(callModel);
  const r = await generateForCapture(capture, ctx);
  assert.equal(r.accepted, false);
  assert.equal(calls.length, 2);
  assert.ok(r.reason.includes('invalid fact type'));
});

// ============================================================================
// draftCaptures (batch driver)
// ============================================================================

test('draftCaptures never calls the LLM for malformed or missing-source captures', async () => {
  const calls = [];
  const callModel = async () => { calls.push(1); return VALID_ESCROW_RESPONSE; };
  const captures = [
    { file: 'staging/inbox/broken.md', origin: 'malformed', reason: 'capture has no note text' },
    { file: 'staging/inbox/typo.md', origin: 'missing-source', source: 'raw/nope.md', reason: 'source path not found (or not a file) on disk: raw/nope.md' },
  ];
  const ctx = baseCtx(callModel);
  const { results, facts, parked, rejected } = await draftCaptures(captures, ctx);
  assert.equal(calls.length, 0);
  assert.equal(facts.length, 0);
  assert.equal(parked.length, 0);
  assert.equal(rejected.length, 2);
  assert.equal(results.length, 2);
  assert.equal(rejected[0].origin, 'malformed');
  assert.equal(rejected[1].origin, 'missing-source');
});

test('draftCaptures partitions a mixed batch into facts / parked / rejected', async () => {
  const callModel = async (prompt) => {
    if (prompt.includes('Normally between 10% and 20%')) return VALID_ESCROW_RESPONSE;
    return JSON.stringify({ type: 'advice', statement: 'S2', detail: 'D2', tags: ['x'], difficulty: 3 });
  };
  const captures = [
    sourceCapture({ file: 'staging/inbox/a.md' }),
    selfNoteCapture({ file: 'staging/inbox/b.md' }),
    { file: 'staging/inbox/c.md', origin: 'malformed', reason: 'capture has no note text' },
  ];
  const ctx = baseCtx(callModel);
  const { facts, parked, rejected } = await draftCaptures(captures, ctx);
  assert.equal(facts.length, 1);
  assert.equal(parked.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(facts[0].id, 'vc.econ.loi.escrow-size');
  assert.equal(parked[0].file, 'staging/inbox/b.md');
  assert.equal(rejected[0].file, 'staging/inbox/c.md');
});

test('draftCaptures handles an empty capture list without crashing (empty inbox)', async () => {
  const callModel = async () => { throw new Error('should never be called'); };
  const ctx = baseCtx(callModel);
  const result = await draftCaptures([], ctx);
  assert.deepEqual(result.facts, []);
  assert.deepEqual(result.parked, []);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(result.results, []);
});

test('draftCaptures accumulates draftFactIdsSoFar so a later capture cannot mint a duplicate id within the same run', async () => {
  const callModel = async () => VALID_ESCROW_RESPONSE;
  const captures = [sourceCapture({ file: 'staging/inbox/a.md' }), sourceCapture({ file: 'staging/inbox/b.md' })];
  const ctx = baseCtx(callModel);
  const { facts, rejected } = await draftCaptures(captures, ctx);
  assert.equal(facts.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason.includes('already in use'));
});
