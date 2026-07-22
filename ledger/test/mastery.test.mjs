import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveMastery } from '../lib/mastery.mjs';
import { ledgerMastery } from '../lib/tools.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const now = 2_000_000_000_000;
const ctx = {
  packsDir: path.join(testDir, 'fixtures', 'packs'),
  stateDir: path.join(testDir, 'fixtures', 'state'),
  now,
};

test('deriveMastery implements unseen, overdue, known, and learning precedence', () => {
  assert.deepEqual(deriveMastery(undefined, now), {
    box: 0,
    due: null,
    last_event: null,
    status: 'unseen',
  });
  assert.equal(deriveMastery({ box: 5, next_due: now, history: [] }, now).status, 'overdue');
  assert.equal(deriveMastery({ box: 3, next_due: now + 1, history: [] }, now).status, 'known');
  assert.equal(deriveMastery({ box: 2, next_due: now + 1, history: [] }, now).status, 'learning');
});

test('deriveMastery clamps malformed boxes and surfaces malformed due values', () => {
  assert.equal(deriveMastery({ box: -4, next_due: now + 1, history: [] }, now).box, 1);
  assert.equal(deriveMastery({ box: 99, next_due: now + 1, history: [] }, now).box, 5);
  assert.deepEqual(deriveMastery({ box: Number.NaN, next_due: Number.NaN, history: [] }, now), {
    box: 1,
    due: null,
    last_event: null,
    status: 'overdue',
  });
});

test('deriveMastery exposes only the most recent history timestamp', () => {
  const mastery = deriveMastery({
    box: 2,
    next_due: now + 1,
    history: [
      { ts: '2026-01-01T00:00:00.000Z', quality: 0, encounter_id: 'first' },
      { ts: '2026-02-01T00:00:00.000Z', quality: 1, encounter_id: 'second' },
    ],
  }, now);

  assert.equal(mastery.last_event, '2026-02-01T00:00:00.000Z');
  assert.equal('history' in mastery, false);
});

test('ledger_mastery counts seen boxes, unseen facts, coverage, and weakest facts', async () => {
  const result = await ledgerMastery(ctx, {});

  assert.deepEqual(result.scope, { pack: null, topic: null });
  assert.equal(result.totalFacts, 7);
  assert.deepEqual(result.byBox, { '1': 1, '2': 1, '3': 1, '4': 1, '5': 1 });
  assert.equal(result.unseen, 2);
  assert.equal(result.coveragePct, 42.9);
  assert.deepEqual(
    result.weakest.map((fact) => fact.id),
    [
      'bread.ferment.bulk',
      'bread.dough.rest',
      'bread.shape.tension',
      'bread.starter.feed',
      'bread.bake.steam',
    ],
  );
  assert.deepEqual(result.warnings, []);
});

test('ledger_mastery topic filtering uses tag substrings only', async () => {
  const tagged = await ledgerMastery(ctx, { pack: 'ledger-demo', topic: 'START' });
  assert.equal(tagged.totalFacts, 2);
  assert.equal(tagged.unseen, 1);
  assert.equal(tagged.coveragePct, 50);

  const statementOnly = await ledgerMastery(ctx, { topic: 'loaf' });
  assert.equal(statementOnly.totalFacts, 0);
  assert.equal(statementOnly.coveragePct, 0);
});

test('ledger_mastery keeps unseen facts out of weakest', async () => {
  const result = await ledgerMastery(ctx, {});
  assert.equal(result.weakest.some((fact) => fact.id === 'bread.starter.peak'), false);
  assert.equal(result.weakest.some((fact) => fact.id === 'bread.cool.wait'), false);
  assert.equal(JSON.stringify(result).includes('history'), false);
});
