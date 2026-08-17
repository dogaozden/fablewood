/**
 * Persistence for the wallet + item stacks (state/inventory.json), with the same
 * paranoid guarantees as srs/store.ts (its ObjectStore is not exported, so this
 * is a bespoke clone):
 *   - load-once caching with a shared in-flight promise (no ready() race);
 *   - serialized MERGE-writes that re-read the freshest on-disk value, so a
 *     second tab and unknown/foreign keys always survive;
 *   - corrupt-file recovery: wrong-shape bytes are backed up to
 *     inventory.corrupt-<ts>.json before starting fresh, never discarded;
 *   - graceful degradation: no bridge → in-memory session, warned exactly once.
 *
 * TRAP the SRS ObjectStore doesn't have: `stacks` is a nested object, and a
 * shallow `{...base, ...patch}` would clobber it whenever a patch touches gold
 * only. Every mutation therefore computes the FULL next {gold, stacks} from the
 * freshest remote (stacks deep-copied) and writes the whole object.
 */
import type { Bridge } from '../srs/store';
import { getState, putState } from '../bridge/client';
import { STARTING_GOLD } from './economy';
import { itemById } from './catalog';

const INV_FILE = 'inventory.json';

const realBridge: Bridge = { getState, putState };

export interface InventoryData extends Record<string, unknown> {
  version: 1;
  gold: number;
  stacks: Record<string, number>;
  /** the one relic whose passive is live, or null if none borne (Concordance Ch. IX).
   *  Additive: absent on pre-Ch.IX saves, which normalize() fills to null. */
  bornRelicId: string | null;
}

interface Wallet {
  gold: number;
  stacks: Record<string, number>;
  bornRelicId: string | null;
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isInventoryData(x: unknown): x is InventoryData {
  return (
    isPlainObject(x) &&
    typeof (x as { gold?: unknown }).gold === 'number' &&
    isPlainObject((x as { stacks?: unknown }).stacks)
  );
}

/** A corrupt-backup filename that satisfies the bridge's ^[A-Za-z0-9._-]+$ rule. */
function corruptName(file: string, now: number): string {
  return `${file.replace(/\.json$/, '')}.corrupt-${now}.json`;
}

/** Keep only sane stack entries (finite positive counts) so merge math never NaN-poisons. */
function cleanStacks(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, qty] of Object.entries(raw)) {
    if (typeof qty === 'number' && Number.isFinite(qty) && qty > 0) out[id] = Math.floor(qty);
  }
  return out;
}

function defaults(): InventoryData {
  return { version: 1, gold: STARTING_GOLD, stacks: {}, bornRelicId: null };
}

export class InventoryStore {
  private cache: InventoryData = defaults();
  private loadPromise: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private warned = false;

  constructor(private bridge: Bridge = realBridge) {}

  /** Shared in-flight load promise — a second ready() during a slow load awaits the real load. */
  ready(): Promise<void> {
    return (this.loadPromise ??= this.load());
  }

  private async load(): Promise<void> {
    const raw = await this.bridge.getState<unknown>(INV_FILE);
    if (raw === null) {
      this.cache = defaults();
      return;
    }
    if (!isInventoryData(raw)) {
      await this.bridge.putState(corruptName(INV_FILE, Date.now()), raw);
      console.warn(
        '[inventory] state/inventory.json had an unexpected shape; backed it up to an ' +
          'inventory.corrupt-*.json and started fresh (no data silently discarded).',
      );
      this.cache = defaults();
      return;
    }
    this.cache = this.normalize(raw);
  }

  /** Fill defaults, deep-copy stacks, keep foreign keys. */
  private normalize(raw: InventoryData): InventoryData {
    return { ...defaults(), ...raw, version: 1, stacks: cleanStacks(raw.stacks) };
  }

  getGold(): number {
    return this.cache.gold;
  }

  countOf(id: string): number {
    return this.cache.stacks[id] ?? 0;
  }

  /** Read-only copy of the cached wallet (safe to hold across renders). */
  snapshot(): Wallet {
    return { gold: this.cache.gold, stacks: { ...this.cache.stacks }, bornRelicId: this.bornRelic() };
  }

  /** The currently borne relic id, or null. Defensive at read time: if the id somehow
   *  isn't in stacks (relics can't be sold or wiped today, but a hand-edited save could
   *  drift), it reads as null rather than trusting the stale field. */
  bornRelic(): string | null {
    const id = this.cache.bornRelicId;
    return id !== null && (this.cache.stacks[id] ?? 0) > 0 ? id : null;
  }

  /**
   * One serialized merge-write. `fn` sees the freshest {gold, stacks} (stacks
   * already a private copy it may mutate) and returns the full next wallet, or
   * null to abort without writing (e.g. can't afford). Foreign top-level keys
   * ride along untouched.
   */
  private mutate(fn: (cur: Wallet) => Wallet | null): Promise<boolean> {
    let applied = false;
    const task = this.writeChain.then(async () => {
      const remote = await this.bridge.getState<unknown>(INV_FILE);
      const base: InventoryData = isInventoryData(remote)
        ? this.normalize(remote)
        : this.cache; // null/corrupt mid-run → build on our cache, don't lose the write
      const next = fn({ gold: base.gold, stacks: { ...base.stacks }, bornRelicId: base.bornRelicId });
      if (next === null) return;
      applied = true;
      const merged: InventoryData = {
        ...base,
        version: 1,
        gold: next.gold,
        stacks: next.stacks,
        bornRelicId: next.bornRelicId,
      };
      const ok = await this.bridge.putState(INV_FILE, merged);
      if (!ok) this.warnOnce();
      this.cache = merged; // cache reflects the latest, persisted or not
    });
    this.writeChain = task.catch(() => {}); // keep the chain alive past a failure
    return task.then(() => applied);
  }

  /** Add (or with a negative delta, deduct) gold; wallet clamps at 0. Resolves to the new total. */
  async addGold(delta: number): Promise<number> {
    await this.mutate((cur) => ({ ...cur, gold: Math.max(0, cur.gold + delta) }));
    return this.cache.gold;
  }

  /** Spend against the freshest balance; false (and no write) if it can't be afforded. */
  spendGold(cost: number): Promise<boolean> {
    if (cost <= 0) return Promise.resolve(true);
    return this.mutate((cur) => (cur.gold < cost ? null : { ...cur, gold: cur.gold - cost }));
  }

  grant(id: string, qty = 1): Promise<boolean> {
    const n = Math.floor(qty);
    if (n <= 0) return Promise.resolve(false);
    return this.mutate((cur) => {
      cur.stacks[id] = (cur.stacks[id] ?? 0) + n;
      return cur;
    });
  }

  /** Remove qty from a stack; false (and no write) if not enough are held. */
  remove(id: string, qty = 1): Promise<boolean> {
    const n = Math.floor(qty);
    if (n <= 0) return Promise.resolve(false);
    return this.mutate((cur) => {
      const held = cur.stacks[id] ?? 0;
      if (held < n) return null;
      if (held === n) delete cur.stacks[id];
      else cur.stacks[id] = held - n;
      return cur;
    });
  }

  /**
   * Atomic buy (crucible finding #6): deducts gold AND grants the item in the SAME
   * mutate() call, i.e. one read-merge-write — never spendGold() then a separate grant(),
   * whose gap a reload could land in and lose the gold without ever granting the item.
   * false (and no write at all) if the freshest balance can't afford it.
   */
  buy(id: string, cost: number, qty = 1): Promise<boolean> {
    const n = Math.floor(qty);
    if (n <= 0) return Promise.resolve(false);
    return this.mutate((cur) => {
      if (cur.gold < cost) return null;
      cur.stacks[id] = (cur.stacks[id] ?? 0) + n;
      return { ...cur, gold: cur.gold - cost };
    });
  }

  /**
   * Atomic sell (crucible finding #6): removes from stacks AND credits gold in the SAME
   * mutate() call — the sell-side mirror of buy() above. false (and no write at all) if not
   * enough of the item are held.
   */
  sell(id: string, price: number, qty = 1): Promise<boolean> {
    const n = Math.floor(qty);
    if (n <= 0) return Promise.resolve(false);
    return this.mutate((cur) => {
      const held = cur.stacks[id] ?? 0;
      if (held < n) return null;
      if (held === n) delete cur.stacks[id];
      else cur.stacks[id] = held - n;
      return { ...cur, gold: cur.gold + price };
    });
  }

  /**
   * Choose the one live relic passive, or pass null to set it down (Concordance Ch. IX:
   * "swap costs nothing"). Reads the catalog (type === 'relic') and the freshest live
   * stacks INSIDE the mutate() call, same freshness guarantee as buy/sell. false (and no
   * write) if id isn't an owned relic — same refusal idiom as buy/sell/spendGold above, not
   * a thrown rejection (uniform guarded-mutator contract; controller line-read ruling).
   * Bearing null always succeeds.
   */
  bearRelic(id: string | null): Promise<boolean> {
    return this.mutate((cur) => {
      if (id !== null) {
        const def = itemById(id);
        const owned = (cur.stacks[id] ?? 0) > 0;
        if (!def || def.type !== 'relic' || !owned) return null;
      }
      return { ...cur, bornRelicId: id };
    });
  }

  private warnOnce(): void {
    if (this.warned) return;
    this.warned = true;
    console.warn('[inventory] no state bridge — the satchel is in-memory only for this session.');
  }
}
