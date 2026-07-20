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

// Phase 2 (magic-combat-depth §13): buy/sell are now part of the InventoryApi contract
// surface (contracts.ts), so the store singleton no longer needs to be exported for
// shopPane.ts to reach them directly — it goes through services.inventory like every
// other consumer. Kept module-private; every write still serializes through its one
// writeChain (store.ts's mutate()) since services.inventory delegates to this same instance.
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
  buy: (id, cost, qty) => store.buy(id, cost, qty),
  sell: (id, price, qty) => store.sell(id, price, qty),
};
