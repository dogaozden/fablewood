// validate_dungeon.test.mjs — tests for validate_dungeon.mjs's additive
// `boss.moveLabels` rule (docs/design/magic-combat-depth.md §9.5/§13, Phase 3).
// Node's built-in test runner — no framework, matching pipeline/'s existing
// "node ESM + python, no frameworks" style (see validate_pack.test.mjs). Runs
// standalone (does NOT go through vitest — vite.config.ts scopes vitest's
// root/include to app/src only, and this pack never touches app/):
//
//   node --test pipeline/validate_dungeon.test.mjs
//
// validate_dungeon.mjs is a SCRIPT (it validates on import and exits), not a
// module of pure helpers, so these drive the real CLI over temp fixtures and
// assert on its exit code + message. That also keeps the test honest about the
// thing packs are actually gated by.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(root, 'pipeline', 'validate_dungeon.mjs');

// The smallest pack + dungeon the validator accepts: one fact carrying the tag
// the boss phase recalls, one scenario_branch encounter for the phase, one boss
// room whose shields match its phase count.
const PACK = {
  meta: { id: 'test-pack' },
  facts: [{ id: 'fact.one', tags: ['a-tag'] }],
  encounters: [{ id: 'enc.branch', kind: 'scenario_branch' }],
};

function dungeonWith(boss) {
  return {
    id: 'test.dungeon',
    name: 'Test Dungeon',
    region: 'Testing',
    packId: 'test-pack',
    rooms: [{
      id: 'room.boss',
      name: 'Boss Room',
      enemies: [{ archetype: 'wisp' }],
      boss: {
        name: 'The Test-Warden',
        shields: 1,
        phases: [{ branchEncounterId: 'enc.branch', recallTags: ['a-tag'] }],
        ...boss,
      },
    }],
  };
}

/** Run the real validator CLI over a temp fixture; returns { ok, out }. */
function runValidator(bossExtras) {
  const dir = mkdtempSync(join(tmpdir(), 'fw-dungeon-'));
  try {
    const dPath = join(dir, 'test.dungeon.json');
    const pPath = join(dir, 'pack.json');
    writeFileSync(dPath, JSON.stringify(dungeonWith(bossExtras)));
    writeFileSync(pPath, JSON.stringify(PACK));
    const res = spawnSync(process.execPath, [SCRIPT, dPath, pPath], { encoding: 'utf8' });
    return { ok: res.status === 0, out: `${res.stdout}${res.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('moveLabels absent stays valid — the rule is additive, every shipped dungeon predates it', () => {
  const { ok } = runValidator({});
  assert.equal(ok, true);
});

test('a full, correct moveLabels map passes', () => {
  const { ok, out } = runValidator({
    moveLabels: { seizure: 'Writ of Seizure', injunction: "Injunction of the '33 Codex", summon: 'Call the Clause' },
  });
  assert.equal(ok, true, out);
});

test('a partial moveLabels map passes — every key is independently optional', () => {
  const { ok, out } = runValidator({ moveLabels: { injunction: 'Just the one' } });
  assert.equal(ok, true, out);
});

test('an unknown moveLabels key is REJECTED (a typo must not silently relabel nothing)', () => {
  const { ok, out } = runValidator({ moveLabels: { seizure: 'ok', sumon: 'typo' } });
  assert.equal(ok, false);
  assert.match(out, /bad boss\.moveLabels key: sumon/);
  assert.match(out, /DUNGEON VALIDATION FAILED/);
});

test('an empty or blank moveLabels value is REJECTED', () => {
  for (const bad of ['', '   ']) {
    const { ok, out } = runValidator({ moveLabels: { summon: bad } });
    assert.equal(ok, false, `expected rejection for ${JSON.stringify(bad)}`);
    assert.match(out, /boss\.moveLabels\.summon must be a non-empty string/);
  }
});

test('a non-string moveLabels value is REJECTED', () => {
  const { ok, out } = runValidator({ moveLabels: { seizure: 42 } });
  assert.equal(ok, false);
  assert.match(out, /boss\.moveLabels\.seizure must be a non-empty string/);
});

test('a non-object moveLabels is REJECTED (array and scalar alike)', () => {
  for (const bad of [['Writ of Seizure'], 'Writ of Seizure']) {
    const { ok, out } = runValidator({ moveLabels: bad });
    assert.equal(ok, false, `expected rejection for ${JSON.stringify(bad)}`);
    assert.match(out, /boss\.moveLabels must be an object when present/);
  }
});

// ============================================================================
// 2.3 — boss.relicId parity: mirrors the enemy.archetype precedent (a closed set,
// checked only when present — relicId is optional, same shape as moveLabels above).
// ============================================================================

test('relicId absent stays valid — every shipped dungeon before this ticket predates it', () => {
  const { ok, out } = runValidator({});
  assert.equal(ok, true, out);
});

test('a known relicId (the shipped Warden Signet) passes', () => {
  const { ok, out } = runValidator({ relicId: 'warden-signet-of-terms' });
  assert.equal(ok, true, out);
});

test('an unknown relicId is REJECTED (a typo must not silently ship an unresolvable grant)', () => {
  const { ok, out } = runValidator({ relicId: 'not-a-real-relic' });
  assert.equal(ok, false);
  assert.match(out, /bad boss\.relicId: not-a-real-relic/);
  assert.match(out, /DUNGEON VALIDATION FAILED/);
});

// ============================================================================
// crucible-2 — non-array rooms/enemies/phases must be REPORTED, not crash the
// validator with a TypeError. Each field already had an Array.isArray() check
// that pushed a clean error message — but the for-of loop right after it ran
// over the raw (non-iterable) value regardless, so the process crashed before
// ever reaching the report. Fixtures mirror the verifier's malformed-pack repro.
// ============================================================================

/** Run the real validator CLI over an explicit dungeon object (bypassing
 * dungeonWith's fixed valid-boss shape, since these fixtures target rooms/
 * enemies/phases directly) against the shared PACK fixture above. */
function runValidatorWithDungeon(dungeon) {
  const dir = mkdtempSync(join(tmpdir(), 'fw-dungeon-'));
  try {
    const dPath = join(dir, 'test.dungeon.json');
    const pPath = join(dir, 'pack.json');
    writeFileSync(dPath, JSON.stringify(dungeon));
    writeFileSync(pPath, JSON.stringify(PACK));
    const res = spawnSync(process.execPath, [SCRIPT, dPath, pPath], { encoding: 'utf8' });
    return { ok: res.status === 0, out: `${res.stdout}${res.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('dungeon.rooms as a non-array object is reported, not a crash', () => {
  const { ok, out } = runValidatorWithDungeon({
    id: 'test.dungeon', name: 'Test Dungeon', region: 'Testing', packId: 'test-pack', rooms: {},
  });
  assert.equal(ok, false);
  assert.ok(!/TypeError/.test(out), `expected a clean validation error, not a crash:\n${out}`);
  assert.match(out, /dungeon\.rooms must be a non-empty array/);
  assert.match(out, /DUNGEON VALIDATION FAILED/);
});

test('dungeon.rooms as a non-array number is reported, not a crash', () => {
  const { ok, out } = runValidatorWithDungeon({
    id: 'test.dungeon', name: 'Test Dungeon', region: 'Testing', packId: 'test-pack', rooms: 5,
  });
  assert.equal(ok, false);
  assert.ok(!/TypeError/.test(out), `expected a clean validation error, not a crash:\n${out}`);
  assert.match(out, /dungeon\.rooms must be a non-empty array/);
});

test('room.enemies as a non-array object is reported, not a crash', () => {
  const { ok, out } = runValidatorWithDungeon({
    id: 'test.dungeon', name: 'Test Dungeon', region: 'Testing', packId: 'test-pack',
    rooms: [{ id: 'room.1', name: 'Room 1', enemies: {} }],
  });
  assert.equal(ok, false);
  assert.ok(!/TypeError/.test(out), `expected a clean validation error, not a crash:\n${out}`);
  assert.match(out, /\[room\.1\] room\.enemies must be an array/);
});

test('boss.phases as a non-array object is reported, not a crash', () => {
  const { ok, out } = runValidatorWithDungeon({
    id: 'test.dungeon', name: 'Test Dungeon', region: 'Testing', packId: 'test-pack',
    rooms: [{
      id: 'room.1', name: 'Room 1', enemies: [],
      boss: { name: 'Boss', shields: 1, phases: {} },
    }],
  });
  assert.equal(ok, false);
  assert.ok(!/TypeError/.test(out), `expected a clean validation error, not a crash:\n${out}`);
  assert.match(out, /\[room\.1\] boss\.phases must be non-empty/);
});
