/**
 * Inventory provider registration. OWNED BY THE INVENTORY AGENT.
 *
 * Installs the bridge-backed wallet/satchel service into the shared `services`
 * registry as a side effect on import (scenes/index.ts imports this, mirroring
 * srs/register.ts). Persistence lives in ./store; catalog data in ./catalog;
 * field-use rules in ./consume.
 */
import { services } from '../game/contracts';
import { InventoryStore } from './store';
import { useItem } from './consume';

const store = new InventoryStore();

services.inventory = {
  ready: () => store.ready(),
  getGold: () => store.getGold(),
  snapshot: () => store.snapshot(),
  addGold: (delta) => store.addGold(delta),
  spendGold: (cost) => store.spendGold(cost),
  grantItem: async (id, qty) => {
    await store.grant(id, qty);
  },
  removeItem: (id, qty) => store.remove(id, qty),
  countOf: (id) => store.countOf(id),
  useItem: (id) => useItem(store, id),
};
