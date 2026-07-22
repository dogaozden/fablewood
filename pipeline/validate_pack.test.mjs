// validate_pack.test.mjs — unit tests for the pure supersession-checking piece
// of the pack validator (docs/design/knowledge-platform-vision.md §3b, §9.3).
// Node's built-in test runner — no framework, matching pipeline/'s existing
// "node ESM + python, no frameworks" style (see expand_pack.test.mjs). Runs
// standalone (does NOT go through vitest — vite.config.ts scopes vitest's
// root/include to app/src only, and this pack never touches app/):
//
//   node --test pipeline/validate_pack.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSupersession } from './validate_pack.mjs';

// Minimal fact builder — only the fields checkSupersession actually reads
// (id, as_of, supersedes, superseded_by) matter; the rest are filler so the
// object at least looks like a real Fact.
function fact(overrides) {
  return {
    id: 'f',
    type: 'concept',
    statement: 'stub statement',
    source_ref: { file: 'raw/test/x.md', loc: '1', quote: 'q' },
    as_of: '2020-01-01',
    source_version: 'v1',
    difficulty: 1,
    ...overrides,
  };
}

function mcq(id, factIds) {
  return { id, fact_ids: factIds, kind: 'mcq', prompt: 'p?', options: ['a', 'b'], answer: 'a' };
}

// ============================================================================
// Regression guard — a pack with no supersession fields at all (today's shape,
// e.g. packs/vc-law/pack.json) must be completely unaffected.
// ============================================================================

test('a pack with no supersedes/superseded_by fields at all produces zero errors and zero warnings', () => {
  const pack = {
    facts: [fact({ id: 'A' }), fact({ id: 'B' })],
    encounters: [mcq('E1', ['A'])],
  };
  const { errors, warnings } = checkSupersession(pack);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

// ============================================================================
// (1) valid pair / (2) valid chain
// ============================================================================

test('a valid one-for-one supersession pair produces no errors', () => {
  const pack = {
    facts: [
      fact({ id: 'A', as_of: '2020-01-01', superseded_by: 'B' }),
      fact({ id: 'B', as_of: '2021-01-01', supersedes: 'A' }),
    ],
  };
  const { errors } = checkSupersession(pack);
  assert.deepEqual(errors, []);
});

test('a valid supersession chain (A -> B -> C over years) produces no errors', () => {
  const pack = {
    facts: [
      fact({ id: 'A', as_of: '2018-01-01', superseded_by: 'B' }),
      fact({ id: 'B', as_of: '2020-06-01', supersedes: 'A', superseded_by: 'C' }),
      fact({ id: 'C', as_of: '2022-01-01', supersedes: 'B' }),
    ],
  };
  const { errors } = checkSupersession(pack);
  assert.deepEqual(errors, []);
});

// ============================================================================
// (3) cycle error
// ============================================================================

test('a supersession cycle (A <- B <- C <- A) is an error', () => {
  const pack = {
    facts: [
      fact({ id: 'A', as_of: '2020-01-01', supersedes: 'C', superseded_by: 'B' }),
      fact({ id: 'B', as_of: '2021-01-01', supersedes: 'A', superseded_by: 'C' }),
      fact({ id: 'C', as_of: '2022-01-01', supersedes: 'B', superseded_by: 'A' }),
    ],
  };
  const { errors } = checkSupersession(pack);
  assert.ok(errors.some((e) => /cycle/i.test(e)), errors.join('\n'));
});

// ============================================================================
// (4) branch error — a fact superseded by more than one fact
// ============================================================================

test('two facts both superseding the same fact is a branch error', () => {
  const pack = {
    facts: [
      fact({ id: 'A', as_of: '2020-01-01', superseded_by: 'B' }),
      fact({ id: 'B', as_of: '2021-01-01', supersedes: 'A' }),
      fact({ id: 'C', as_of: '2022-01-01', supersedes: 'A' }),
    ],
  };
  const { errors } = checkSupersession(pack);
  assert.ok(errors.some((e) => /branch/i.test(e) && e.includes('B') && e.includes('C')), errors.join('\n'));
});

// ============================================================================
// (5) dangling ref — both directions
// ============================================================================

test('supersedes referencing a nonexistent fact id is a dangling-ref error', () => {
  const pack = { facts: [fact({ id: 'A', as_of: '2021-01-01', supersedes: 'ghost' })] };
  const { errors } = checkSupersession(pack);
  assert.ok(errors.some((e) => /supersedes unknown fact id: ghost/.test(e)), errors.join('\n'));
});

test('superseded_by referencing a nonexistent fact id is a dangling-ref error', () => {
  const pack = { facts: [fact({ id: 'A', as_of: '2021-01-01', superseded_by: 'ghost' })] };
  const { errors } = checkSupersession(pack);
  assert.ok(errors.some((e) => /superseded_by unknown fact id: ghost/.test(e)), errors.join('\n'));
});

// ============================================================================
// (6) missing back-pointer
// ============================================================================

test('a superseded fact missing its superseded_by back-pointer is an error', () => {
  const pack = {
    facts: [
      fact({ id: 'A', as_of: '2020-01-01' }), // no superseded_by — forgotten
      fact({ id: 'B', as_of: '2021-01-01', supersedes: 'A' }),
    ],
  };
  const { errors } = checkSupersession(pack);
  assert.ok(errors.some((e) => /no superseded_by back-pointer/.test(e)), errors.join('\n'));
});

test('a wrong (not missing) back-pointer is also an error', () => {
  const pack = {
    facts: [
      fact({ id: 'A', as_of: '2020-01-01', superseded_by: 'WRONG' }),
      fact({ id: 'B', as_of: '2021-01-01', supersedes: 'A' }),
    ],
  };
  const { errors } = checkSupersession(pack);
  assert.ok(errors.some((e) => e.includes("is 'WRONG', not 'B'")), errors.join('\n'));
});

// ============================================================================
// (7) self-reference — both directions
// ============================================================================

test('a fact naming itself in supersedes is a self-reference error', () => {
  const pack = { facts: [fact({ id: 'A', as_of: '2020-01-01', supersedes: 'A' })] };
  const { errors } = checkSupersession(pack);
  assert.ok(errors.some((e) => /self-reference/.test(e)), errors.join('\n'));
});

test('a fact naming itself in superseded_by is a self-reference error', () => {
  const pack = { facts: [fact({ id: 'A', as_of: '2020-01-01', superseded_by: 'A' })] };
  const { errors } = checkSupersession(pack);
  assert.ok(errors.some((e) => /self-reference/.test(e)), errors.join('\n'));
});

// ============================================================================
// (8) as_of inversion — knowledge must move forward
// ============================================================================

test('a superseding fact with an earlier as_of than the fact it replaces is an error', () => {
  const pack = {
    facts: [
      fact({ id: 'A', as_of: '2022-01-01', superseded_by: 'B' }),
      fact({ id: 'B', as_of: '2020-01-01', supersedes: 'A' }), // backward in time
    ],
  };
  const { errors } = checkSupersession(pack);
  assert.ok(errors.some((e) => /as_of/.test(e) && /earlier/.test(e)), errors.join('\n'));
});

test('equal as_of on both sides is NOT an inversion (>= is allowed, not just >)', () => {
  const pack = {
    facts: [
      fact({ id: 'A', as_of: '2021-01-01', superseded_by: 'B' }),
      fact({ id: 'B', as_of: '2021-01-01', supersedes: 'A' }),
    ],
  };
  const { errors } = checkSupersession(pack);
  assert.deepEqual(errors, []);
});

// ============================================================================
// (9) encounter-references-superseded fact -> WARNING, not error
// ============================================================================

test('an encounter still targeting a superseded fact is a warning, not an error', () => {
  const pack = {
    facts: [
      fact({ id: 'A', as_of: '2020-01-01', superseded_by: 'B' }),
      fact({ id: 'B', as_of: '2021-01-01', supersedes: 'A' }),
    ],
    encounters: [mcq('E1', ['A'])],
  };
  const { errors, warnings } = checkSupersession(pack);
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes('E1') && warnings[0].includes('A') && warnings[0].includes('B'));
});

test('an encounter targeting the successor fact (not the superseded one) is clean', () => {
  const pack = {
    facts: [
      fact({ id: 'A', as_of: '2020-01-01', superseded_by: 'B' }),
      fact({ id: 'B', as_of: '2021-01-01', supersedes: 'A' }),
    ],
    encounters: [mcq('E1', ['B'])],
  };
  const { errors, warnings } = checkSupersession(pack);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});
