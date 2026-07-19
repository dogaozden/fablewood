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
import { getPacks } from '../bridge/client';
import { buildFactMeta, dueQueue, type FactMeta } from './leitner';
import { SaveStore, SettingsStore, SrsStore } from './store';

const srsStore = new SrsStore();
const saveStore = new SaveStore();
const settingsStore = new SettingsStore();

// packId → (factId → { prereqs }), built once from the installed packs.
let factMetaByPack = new Map<string, Map<string, FactMeta>>();
let packsPulled = false;

async function pullPacks(): Promise<void> {
  if (packsPulled) return;
  packsPulled = true;
  const { packs } = await getPacks();
  factMetaByPack = buildFactMeta(packs);
}

services.srs = {
  async ready() {
    // Load persisted state and the prereq index together (both idempotent).
    await Promise.all([srsStore.ready(), pullPacks()]);
  },
  dueQueue(packId: string, factIds: string[], now: number = Date.now()) {
    const meta = factMetaByPack.get(packId) ?? new Map<string, FactMeta>();
    return dueQueue(srsStore.snapshot(), factIds, meta, now);
  },
  record(factId, quality, encounterId) {
    return srsStore.record(factId, quality, encounterId);
  },
  boxOf(factId) {
    return srsStore.boxOf(factId);
  },
  masteryAvg(factIds) {
    return srsStore.masteryAvg(factIds);
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
