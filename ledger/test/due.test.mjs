import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ledgerDue } from '../lib/tools.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const now = 2_000_000_000_000;
const ctx = {
  packsDir: path.join(testDir, 'fixtures', 'packs'),
  stateDir: path.join(testDir, 'fixtures', 'state'),
  now,
};

test('ledger_due returns seen overdue facts in most-stale order', async () => {
  const result = await ledgerDue(ctx, {});

  assert.deepEqual(result.facts.map((fact) => fact.id), [
    'bread.bake.steam',
    'bread.ferment.bulk',
  ]);
  assert.deepEqual(result.facts.map((fact) => fact.mastery.status), ['overdue', 'overdue']);
  assert.equal(result.facts[0].daysOverdue, Math.floor((now - 900_000_000_000) / 86_400_000));
  assert.equal(result.facts[1].daysOverdue, Math.floor((now - 1_000_000_000_000) / 86_400_000));
  assert.deepEqual(result.warnings, []);
});

test('ledger_due uses an inclusive next_due <= now boundary', async () => {
  const result = await ledgerDue({ ...ctx, now: 1_000_000_000_000 }, { pack: 'ledger-demo' });
  const bulk = result.facts.find((fact) => fact.id === 'bread.ferment.bulk');

  assert.ok(bulk);
  assert.equal(bulk.daysOverdue, 0);
});

test('ledger_due excludes unseen and future facts and preserves the public shape', async () => {
  const result = await ledgerDue(ctx, { pack: 'ledger-demo' });
  const serialized = JSON.stringify(result);

  assert.equal(result.facts.some((fact) => fact.id === 'bread.starter.peak'), false);
  assert.equal(result.facts.some((fact) => fact.id === 'bread.starter.feed'), false);
  assert.equal('next_due_raw' in result.facts[0], false);
  assert.equal(serialized.includes('history'), false);
  assert.equal(serialized.includes('quality'), false);
  assert.equal(serialized.includes('encounter_id'), false);
});

test('ledger_due reports an unknown pack without throwing', async () => {
  const result = await ledgerDue(ctx, { pack: 'not-here' });
  assert.deepEqual(result, { facts: [], warnings: ['unknown pack: not-here'] });
});
