import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listPacks } from '../plugin';

// Proves the "engine works packless" contract from the packs side. check-zero-packs.sh
// runs the whole suite with PACKS_DIR pointed at an empty dir; this asserts the shape.
describe('zero packs', () => {
  it('returns [] for an empty packs dir', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-empty-'));
    try {
      expect(listPacks(empty)).toEqual([]);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('returns [] for a non-existent packs dir', () => {
    expect(listPacks(path.join(os.tmpdir(), 'fw-does-not-exist-' + Date.now()))).toEqual([]);
  });

  it('honors PACKS_DIR when the harness points it at an empty dir', () => {
    if (process.env.PACKS_DIR) {
      expect(listPacks(process.env.PACKS_DIR)).toEqual([]);
    }
  });
});
