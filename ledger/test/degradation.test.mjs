import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadPacks } from '../lib/packs.mjs';
import { loadSrs } from '../lib/srs.mjs';
import { ledgerLookup } from '../lib/tools.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePacksDir = path.join(testDir, 'fixtures', 'packs');
const fixtureStateDir = path.join(testDir, 'fixtures', 'state');

async function withTempDir(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fablewood-ledger-test-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('a missing srs.json is a warning-free empty state', async () => {
  await withTempDir(async (stateDir) => {
    const loaded = await loadSrs(stateDir);
    assert.deepEqual(loaded, { state: { version: 1, facts: {} }, warnings: [] });

    const result = await ledgerLookup({ packsDir: fixturePacksDir, stateDir, now: 0 }, {
      query: 'starter',
    });
    assert.equal(result.facts.length, 3);
    assert.equal(result.facts.every((fact) => fact.mastery.status === 'unseen'), true);
    assert.deepEqual(result.warnings, []);
  });
});

test('malformed SRS JSON and malformed SRS shape fall back with warnings', async () => {
  await withTempDir(async (stateDir) => {
    await writeFile(path.join(stateDir, 'srs.json'), '{not-json', 'utf8');
    const badJson = await loadSrs(stateDir);
    assert.deepEqual(badJson.state, { version: 1, facts: {} });
    assert.match(badJson.warnings[0], /^state\/srs\.json is malformed, ignoring:/);

    await writeFile(path.join(stateDir, 'srs.json'), JSON.stringify({ facts: [] }), 'utf8');
    const badShape = await loadSrs(stateDir);
    assert.deepEqual(badShape.state, { version: 1, facts: {} });
    assert.match(badShape.warnings[0], /expected an object with a facts object/);
  });
});

test('malformed packs are skipped while valid packs keep loading', async () => {
  await withTempDir(async (directory) => {
    const goodDir = path.join(directory, 'good');
    const badJsonDir = path.join(directory, 'bad-json');
    const missingFactsDir = path.join(directory, 'missing-facts');
    await Promise.all([
      mkdir(goodDir),
      mkdir(badJsonDir),
      mkdir(missingFactsDir),
    ]);

    const fixture = await readFile(
      path.join(fixturePacksDir, 'ledger-demo', 'pack.json'),
      'utf8',
    );
    await Promise.all([
      writeFile(path.join(goodDir, 'pack.json'), fixture, 'utf8'),
      writeFile(path.join(badJsonDir, 'pack.json'), '{bad-json', 'utf8'),
      writeFile(path.join(missingFactsDir, 'pack.json'), JSON.stringify({ meta: { id: 'broken' } }), 'utf8'),
      writeFile(path.join(goodDir, 'pack.staging.json'), '{bad-staging-json', 'utf8'),
    ]);

    const result = await loadPacks(directory);
    assert.deepEqual(result.packs.map((pack) => pack.meta.id), ['ledger-demo']);
    assert.equal(result.warnings.length, 2);
    assert.equal(result.warnings.some((warning) => warning.startsWith('skipped packs/bad-json/pack.json:')), true);
    assert.equal(result.warnings.some((warning) => warning === 'skipped packs/missing-facts/pack.json: missing facts array'), true);
    assert.equal(result.warnings.some((warning) => warning.includes('staging')), false);
  });
});

test('a nonexistent packs directory returns no packs and a warning', async () => {
  await withTempDir(async (directory) => {
    const missing = path.join(directory, 'does-not-exist');
    const result = await loadPacks(missing);
    assert.deepEqual(result.packs, []);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /^packs directory unavailable:/);
  });
});

test('tool calls combine pack and state warnings without crashing', async () => {
  await withTempDir(async (directory) => {
    const packsDir = path.join(directory, 'packs');
    const stateDir = path.join(directory, 'state');
    await mkdir(path.join(packsDir, 'bad'), { recursive: true });
    await mkdir(stateDir);
    await writeFile(path.join(packsDir, 'bad', 'pack.json'), '{bad', 'utf8');
    await writeFile(path.join(stateDir, 'srs.json'), '{bad', 'utf8');

    const result = await ledgerLookup({ packsDir, stateDir, now: 0 }, { query: 'anything' });
    assert.deepEqual(result.facts, []);
    assert.equal(result.warnings.length, 2);
  });
});

test('fixture files remain unchanged across read-only tool calls', async () => {
  const packFile = path.join(fixturePacksDir, 'ledger-demo', 'pack.json');
  const stateFile = path.join(fixtureStateDir, 'srs.json');
  const before = await Promise.all([readFile(packFile, 'utf8'), readFile(stateFile, 'utf8')]);

  await ledgerLookup({ packsDir: fixturePacksDir, stateDir: fixtureStateDir, now: 0 }, {
    query: 'starter',
  });

  const after = await Promise.all([readFile(packFile, 'utf8'), readFile(stateFile, 'utf8')]);
  assert.deepEqual(after, before);
});
