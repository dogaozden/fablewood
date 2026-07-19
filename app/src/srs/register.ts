/**
 * SRS + save provider registration. OWNED BY THE SRS AGENT — this in-memory stub is
 * replaced wholesale (bridge-backed Leitner per slice-blueprint §2); keep the install shape.
 */
import { services, type Quality, type SaveData } from '../game/contracts';

const boxes = new Map<string, number>();

services.srs = {
  async ready() {},
  dueQueue(_packId: string, factIds: string[]) {
    return [...factIds];
  },
  async record(factId: string, quality: Quality) {
    const cur = boxes.get(factId) ?? 0;
    boxes.set(factId, quality === 1 ? Math.min(cur + 1, 5) : 1);
  },
  boxOf(factId: string) {
    return boxes.get(factId) ?? 0;
  },
  masteryAvg(factIds: string[]) {
    if (!factIds.length) return 0;
    return factIds.reduce((s, id) => s + (boxes.get(id) ?? 0), 0) / factIds.length;
  },
};

let save: SaveData = { scene: 'hamlet', hp: 10, streak: 0, lastPlayed: '' };

services.save = {
  async ready() {},
  get: () => save,
  async save(patch) {
    save = { ...save, ...patch };
  },
};

let settings = { muted: false };

services.settings = {
  async ready() {},
  get: () => settings,
  async set(patch) {
    settings = { ...settings, ...patch };
  },
};
