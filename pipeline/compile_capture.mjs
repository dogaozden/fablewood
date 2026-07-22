#!/usr/bin/env node
// compile_capture.mjs — the `capture` verb (docs/design/knowledge-platform-vision.md
// §9.2, generalizing §5's "ingestion at lifetime scale" funnel, and §2.5's
// ratification-gate constitution: nothing reaches canon without the author's explicit
// approval). Turns the author's loose staging/inbox/ captures (a highlight, a URL, a
// one-line note) into candidate facts, reusing pipeline/expand_pack.mjs's
// proven draft -> validate -> stage shape (Fable_SPEC.md §5's `expand` verb)
// rather than re-deriving it: this file imports expand_pack.mjs's exported pure
// helpers directly (quoteAppearsIn, validateDraftFact, resolveSourceVersion,
// chapterLabel, pickExcerpt, firstJsonObject, VALID_FACT_TYPES) instead of
// forking their logic, and mirrors its unexported runClaude spawn shape
// (MCP-stripped, timeout-capped, <=1 corrective retry) verbatim.
//
// Unlike `expand`, this verb:
//   - has no coverage analysis. the author already said what to look at — one inbox
//     file is one candidate. There is no gap-picking.
//   - drafts FACTS ONLY, never encounters. The vision doc (§5) keeps encounter
//     generation "a second, separable pass" — facts can live in canon before
//     any game content exists for them.
//   - branches on provenance per capture:
//       * a `source:` line naming a file that exists on disk -> drafts a real
//         Fact (statement/detail/type/tags/difficulty + a VERBATIM quote
//         candidate + loc), locally validated via expand_pack.mjs's own
//         validateDraftFact/quoteAppearsIn, then independently re-confirmed by
//         shelling out to the real pipeline/validate_quotes.py (never forking
//         its rules).
//       * a `source:` line that is a URL, or no `source:` line at all -> still
//         drafted (statement/detail/type/tags/difficulty), but PARKED:
//         `origin: "url"|"self-note"`, `needs_ratification_as: "insight"`
//         (vision §3a — the schema has no `insight` fact type yet). Parked
//         drafts are never apply-eligible; there is nowhere for them to go
//         until that schema work lands.
//       * a `source:` line naming a local path that does NOT resolve to a
//         file on disk, or a capture with no note text at all -> rejected
//         outright, no LLM call spent (this is a broken capture, not a
//         provenance judgment call).
//
// Pipeline (this run):
//   1. --check (default) — read every eligible *.md/*.txt file directly under
//      --inbox-dir (staging/inbox/, skipping README.md and the processed/
//      subdirectory), draft one candidate per file via `claude -p`, and write
//      a reviewable staging/captures/<timestamp>/ proposal (proposal.json +
//      proposal.md). Nothing here writes packs/. Accepted facts are also
//      previewed against a hypothetical merge with the pack's existing
//      facts.staging.json, via the real validate_quotes.py.
//   2. --apply <run> — re-reads that run's proposal.json, merges its
//      already-validated `facts` into packs/<pack>/facts.staging.json (the
//      existing pre-compile staging file pipeline/compile_pack.py reads —
//      see that script's own docstring: `pack.json`'s facts[] IS whatever is
//      in facts.staging.json, wholesale, the next time a human runs
//      compile_pack.py — a SEPARATE, human-invoked step this tool never
//      takes). The merge is re-validated with the real validate_quotes.py
//      before anything is written; on failure the apply aborts and
//      facts.staging.json is left untouched. On success, every inbox file the
//      run consumed moves to staging/inbox/processed/<run>/. Parked captures
//      are never merged into anything — they have no schema home yet.
//
// Usage:
//   node pipeline/compile_capture.mjs [--check] [--inbox-dir staging/inbox]
//                                     [--pack-dir packs/vc-law] [--model sonnet]
//                                     [--timeout-ms 120000]
//   node pipeline/compile_capture.mjs --apply <staging/captures/run-dir>
//
// No API keys: every LLM call shells the subscription `claude` CLI, exactly
// the way pipeline/expand_pack.mjs and app/vite-judge-plugin.ts already do.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync, renameSync } from 'node:fs';
import { resolve, dirname, join, relative, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import {
  quoteAppearsIn,
  validateDraftFact,
  resolveSourceVersion,
  chapterLabel,
  pickExcerpt,
  firstJsonObject,
  VALID_FACT_TYPES,
} from './expand_pack.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ============================================================================
// Pure helpers — capture file parsing + classification
// ============================================================================

/** Parses one staging/inbox/ capture file: an optional leading `source:` line
 *  (must be the first non-blank line — a path into raw/, or a URL) followed
 *  by freeform note text. Blank lines around the source line are skipped. If
 *  there is no source line, the whole (trimmed) file is note text. */
export function parseCaptureFile(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  let source = null;
  const m = i < lines.length ? lines[i].match(/^\s*source:\s*(.*)$/i) : null;
  if (m) {
    const val = m[1].trim();
    if (val) source = val;
    i++;
    while (i < lines.length && lines[i].trim() === '') i++;
  }
  const note = lines.slice(i).join('\n').trim();
  return { source, note };
}

export function isUrlSource(source) {
  return /^https?:\/\//i.test(String(source ?? '').trim());
}

/** Classifies a parsed capture into one of four provenance buckets. The only
 *  I/O in this otherwise-pure module is injected via `resolveLocal` (source
 *  string -> absolute path, or null if it doesn't resolve to a real file), so
 *  this stays directly testable against fixtures. */
export function classifyCapture({ source, note }, { resolveLocal }) {
  if (!note) return { origin: 'malformed', reason: 'capture has no note text' };
  if (!source) return { origin: 'self-note' };
  if (isUrlSource(source)) return { origin: 'url', source };
  const abs = resolveLocal(source);
  if (!abs) return { origin: 'missing-source', source, reason: `source path not found (or not a file) on disk: ${source}` };
  return { origin: 'source-file', source, sourceAbsPath: abs };
}

/** Which inbox directory entries are eligible captures: *.md / *.txt files,
 *  excluding README.md (the format doc, not a capture) case-insensitively.
 *  Pure — callers do the readdir; this just filters+sorts names. */
export function filterInboxFilenames(names) {
  return names.filter((name) => /\.(md|txt)$/i.test(name) && name.toLowerCase() !== 'readme.md').sort();
}

// ============================================================================
// Pure helpers — parked-draft validation (no id/source_ref/quote: there is
// nothing to cite for a self-originated or unfetched-URL note)
// ============================================================================

/** Structural validation for a PARKED draft (self-note / url origin) — the
 *  same craftsmanship bar validateDraftFact applies to statement/detail/type/
 *  tags/difficulty, without that function's id/prereq/source_ref checks (which
 *  don't apply: a parked draft is not a citable Fact and never will be one
 *  under today's schema — vision §3a). */
export function validateParkedDraft(draft) {
  const errors = [];
  if (!draft || typeof draft !== 'object') return ['draft is not an object'];
  for (const key of ['type', 'statement', 'detail']) {
    const v = draft[key];
    if (v === undefined || v === null || v === '') errors.push(`draft missing/empty '${key}'`);
  }
  if (!VALID_FACT_TYPES.has(draft.type)) errors.push(`invalid fact type: ${draft.type}`);
  if (!(Number.isInteger(draft.difficulty) && draft.difficulty >= 1 && draft.difficulty <= 5)) {
    errors.push(`difficulty not int 1-5: ${JSON.stringify(draft.difficulty)}`);
  }
  if (!(Array.isArray(draft.tags) && draft.tags.length > 0 && draft.tags.every((t) => typeof t === 'string' && t === t.toLowerCase()))) {
    errors.push(`tags must be a non-empty array of lowercase strings: ${JSON.stringify(draft.tags)}`);
  }
  return errors;
}

// ============================================================================
// Pure helper — facts.staging.json's own formatting convention
// ============================================================================

/** Serializes a value the way packs/<id>/facts.staging.json is already
 *  hand-formatted: 2-space indent per nesting level, but an array of JSON
 *  primitives (string/number/boolean/null) — e.g. a fact's `tags`/`prereqs` —
 *  collapses onto one line instead of one item per line. Verified
 *  byte-for-byte against the real file's existing 42 facts before use here:
 *  writing new facts with plain `JSON.stringify(merged, null, 2)` reformats
 *  every pre-existing fact's short arrays too (Node always expands arrays,
 *  one item per line, regardless of length), turning a one-fact append into
 *  a ~300-line diff of pure churn. This keeps `--apply` additive in the git
 *  diff sense, not just in content. */
export function stringifyFactsStyle(value, indentLevel = 0) {
  const pad = '  '.repeat(indentLevel);
  const padInner = '  '.repeat(indentLevel + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const allPrimitive = value.every((v) => v === null || typeof v !== 'object');
    if (allPrimitive) return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    const items = value.map((v) => `${padInner}${stringifyFactsStyle(v, indentLevel + 1)}`).join(',\n');
    return `[\n${items}\n${pad}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const items = keys.map((k) => `${padInner}${JSON.stringify(k)}: ${stringifyFactsStyle(value[k], indentLevel + 1)}`).join(',\n');
    return `{\n${items}\n${pad}}`;
  }
  return JSON.stringify(value);
}

function writeFactsStagingFile(path, facts) {
  writeFileSync(path, stringifyFactsStyle(facts, 0) + '\n');
}

// ============================================================================
// Pure-ish helper — apply-time merge decision (no I/O: proposal facts + known
// ids in, {merged, added, skipped} out; the caller does the reading/writing)
// ============================================================================

/** Decides which proposal.facts are safe to append to the pack's existing
 *  facts.staging.json: skips (rather than crashes on) any id that has become
 *  known since the run was generated (e.g. a second run already applied it).
 *  Pure — testable without touching a filesystem. */
export function computeApply({ proposalFacts, existingFactIds, stagingFacts }) {
  const known = new Set(existingFactIds);
  const added = [];
  const skipped = [];
  for (const fact of proposalFacts ?? []) {
    if (known.has(fact.id)) {
      skipped.push({ id: fact.id, reason: 'id already present in pack.json or facts.staging.json' });
      continue;
    }
    added.push(fact);
    known.add(fact.id);
  }
  return { merged: [...stagingFacts, ...added], added, skipped };
}

// ============================================================================
// LLM plumbing — claude -p, MCP-stripped, timeout-capped (mirrors
// pipeline/expand_pack.mjs's own runClaude/generateDraft shape verbatim).
// ============================================================================

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

function buildSourcePrompt(capture, ctx) {
  const { note, source, excerpt, heading } = capture;
  const label = chapterLabel(source);
  const existingIdsSample = [...ctx.existingFactIds].slice(0, 40);
  return [
    `You are drafting ONE candidate fact for "${ctx.pack.meta.title}" (Fablewood, a knowledge-retention RPG's knowledge store), from one of the author's personal captures.`,
    `the author's own note about why this matters:`,
    '"""',
    note,
    '"""',
    '',
    'Extract exactly ONE new atomic fact, grounded in the SOURCE_EXCERPT below, that best matches what the note is pointing at.',
    '',
    'Respond with STRICT JSON only — no prose, no markdown fence, no preamble:',
    '{',
    '  "id": "vc.econ.<topic>.<slug>",',
    '  "type": "rule"|"concept"|"advice"|"do"|"dont"|"number"|"story",',
    '  "statement": "<one crisp, self-contained sentence>",',
    '  "detail": "<1-3 sentences of elaborating context, example, or number>",',
    '  "quote": "<a VERBATIM contiguous substring of SOURCE_EXCERPT — copy exactly, do not paraphrase or fix punctuation>",',
    '  "tags": ["lowercase-tag", "..."],',
    '  "difficulty": "<integer 1-5>"',
    '}',
    '',
    '"topic" = a short lowercase subject cluster, letters/digits only (new or matching an existing one); "slug" = short kebab-case.',
    'The "id" MUST match exactly: vc.econ.<topic>.<slug> (e.g. "vc.econ.control.board-size").',
    '',
    existingIdsSample.length
      ? `EXISTING_FACT_IDS (style reference only, to help you pick a consistent topic/slug — do not reuse any of these ids):\n${existingIdsSample.join(', ')}`
      : '',
    '',
    `SOURCE_FILE: ${source}`,
    `SOURCE_EXCERPT (section: "${heading ?? label}"):`,
    '"""',
    excerpt,
    '"""',
  ].filter((l) => l !== '').join('\n');
}

function buildParkedPrompt(capture, ctx) {
  const { note, origin, source } = capture;
  return [
    `You are drafting ONE candidate self-originated insight for "${ctx.pack.meta.title}" (Fablewood, a knowledge-retention RPG's knowledge store) — this is the author's own note${origin === 'url' ? ` (he linked ${source} for reference, but do not invent quoted text from it)` : ''}, not a citable passage from an ingested source.`,
    '',
    'Respond with STRICT JSON only — no prose, no markdown fence, no preamble:',
    '{',
    '  "type": "rule"|"concept"|"advice"|"do"|"dont"|"number"|"story",',
    '  "statement": "<one crisp, self-contained sentence capturing the author\'s point>",',
    '  "detail": "<1-3 sentences of elaborating context>",',
    '  "tags": ["lowercase-tag", "..."],',
    '  "difficulty": "<integer 1-5>"',
    '}',
    '',
    'Do NOT invent a quote or a source citation — this is the author speaking, not a book.',
    '',
    "the author's NOTE:",
    '"""',
    note,
    '"""',
  ].join('\n');
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

// ============================================================================
// Draft + validate (LLM layer injected via ctx.callModel — the seam tests
// stub out; production wiring passes the real runClaude above)
// ============================================================================

/**
 * Drafts + validates a candidate for ONE already-classified (and, for
 * "source-file" origin, already-hydrated: fileText/excerpt/heading/
 * sourceVersion present) capture. <=1 corrective retry, same shape as
 * expand_pack.mjs's generateDraft. Returns:
 *   accepted source-file  -> { accepted: true, capture, fact, attempts }
 *   accepted parked       -> { accepted: true, capture, draft, attempts }
 *   rejected              -> { accepted: false, capture, reason, attempts }
 */
export async function generateForCapture(capture, ctx) {
  const isSource = capture.origin === 'source-file';
  const prompt = isSource ? buildSourcePrompt(capture, ctx) : buildParkedPrompt(capture, ctx);
  let lastRaw = '';
  let errors = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const fullPrompt = attempt === 0 ? prompt : buildRetryPrompt(prompt, lastRaw, errors);
    let raw;
    try {
      raw = await ctx.callModel(fullPrompt, { model: ctx.model, timeoutMs: ctx.timeoutMs });
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

    if (isSource) {
      const fact = {
        id: parsed?.id,
        type: parsed?.type,
        statement: parsed?.statement,
        detail: parsed?.detail,
        source_ref: {
          file: capture.source,
          loc: capture.heading ? `${chapterLabel(capture.source)} > ${capture.heading}` : chapterLabel(capture.source),
          quote: parsed?.quote,
        },
        as_of: ctx.today,
        source_version: capture.sourceVersion,
        tags: parsed?.tags,
        difficulty: parsed?.difficulty,
        prereqs: [],
      };
      const knownIds = new Set([...ctx.existingFactIds, ...(ctx.draftFactIdsSoFar ?? [])]);
      const factErrors = validateDraftFact(fact, { knownIds });
      if (parsed?.quote && !quoteAppearsIn(parsed.quote, capture.fileText)) {
        factErrors.push(`quote not found verbatim in ${capture.source} (normalized whitespace/curly-quote check)`);
      }
      if (factErrors.length === 0) return { accepted: true, capture, fact, attempts: attempt + 1 };
      errors = factErrors;
    } else {
      const draft = {
        file: capture.file,
        origin: capture.origin,
        source: capture.source ?? null,
        needs_ratification_as: 'insight',
        type: parsed?.type,
        statement: parsed?.statement,
        detail: parsed?.detail,
        tags: parsed?.tags,
        difficulty: parsed?.difficulty,
        as_of: ctx.today,
        prereqs: [],
      };
      const draftErrors = validateParkedDraft(draft);
      if (draftErrors.length === 0) return { accepted: true, capture, draft, attempts: attempt + 1 };
      errors = draftErrors;
    }
  }
  return { accepted: false, capture, reason: errors.join('; '), attempts: 2 };
}

/**
 * Batch driver over already-classified captures. malformed/missing-source
 * captures are rejected WITHOUT spending an LLM call (ctx.callModel is never
 * invoked for them); everything else goes through generateForCapture.
 * ctx.draftFactIdsSoFar accumulates across the loop (mutated in place, same
 * pattern as expand_pack.mjs's ctx.draftFactIdsSoFar) so later captures in the
 * same run can't collide with earlier ones' freshly-minted ids.
 */
export async function draftCaptures(captures, ctx) {
  ctx.draftFactIdsSoFar = ctx.draftFactIdsSoFar ?? new Set();
  const results = [];
  for (const capture of captures) {
    if (capture.origin === 'malformed' || capture.origin === 'missing-source') {
      results.push({ accepted: false, capture, reason: capture.reason, attempts: 0 });
      continue;
    }
    const r = await generateForCapture(capture, ctx);
    if (r.accepted && r.fact) ctx.draftFactIdsSoFar.add(r.fact.id);
    results.push(r);
  }
  const facts = results.filter((r) => r.accepted && r.fact).map((r) => r.fact);
  const parked = results.filter((r) => r.accepted && r.draft).map((r) => r.draft);
  const rejected = results
    .filter((r) => !r.accepted)
    .map((r) => ({ file: r.capture.file, origin: r.capture.origin, reason: r.reason }));
  return { results, facts, parked, rejected };
}

// ============================================================================
// CLI plumbing
// ============================================================================

function parseArgs(argv) {
  const opts = {
    inboxDir: 'staging/inbox',
    packDir: 'packs/vc-law',
    model: 'sonnet',
    timeoutMs: 120_000,
    apply: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--inbox-dir') opts.inboxDir = argv[++i];
    else if (a === '--pack-dir') opts.packDir = argv[++i];
    else if (a === '--model') opts.model = argv[++i];
    else if (a === '--timeout-ms') opts.timeoutMs = parseInt(argv[++i], 10);
    else if (a === '--check') { /* default mode; accepted explicitly as a no-op */ }
    else if (a === '--apply') opts.apply = argv[++i];
  }
  return opts;
}

function loadPack(packDir) {
  return JSON.parse(readFileSync(resolve(root, packDir, 'pack.json'), 'utf8'));
}

function loadStagingFacts(packDir) {
  const p = resolve(root, packDir, 'facts.staging.json');
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, 'utf8'));
}

function loadCaptures(inboxAbsDir) {
  if (!existsSync(inboxAbsDir)) return [];
  const names = filterInboxFilenames(
    readdirSync(inboxAbsDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name),
  );
  return names.map((name) => {
    const abs = join(inboxAbsDir, name);
    return { file: relative(root, abs), inboxAbsPath: abs, raw: readFileSync(abs, 'utf8') };
  });
}

function runValidatorSubprocess(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });
  return { ok: result.status === 0, status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function renderProposalMd({ opts, proposal, check, runDir }) {
  const lines = [];
  lines.push(`# Capture proposal — ${basename(runDir)}`);
  lines.push('');
  lines.push(`**Pack:** \`${opts.packDir}\` · **Verb:** \`capture\` (docs/design/knowledge-platform-vision.md §9.2) · **Generated:** ${proposal.generated_at}`);
  lines.push(`**Model:** \`${opts.model}\` · **Inbox:** \`${opts.inboxDir}\` · **Captures read:** ${proposal.captures.length}`);
  lines.push('');
  lines.push('This proposal is REVIEWABLE ONLY — nothing here has been written to packs/. `facts` below are');
  lines.push(`quote-validated and apply-eligible (\`node pipeline/compile_capture.mjs --apply ${relative(root, runDir)}\`);`);
  lines.push('`parked` entries have no schema home yet (vision §3a: no `insight` fact type) and are NEVER');
  lines.push('apply-eligible; `rejected` entries got no faithful draft after one correction attempt (or, for a');
  lines.push('malformed/missing-source capture, no LLM call at all).');
  lines.push('');

  lines.push('## 1. Captures in this run');
  lines.push('');
  lines.push('| file | origin | source | outcome |');
  lines.push('|---|---|---|---|');
  for (const c of proposal.captures) {
    lines.push(`| ${c.file} | ${c.origin} | ${c.source ?? '—'} | ${c.outcome}${c.reason ? `: ${c.reason}` : ''} |`);
  }
  lines.push('');

  lines.push(`## 2. Accepted draft facts (apply-eligible): ${proposal.facts.length}`);
  lines.push('');
  for (const f of proposal.facts) {
    lines.push(`- **${f.id}** (${f.type}, difficulty ${f.difficulty}): ${f.statement}`);
    lines.push(`  - detail: ${f.detail}`);
    lines.push(`  - source: \`${f.source_ref.file}\` — ${f.source_ref.loc}`);
    lines.push(`  - quote: "${f.source_ref.quote.slice(0, 140)}${f.source_ref.quote.length > 140 ? '…' : ''}"`);
    lines.push(`  - tags: ${(f.tags ?? []).join(', ')}`);
  }
  lines.push('');

  lines.push(`## 3. Parked drafts (self-note / url — needs_ratification_as: insight): ${proposal.parked.length}`);
  lines.push('');
  for (const p of proposal.parked) {
    lines.push(`- (${p.type}, difficulty ${p.difficulty}) from \`${p.file}\`${p.source ? ` [linked: ${p.source}]` : ' [no source — self-note]'}: ${p.statement}`);
    lines.push(`  - detail: ${p.detail}`);
    lines.push(`  - tags: ${(p.tags ?? []).join(', ')}`);
  }
  lines.push('');

  lines.push(`## 4. Rejected: ${proposal.rejected.length}`);
  lines.push('');
  for (const r of proposal.rejected) {
    lines.push(`- \`${r.file}\` (${r.origin}): ${r.reason}`);
  }
  lines.push('');

  if (check) {
    lines.push('## 5. Preview validation (validate_quotes.py against facts.staging.json + these accepted facts)');
    lines.push('');
    lines.push(`- **validate_quotes.py:** ${check.ok ? 'PASS' : 'FAIL'}`);
    if (!check.ok) {
      lines.push('');
      lines.push('```');
      lines.push(check.stdout.trim());
      lines.push('```');
    }
    lines.push('');
    lines.push('### Reproduce');
    lines.push('```');
    lines.push(`python3 pipeline/validate_quotes.py ${relative(root, check.mergedPath)}`);
    lines.push('```');
    lines.push('');
  } else {
    lines.push('## 5. Preview validation');
    lines.push('');
    lines.push('Skipped — no accepted facts in this run.');
    lines.push('');
  }

  lines.push('### Next step');
  lines.push('```');
  lines.push(`node pipeline/compile_capture.mjs --apply ${relative(root, runDir)}`);
  lines.push('```');

  return lines.join('\n');
}

async function runCheckMode(opts) {
  const pack = loadPack(opts.packDir);
  const stagingFacts = loadStagingFacts(opts.packDir);
  const inboxAbsDir = resolve(root, opts.inboxDir);
  const rawCaptures = loadCaptures(inboxAbsDir);

  console.log(`Scanning ${opts.inboxDir} for captures...`);
  console.log(`Found ${rawCaptures.length} capture file(s)`);
  if (rawCaptures.length === 0) {
    console.log('Nothing to do — inbox is empty (or contains only README.md / processed/).');
    return 0;
  }

  const resolveLocal = (source) => {
    const abs = resolve(root, source);
    return existsSync(abs) && statSync(abs).isFile() ? abs : null;
  };

  const classified = rawCaptures.map((c) => {
    const { source, note } = parseCaptureFile(c.raw);
    const cls = classifyCapture({ source, note }, { resolveLocal });
    return { file: c.file, note, ...cls };
  });

  const hydrated = classified.map((c) => {
    if (c.origin !== 'source-file') return c;
    const fileText = readFileSync(c.sourceAbsPath, 'utf8');
    const { heading, text: excerpt } = pickExcerpt(fileText);
    return { ...c, fileText, excerpt, heading, sourceVersion: resolveSourceVersion(pack, c.source) };
  });

  const today = new Date().toISOString().slice(0, 10);
  const existingFactIds = new Set([...pack.facts.map((f) => f.id), ...stagingFacts.map((f) => f.id)]);
  const ctx = { pack, model: opts.model, timeoutMs: opts.timeoutMs, today, existingFactIds, draftFactIdsSoFar: new Set(), callModel: runClaude };

  for (const c of hydrated) console.log(`  [${c.file}] origin=${c.origin}${c.source ? ` source=${c.source}` : ''}`);

  const { results, facts, parked, rejected } = await draftCaptures(hydrated, ctx);
  for (const r of results) {
    if (r.accepted) console.log(`  ${r.capture.file}: accepted (attempt ${r.attempts})${r.fact ? ` — fact ${r.fact.id}` : ' — parked'}`);
    else console.log(`  ${r.capture.file}: REJECTED — ${r.reason}`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = resolve(root, 'staging/captures', timestamp);
  mkdirSync(runDir, { recursive: true });

  const proposal = {
    generated_at: new Date().toISOString(),
    pack_id: pack.meta.id,
    pack_dir: opts.packDir,
    inbox_dir: opts.inboxDir,
    model: opts.model,
    captures: results.map((r) => ({
      file: r.capture.file,
      origin: r.capture.origin,
      source: r.capture.source ?? null,
      outcome: r.accepted ? (r.fact ? 'accepted' : 'parked') : 'rejected',
      ...(r.accepted ? {} : { reason: r.reason }),
    })),
    facts,
    parked,
    rejected,
  };
  writeFileSync(join(runDir, 'proposal.json'), JSON.stringify(proposal, null, 2) + '\n');

  let check = null;
  if (facts.length > 0) {
    const merged = [...stagingFacts, ...facts];
    const mergedPath = join(runDir, 'merged.preview.facts.staging.json');
    writeFactsStagingFile(mergedPath, merged);
    const quoteCheck = runValidatorSubprocess('python3', [resolve(root, 'pipeline/validate_quotes.py'), mergedPath, `--root=${root}`]);
    check = { ok: quoteCheck.ok, stdout: quoteCheck.stdout, mergedPath };
    console.log(`\nPreview validate_quotes.py (facts.staging.json + ${facts.length} new): ${check.ok ? 'PASS' : 'FAIL'}`);
    if (!check.ok) console.log(check.stdout);
  } else {
    console.log('\nNo accepted facts — skipping preview validation.');
  }

  const reportMd = renderProposalMd({ opts, proposal, check, runDir });
  writeFileSync(join(runDir, 'proposal.md'), reportMd);

  console.log(`\nProposal written to ${relative(root, runDir)}/`);
  console.log(`  facts (apply-eligible): ${facts.length}`);
  console.log(`  parked (self-note/url, needs "insight" type): ${parked.length}`);
  console.log(`  rejected: ${rejected.length}`);

  return check && !check.ok ? 1 : 0;
}

function findRunDir(arg) {
  if (!arg) return null;
  const direct = resolve(root, arg);
  if (existsSync(direct)) return direct;
  const underCaptures = resolve(root, 'staging/captures', arg);
  if (existsSync(underCaptures)) return underCaptures;
  return null;
}

function runApplyMode(opts) {
  const runDir = findRunDir(opts.apply);
  if (!runDir) {
    console.error(`--apply: run directory not found: ${opts.apply}`);
    return 1;
  }
  const proposalPath = join(runDir, 'proposal.json');
  if (!existsSync(proposalPath)) {
    console.error(`--apply: ${relative(root, proposalPath)} not found`);
    return 1;
  }
  const proposal = JSON.parse(readFileSync(proposalPath, 'utf8'));
  const packDir = proposal.pack_dir;
  const pack = loadPack(packDir);
  const stagingPath = resolve(root, packDir, 'facts.staging.json');
  const stagingFacts = loadStagingFacts(packDir);
  const existingFactIds = new Set([...pack.facts.map((f) => f.id), ...stagingFacts.map((f) => f.id)]);

  const { merged, added, skipped } = computeApply({ proposalFacts: proposal.facts, existingFactIds, stagingFacts });

  console.log(`Applying ${relative(root, runDir)}: ${(proposal.facts ?? []).length} candidate fact(s), ${added.length} new, ${skipped.length} skipped.`);
  for (const s of skipped) console.log(`  skipped ${s.id}: ${s.reason}`);

  let quoteCheck = { ok: true, stdout: '' };
  if (added.length > 0) {
    const tempPath = join(runDir, 'merged.preview.facts.staging.json');
    writeFactsStagingFile(tempPath, merged);
    quoteCheck = runValidatorSubprocess('python3', [resolve(root, 'pipeline/validate_quotes.py'), tempPath, `--root=${root}`]);
    console.log(`  validate_quotes.py (post-merge): ${quoteCheck.ok ? 'PASS' : 'FAIL'}`);
    if (!quoteCheck.ok) {
      console.log(quoteCheck.stdout);
      console.log(`\nAPPLY ABORTED — ${relative(root, stagingPath)} left untouched.`);
      writeFileSync(join(runDir, 'apply-result.md'), renderApplyResultMd({ runDir, quoteCheck, added: 0, skipped: skipped.length, movedCount: 0, stagingPath, ok: false }));
      return 1;
    }
    writeFactsStagingFile(stagingPath, merged);
    console.log(`  wrote ${relative(root, stagingPath)} (${stagingFacts.length} -> ${merged.length} facts)`);
  } else {
    console.log(`  no new facts to add — ${relative(root, stagingPath)} left untouched.`);
  }

  const inboxCaptureFiles = (proposal.captures ?? []).map((c) => c.file);
  const processedDir = resolve(root, 'staging/inbox/processed', basename(runDir));
  let moved = 0;
  if (inboxCaptureFiles.length) mkdirSync(processedDir, { recursive: true });
  for (const relFile of inboxCaptureFiles) {
    const src = resolve(root, relFile);
    if (!existsSync(src)) continue; // already moved by a previous apply of this same run
    renameSync(src, join(processedDir, basename(src)));
    moved++;
  }
  console.log(`  moved ${moved} inbox file(s) to ${relative(root, processedDir)}/`);

  writeFileSync(join(runDir, 'apply-result.md'), renderApplyResultMd({ runDir, quoteCheck, added: added.length, skipped: skipped.length, movedCount: moved, stagingPath, ok: true }));

  return 0;
}

function renderApplyResultMd({ runDir, quoteCheck, added, skipped, movedCount, stagingPath, ok }) {
  return [
    `# Apply result — ${basename(runDir)}`,
    '',
    `Applied at ${new Date().toISOString()}`,
    '',
    `- **facts added:** ${added}`,
    `- **facts skipped (id already present):** ${skipped}`,
    `- **inbox files moved to processed/:** ${movedCount}`,
    `- **validate_quotes.py (post-merge):** ${quoteCheck.ok ? 'PASS' : 'FAIL'}`,
    '',
    ok
      ? `Overall: **APPLIED** — ${relative(root, stagingPath)} updated.`
      : `Overall: **ABORTED** — ${relative(root, stagingPath)} left untouched.`,
  ].join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.apply) return runApplyMode(opts);
  return runCheckMode(opts);
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
