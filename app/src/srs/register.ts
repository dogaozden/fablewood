/**
 * SRS + save + settings provider registration. OWNED BY THE SRS AGENT.
 *
 * Installs bridge-backed Leitner services (slice-blueprint §2) into the shared
 * `services` registry as a side effect on import (scenes/index.ts imports this).
 * The heavy lifting lives in ./leitner (pure math) and ./store (persistence);
 * this file only wires them to the contracts and builds the prereq index that
 * dueQueue ordering needs.
 */
import { services } from '../game/contracts';
import type { Fact, Pack } from '../packs/types';
import { getPacks } from '../bridge/client';
import { buildFactMeta, dueQueue, type FactMeta } from './leitner';
import {
  buildAmendmentIndex,
  eligibleFactIds,
  emptyAmendmentIndex,
  firstAmendedAppearance,
  isSuspended,
  pendingAmendments,
  type AmendmentIndex,
} from './amendments';
import { AmendmentsStore, SaveStore, SettingsStore, SrsStore } from './store';

const srsStore = new SrsStore();
const saveStore = new SaveStore();
const settingsStore = new SettingsStore();
const amendmentsStore = new AmendmentsStore();

// packId → (factId → { prereqs }), built once from the installed packs.
let factMetaByPack = new Map<string, Map<string, FactMeta>>();
// supersession-reteach.md §4 — the superseded/superseding shape of those same packs.
let amendmentIndex: AmendmentIndex = emptyAmendmentIndex();
let pullPromise: Promise<void> | null = null;

/**
 * Concurrent callers share the SAME in-flight pull (the store's ready() idiom):
 * a synchronous "already pulled" flag let a second ready() resolve while
 * /api/packs was still in flight, so its dueQueue calls ran against an empty
 * prereq index and blocked facts surfaced in the wrong order.
 */
function pullPacks(): Promise<void> {
  return (pullPromise ??= (async () => {
    const { packs } = await getPacks();
    factMetaByPack = buildFactMeta(packs);
    amendmentIndex = buildAmendmentIndex(
      packs.map((entry) => ({
        id: entry.id,
        facts: ((entry.pack as Partial<Pack>)?.facts ?? []) as Fact[],
      })),
    );
  })());
}

const isWitnessed = (supersededFactId: string): boolean => amendmentsStore.isWitnessed(supersededFactId);

/** §4 THE suspension predicate — exported through services.amendments for the handful of
 *  sites that build a raw pack-order fact list without passing through dueQueue. */
const suspended = (factId: string): boolean => isSuspended(factId, amendmentIndex, isWitnessed);

services.srs = {
  async ready() {
    // Load persisted state and the prereq index together (both idempotent).
    await Promise.all([srsStore.ready(), amendmentsStore.ready(), pullPacks()]);
  },
  dueQueue(packId: string, factIds: string[], now: number = Date.now()) {
    const meta = factMetaByPack.get(packId) ?? new Map<string, FactMeta>();
    // supersession-reteach.md §4 — THE canonical filter site. One predicate here covers
    // combat's dueFactIds + snapshotDueSet, the Wellspring recompute and the hamlet due
    // badge. Filtering the INPUT (not the result) also keeps a suspended fact out of the
    // unseen-in-prereq-order tail dueQueue appends, which a result-side filter would miss.
    return dueQueue(srsStore.snapshot(), eligibleFactIds(factIds, suspended), meta, now);
  },
  record(factId, quality, encounterId, factType) {
    return srsStore.record(factId, quality, encounterId, Date.now(), factType);
  },
  boxOf(factId) {
    return srsStore.boxOf(factId);
  },
  hasRecord(factId) {
    return srsStore.boxOf(factId) > 0;
  },
  nextDueOf(factId) {
    return srsStore.nextDueOf(factId);
  },
  masteryAvg(factIds) {
    return srsStore.masteryAvg(factIds);
  },
  historyQualities(factId) {
    return srsStore.historyQualities(factId);
  },
};

services.save = {
  ready: () => saveStore.ready(),
  get: () => saveStore.get(),
  save: (patch) => saveStore.save(patch),
};

services.settings = {
  ready: () => settingsStore.ready(),
  get: () => settingsStore.get(),
  set: (patch) => settingsStore.save(patch),
};

/** "The Ledger Amended" (supersession-reteach.md) — witness state, the suspension predicate
 *  every draw surface funnels through, and the §5 mercy read. Shares the srs pack pull. */
services.amendments = {
  async ready() {
    await Promise.all([amendmentsStore.ready(), srsStore.ready(), pullPacks()]);
  },
  isWitnessed,
  isSuspended: suspended,
  eligible: (factIds) => eligibleFactIds(factIds, suspended),
  pending: (packId) =>
    pendingAmendments(
      amendmentIndex.pairsByPack.get(packId) ?? [],
      isWitnessed,
      (factId) => srsStore.historyQualities(factId).length > 0,
    ),
  witness: (supersededFactId) => amendmentsStore.witness(supersededFactId),
  firstAmendedAppearance: (factIds) =>
    firstAmendedAppearance(factIds, amendmentIndex, (factId) => srsStore.historyQualities(factId).length),
};
