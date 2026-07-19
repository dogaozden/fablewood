import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  listPacks,
  readState,
  writeState,
  isValidStateName,
} from '../plugin';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-bridge-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('listPacks', () => {
  it('reads packs from <dir>/<name>/pack.json and uses meta.id', () => {
    const dir = path.join(tmp, 'packs');
    fs.mkdirSync(path.join(dir, 'toy'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'toy', 'pack.json'),
      JSON.stringify({ meta: { id: 'toy-pack' } }),
    );
    const packs = listPacks(dir);
    expect(packs).toHaveLength(1);
    expect(packs[0].id).toBe('toy-pack');
    expect(packs[0].dir).toBe('toy');
  });

  it('skips directories without a pack.json and invalid JSON', () => {
    const dir = path.join(tmp, 'packs');
    fs.mkdirSync(path.join(dir, 'empty'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'broken'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'broken', 'pack.json'), '{ not json');
    expect(listPacks(dir)).toEqual([]);
  });

  it('falls back to the directory name when meta.id is absent', () => {
    const dir = path.join(tmp, 'packs');
    fs.mkdirSync(path.join(dir, 'nameless'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'nameless', 'pack.json'), JSON.stringify({ facts: [] }));
    expect(listPacks(dir)[0].id).toBe('nameless');
  });
});

describe('state read/write', () => {
  it('round-trips JSON and creates the dir (mkdir -p)', async () => {
    const dir = path.join(tmp, 'state'); // does not exist yet
    await writeState(dir, 'save.json', { hp: 10, box: 3 });
    expect(await readState(dir, 'save.json')).toEqual({ hp: 10, box: 3 });
  });

  it('returns null for a missing state file', async () => {
    expect(await readState(tmp, 'nope.json')).toBeNull();
  });

  it('never deletes sibling files on write', async () => {
    await writeState(tmp, 'a.json', { a: 1 });
    await writeState(tmp, 'b.json', { b: 2 });
    expect(await readState(tmp, 'a.json')).toEqual({ a: 1 });
    expect(await readState(tmp, 'b.json')).toEqual({ b: 2 });
    // no stray temp files left behind
    expect(fs.readdirSync(tmp).filter((f) => f.startsWith('.tmp-'))).toEqual([]);
  });

  it('rejects path-traversal and separators in names', () => {
    expect(isValidStateName('save.json')).toBe(true);
    expect(isValidStateName('srs-state.json')).toBe(true);
    expect(isValidStateName('../secret')).toBe(false);
    expect(isValidStateName('a/b.json')).toBe(false);
    expect(isValidStateName('has space.json')).toBe(false);
    expect(isValidStateName('..')).toBe(false);
  });

  it('throws rather than escaping the state dir', async () => {
    await expect(writeState(tmp, '../escape.json', { x: 1 })).rejects.toThrow();
  });
});
