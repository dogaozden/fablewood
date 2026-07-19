// validate_dungeon.mjs — cross-check a pack-owned DungeonSpec against its pack
// and the DungeonSpec contract (app/src/game/contracts.ts).
//
// The engine reads packs/<id>/assets/<slug>.dungeon.json generically; there is
// no ajv schema for it (it's a TS interface), so this script is the gate. It
// verifies the shape and that every reference resolves into pack.json:
//   - packId matches the pack; room ids unique
//   - teaching[] fact ids exist; gate.encounterId exists (and is free_recall)
//   - enemy.archetype in {wisp,wraith,construct,warden}; kinds valid; tags exist
//     on >=1 fact (so encounters can actually be drawn); parley is boolean
//   - boss.phases[].branchEncounterId exists and is a scenario_branch;
//     recallTags exist on >=1 fact; shields is a positive integer
//
// Usage: node pipeline/validate_dungeon.mjs [dungeon.json] [pack.json]

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dPath = resolve(root, process.argv[2] || 'packs/vc-law/assets/preference-vaults.dungeon.json');
const pPath = resolve(root, process.argv[3] || 'packs/vc-law/pack.json');

const dun = JSON.parse(readFileSync(dPath, 'utf8'));
const pack = JSON.parse(readFileSync(pPath, 'utf8'));

const ARCHETYPES = new Set(['wisp', 'wraith', 'construct', 'warden']);
const KINDS = new Set(['mcq', 'free_recall', 'scenario_branch', 'match', 'order']);

const factIds = new Set(pack.facts.map((f) => f.id));
const factTags = new Set(pack.facts.flatMap((f) => f.tags ?? []));
const encById = new Map(pack.encounters.map((e) => [e.id, e]));

const errors = [];
const push = (m) => errors.push(m);

for (const k of ['id', 'name', 'region', 'packId']) {
  if (typeof dun[k] !== 'string' || !dun[k]) push(`dungeon.${k} must be a non-empty string`);
}
if (dun.packId !== pack.meta.id) push(`packId '${dun.packId}' != pack meta.id '${pack.meta.id}'`);
if (!Array.isArray(dun.rooms) || dun.rooms.length === 0) push('dungeon.rooms must be a non-empty array');

const roomIds = new Set();
let bossCount = 0;

for (const r of dun.rooms ?? []) {
  const at = (m) => `[${r.id ?? '?'}] ${m}`;
  if (!r.id || roomIds.has(r.id)) push(at('room id missing or duplicate'));
  roomIds.add(r.id);
  if (!r.name) push(at('room.name required'));

  for (const fid of r.teaching ?? []) {
    if (!factIds.has(fid)) push(at(`teaching references unknown fact: ${fid}`));
  }
  if (!Array.isArray(r.enemies)) push(at('room.enemies must be an array'));
  for (const e of r.enemies ?? []) {
    if (!ARCHETYPES.has(e.archetype)) push(at(`bad enemy archetype: ${e.archetype}`));
    for (const k of e.kinds ?? []) if (!KINDS.has(k)) push(at(`bad enemy kind: ${k}`));
    for (const t of e.tags ?? []) if (!factTags.has(t)) push(at(`enemy tag not on any fact: ${t}`));
    if (e.parley !== undefined && typeof e.parley !== 'boolean') push(at('enemy.parley must be boolean'));
  }

  if (r.gate) {
    const e = encById.get(r.gate.encounterId);
    if (!e) push(at(`gate references unknown encounter: ${r.gate.encounterId}`));
    else if (e.kind !== 'free_recall') push(at(`gate encounter ${e.id} should be free_recall, is ${e.kind}`));
  }

  if (r.boss) {
    bossCount++;
    const b = r.boss;
    if (!b.name) push(at('boss.name required'));
    if (!Number.isInteger(b.shields) || b.shields < 1) push(at(`boss.shields must be a positive integer, got ${b.shields}`));
    if (!Array.isArray(b.phases) || b.phases.length === 0) push(at('boss.phases must be non-empty'));
    for (const ph of b.phases ?? []) {
      const e = encById.get(ph.branchEncounterId);
      if (!e) push(at(`boss phase references unknown encounter: ${ph.branchEncounterId}`));
      else if (e.kind !== 'scenario_branch') push(at(`boss phase encounter ${e.id} must be scenario_branch, is ${e.kind}`));
      for (const t of ph.recallTags ?? []) if (!factTags.has(t)) push(at(`boss recallTag not on any fact: ${t}`));
    }
    if (b.shields !== (b.phases ?? []).length) {
      push(at(`boss.shields (${b.shields}) != number of phases (${(b.phases ?? []).length}) — intended?`));
    }
  }
}

if (bossCount === 0) push('dungeon has no boss room');

console.log(`Validated ${dPath}`);
console.log(`  rooms: ${(dun.rooms ?? []).length} | bosses: ${bossCount} | against pack ${pack.meta.id}`);
if (errors.length) {
  console.log(`\n${errors.length} problem(s):`);
  for (const e of errors) console.log('  -', e);
  console.log('\nDUNGEON VALIDATION FAILED');
  process.exit(1);
}
console.log('\nAll dungeon checks passed.');
