// validate_pack.mjs — schema-gate a compiled pack the way the engine does,
// plus content cross-checks the JSON Schema cannot express.
//
// Uses the real engine schema (app/src/packs/pack.schema.json) and the same ajv
// options as app/src/packs/validatePack.ts ({ allErrors: true, strict: false }),
// so passing here means passing the engine's validator. Then it verifies:
//   - >=30 facts, >=40 encounters, all 5 kinds present
//   - unique ids; every encounter.fact_ids and quest.encounter_ids resolves
//   - mcq answer is one of options; order answer is a permutation of options;
//     match answer pairs are drawn from the two option columns
//   - free_recall has a non-empty rubric; scenario_branch has a correct branch
//   - every {{var}} in a prompt is defined in template_vars
//   - duplicate_of points directly to a distinct canonical fact in this pack;
//     aliases cannot chain, cycle, or carry supersession metadata
//   - supersession (docs/design/knowledge-platform-vision.md §3b, §9.3):
//     supersedes/superseded_by reference real facts, pair up perfectly in both
//     directions, no self-reference, no cycles, no branching (a fact may be
//     superseded by at most one fact), and the superseding fact's as_of is
//     >= the superseded fact's. A live encounter still targeting a superseded
//     fact is a WARNING, not an error — existing packs must not break.
//
// Usage: node pipeline/validate_pack.mjs [packs/vc-law/pack.json]

import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Supersession checks (vision §3b / §9.3 — schema + validator layer only; the
 * game-event half, the amended-Ledger re-teach encounter, is a separate design
 * pass and out of scope here).
 *
 * v1 is one-for-one: `Fact.supersedes` names the single old fact a new fact
 * replaces; `Fact.superseded_by` is the stored back-pointer on the old fact
 * (kept explicit in pack.json for human readability rather than derived).
 * One-to-many consolidation (several old facts folded into one new fact) is a
 * flagged future extension — NOT built. Both fields are additive/optional, so
 * a pack that never uses them (e.g. today's vc-law) produces zero errors and
 * zero warnings here.
 *
 * A fact can only ever name one `supersedes` target by construction (it's a
 * single string field, not an array), so "may supersede exactly one" needs no
 * extra check. "May be superseded by exactly one fact" is a real check — two
 * facts both claiming to supersede the same old fact is a branch.
 *
 * Returns { errors, warnings }. Errors fail validation; a warning does not —
 * it flags a live encounter that hasn't migrated to a successor fact yet.
 */
export function checkSupersession(pack) {
  const errors = [];
  const warnings = [];
  const facts = pack.facts ?? [];
  const factsById = new Map(facts.map((f) => [f.id, f]));

  // (a) dangling refs, (c) self-reference, (b) bidirectional pairing, (e) as_of order
  for (const f of facts) {
    if (f.supersedes !== undefined) {
      if (f.supersedes === f.id) {
        errors.push(`[${f.id}] supersedes itself (self-reference)`);
      } else if (!factsById.has(f.supersedes)) {
        errors.push(`[${f.id}] supersedes unknown fact id: ${f.supersedes}`);
      } else {
        const old = factsById.get(f.supersedes);
        if (old.superseded_by === undefined) {
          errors.push(`[${f.id}] supersedes ${f.supersedes}, but ${f.supersedes} has no superseded_by back-pointer to ${f.id}`);
        } else if (old.superseded_by !== f.id) {
          errors.push(`[${f.id}] supersedes ${f.supersedes}, but ${f.supersedes}.superseded_by is '${old.superseded_by}', not '${f.id}'`);
        }
        if (typeof old.as_of === 'string' && typeof f.as_of === 'string' && old.as_of > f.as_of) {
          errors.push(`[${f.id}] supersedes ${f.supersedes} but as_of (${f.as_of}) is earlier than the superseded fact's as_of (${old.as_of})`);
        }
      }
    }
    if (f.superseded_by !== undefined) {
      if (f.superseded_by === f.id) {
        errors.push(`[${f.id}] superseded_by itself (self-reference)`);
      } else if (!factsById.has(f.superseded_by)) {
        errors.push(`[${f.id}] superseded_by unknown fact id: ${f.superseded_by}`);
      } else {
        const successor = factsById.get(f.superseded_by);
        if (successor.supersedes === undefined) {
          errors.push(`[${f.id}] superseded_by ${f.superseded_by}, but ${f.superseded_by} has no supersedes pointer back to ${f.id}`);
        } else if (successor.supersedes !== f.id) {
          errors.push(`[${f.id}] superseded_by ${f.superseded_by}, but ${f.superseded_by}.supersedes is '${successor.supersedes}', not '${f.id}'`);
        }
      }
    }
  }

  // (d) branching: a fact may be superseded by at most one fact.
  const claimantsByOldId = new Map(); // old fact id -> [new-fact ids that claim to supersede it]
  for (const f of facts) {
    if (f.supersedes === undefined || !factsById.has(f.supersedes)) continue;
    const list = claimantsByOldId.get(f.supersedes) ?? [];
    list.push(f.id);
    claimantsByOldId.set(f.supersedes, list);
  }
  for (const [oldId, claimants] of claimantsByOldId) {
    if (claimants.length > 1) {
      errors.push(`[${oldId}] superseded by more than one fact (branch): ${claimants.join(', ')}`);
    }
  }

  // (d) cycles: chains (A -> B -> C over years) are fine; looping back to an
  // already-visited fact within the same walk is not. Self-references are
  // already reported above and are excluded from the walk so they don't also
  // register as a (trivial) cycle.
  const resolved = new Set();
  for (const start of facts) {
    if (resolved.has(start.id)) continue;
    const path = [];
    const indexOnPath = new Map();
    let cur = start;
    while (cur) {
      if (indexOnPath.has(cur.id)) {
        const cycle = path.slice(indexOnPath.get(cur.id)).concat(cur.id);
        errors.push(`supersession cycle detected: ${cycle.join(' -> ')}`);
        break;
      }
      if (resolved.has(cur.id)) break; // walks into an already-resolved (acyclic) chain
      indexOnPath.set(cur.id, path.length);
      path.push(cur.id);
      cur = (cur.supersedes !== undefined && cur.supersedes !== cur.id)
        ? factsById.get(cur.supersedes)
        : undefined;
    }
    for (const id of path) resolved.add(id);
  }

  // (f) WARNING (not error): a live encounter still targets a superseded fact.
  for (const e of pack.encounters ?? []) {
    for (const fid of e.fact_ids ?? []) {
      const f = factsById.get(fid);
      if (f?.superseded_by !== undefined) {
        warnings.push(`[${e.id}] references superseded fact ${fid} (superseded by ${f.superseded_by}); consider migrating to the successor`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Validate the pack-local durable duplicate relationship.
 *
 * `duplicate_of` is an explicit publisher-reviewed link, not supersession. A
 * target must be present and canonical; chains and cycles would make the
 * learning identity ambiguous, so both are rejected. The relationship is
 * allowed to branch: several durable records may point at one canonical fact.
 */
export function checkDuplicateAliases(pack) {
  const errors = [];
  const facts = Array.isArray(pack?.facts) ? pack.facts : [];
  const factsById = new Map();
  for (const fact of facts) {
    if (!fact || typeof fact !== 'object' || typeof fact.id !== 'string' || !fact.id || factsById.has(fact.id)) continue;
    factsById.set(fact.id, fact);
  }

  for (const fact of facts) {
    if (!fact || typeof fact !== 'object' || fact.duplicate_of === undefined) continue;
    const id = typeof fact.id === 'string' && fact.id ? fact.id : '(unknown)';
    const targetId = fact.duplicate_of;
    if (typeof targetId !== 'string' || !targetId) {
      errors.push(`[${id}] duplicate_of must be a non-empty string`);
      continue;
    }
    if (targetId === fact.id) errors.push(`[${id}] duplicate_of itself (self-reference)`);
    if (fact.supersedes !== undefined || fact.superseded_by !== undefined) {
      errors.push(`[${id}] duplicate_of cannot be combined with supersedes or superseded_by`);
    }

    const target = factsById.get(targetId);
    if (!target) {
      errors.push(`[${id}] duplicate_of unknown fact id: ${targetId}`);
    } else if (target.duplicate_of !== undefined) {
      errors.push(`[${id}] duplicate_of target ${targetId} is itself an alias; duplicate chains/cycles are not allowed`);
    } else if (target.supersedes !== undefined || target.superseded_by !== undefined) {
      errors.push(`[${id}] duplicate_of target ${targetId} cannot carry supersedes or superseded_by metadata`);
    }
  }

  // The direct-target error above catches every cycle edge. This additional
  // walk names each cycle once, making the invalid graph clear to publishers.
  const reportedCycles = new Set();
  for (const start of facts) {
    if (!start || typeof start !== 'object' || typeof start.id !== 'string' || typeof start.duplicate_of !== 'string') continue;
    const path = [];
    const position = new Map();
    let current = start.id;
    while (current !== undefined) {
      if (position.has(current)) {
        const cycle = path.slice(position.get(current)).concat(current);
        const key = cycle.slice(0, -1).slice().sort().join('\u0000');
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          errors.push(`duplicate_of cycle detected: ${cycle.join(' -> ')}`);
        }
        break;
      }
      position.set(current, path.length);
      path.push(current);
      const fact = factsById.get(current);
      const next = fact?.duplicate_of;
      if (typeof next !== 'string' || !factsById.has(next)) break;
      current = next;
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// CLI entrypoint — guarded (isMain, below) so checkSupersession can be
// imported for unit tests (pipeline/validate_pack.test.mjs) without reading
// files off disk or exiting the process.
// ---------------------------------------------------------------------------
function main(packPathArg) {
  const schemaPath = resolve(root, 'app/src/packs/pack.schema.json');
  const packPath = resolve(root, packPathArg || 'packs/vc-law/pack.json');

  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const pack = JSON.parse(readFileSync(packPath, 'utf8'));

  const errors = [];
  const push = (m) => errors.push(m);

  // 1) JSON Schema gate (identical config to the engine validator)
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(pack)) {
    for (const e of validate.errors) push(`schema ${e.instancePath || '/'} ${e.message}`);
  }

  // 2) Content cross-checks
  const factIds = new Set();
  for (const f of pack.facts ?? []) {
    if (factIds.has(f.id)) push(`duplicate fact id: ${f.id}`);
    factIds.add(f.id);
  }
  const encIds = new Set();
  const kinds = new Set();
  const uniq = (a) => new Set(a).size === a.length;

  for (const e of pack.encounters ?? []) {
    if (encIds.has(e.id)) push(`duplicate encounter id: ${e.id}`);
    encIds.add(e.id);
    kinds.add(e.kind);

    for (const fid of e.fact_ids ?? []) {
      if (!factIds.has(fid)) push(`[${e.id}] references unknown fact_id: ${fid}`);
    }

    // template-var coverage: every {{x}} in the prompt must be defined
    const vars = new Set(Object.keys(e.template_vars ?? {}));
    for (const m of (e.prompt ?? '').matchAll(/\{\{(\w+)\}\}/g)) {
      if (!vars.has(m[1])) push(`[${e.id}] prompt uses {{${m[1]}}} but template_vars has no '${m[1]}'`);
    }

    if (e.kind === 'mcq') {
      if (!Array.isArray(e.options) || !e.options.includes(e.answer)) {
        push(`[${e.id}] mcq answer is not one of options`);
      }
    } else if (e.kind === 'order') {
      const o = e.options ?? [], a = e.answer ?? [];
      if (!Array.isArray(a) || a.length !== o.length || !uniq(a) ||
          [...o].sort().join(' ') !== [...a].sort().join(' ')) {
        push(`[${e.id}] order answer must be a permutation of options`);
      }
    } else if (e.kind === 'match') {
      const cols = e.options, a = e.answer;
      if (!Array.isArray(cols) || cols.length !== 2 || !Array.isArray(a)) {
        push(`[${e.id}] match options must be [colA, colB] and answer an array of pairs`);
      } else {
        const [left, right] = cols;
        if (!Array.isArray(left) || !Array.isArray(right)) {
          push(`[${e.id}] match options[0] and options[1] must both be arrays`);
        } else {
          if (a.length !== left.length) push(`[${e.id}] match answer count != left column count`);
          for (const pair of a) {
            if (!Array.isArray(pair) || pair.length !== 2 ||
                !left.includes(pair[0]) || !right.includes(pair[1])) {
              push(`[${e.id}] match pair not drawn from the two columns: ${JSON.stringify(pair)}`);
            }
          }
        }
      }
    } else if (e.kind === 'free_recall') {
      if (typeof e.rubric !== 'string' || e.rubric.trim().length < 10) {
        push(`[${e.id}] free_recall needs a non-empty string rubric`);
      }
    } else if (e.kind === 'scenario_branch') {
      const b = e.branches ?? [];
      if (b.length < 2) push(`[${e.id}] scenario_branch needs >=2 branches`);
      if (!b.some((x) => x.correct === true)) push(`[${e.id}] scenario_branch has no correct branch`);
    }
  }

  for (const q of pack.quests ?? []) {
    for (const eid of q.encounter_ids ?? []) {
      if (!encIds.has(eid)) push(`[${q.id}] references unknown encounter_id: ${eid}`);
    }
  }

  // 3) Supersession checks (vision §3b / §9.3 — schema + validator layer only)
  const supersession = checkSupersession(pack);
  for (const e of supersession.errors) push(e);
  const warnings = supersession.warnings;

  // 4) Durable duplicate checks (pack-local, direct canonical links).
  for (const e of checkDuplicateAliases(pack)) push(e);

  // 5) Goal-2 thresholds
  const nFacts = (pack.facts ?? []).length;
  const nEnc = (pack.encounters ?? []).length;
  if (nFacts < 30) push(`need >=30 facts, have ${nFacts}`);
  if (nEnc < 40) push(`need >=40 encounters, have ${nEnc}`);
  for (const k of ['mcq', 'free_recall', 'scenario_branch', 'match', 'order']) {
    if (!kinds.has(k)) push(`missing encounter kind: ${k}`);
  }

  // Report
  console.log(`Validated ${packPath}`);
  console.log(`  facts: ${nFacts} | encounters: ${nEnc} | kinds: ${[...kinds].sort().join(', ')}`);
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.log('  !', w);
  }
  if (errors.length) {
    console.log(`\n${errors.length} problem(s):`);
    for (const e of errors) console.log('  -', e);
    console.log('\nPACK VALIDATION FAILED');
    process.exit(1);
  }
  console.log('\nAll pack checks passed.');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv[2]);
}
