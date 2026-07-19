import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { safePackAssetPath, assetContentType } from '../plugin';

const ROOT = path.resolve('/packs/vc-law/assets');

describe('safePackAssetPath', () => {
  it('accepts a plain file inside the assets dir', () => {
    expect(safePackAssetPath(ROOT, 'preference-vaults.dungeon.json')).toBe(
      path.join(ROOT, 'preference-vaults.dungeon.json'),
    );
  });

  it('accepts a nested subpath inside the assets dir', () => {
    expect(safePackAssetPath(ROOT, 'sprites/warden.png')).toBe(
      path.join(ROOT, 'sprites', 'warden.png'),
    );
  });

  it('rejects .. traversal', () => {
    expect(safePackAssetPath(ROOT, '../pack.json')).toBeNull();
    expect(safePackAssetPath(ROOT, '../../secret')).toBeNull();
    expect(safePackAssetPath(ROOT, 'a/../../b')).toBeNull();
  });

  it('rejects absolute paths', () => {
    expect(safePackAssetPath(ROOT, '/etc/passwd')).toBeNull();
  });

  it('rejects the assets dir itself and empty input', () => {
    expect(safePackAssetPath(ROOT, '')).toBeNull();
    expect(safePackAssetPath(ROOT, '.')).toBeNull();
  });

  it('rejects a sibling dir that shares the prefix', () => {
    // /packs/vc-law/assets-evil must not pass just because it starts with the root string
    expect(safePackAssetPath(ROOT, '../assets-evil/x')).toBeNull();
  });

  it('rejects null bytes', () => {
    expect(safePackAssetPath(ROOT, 'a\0b.json')).toBeNull();
  });
});

describe('assetContentType', () => {
  it('maps known extensions', () => {
    expect(assetContentType('x.dungeon.json')).toBe('application/json');
    expect(assetContentType('warden.png')).toBe('image/png');
    expect(assetContentType('bg.jpg')).toBe('image/jpeg');
    expect(assetContentType('bg.jpeg')).toBe('image/jpeg');
    expect(assetContentType('tile.webp')).toBe('image/webp');
    expect(assetContentType('mark.svg')).toBe('image/svg+xml');
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(assetContentType('data.bin')).toBe('application/octet-stream');
    expect(assetContentType('noext')).toBe('application/octet-stream');
  });
});
