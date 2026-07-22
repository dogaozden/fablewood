import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { matchesQuery } from '../lib/query.mjs';
import { ledgerLookup } from '../lib/tools.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const ctx = {
  packsDir: path.join(testDir, 'fixtures', 'packs'),
  stateDir: path.join(testDir, 'fixtures', 'state'),
  now: 2_000_000_000_000,
};

test('matchesQuery checks statement, detail, and tag substrings case-insensitively', () => {
  const fact = {
    statement: 'Keep the Crust crisp',
    detail: 'Cool on a wire rack',
    tags: ['Bread-Care'],
  };

  assert.equal(matchesQuery(fact, 'CRUST'), true);
  assert.equal(matchesQuery(fact, 'wire RACK'), true);
  assert.equal(matchesQuery(fact, 'care'), true);
  assert.equal(matchesQuery(fact, 'bread-care'), true);
  assert.equal(matchesQuery(fact, '   '), false);
  assert.equal(matchesQuery(fact, 'starter'), false);
});

test('ledger_lookup returns matching facts with derived mastery and source metadata', async () => {
  const result = await ledgerLookup(ctx, { query: 'starter' });

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    result.facts.map((fact) => fact.id),
    ['bread.starter.feed', 'bread.starter.peak', 'bread.ferment.bulk'],
  );
  assert.deepEqual(result.facts[0], {
    id: 'bread.starter.feed',
    pack: 'ledger-demo',
    type: 'do',
    statement: 'Feed a sourdough starter with equal weights of flour and water.',
    detail: 'A kitchen scale keeps the ratio consistent from one feeding to the next.',
    tags: ['Starter', 'Routine'],
    as_of: '2026-07-20',
    source: {
      title: 'The Tiny Bread Guide, 1st edition',
      loc: 'Starter > Feeding',
    },
    mastery: {
      box: 4,
      due: '2100-01-01T00:00:00.000Z',
      last_event: '2026-07-10T09:00:00.000Z',
      status: 'known',
    },
  });
});

test('ledger_lookup supports detail matches, pack filters, and empty queries', async () => {
  const detailResult = await ledgerLookup(ctx, {
    query: 'KITCHEN SCALE',
    pack: 'ledger-demo',
  });
  assert.deepEqual(detailResult.facts.map((fact) => fact.id), ['bread.starter.feed']);

  const emptyResult = await ledgerLookup(ctx, { query: ' \n\t ' });
  assert.deepEqual(emptyResult, { facts: [], warnings: [] });
});

test('ledger_lookup reports an unknown pack without throwing', async () => {
  const result = await ledgerLookup(ctx, { query: 'starter', pack: 'missing-pack' });
  assert.deepEqual(result, {
    facts: [],
    warnings: ['unknown pack: missing-pack'],
  });
});

test('ledger_lookup never exposes raw SRS history fields', async () => {
  const result = await ledgerLookup(ctx, { query: 'starter' });
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes('history'), false);
  assert.equal(serialized.includes('quality'), false);
  assert.equal(serialized.includes('encounter_id'), false);
});
