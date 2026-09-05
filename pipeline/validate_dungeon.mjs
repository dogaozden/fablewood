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
//   - boss.moveLabels (optional, additive): keys in {seizure,injunction,summon},
//     values non-empty strings — absent is always valid
//   - boss.relicId (optional, additive, 2.3): a catalog id of type 'relic'
//     (app/src/inventory/catalog.ts) — absent is always valid; mirrors the
//     enemy.archetype precedent above. RELIC_IDS is exported so
//     app/src/inventory/relicIdParity.test.ts can assert it never drifts from
//     the catalog (a plain Node script can't import TypeScript, so the set here
//     is necessarily a hand-maintained duplicate — the parity test is what
//     keeps that duplicate honest).
//
// Usage: node pipeline/validate_dungeon.mjs [dungeon.json] [pack.json]
//        node pipeline/validate_dungeon.mjs --engine <dungeon.json>
//
// --engine validates an ENGINE-side spec (app/src/game/scenes/dungeon/__fixtures__/*.json,
// universe design §9): shape, room ids, archetypes, kinds, shields/phases, moveLabels and
// relicId are all still checked. The pack cross-references (teaching fact ids, gate/phase
// encounter ids, enemy and recall tags, packId match) are skipped, because there is no pack —
// an arc's trials resolve through the global Draw Service at runtime, never through a named
// pack asset.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ARCHETYPES = new Set(['wisp', 'wraith', 'construct', 'warden']);
const KINDS = new Set(['mcq', 'free_recall', 'scenario_branch', 'match', 'order']);
// magic-combat-depth.md §9.4/§9.5 — the engine's WardenMove union (app/src/game/combat/boss.ts).
const WARDEN_MOVES = new Set(['seizure', 'injunction', 'summon']);
// Ch. IX Provenance — the five shipped relic ids (app/src/inventory/catalog.ts, type: 'relic').
export const RELIC_IDS = new Set([
  'warden-signet-of-terms', 'unbroken-clasp', 'waymark-heel', 'margin-lamp', 'second-wick',
]);

// ---------------------------------------------------------------------------
// CLI entrypoint — guarded (isMain, below) so RELIC_IDS can be imported for
// the parity test (app/src/inventory/relicIdParity.test.ts) without reading
// files off disk or exiting the process.
// ---------------------------------------------------------------------------
function main(dungeonPathArg, packPathArg, { engine: ENGINE = false } = {}) {
  const dPath = resolve(root, dungeonPathArg || 'packs/vc-law/assets/preference-vaults.dungeon.json');
  const pPath = resolve(root, packPathArg || 'packs/vc-law/pack.json');

  const dun = JSON.parse(readFileSync(dPath, 'utf8'));
  // An engine spec (universe design §9) has no pack.json: packId is 'engine' and gate/phase
  // encounter ids exist in no pack by design (they resolve through the global Draw Service at
  // runtime instead). Synthesize an empty pack echoing the spec's own packId so the packId-
  // match check below is trivially true, rather than special-casing it out entirely.
  const pack = ENGINE ? { meta: { id: dun.packId }, facts: [], encounters: [] } : JSON.parse(readFileSync(pPath, 'utf8'));

  const factIds = new Set(pack.facts.map((f) => f.id));
  const factTags = new Set(pack.facts.flatMap((f) => f.tags ?? []));
  const encById = new Map(pack.encounters.map((e) => [e.id, e]));

  const errors = [];
  const push = (m) => errors.push(m);

  for (const k of ['id', 'name', 'region', 'packId']) {
    if (typeof dun[k] !== 'string' || !dun[k]) push(`dungeon.${k} must be a non-empty string`);
  }
  if (!ENGINE && dun.packId !== pack.meta.id) push(`packId '${dun.packId}' != pack meta.id '${pack.meta.id}'`);
  if (!Array.isArray(dun.rooms) || dun.rooms.length === 0) push('dungeon.rooms must be a non-empty array');

  const roomIds = new Set();
  let bossCount = 0;

  for (const r of Array.isArray(dun.rooms) ? dun.rooms : []) {
    const at = (m) => `[${r.id ?? '?'}] ${m}`;
    if (!r.id || roomIds.has(r.id)) push(at('room id missing or duplicate'));
    roomIds.add(r.id);
    if (!r.name) push(at('room.name required'));

    for (const fid of r.teaching ?? []) {
      if (!ENGINE && !factIds.has(fid)) push(at(`teaching references unknown fact: ${fid}`));
    }
    if (!Array.isArray(r.enemies)) push(at('room.enemies must be an array'));
    for (const e of Array.isArray(r.enemies) ? r.enemies : []) {
      if (!ARCHETYPES.has(e.archetype)) push(at(`bad enemy archetype: ${e.archetype}`));
      for (const k of e.kinds ?? []) if (!KINDS.has(k)) push(at(`bad enemy kind: ${k}`));
      for (const t of e.tags ?? []) if (!ENGINE && !factTags.has(t)) push(at(`enemy tag not on any fact: ${t}`));
      if (e.parley !== undefined && typeof e.parley !== 'boolean') push(at('enemy.parley must be boolean'));
    }

    if (r.gate && !ENGINE) {
      const e = encById.get(r.gate.encounterId);
      if (!e) push(at(`gate references unknown encounter: ${r.gate.encounterId}`));
      else if (e.kind !== 'free_recall') push(at(`gate encounter ${e.id} should be free_recall, is ${e.kind}`));
    }
    if (r.gate && ENGINE && typeof r.gate.encounterId !== 'string') push(at('gate.encounterId must be a string'));

    if (r.boss) {
      bossCount++;
      const b = r.boss;
      if (!b.name) push(at('boss.name required'));
      if (!Number.isInteger(b.shields) || b.shields < 1) push(at(`boss.shields must be a positive integer, got ${b.shields}`));
      if (!Array.isArray(b.phases) || b.phases.length === 0) push(at('boss.phases must be non-empty'));
      for (const ph of Array.isArray(b.phases) ? b.phases : []) {
        if (typeof ph.branchEncounterId !== 'string' || !ph.branchEncounterId) {
          push(at('boss phase branchEncounterId must be a non-empty string'));
        } else if (!ENGINE) {
          const e = encById.get(ph.branchEncounterId);
          if (!e) push(at(`boss phase references unknown encounter: ${ph.branchEncounterId}`));
          else if (e.kind !== 'scenario_branch') push(at(`boss phase encounter ${e.id} must be scenario_branch, is ${e.kind}`));
        }
        for (const t of ph.recallTags ?? []) if (!ENGINE && !factTags.has(t)) push(at(`boss recallTag not on any fact: ${t}`));
      }
      if (b.shields !== (b.phases ?? []).length) {
        push(at(`boss.shields (${b.shields}) != number of phases (${(b.phases ?? []).length}) — intended?`));
      }
      // magic-combat-depth.md §9.5/§13 — boss.moveLabels is ADDITIVE and OPTIONAL: absent is
      // always fine (every shipped dungeon predates it). When present it must be a flat map of
      // the engine's three WardenMove keys to non-empty strings, so a typo'd key silently
      // relabels nothing instead of failing loudly at runtime.
      if (b.moveLabels !== undefined) {
        if (typeof b.moveLabels !== 'object' || b.moveLabels === null || Array.isArray(b.moveLabels)) {
          push(at('boss.moveLabels must be an object when present'));
        } else {
          for (const [k, v] of Object.entries(b.moveLabels)) {
            if (!WARDEN_MOVES.has(k)) push(at(`bad boss.moveLabels key: ${k} (expected one of ${[...WARDEN_MOVES].join(', ')})`));
            if (typeof v !== 'string' || !v.trim()) push(at(`boss.moveLabels.${k} must be a non-empty string`));
          }
        }
      }
      // Ch. IX Provenance (2.3) — same shape as moveLabels above: optional, checked only when
      // present, since a room with no relicId at all falls back to the Warden's Signet
      // (contracts.ts's BossSpec.relicId doc) — the same precedent enemy.archetype set above.
      if (b.relicId !== undefined && !RELIC_IDS.has(b.relicId)) {
        push(at(`bad boss.relicId: ${b.relicId}`));
      }
    }
  }

  if (bossCount === 0) push('dungeon has no boss room');

  console.log(`Validated ${dPath}`);
  console.log(
    `  rooms: ${(dun.rooms ?? []).length} | bosses: ${bossCount} | against ${
      ENGINE ? 'the DungeonSpec contract (engine spec, no pack)' : `pack ${pack.meta.id}`
    }`,
  );
  if (errors.length) {
    console.log(`\n${errors.length} problem(s):`);
    for (const e of errors) console.log('  -', e);
    console.log('\nDUNGEON VALIDATION FAILED');
    process.exit(1);
  }
  console.log('\nAll dungeon checks passed.');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const ENGINE = argv.includes('--engine');
  const positional = argv.filter((a) => a !== '--engine');
  main(positional[0], positional[1], { engine: ENGINE });
}
