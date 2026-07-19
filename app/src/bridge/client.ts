import type { PackEntry, PacksResponse } from './types';

export type { PackEntry, PacksResponse };

// All calls degrade gracefully: in a static build (no dev bridge) the fetches fail
// and we return empty/absent data so the engine still renders.

export async function getPacks(): Promise<PacksResponse> {
  try {
    const res = await fetch('/api/packs');
    if (!res.ok) return { packs: [] };
    return (await res.json()) as PacksResponse;
  } catch {
    return { packs: [] };
  }
}

/**
 * Fetch a read-only pack asset (e.g. `<slug>.dungeon.json`, a sprite sheet) via
 * the dev bridge. Returns the raw Response so callers pick `.json()` / `.blob()`;
 * null when the bridge is absent (static build), the pack/file is missing, or the
 * path is rejected. Path segments are individually encoded so subdirs survive.
 */
export async function getPackAsset(packId: string, relPath: string): Promise<Response | null> {
  try {
    const rel = relPath
      .split('/')
      .filter((seg) => seg.length > 0)
      .map(encodeURIComponent)
      .join('/');
    const res = await fetch(`/api/packs/${encodeURIComponent(packId)}/assets/${rel}`);
    if (!res.ok) return null;
    return res;
  } catch {
    return null;
  }
}

export async function getState<T = unknown>(name: string): Promise<T | null> {
  try {
    const res = await fetch(`/api/state/${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function putState(name: string, data: unknown): Promise<boolean> {
  try {
    const res = await fetch(`/api/state/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.ok;
  } catch {
    return false;
  }
}
