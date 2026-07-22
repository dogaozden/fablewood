import { readFile } from 'node:fs/promises';
import path from 'node:path';

function emptyState() {
  return { version: 1, facts: {} };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function loadSrs(stateDir) {
  const filename = path.join(stateDir, 'srs.json');

  let source;
  try {
    source = await readFile(filename, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { state: emptyState(), warnings: [] };
    }
    return {
      state: emptyState(),
      warnings: [`state/srs.json is malformed, ignoring: ${errorMessage(error)}`],
    };
  }

  try {
    const state = JSON.parse(source);
    const facts = state?.facts;
    if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
      throw new Error('expected an object with a facts object');
    }
    return { state, warnings: [] };
  } catch (error) {
    return {
      state: emptyState(),
      warnings: [`state/srs.json is malformed, ignoring: ${errorMessage(error)}`],
    };
  }
}
