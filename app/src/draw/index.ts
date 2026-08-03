import type { DrawIndex, InstalledPack } from './types';
export * from './types';

export function buildDrawIndex(packs: InstalledPack[]): DrawIndex {
  const factById = new Map(); const packIdByFactId = new Map();
  const encountersByFactId = new Map(); const packIds: string[] = [];
  let warned = false;
  for (const { id, pack } of packs) {
    packIds.push(id);
    for (const f of pack.facts) {
      if (factById.has(f.id)) {
        if (!warned) { console.warn(`[draw] duplicate fact id across packs: ${f.id} — first-installed wins`); warned = true; }
        continue;
      }
      factById.set(f.id, f); packIdByFactId.set(f.id, id);
    }
    for (const e of pack.encounters) {
      for (const fid of e.fact_ids ?? []) {
        if (packIdByFactId.get(fid) !== id) continue; // encounters attach only to their own pack's facts
        const arr = encountersByFactId.get(fid) ?? [];
        arr.push(e); encountersByFactId.set(fid, arr);
      }
    }
  }
  return { factById, packIdByFactId, encountersByFactId, packIds };
}
