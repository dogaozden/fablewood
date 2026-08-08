/**
 * Draw service registration (side-effect install into `services`; game/contracts.ts).
 * Wires the pure draw/index.ts (buildDrawIndex/drawDue/drawNew, Tasks 1-3) to the real
 * installed packs (bridge getPacks) and the real SRS/amendment services — the global
 * cross-pack question picker every wave-1+ draw site (Wellspring, combat casts, dungeon
 * teaching) calls through instead of a scene's own packId-scoped picker.
 */
import { services } from '../game/contracts';
import type { Pack } from '../packs/types';
import { getPacks } from '../bridge/client';
import { buildDrawIndex, drawDue, drawNew } from './index';
import type { DrawIndex, DrawDeps, InstalledPack } from './types';

/** getPacks() types `pack` as `unknown` (bridge/types.ts) — the same boundary
 *  encounters/register.ts's loadPacks() guards; a pack missing these arrays would
 *  otherwise throw inside buildDrawIndex's iteration and take the whole boot down. */
function isPack(p: unknown): p is Pack {
  return !!p && typeof p === 'object' && Array.isArray((p as Pack).facts) && Array.isArray((p as Pack).encounters);
}

let index: DrawIndex = buildDrawIndex([]);
let indexPromise: Promise<void> | null = null;

/** Concurrent callers share the SAME in-flight pull (srs/register.ts's pullPacks() idiom). */
function loadIndex(): Promise<void> {
  return (indexPromise ??= (async () => {
    const { packs } = await getPacks();
    const installed: InstalledPack[] = [];
    for (const entry of packs) if (isPack(entry.pack)) installed.push({ id: entry.id, pack: entry.pack });
    index = buildDrawIndex(installed);
  })());
}

const deps: DrawDeps = {
  /**
   * srs/register.ts:66-73 (recon-confirmed) — dueQueue's packId param only fetches prereq
   * metadata for the unseen tail; it never filters the input factIds. Passing the first
   * installed pack id (or '' with zero packs) therefore orders every pack's facts correctly
   * in one call. W2+ may widen dueQueue's signature to drop the vestigial param — not this wave.
   */
  dueOrder: (factIds, now) => services.srs.dueQueue(index.packIds[0] ?? '', factIds, now),
  // Same predicate for due() AND fresh() — one adapter, both calls (2026-08 amendment ruling).
  eligible: (factId) => !services.amendments.isSuspended(factId),
  hasRecord: (factId) => services.srs.hasRecord(factId),
  dueOf: (factId) => services.srs.nextDueOf(factId),
};

services.draw = {
  async ready() {
    await Promise.all([services.srs.ready(), services.amendments.ready(), loadIndex()]);
  },
  indexReady() {
    return loadIndex();
  },
  due(opts) {
    return drawDue(index, deps, opts);
  },
  fresh(opts) {
    return drawNew(index, deps, opts);
  },
  allFactIds() {
    return Array.from(index.factById.keys());
  },
  sourceOf(factId) {
    return index.packIdByFactId.get(factId);
  },
  factOf(factId) {
    return index.factById.get(factId);
  },
  encountersOf(factId) {
    return index.encountersByFactId.get(factId) ?? [];
  },
  isEmpty() {
    return index.packIds.length === 0;
  },
};
