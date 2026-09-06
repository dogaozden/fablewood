import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listPacks } from '../plugin';

// Amendment to R31 (task 4.1a, 2026-09-05 overnight): the e2e fixture at
// e2e/fixtures/packs-vc-law/vc-law is a committed RELATIVE symlink to packs/vc-law (no
// duplicated content), so listPacks() must resolve symlinked pack directories too — Node's
// Dirent.isDirectory() is false for a symlink even when its target is a real directory.
// A dangling symlink (broken target) must be skipped without throwing.
describe('listPacks — symlinked pack directories', () => {
  it('lists a real pack dir and a symlinked pack dir; skips a dangling symlink', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-symlinked-packs-'));
    const dir = path.join(root, 'packs');
    const outside = path.join(root, 'outside-target');
    fs.mkdirSync(dir);
    fs.mkdirSync(outside);
    try {
      // (a) a real pack dir, directly inside the packs dir
      fs.mkdirSync(path.join(dir, 'real-pack'));
      fs.writeFileSync(
        path.join(dir, 'real-pack', 'pack.json'),
        JSON.stringify({ meta: { id: 'real-pack' } }),
      );

      // (b) a symlink (inside the packs dir) pointing to a real pack dir living outside it
      fs.mkdirSync(path.join(outside, 'linked-pack'));
      fs.writeFileSync(
        path.join(outside, 'linked-pack', 'pack.json'),
        JSON.stringify({ meta: { id: 'linked-pack' } }),
      );
      fs.symlinkSync(path.join(outside, 'linked-pack'), path.join(dir, 'linked-pack'), 'dir');

      // (c) a dangling symlink — target does not exist
      fs.symlinkSync(path.join(outside, 'does-not-exist'), path.join(dir, 'dangling-pack'), 'dir');

      const ids = listPacks(dir)
        .map((p) => p.id)
        .sort();
      expect(ids).toEqual(['linked-pack', 'real-pack']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
