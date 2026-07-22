import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function packLabel(directoryName) {
  return `packs/${directoryName}/pack.json`;
}

const FACT_TYPES = new Set(['rule', 'concept', 'advice', 'do', 'dont', 'number', 'story']);

function validateFact(fact, index) {
  if (!fact || typeof fact !== 'object') return `fact at index ${index} is not an object`;
  if (typeof fact.id !== 'string') return `fact at index ${index} is missing id`;
  if (!FACT_TYPES.has(fact.type)) return `fact ${fact.id} has an invalid type`;
  if (typeof fact.statement !== 'string') return `fact ${fact.id} is missing statement`;
  if (fact.detail !== undefined && typeof fact.detail !== 'string') {
    return `fact ${fact.id} has an invalid detail`;
  }
  if (!fact.source_ref || typeof fact.source_ref !== 'object') {
    return `fact ${fact.id} is missing source_ref`;
  }
  if (typeof fact.source_ref.loc !== 'string' && typeof fact.source_ref.loc !== 'number') {
    return `fact ${fact.id} is missing source_ref.loc`;
  }
  if (typeof fact.as_of !== 'string') return `fact ${fact.id} is missing as_of`;
  if (typeof fact.source_version !== 'string') return `fact ${fact.id} is missing source_version`;
  if (fact.tags !== undefined && (
    !Array.isArray(fact.tags) || fact.tags.some((tag) => typeof tag !== 'string')
  )) {
    return `fact ${fact.id} has invalid tags`;
  }
  return null;
}

export async function loadPacks(packsDir) {
  const packs = [];
  const warnings = [];

  let entries;
  try {
    entries = await readdir(packsDir, { withFileTypes: true });
  } catch (error) {
    warnings.push(`packs directory unavailable: ${packsDir}: ${errorMessage(error)}`);
    return { packs, warnings };
  }

  const directories = entries
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const directory of directories) {
    const label = packLabel(directory.name);
    const filename = path.join(packsDir, directory.name, 'pack.json');
    let source;

    try {
      source = await readFile(filename, 'utf8');
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') continue;
      warnings.push(`skipped ${label}: ${errorMessage(error)}`);
      continue;
    }

    try {
      const pack = JSON.parse(source);
      if (!pack || typeof pack !== 'object') {
        throw new Error('expected a JSON object');
      }
      if (typeof pack.meta?.id !== 'string' || !pack.meta.id) {
        throw new Error('missing meta.id');
      }
      if (!Array.isArray(pack.facts)) {
        throw new Error('missing facts array');
      }
      if (typeof pack.meta.title !== 'string') {
        throw new Error('missing meta.title');
      }
      if (!Array.isArray(pack.meta.sources)
        || pack.meta.sources.some((sourceEntry) => typeof sourceEntry?.title !== 'string')) {
        throw new Error('missing meta.sources');
      }
      for (let index = 0; index < pack.facts.length; index += 1) {
        const reason = validateFact(pack.facts[index], index);
        if (reason) throw new Error(reason);
      }
      packs.push(pack);
    } catch (error) {
      warnings.push(`skipped ${label}: ${errorMessage(error)}`);
    }
  }

  return { packs, warnings };
}
