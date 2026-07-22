import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ledgerExport, UnknownPackError } from '../lib/tools.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const now = 2_000_000_000_000;
const ctx = {
  packsDir: path.join(testDir, 'fixtures', 'packs'),
  stateDir: path.join(testDir, 'fixtures', 'state'),
  now,
};

test('ledger_export builds deterministic tagged markdown at the default threshold', async () => {
  const result = await ledgerExport(ctx, { pack: 'ledger-demo' });
  const lines = result.markdown.split('\n');

  assert.equal(result.factCount, 3);
  assert.equal(lines[0], '# The Friendly Sourdough Ledger — box >= 3 (exported 2033-05-18T03:33:20.000Z)');
  assert.equal(lines[1], '_Source: The Tiny Bread Guide_');
  assert.match(result.markdown, /## Starter\n- \*\*Feed a sourdough starter/);
  assert.match(result.markdown, /## Routine\n- \*\*Feed a sourdough starter/);
  assert.match(result.markdown, /## Shaping\n- \*\*Surface tension helps/);
  assert.match(result.markdown, /## Baking\n- \*\*Steam early in the bake/);
  assert.deepEqual(result.warnings, []);
});

test('ledger_export applies minBox using the shared mastery derivation', async () => {
  const boxFive = await ledgerExport(ctx, { pack: 'ledger-demo', minBox: 5 });
  assert.equal(boxFive.factCount, 1);
  assert.match(boxFive.markdown, /Steam early in the bake/);
  assert.doesNotMatch(boxFive.markdown, /Surface tension helps/);

  const includeUnseen = await ledgerExport(ctx, { pack: 'ledger-demo', minBox: 0 });
  assert.equal(includeUnseen.factCount, 7);
  assert.match(includeUnseen.markdown, /## Untagged/);
  assert.match(includeUnseen.markdown, /- \*\*Do not slice a loaf immediately after it leaves the oven\.\*\*$/m);
});

test('ledger_export emits a useful document when no facts qualify', async () => {
  const result = await ledgerExport(ctx, { pack: 'ledger-demo', minBox: 6 });

  assert.equal(result.factCount, 0);
  assert.match(result.markdown, /^# The Friendly Sourdough Ledger — box >= 6/);
  assert.match(result.markdown, /_No facts yet at box >= 6\._/);
});

test('ledger_export identifies unknown packs for MCP error translation', async () => {
  await assert.rejects(
    ledgerExport(ctx, { pack: 'missing-pack' }),
    (error) => {
      assert.ok(error instanceof UnknownPackError);
      assert.equal(error.message, 'unknown pack: missing-pack. Available packs: ledger-demo');
      return true;
    },
  );
});

test('ledger_export never exposes raw SRS history', async () => {
  const result = await ledgerExport(ctx, { pack: 'ledger-demo', minBox: 0 });
  assert.equal(result.markdown.includes('demo.feed'), false);
  assert.equal(result.markdown.includes('quality'), false);
  assert.equal(result.markdown.includes('encounter_id'), false);
});
