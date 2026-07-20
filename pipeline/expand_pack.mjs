#!/usr/bin/env node
// expand_pack.mjs — the `expand` verb (Fable_SPEC.md §5): given a pack + its raw
// sources, propose ADDITIVE expansion. Existing fact ids, statements, and
// encounter ids are immutable — this script only ever ADDS. It never writes
// packs/ directly: drafts land in staging/expand/<pack>-<timestamp>/ as a
// reviewable proposal (proposal.json + report.md); a human (or a later reviewed
// merge step) promotes them into pack.json.
//
// Pipeline (this run):
//   1. Coverage analysis — which raw chapters are under-mined, which
//      per-topic-cluster encounter kinds are thin (the pack skews mcq-heavy),
//      which facts have zero encounters.
//   2. Candidate generation — for the N weakest gaps, draft facts (verbatim
//      source_ref quotes, checkable the same way validate_quotes.py checks
//      them) and encounters (correct kind mix; rubrics for free_recall) via
//      `claude -p` with strict-JSON prompts. MCP-stripped, timeout-capped —
//      same spawn shape as app/vite-judge-plugin.ts's runClaude(). Every draft
//      is locally validated (mirrors validate_pack.mjs's per-kind checks +
//      validate_quotes.py's normalize/verbatim check) before it's accepted;
//      one corrective retry, then reject-and-log.
//   3. --check — build a hypothetical merged pack (current + accepted drafts)
//      and run the REAL validate_pack.mjs + validate_quotes.py against it,
//      plus an id-immutability check (no existing fact/encounter id touched).
//      Generate mode runs this automatically at the end; `--check <run-dir>`
//      also re-runs it standalone against a previously-generated proposal.
//
// Usage:
//   node pipeline/expand_pack.mjs [--pack-dir packs/vc-law] [--raw-dir raw/vc-law]
//                                 [-n 5] [--model sonnet] [--timeout-ms 120000]
//   node pipeline/expand_pack.mjs --coverage-only [--pack-dir ...] [--raw-dir ...]
//   node pipeline/expand_pack.mjs --check [<staging/expand/run-dir>]
//
// No API keys: every LLM call shells the subscription `claude` CLI, exactly
// the way app/vite-judge-plugin.ts already does for the Clerk.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ============================================================================
// Constants
// ============================================================================

export const VALID_FACT_TYPES = new Set(['rule', 'concept', 'advice', 'do', 'dont', 'number', 'story']);
export const VALID_KINDS = new Set(['mcq', 'free_recall', 'scenario_branch', 'match', 'order']);
export const KIND_ABBR = { mcq: 'mcq', free_recall: 'fr', scenario_branch: 'sb', match: 'match', order: 'order' };
// Same convention validate_quotes.py already hardcodes for this pack (vc.econ.<topic>.<slug>).
export const FACT_ID_RE = /^vc\.econ\.[a-z0-9]+(\.[a-z0-9-]+)+$/;
// Priority when several kinds tie for "thinnest" in a cluster — favors correcting
// the pack-wide mcq-heavy skew (match/order are globally the thinnest kinds).
const KIND_PRIORITY = ['match', 'order', 'free_recall', 'scenario_branch', 'mcq'];

const KIND_CONTRACT = {
  mcq: `"options": array of exactly 4 short distinct strings; "answer": must equal one of "options" byte-for-byte.`,
  free_recall: `"rubric": a string (>=10 characters) stating exactly what earns full vs partial vs no credit. Do not include "options" or "answer".`,
  scenario_branch: `"branches": array of >=2 objects {"label","outcome","correct"}; EXACTLY ONE branch has "correct": true.`,
  match: `"options": a 2-element array [colA, colB], each a list of strings, both lists the SAME length (>=2 pairs); "answer": array of [colA_item, colB_item] pairs — one pair per colA item, values copied EXACTLY from the two columns.`,
  order: `"options": array of >=3 strings, listed in SHUFFLED (not-yet-correct) order; "answer": the same items reordered into the correct sequence (a permutation of "options").`,
};

// ============================================================================
// Pure helpers — quote verification (mirrors validate_quotes.py's normalize())
// ============================================================================

const QUOTE_FOLD = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"',
  'ʼ': "'", '´': "'", '`': "'",
};

/** Same normalization as pipeline/validate_quotes.py's normalize(): fold curly
 *  quotes/apostrophes to straight, collapse whitespace runs, strip. Used for a
 *  fast local pre-check during generation; the authoritative gate in --check
 *  mode is the real Python script run as a subprocess against the merged pack. */
export function normalizeQuote(text) {
  let out = '';
  for (const ch of String(text ?? '')) out += QUOTE_FOLD[ch] ?? ch;
  return out.replace(/\s+/g, ' ').trim();
}

export function quoteAppearsIn(quote, sourceText) {
  const q = normalizeQuote(quote);
  if (!q) return false;
  return normalizeQuote(sourceText).includes(q);
}

// ============================================================================
// Pure helpers — coverage analysis
// ============================================================================

export function defaultTopicOf(id) {
  return String(id).split('.').slice(0, -1).join('.');
}

/**
 * Coverage analysis (pure — pass in the pack and pre-read raw docs).
 *   - chapterGaps: raw files (filtered by isTeachingFile) ranked by
 *     wordCount / (factCount + 1) — big, unmined files rank first.
 *   - kindSkew: per fact-cluster (grouped by topicOf(fact.id)) encounter-kind
 *     counts, with the single thinnest kind picked as targetKind (ties broken
 *     toward match/order — the pack's globally thinnest kinds — but match/order
 *     are only eligible when the cluster has >=3 facts to draw on).
 *   - zeroEncounterFacts: facts referenced by zero encounters.
 */
export function analyzeCoverage({ pack, rawDocs, isTeachingFile = () => true, topicOf = defaultTopicOf }) {
  const facts = pack.facts ?? [];
  const encounters = pack.encounters ?? [];

  const factCountByFile = new Map();
  for (const f of facts) {
    const file = f.source_ref?.file;
    if (!file) continue;
    factCountByFile.set(file, (factCountByFile.get(file) ?? 0) + 1);
  }
  const chapterGaps = rawDocs
    .filter((d) => isTeachingFile(d.file))
    .map((d) => {
      const wordCount = (d.text.match(/\S+/g) ?? []).length;
      const factCount = factCountByFile.get(d.file) ?? 0;
      return { file: d.file, wordCount, factCount, score: wordCount / (factCount + 1) };
    })
    .sort((a, b) => b.score - a.score);

  const factById = new Map(facts.map((f) => [f.id, f]));
  const clusterFacts = new Map();
  for (const f of facts) {
    const topic = topicOf(f.id);
    if (!clusterFacts.has(topic)) clusterFacts.set(topic, []);
    clusterFacts.get(topic).push(f);
  }

  const emptyCounts = () => ({ mcq: 0, free_recall: 0, scenario_branch: 0, match: 0, order: 0 });
  const kindCountByCluster = new Map();
  const globalKindCounts = emptyCounts();
  for (const e of encounters) {
    if (globalKindCounts[e.kind] === undefined) continue;
    globalKindCounts[e.kind]++;
    const topics = new Set(
      (e.fact_ids ?? [])
        .map((fid) => factById.get(fid))
        .filter(Boolean)
        .map((f) => topicOf(f.id)),
    );
    for (const t of topics) {
      if (!kindCountByCluster.has(t)) kindCountByCluster.set(t, emptyCounts());
      kindCountByCluster.get(t)[e.kind]++;
    }
  }

  const kindSkew = [];
  for (const [topic, tFacts] of clusterFacts) {
    const counts = kindCountByCluster.get(topic) ?? emptyCounts();
    let targetKind = null;
    for (const k of KIND_PRIORITY) {
      const needsMulti = k === 'match' || k === 'order';
      if (needsMulti && tFacts.length < 3) continue;
      if (targetKind === null || counts[k] < counts[targetKind]) targetKind = k;
    }
    if (!targetKind) targetKind = 'mcq'; // always satisfiable (needs only 1 fact)
    const spread = Math.max(...Object.values(counts)) - counts[targetKind];
    kindSkew.push({
      topic,
      factCount: tFacts.length,
      counts,
      targetKind,
      gapSize: spread,
      facts: tFacts.slice(0, 4).map((f) => ({ id: f.id, statement: f.statement, detail: f.detail })),
    });
  }
  kindSkew.sort((a, b) => b.gapSize - a.gapSize || b.factCount - a.factCount);

  const referenced = new Set();
  for (const e of encounters) for (const fid of e.fact_ids ?? []) referenced.add(fid);
  const zeroEncounterFacts = facts
    .filter((f) => !referenced.has(f.id))
    .map((f) => ({ factId: f.id, facts: [{ id: f.id, statement: f.statement, detail: f.detail }] }));

  return { chapterGaps, kindSkew, zeroEncounterFacts, globalKindCounts };
}

/** Round-robin interleave of the three gap pools (zero-encounter facts first —
 *  an unreachable fact is the most severe gap — then chapter gaps, then kind
 *  skew), until `n` candidates are picked or every pool is exhausted. Pure —
 *  the encounter kind for 'chapter' candidates is assigned separately by
 *  assignKinds() so this function needs no running state. */
export function pickCandidates(coverage, n) {
  const pools = {
    zero_encounter: coverage.zeroEncounterFacts.map((z) => ({ type: 'zero_encounter', factId: z.factId, facts: z.facts })),
    chapter: coverage.chapterGaps.map((g) => ({ type: 'chapter', file: g.file, wordCount: g.wordCount, factCount: g.factCount })),
    kind_skew: coverage.kindSkew.map((k) => ({ type: 'kind_skew', topic: k.topic, targetKind: k.targetKind, facts: k.facts })),
  };
  const order = ['zero_encounter', 'chapter', 'kind_skew'];
  const idx = { zero_encounter: 0, chapter: 0, kind_skew: 0 };
  const picked = [];
  while (picked.length < n) {
    let progressed = false;
    for (const key of order) {
      if (picked.length >= n) break;
      if (idx[key] < pools[key].length) {
        picked.push(pools[key][idx[key]]);
        idx[key]++;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return picked;
}

/** Assigns the encounter kind to draft for each candidate. 'kind_skew' and
 *  'zero_encounter' candidates already carry a targetKind computed from real
 *  per-cluster counts; 'chapter' candidates (a brand-new, still-uncreated fact)
 *  get a greedy pick among the single-fact-friendly kinds — free_recall,
 *  scenario_branch, mcq (never match/order, which need multiple facts) — biased
 *  toward whichever is least-represented so-far in THIS run, so a batch of
 *  chapter candidates doesn't just pile up more mcq (the pack's existing skew).
 *  Pure: `initialKindCounts` is the pack's current global counts; a local copy
 *  is threaded through the map, never mutating the input. */
export function assignKinds(candidates, initialKindCounts) {
  const counts = { ...initialKindCounts };
  return candidates.map((c) => {
    if (c.type !== 'chapter') return { ...c, kind: c.targetKind };
    const eligible = ['free_recall', 'scenario_branch', 'mcq'];
    eligible.sort((a, b) => (counts[a] ?? 0) - (counts[b] ?? 0));
    const kind = eligible[0];
    counts[kind] = (counts[kind] ?? 0) + 1;
    return { ...c, kind };
  });
}

// ============================================================================
// Pure helpers — source text chunking
// ============================================================================

/** Derive a human loc prefix ("Chapter 6" / "Introduction" / "Appendix A")
 *  from a raw filename, matching the book's own numbering. */
export function chapterLabel(file) {
  const base = basename(file);
  let m = base.match(/chapter-(\d+)/i);
  if (m) return `Chapter ${m[1]}`;
  m = base.match(/appendix-([a-d])-/i);
  if (m) return `Appendix ${m[1].toUpperCase()}`;
  if (/introduction/i.test(base)) return 'Introduction';
  return base.replace(/^\d+-/, '').replace(/\.md$/, '').replace(/-/g, ' ');
}

/** Split markdown on H1/H2 headings (H3+ stays with its enclosing section) into
 *  [{heading, text}]. Text spans are unmodified substrings of the input, so any
 *  quote drawn from a returned span remains a verbatim substring of the
 *  original file. */
export function splitSections(text) {
  const lines = text.split('\n');
  const sections = [];
  let current = { heading: null, body: [] };
  for (const line of lines) {
    if (/^#{1,2}\s+/.test(line)) {
      if (current.body.length) sections.push(current);
      current = { heading: line.replace(/^#{1,2}\s+/, '').trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.length) sections.push(current);
  return sections.map((s) => ({ heading: s.heading, text: s.body.join('\n').trim() })).filter((s) => s.text.length > 0);
}

/** Picks the largest section (most content to mine) as the excerpt to hand the
 *  LLM, capped to maxChars (a substring, so still verbatim-checkable). */
export function pickExcerpt(text, maxChars = 7000) {
  const sections = splitSections(text);
  const nonTrivial = sections.filter((s) => s.text.length > 200);
  const pool = nonTrivial.length ? nonTrivial : sections.length ? sections : [{ heading: null, text }];
  const largest = pool.reduce((a, b) => (b.text.length > a.text.length ? b : a), pool[0]);
  return { heading: largest.heading, text: largest.text.slice(0, maxChars) };
}

/** Picks the source_version for a new fact by matching which raw/<pack>/<bucket>/
 *  subdirectory the file lives under against each meta.sources[].file entry's own
 *  bucket. Trivial (and today, always sources[0]) while vc-law has one source; once
 *  NVCA docs get their own sources[] entry (see raw/vc-law/INTAKE.md) whose `file`
 *  points into that same bucket, this starts resolving correctly with no code change. */
export function resolveSourceVersion(pack, rawFile) {
  const sources = pack.meta?.sources ?? [];
  if (sources.length <= 1) return sources[0]?.version ?? 'unknown';
  const bucket = rawFile.split('/')[2]; // raw/<pack>/<bucket>/...
  const hit = sources.find((s) => (s.file ?? '').includes(`/${bucket}/`) || (s.id ?? '').includes(bucket));
  return (hit ?? sources[0]).version;
}

// ============================================================================
// Pure helpers — draft validation (mirrors validate_pack.mjs / validate_quotes.py)
// ============================================================================

/** Structural + convention checks for one draft fact, mirroring
 *  validate_quotes.py's per-fact checks (id pattern, enum, difficulty range,
 *  lowercase tags, prereq resolution, self-prereq). Does NOT check the quote
 *  against source text — that's quoteAppearsIn(), called separately since it
 *  needs the source file text. `knownIds` = existing pack fact ids ∪ ids
 *  already accepted earlier in this same run. */
export function validateDraftFact(fact, { knownIds }) {
  const errors = [];
  if (!fact || typeof fact !== 'object') return ['fact is not an object'];
  for (const key of ['id', 'type', 'statement', 'detail', 'source_ref', 'as_of', 'source_version', 'tags', 'difficulty']) {
    const v = fact[key];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && key !== 'tags' && v.length === 0)) {
      errors.push(`fact missing/empty '${key}'`);
    }
  }
  if (typeof fact.id === 'string') {
    if (!FACT_ID_RE.test(fact.id)) errors.push(`fact id not well-formed (want vc.econ.<topic>.<slug>): ${fact.id}`);
    if (knownIds.has(fact.id)) errors.push(`fact id already in use: ${fact.id}`);
  }
  if (!VALID_FACT_TYPES.has(fact.type)) errors.push(`invalid fact type: ${fact.type}`);
  if (!(Number.isInteger(fact.difficulty) && fact.difficulty >= 1 && fact.difficulty <= 5)) {
    errors.push(`difficulty not int 1-5: ${JSON.stringify(fact.difficulty)}`);
  }
  if (!(Array.isArray(fact.tags) && fact.tags.length > 0 && fact.tags.every((t) => typeof t === 'string' && t === t.toLowerCase()))) {
    errors.push(`tags must be a non-empty array of lowercase strings: ${JSON.stringify(fact.tags)}`);
  }
  for (const p of fact.prereqs ?? []) {
    if (p === fact.id) errors.push('fact lists itself as a prereq');
    else if (!knownIds.has(p)) errors.push(`prereq does not resolve: ${p}`);
  }
  const sr = fact.source_ref ?? {};
  if (!sr.file || !sr.loc || !sr.quote) errors.push('source_ref missing file/loc/quote');
  return errors;
}

/** Structural checks for one draft encounter — the SAME per-kind rules
 *  pipeline/validate_pack.mjs enforces (mcq answer in options; order answer a
 *  permutation; match pairs drawn from the two columns; free_recall rubric
 *  >=10 chars; scenario_branch >=2 branches with a correct one; every
 *  {{template_var}} defined) so a draft that passes here is expected to pass
 *  the real validator too. */
export function validateDraftEncounter(enc, { knownFactIds, knownEncIds = new Set() }) {
  const errors = [];
  if (!enc || typeof enc !== 'object') return ['encounter is not an object'];
  if (!enc.id) errors.push('encounter missing id');
  else if (knownEncIds.has(enc.id)) errors.push(`encounter id already in use: ${enc.id}`);
  if (!VALID_KINDS.has(enc.kind)) errors.push(`invalid encounter kind: ${enc.kind}`);
  if (!Array.isArray(enc.fact_ids) || enc.fact_ids.length === 0) {
    errors.push('fact_ids must be a non-empty array');
  } else {
    for (const fid of enc.fact_ids) if (!knownFactIds.has(fid)) errors.push(`fact_ids references unknown fact: ${fid}`);
  }
  if (typeof enc.prompt !== 'string' || !enc.prompt.trim()) errors.push('prompt must be a non-empty string');

  const vars = new Set(Object.keys(enc.template_vars ?? {}));
  for (const m of String(enc.prompt ?? '').matchAll(/\{\{(\w+)\}\}/g)) {
    if (!vars.has(m[1])) errors.push(`prompt uses {{${m[1]}}} but template_vars has no '${m[1]}'`);
  }

  const uniq = (arr) => new Set(arr).size === arr.length;
  if (enc.kind === 'mcq') {
    if (!Array.isArray(enc.options) || !enc.options.includes(enc.answer)) errors.push('mcq answer is not one of options');
  } else if (enc.kind === 'order') {
    const o = enc.options ?? [], a = enc.answer ?? [];
    if (!Array.isArray(a) || a.length !== o.length || !uniq(a) || [...o].sort().join(' ') !== [...a].sort().join(' ')) {
      errors.push('order answer must be a permutation of options');
    }
  } else if (enc.kind === 'match') {
    const cols = enc.options, a = enc.answer;
    if (!Array.isArray(cols) || cols.length !== 2 || !Array.isArray(a)) {
      errors.push('match options must be [colA, colB] and answer an array of pairs');
    } else {
      const [left, right] = cols;
      if (!Array.isArray(left) || !Array.isArray(right) || a.length !== left.length) {
        errors.push('match answer count != left column count');
      }
      for (const pair of a) {
        if (!Array.isArray(pair) || pair.length !== 2 || !left?.includes(pair[0]) || !right?.includes(pair[1])) {
          errors.push(`match pair not drawn from the two columns: ${JSON.stringify(pair)}`);
        }
      }
    }
  } else if (enc.kind === 'free_recall') {
    if (typeof enc.rubric !== 'string' || enc.rubric.trim().length < 10) errors.push('free_recall needs a non-empty string rubric (>=10 chars)');
  } else if (enc.kind === 'scenario_branch') {
    const b = enc.branches ?? [];
    if (!Array.isArray(b) || b.length < 2) errors.push('scenario_branch needs >=2 branches');
    else if (!b.some((x) => x?.correct === true)) errors.push('scenario_branch has no correct branch');
  }
  return errors;
}

/**
 * The additive-expansion gate: given the pack BEFORE expansion and a candidate
 * MERGED pack (current + drafts), verify:
 *   - every existing fact/encounter id is still present, byte-identical;
 *   - meta/quests/npcs/metaphor_map are untouched;
 *   - no duplicate id anywhere in the merged facts/encounters arrays (which
 *     transitively also catches a draft id colliding with an existing one,
 *     since that would show up as the SAME id appearing twice).
 * Pure — no I/O, so this is testable with plain fixtures.
 */
export function checkIdImmutability(originalPack, mergedPack) {
  const errors = [];

  const checkList = (origList, mergedList, label) => {
    const origById = new Map((origList ?? []).map((x) => [x.id, x]));
    const mergedById = new Map();
    for (const item of mergedList ?? []) {
      if (mergedById.has(item.id)) errors.push(`duplicate ${label} id in merged pack: ${item.id}`);
      mergedById.set(item.id, item);
    }
    for (const [id, orig] of origById) {
      if (!mergedById.has(id)) {
        errors.push(`existing ${label} missing from merged pack: ${id}`);
      } else if (JSON.stringify(mergedById.get(id)) !== JSON.stringify(orig)) {
        errors.push(`existing ${label} mutated: ${id}`);
      }
    }
  };

  checkList(originalPack.facts, mergedPack.facts, 'fact');
  checkList(originalPack.encounters, mergedPack.encounters, 'encounter');

  for (const key of ['meta', 'quests', 'npcs', 'metaphor_map']) {
    if (JSON.stringify(originalPack[key]) !== JSON.stringify(mergedPack[key])) {
      errors.push(`pack.${key} changed — expand must never touch this section`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function buildMergedPack(currentPack, draftFacts, draftEncounters) {
  return {
    ...currentPack,
    facts: [...(currentPack.facts ?? []), ...draftFacts],
    encounters: [...(currentPack.encounters ?? []), ...draftEncounters],
  };
}

// ============================================================================
// LLM plumbing — claude -p, MCP-stripped, timeout-capped (mirrors
// app/vite-judge-plugin.ts's runClaude(); see that file for measured latency
// notes on this exact spawn shape).
// ============================================================================

/** Extract the first balanced {...} object from arbitrary text (tolerates a
 *  ```json fence or stray prose around it). Same algorithm as
 *  app/vite-judge-plugin.ts's firstJsonObject, reimplemented here since
 *  pipeline/ must not import from app/ (engine/content split). */
export function firstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function runClaude(prompt, { model, timeoutMs }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      'claude',
      ['-p', prompt, '--model', model, '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'],
      { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    );
    let out = '', err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude -p timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolvePromise(out);
      else reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
    });
  });
}

// ============================================================================
// Prompt building
// ============================================================================

function buildChapterPrompt(candidate, ctx) {
  const { file, excerpt, heading, kind } = candidate;
  const label = chapterLabel(file);
  const example = ctx.exampleByKind.get(kind);
  const existingIdsSample = [...ctx.existingFactIds].slice(0, 40);
  return [
    `You are drafting ADDITIVE content for "${ctx.pack.meta.title}" (Fablewood, a knowledge-retention RPG's VC-law province).`,
    `Extract exactly ONE new atomic fact from the SOURCE_EXCERPT below, plus ONE new encounter of kind "${kind}" that drills it.`,
    '',
    'Respond with STRICT JSON only — no prose, no markdown fence, no preamble:',
    '{',
    '  "fact": {',
    '    "id": "vc.econ.<topic>.<slug>",',
    '    "type": "rule"|"concept"|"advice"|"do"|"dont"|"number"|"story",',
    '    "statement": "<one crisp, self-contained sentence>",',
    '    "detail": "<1-3 sentences of elaborating context, example, or number>",',
    '    "quote": "<a VERBATIM contiguous substring of SOURCE_EXCERPT — copy exactly, do not paraphrase or fix punctuation>",',
    '    "tags": ["lowercase-tag", "..."],',
    '    "difficulty": "<integer 1-5>",',
    '    "prereqs": []',
    '  },',
    '  "encounter": {',
    `    "id": "enc.${KIND_ABBR[kind]}.<slug>",`,
    `    "kind": "${kind}",`,
    '    "prompt": "...",',
    '    ... kind-specific fields, see KIND_CONTRACT below ...',
    '    "trap_notes": "<optional — why wrong answers are tempting>"',
    '  }',
    '}',
    '',
    '"topic" = a short lowercase subject cluster, letters/digits only (new or matching an existing one, e.g. "control", "negotiation"); "slug" = short kebab-case.',
    'The fact "id" MUST match exactly: vc.econ.<topic>.<slug> (e.g. "vc.econ.control.board-size").',
    '',
    `KIND_CONTRACT for "${kind}": ${KIND_CONTRACT[kind]}`,
    '',
    example ? `WORKED EXAMPLE (same kind, a DIFFERENT existing fact — JSON shape reference only, do not reuse its content):\n${JSON.stringify(example, null, 2)}` : '',
    '',
    existingIdsSample.length
      ? `EXISTING_FACT_IDS (optional — use only if a prereq genuinely applies to your new fact; otherwise leave prereqs empty; do not invent ids not in this list):\n${existingIdsSample.join(', ')}`
      : '',
    '',
    `SOURCE_FILE: ${file}`,
    `SOURCE_EXCERPT (section: "${heading ?? label}"):`,
    '"""',
    excerpt,
    '"""',
  ].filter((l) => l !== '').join('\n');
}

function buildEncounterOnlyPrompt(candidate, ctx) {
  const { kind, facts } = candidate;
  const example = ctx.exampleByKind.get(kind);
  return [
    `You are drafting ONE new encounter (ADDITIVE — no new facts) for "${ctx.pack.meta.title}" (Fablewood, a knowledge-retention RPG's VC-law province).`,
    `This drills an EXISTING cluster of facts that currently has too few "${kind}" encounters.`,
    '',
    'Respond with STRICT JSON only — no prose, no markdown fence, no preamble:',
    '{',
    '  "encounter": {',
    `    "id": "enc.${KIND_ABBR[kind]}.<slug>",`,
    `    "kind": "${kind}",`,
    '    "prompt": "...",',
    '    ... kind-specific fields, see KIND_CONTRACT below ...',
    '    "trap_notes": "<optional>"',
    '  }',
    '}',
    '',
    'Do NOT include "fact_ids" — the caller sets it to the exact FACTS_TO_DRILL ids below. "slug" = short kebab-case.',
    '',
    `KIND_CONTRACT for "${kind}": ${KIND_CONTRACT[kind]}`,
    '',
    example ? `WORKED EXAMPLE (same kind, a DIFFERENT fact cluster — JSON shape reference only):\n${JSON.stringify(example, null, 2)}` : '',
    '',
    'FACTS_TO_DRILL (in this order):',
    facts.map((f) => `- ${f.id}: ${f.statement}${f.detail ? ` (${f.detail})` : ''}`).join('\n'),
  ].filter((l) => l !== '').join('\n');
}

function buildRetryPrompt(originalPrompt, lastRaw, errors) {
  return [
    originalPrompt,
    '',
    '---',
    'Your previous response was:',
    lastRaw || '(no response — the call failed in transit)',
    '',
    'That response had these problems:',
    ...errors.map((e) => `- ${e}`),
    '',
    'Respond again with a corrected STRICT JSON object only — no prose, no markdown fence.',
  ].join('\n');
}

function normalizeAndValidate(parsed, candidate, ctx) {
  const errors = [];
  let fact = null;

  if (candidate.type === 'chapter') {
    const f = parsed?.fact;
    if (!f || typeof f !== 'object') {
      errors.push('missing "fact" object');
    } else {
      fact = {
        id: f.id,
        type: f.type,
        statement: f.statement,
        detail: f.detail,
        source_ref: {
          file: candidate.file,
          loc: candidate.heading ? `${chapterLabel(candidate.file)} > ${candidate.heading}` : chapterLabel(candidate.file),
          quote: f.quote,
        },
        as_of: ctx.today,
        source_version: candidate.sourceVersion,
        tags: f.tags,
        difficulty: f.difficulty,
        prereqs: Array.isArray(f.prereqs) ? f.prereqs : [],
      };
      const knownIds = new Set([...ctx.existingFactIds, ...ctx.draftFactIdsSoFar]);
      errors.push(...validateDraftFact(fact, { knownIds }));
      if (f.quote && !quoteAppearsIn(f.quote, candidate.fileText)) {
        errors.push(`quote not found verbatim in ${candidate.file} (normalized whitespace/curly-quote check)`);
      }
    }
  }

  let encounter = null;
  const e = parsed?.encounter;
  if (!e || typeof e !== 'object') {
    errors.push('missing "encounter" object');
  } else {
    const fact_ids = candidate.type === 'chapter' ? (fact?.id ? [fact.id] : []) : candidate.facts.map((x) => x.id);
    encounter = {
      id: e.id,
      fact_ids,
      kind: candidate.kind,
      ...(e.template_vars !== undefined ? { template_vars: e.template_vars } : {}),
      prompt: e.prompt,
      ...(e.options !== undefined ? { options: e.options } : {}),
      ...(e.branches !== undefined ? { branches: e.branches } : {}),
      ...(e.answer !== undefined ? { answer: e.answer } : {}),
      ...(e.rubric !== undefined ? { rubric: e.rubric } : {}),
      ...(e.trap_notes !== undefined ? { trap_notes: e.trap_notes } : {}),
    };
    const knownFactIds = new Set([...ctx.existingFactIds, ...ctx.draftFactIdsSoFar, ...(fact?.id ? [fact.id] : [])]);
    const knownEncIds = new Set([...ctx.existingEncounterIds, ...ctx.draftEncounterIdsSoFar]);
    errors.push(...validateDraftEncounter(encounter, { knownFactIds, knownEncIds }));
  }

  return { fact, encounter, errors };
}

async function generateDraft(candidate, ctx) {
  const prompt = candidate.type === 'chapter' ? buildChapterPrompt(candidate, ctx) : buildEncounterOnlyPrompt(candidate, ctx);
  let lastRaw = '';
  let errors = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const fullPrompt = attempt === 0 ? prompt : buildRetryPrompt(prompt, lastRaw, errors);
    let raw;
    try {
      raw = await runClaude(fullPrompt, { model: ctx.model, timeoutMs: ctx.timeoutMs });
    } catch (e) {
      errors = [`claude -p call failed: ${e.message}`];
      lastRaw = '';
      continue;
    }
    lastRaw = raw;
    const jsonText = firstJsonObject(raw);
    if (!jsonText) {
      errors = ['no JSON object found in response'];
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      errors = [`JSON.parse failed: ${e.message}`];
      continue;
    }
    const result = normalizeAndValidate(parsed, candidate, ctx);
    if (result.errors.length === 0) {
      return { accepted: true, candidate, fact: result.fact, encounter: result.encounter, attempts: attempt + 1 };
    }
    errors = result.errors;
  }
  return { accepted: false, candidate, reason: errors.join('; '), attempts: 2 };
}

// ============================================================================
// CLI plumbing
// ============================================================================

function parseArgs(argv) {
  const opts = {
    packDir: 'packs/vc-law',
    rawDir: 'raw/vc-law',
    count: 5,
    model: 'sonnet',
    timeoutMs: 120_000,
    check: false,
    checkDir: null,
    coverageOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pack-dir') opts.packDir = argv[++i];
    else if (a === '--raw-dir') opts.rawDir = argv[++i];
    else if (a === '-n' || a === '--count') opts.count = parseInt(argv[++i], 10);
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--timeout-ms') opts.timeoutMs = parseInt(argv[++i], 10);
    else if (a === '--coverage-only') opts.coverageOnly = true;
    else if (a === '--check') {
      opts.check = true;
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) opts.checkDir = argv[++i];
    }
  }
  return opts;
}

function walkMd(absDir) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && p.endsWith('.md')) out.push(p);
    }
  };
  walk(absDir);
  return out.sort();
}

/** vc-law-specific eligibility rule for "teaching content" raw files — chapters,
 *  the introduction, and appendices A-C (a real sample term sheet + Foundry
 *  Group term sheet + sample LOI: prime, un-mined source material). Excludes
 *  forewords/preface/acknowledgments/author bios/EULA/glossary/index/the
 *  bundled Startup Communities excerpt — book apparatus, not this source's own
 *  teaching content. Mirrors the scoping extract-run-1.md already used for the
 *  pack's first extraction pass (Introduction + Chapters only); kept here as a
 *  CLI-layer predicate so the pure analyzeCoverage() stays pack-agnostic. */
function vcLawTeachingFile(file) {
  // The book-md/ bucket mixes real chapters with book apparatus (forewords,
  // glossary, index, EULA, ...), so it needs the filename allowlist below. Any
  // OTHER bucket under raw/vc-law/ (e.g. a future nvca/ drop per INTAKE.md) has
  // no such front/back-matter mixed in — every file there is presumptively real
  // source material, so it's eligible by default.
  if (!file.includes('/book-md/')) return true;
  const base = basename(file);
  return /chapter-\d+/i.test(base) || /introduction-the-art-of-the-term-sheet/i.test(base) || /appendix-[abc]-/i.test(base);
}

function loadPack(packDir) {
  return JSON.parse(readFileSync(resolve(root, packDir, 'pack.json'), 'utf8'));
}

function loadRawDocs(rawDir) {
  const absDir = resolve(root, rawDir);
  return walkMd(absDir).map((abs) => ({ file: relative(root, abs), text: readFileSync(abs, 'utf8') }));
}

function buildExampleByKind(pack) {
  const map = new Map();
  for (const e of pack.encounters ?? []) {
    if (!map.has(e.kind)) map.set(e.kind, e);
  }
  return map;
}

function runValidatorSubprocess(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function runFullCheck({ currentPack, draftFacts, draftEncounters, runDir }) {
  const merged = buildMergedPack(currentPack, draftFacts, draftEncounters);
  const mergedPath = join(runDir, 'merged.preview.pack.json');
  writeFileSync(mergedPath, JSON.stringify(merged, null, 2) + '\n');

  const packCheck = runValidatorSubprocess('node', [resolve(root, 'pipeline/validate_pack.mjs'), mergedPath]);
  const quoteCheck = runValidatorSubprocess('python3', [resolve(root, 'pipeline/validate_quotes.py'), mergedPath, `--root=${root}`]);
  const idCheck = checkIdImmutability(currentPack, merged);

  const ok = packCheck.ok && quoteCheck.ok && idCheck.ok;
  return { ok, packCheck, quoteCheck, idCheck, mergedPath };
}

function renderReportMd({ opts, coverage, candidates, results, check, runDir }) {
  const accepted = results.filter((r) => r.accepted);
  const rejected = results.filter((r) => !r.accepted);
  const acceptedFacts = accepted.filter((r) => r.fact).map((r) => r.fact);
  const acceptedEncounters = accepted.map((r) => r.encounter);

  const kindLine = (c) => Object.entries(c).map(([k, v]) => `${k}=${v}`).join(' ');

  const lines = [];
  lines.push(`# Expand proposal — ${basename(runDir)}`);
  lines.push('');
  lines.push(`**Pack:** \`${opts.packDir}\` · **Verb:** \`expand\` (Fable_SPEC.md §5) · **Generated:** ${new Date().toISOString()}`);
  lines.push(`**Model:** \`${opts.model}\` · **Requested candidates:** ${opts.count}`);
  lines.push('');
  lines.push('This proposal is REVIEWABLE ONLY — nothing here has been written to packs/. Promote via a human-reviewed merge.');
  lines.push('');

  lines.push('## 1. Coverage analysis');
  lines.push('');
  lines.push(`Global encounter kind counts (current pack): ${kindLine(coverage.globalKindCounts)}`);
  lines.push('');
  lines.push('### Chapter gaps (top 10, ranked by wordCount / (factCount+1))');
  lines.push('');
  lines.push('| file | words | facts | score |');
  lines.push('|---|---:|---:|---:|');
  for (const g of coverage.chapterGaps.slice(0, 10)) {
    lines.push(`| ${g.file} | ${g.wordCount} | ${g.factCount} | ${g.score.toFixed(0)} |`);
  }
  lines.push('');
  lines.push('### Kind skew per fact-cluster (top 10, ranked by gap size)');
  lines.push('');
  lines.push('| topic | facts | mcq | free_recall | scenario_branch | match | order | target kind |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---|');
  for (const k of coverage.kindSkew.slice(0, 10)) {
    lines.push(
      `| ${k.topic} | ${k.factCount} | ${k.counts.mcq} | ${k.counts.free_recall} | ${k.counts.scenario_branch} | ${k.counts.match} | ${k.counts.order} | ${k.targetKind} |`,
    );
  }
  lines.push('');
  lines.push(
    `### Facts with zero encounters: ${coverage.zeroEncounterFacts.length ? coverage.zeroEncounterFacts.map((z) => z.factId).join(', ') : 'NONE'}`,
  );
  lines.push('');

  lines.push('## 2. Candidates attempted');
  lines.push('');
  lines.push('| # | type | target | kind | outcome |');
  lines.push('|---|---|---|---|---|');
  candidates.forEach((c, i) => {
    const r = results[i];
    const target = c.type === 'chapter' ? c.file : c.type === 'kind_skew' ? c.topic : c.factId;
    const outcome = r.accepted ? `accepted (attempt ${r.attempts})` : `REJECTED: ${r.reason}`;
    lines.push(`| ${i + 1} | ${c.type} | ${target} | ${c.kind} | ${outcome} |`);
  });
  lines.push('');
  lines.push(`**Accepted:** ${accepted.length}/${candidates.length} · **Rejected:** ${rejected.length}/${candidates.length}`);
  lines.push('');

  if (acceptedFacts.length) {
    lines.push('## 3. Accepted draft facts');
    lines.push('');
    for (const f of acceptedFacts) {
      lines.push(`- **${f.id}** (${f.type}, difficulty ${f.difficulty}): ${f.statement}`);
      lines.push(`  - source: \`${f.source_ref.file}\` — ${f.source_ref.loc}`);
      lines.push(`  - quote: "${f.source_ref.quote.slice(0, 140)}${f.source_ref.quote.length > 140 ? '…' : ''}"`);
    }
    lines.push('');
  }
  if (acceptedEncounters.length) {
    lines.push('## 4. Accepted draft encounters');
    lines.push('');
    for (const e of acceptedEncounters) {
      lines.push(`- **${e.id}** (${e.kind}) → fact_ids: ${e.fact_ids.join(', ')}`);
      lines.push(`  - prompt: ${e.prompt}`);
    }
    lines.push('');
  }

  if (check) {
    lines.push('## 5. --check results (validate against a hypothetical merged pack)');
    lines.push('');
    lines.push(`- **validate_pack.mjs:** ${check.packCheck.ok ? 'PASS' : 'FAIL'}`);
    lines.push(`- **validate_quotes.py:** ${check.quoteCheck.ok ? 'PASS' : 'FAIL'}`);
    lines.push(`- **id-immutability:** ${check.idCheck.ok ? 'PASS' : 'FAIL'}${check.idCheck.errors.length ? `\n  - ${check.idCheck.errors.join('\n  - ')}` : ''}`);
    lines.push('');
    lines.push(`Overall: **${check.ok ? 'PROPOSAL WOULD PASS' : 'PROPOSAL WOULD FAIL'}**`);
    lines.push('');
    lines.push('### Reproduce');
    lines.push('```');
    lines.push(`node pipeline/validate_pack.mjs ${relative(root, check.mergedPath)}`);
    lines.push(`python3 pipeline/validate_quotes.py ${relative(root, check.mergedPath)}`);
    lines.push(`node pipeline/expand_pack.mjs --check ${relative(root, runDir)}`);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

async function runGenerateMode(opts) {
  const pack = loadPack(opts.packDir);
  const rawDocs = loadRawDocs(opts.rawDir);
  const coverage = analyzeCoverage({ pack, rawDocs, isTeachingFile: vcLawTeachingFile });

  console.log(`Loaded pack '${pack.meta.id}': ${pack.facts.length} facts, ${pack.encounters.length} encounters`);
  console.log(`Scanned ${rawDocs.length} raw .md files under ${opts.rawDir}`);
  console.log(`Global kind counts: ${JSON.stringify(coverage.globalKindCounts)}`);
  console.log(`Top chapter gap: ${coverage.chapterGaps[0]?.file} (score ${coverage.chapterGaps[0]?.score.toFixed(0)})`);
  console.log(`Top kind-skew cluster: ${coverage.kindSkew[0]?.topic} → needs more ${coverage.kindSkew[0]?.targetKind}`);
  console.log(`Zero-encounter facts: ${coverage.zeroEncounterFacts.length}`);

  if (opts.coverageOnly) {
    console.log('\n--coverage-only: skipping generation.');
    return 0;
  }

  const rawByFile = new Map(rawDocs.map((d) => [d.file, d.text]));
  let candidates = pickCandidates(coverage, opts.count);
  candidates = assignKinds(candidates, coverage.globalKindCounts);
  // Hydrate chapter candidates with excerpt text + source version (file I/O the
  // pure pickCandidates/assignKinds functions deliberately don't do).
  candidates = candidates.map((c) => {
    if (c.type !== 'chapter') return c;
    const fileText = rawByFile.get(c.file) ?? '';
    const { heading, text: excerpt } = pickExcerpt(fileText);
    return { ...c, fileText, excerpt, heading, sourceVersion: resolveSourceVersion(pack, c.file) };
  });

  console.log(`\nPicked ${candidates.length} candidate(s):`);
  for (const c of candidates) {
    console.log(`  - [${c.type}] ${c.type === 'chapter' ? c.file : c.type === 'kind_skew' ? c.topic : c.factId} → kind=${c.kind}`);
  }

  const ctx = {
    pack,
    model: opts.model,
    timeoutMs: opts.timeoutMs,
    today: new Date().toISOString().slice(0, 10),
    exampleByKind: buildExampleByKind(pack),
    existingFactIds: new Set(pack.facts.map((f) => f.id)),
    existingEncounterIds: new Set(pack.encounters.map((e) => e.id)),
    draftFactIdsSoFar: new Set(),
    draftEncounterIdsSoFar: new Set(),
  };

  const results = [];
  for (const c of candidates) {
    console.log(`\nGenerating for [${c.type}] ${c.type === 'chapter' ? c.file : c.type === 'kind_skew' ? c.topic : c.factId} (kind=${c.kind})...`);
    const t0 = Date.now();
    const r = await generateDraft(c, ctx);
    const ms = Date.now() - t0;
    if (r.accepted) {
      console.log(`  accepted in ${ms}ms (attempt ${r.attempts})${r.fact ? ` — fact ${r.fact.id}` : ''} — encounter ${r.encounter.id}`);
      if (r.fact) ctx.draftFactIdsSoFar.add(r.fact.id);
      ctx.draftEncounterIdsSoFar.add(r.encounter.id);
    } else {
      console.log(`  REJECTED after ${ms}ms: ${r.reason}`);
    }
    results.push(r);
  }

  const acceptedFacts = results.filter((r) => r.accepted && r.fact).map((r) => r.fact);
  const acceptedEncounters = results.filter((r) => r.accepted).map((r) => r.encounter);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = resolve(root, 'staging/expand', `${pack.meta.id}-${timestamp}`);
  mkdirSync(runDir, { recursive: true });

  const proposal = {
    generated_at: new Date().toISOString(),
    pack_id: pack.meta.id,
    pack_dir: opts.packDir,
    model: opts.model,
    requested_n: opts.count,
    candidates: candidates.map((c, i) => ({ ...c, fileText: undefined, kind: c.kind, outcome: results[i].accepted ? 'accepted' : 'rejected', reason: results[i].reason })),
    facts: acceptedFacts,
    encounters: acceptedEncounters,
    rejected: results.filter((r) => !r.accepted).map((r) => ({ candidate: r.candidate.type, reason: r.reason })),
  };
  writeFileSync(join(runDir, 'proposal.json'), JSON.stringify(proposal, null, 2) + '\n');

  console.log(`\nRunning --check against a hypothetical merged pack...`);
  const check = runFullCheck({ currentPack: pack, draftFacts: acceptedFacts, draftEncounters: acceptedEncounters, runDir });
  console.log(`  validate_pack.mjs:   ${check.packCheck.ok ? 'PASS' : 'FAIL'}`);
  console.log(`  validate_quotes.py:  ${check.quoteCheck.ok ? 'PASS' : 'FAIL'}`);
  console.log(`  id-immutability:     ${check.idCheck.ok ? 'PASS' : 'FAIL'}`);
  if (!check.packCheck.ok) console.log(check.packCheck.stdout);
  if (!check.quoteCheck.ok) console.log(check.quoteCheck.stdout);
  if (!check.idCheck.ok) console.log('  ' + check.idCheck.errors.join('\n  '));

  const reportMd = renderReportMd({ opts, coverage, candidates, results, check, runDir });
  writeFileSync(join(runDir, 'report.md'), reportMd);

  console.log(`\nProposal written to ${relative(root, runDir)}/`);
  console.log(`  - proposal.json  (${acceptedFacts.length} facts, ${acceptedEncounters.length} encounters)`);
  console.log(`  - report.md`);
  console.log(`  - merged.preview.pack.json`);

  return check.ok ? 0 : 1;
}

function findLatestRunDir() {
  const base = resolve(root, 'staging/expand');
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(base, d.name));
  if (!dirs.length) return null;
  return dirs.map((d) => ({ d, mtime: statSync(d).mtimeMs })).sort((a, b) => b.mtime - a.mtime)[0].d;
}

function runCheckMode(opts) {
  const runDir = opts.checkDir ? resolve(root, opts.checkDir) : findLatestRunDir();
  if (!runDir || !existsSync(runDir)) {
    console.error(`--check: no run directory found (looked for ${opts.checkDir ?? 'latest under staging/expand/'})`);
    return 1;
  }
  const proposalPath = join(runDir, 'proposal.json');
  if (!existsSync(proposalPath)) {
    console.error(`--check: ${relative(root, proposalPath)} not found`);
    return 1;
  }
  const proposal = JSON.parse(readFileSync(proposalPath, 'utf8'));
  const pack = loadPack(proposal.pack_dir);

  console.log(`Re-checking proposal in ${relative(root, runDir)} (${proposal.facts.length} facts, ${proposal.encounters.length} encounters) against ${proposal.pack_dir}...`);
  const check = runFullCheck({ currentPack: pack, draftFacts: proposal.facts, draftEncounters: proposal.encounters, runDir });
  console.log(`  validate_pack.mjs:   ${check.packCheck.ok ? 'PASS' : 'FAIL'}`);
  console.log(`  validate_quotes.py:  ${check.quoteCheck.ok ? 'PASS' : 'FAIL'}`);
  console.log(`  id-immutability:     ${check.idCheck.ok ? 'PASS' : 'FAIL'}`);
  if (!check.packCheck.ok) console.log(check.packCheck.stdout);
  if (!check.quoteCheck.ok) console.log(check.quoteCheck.stdout);
  if (!check.idCheck.ok) console.log('  ' + check.idCheck.errors.join('\n  '));

  const resultMd = [
    `# Check result — ${basename(runDir)}`,
    '',
    `Re-run at ${new Date().toISOString()}`,
    '',
    `- **validate_pack.mjs:** ${check.packCheck.ok ? 'PASS' : 'FAIL'}`,
    `- **validate_quotes.py:** ${check.quoteCheck.ok ? 'PASS' : 'FAIL'}`,
    `- **id-immutability:** ${check.idCheck.ok ? 'PASS' : 'FAIL'}${check.idCheck.errors.length ? `\n  - ${check.idCheck.errors.join('\n  - ')}` : ''}`,
    '',
    `Overall: **${check.ok ? 'PROPOSAL WOULD PASS' : 'PROPOSAL WOULD FAIL'}**`,
  ].join('\n');
  writeFileSync(join(runDir, 'check-result.md'), resultMd);

  console.log(`\nOverall: ${check.ok ? 'PROPOSAL WOULD PASS' : 'PROPOSAL WOULD FAIL'}`);
  return check.ok ? 0 : 1;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.check) return runCheckMode(opts);
  return runGenerateMode(opts);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
