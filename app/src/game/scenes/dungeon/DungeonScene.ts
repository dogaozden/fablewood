/**
 * The Preference Vaults — dungeon node-crawl (slice-blueprint §4). Loads a pack's
 * DungeonSpec (or a bundled fixture on the packless dev path), renders the vault
 * map strip via VaultView, and runs the per-room sequence: teach → fight → (gate)
 * → clear → unlock. Combat is a separate scene; this one is fully save-resumable
 * because combat returns via scene.start (a full restart), so all durable state
 * lives in save.dungeon + the game registry.
 *
 * OWNS: everything under scenes/dungeon/. Talks to other systems only through
 * `services.*` and the orchestrator-owned contracts — never provider internals.
 */
import Phaser from 'phaser';
import { markReady } from '../../ready';
import {
  services,
  type CombatLaunch,
  type CombatOutcome,
  type DungeonSpec,
  type DungeonRoom,
  type FactLite,
} from '../../contracts';
import type { Fact, Pack } from '../../../packs/types';
import { getPacks, getPackAsset } from '../../../bridge/client';
import { music } from '../../../music/instance';
import {
  firstUnclearedIndex,
  markRoomCleared,
  nodeState,
  type DungeonProgress,
} from './roomFlow';
import { candidateDungeonFiles, isDungeonSpec, bossQuest, rewardText } from './specResolve';
import { VaultView, type NodeHandlers } from './VaultView';
import devSpecJson from './__fixtures__/dev.dungeon.json';
import devFactsJson from './__fixtures__/dev.facts.json';

const PENDING_KEY = 'vaults:pendingOutcome';
const PACKID_KEY = 'vaults:packId';
/** Party HP pool = Keeper 10 + Mira 6 (blueprint §3). Shared assumption with combat. */
const PARTY_MAX_HP = 16;
const GATE_FAIL_HP = 1;
const SIM_COMBAT_MS = 700;
const READY_FALLBACK_MS = 8000;
const DEV_REWARD = 'the Undercroft falls quiet, and one knot in the Fade comes undone';

interface Pending {
  roomId: string;
  outcome: CombatOutcome;
}

export class DungeonScene extends Phaser.Scene {
  private seed = 0;
  private packId: string | null = null;
  private dev = false;
  private sim = false;
  private auto: string | null = null;

  private spec!: DungeonSpec;
  private facts = new Map<string, FactLite>();
  private pack: Pack | null = null;
  private progress: DungeonProgress = { roomIndex: 0, cleared: [] };

  private view!: VaultView;
  private handlers!: NodeHandlers;
  private busy = false;
  private didReady = false;

  constructor() {
    super('vaults');
  }

  init(data: { seed?: number; packId?: string }): void {
    this.seed = data?.seed ?? 0;
    const params = new URLSearchParams(window.location.search);
    this.dev = params.get('dev') === '1';
    const simParam = params.get('sim');
    this.sim = simParam !== null ? simParam === '1' : this.dev; // sim closes the loop on the packless dev path
    this.auto = params.get('auto');
    this.packId =
      data?.packId ?? (this.registry.get(PACKID_KEY) as string | undefined) ?? null;
    this.busy = false;
    this.didReady = false;
    this.facts = new Map();
    this.pack = null;
  }

  create(): void {
    // The Vaults explore in tense silence — the battle theme hits only when combat
    // starts, and that contrast is deliberate (stops the hamlet motif on entry, and
    // the battle motif when combat returns us here).
    music.stop();
    this.view = new VaultView(this);
    this.handlers = { onRoom: (i) => this.onRoom(i), onCamp: () => void this.onCamp() };
    this.view.renderChrome();
    // hard safety net: a screenshot/e2e must never hang waiting on __FABLEWOOD_READY
    this.time.delayedCall(READY_FALLBACK_MS, () => this.markReadyOnce());
    this.bootFlow().catch((err) => {
      this.view.errorToast(errMsg(err));
      this.markReadyOnce();
    });
  }

  private markReadyOnce(): void {
    if (this.didReady) return;
    this.didReady = true;
    markReady({ scene: 'vaults', title: 'FABLEWOOD', seed: this.seed });
  }

  private async bootFlow(): Promise<void> {
    await services.save.ready();
    await services.srs.ready(); // the gate drill records to SRS — load Leitner state first
    await this.loadSpecAndFacts();

    this.progress = this.readProgress();
    this.view.setHeader(this.spec.name, this.spec.region);
    this.drawMap();
    this.refreshStatus();

    const pending = this.registry.get(PENDING_KEY) as Pending | undefined;
    if (pending) {
      this.registry.remove(PENDING_KEY);
      const { transitioned } = await this.resolveCombat(pending.roomId, pending.outcome);
      if (!transitioned) this.markReadyOnce();
      return;
    }

    if (this.auto) {
      await this.runAuto();
      this.markReadyOnce();
      return;
    }

    this.markReadyOnce();
    if (this.hasResumableProgress()) this.offerResume();
  }

  // ---- loading --------------------------------------------------------------

  private async loadSpecAndFacts(): Promise<void> {
    if (this.dev) return this.useFixture();

    const { packs } = await getPacks();
    if (!packs.length) return this.useFixture();

    const entry = this.packId ? packs.find((p) => p.id === this.packId) : packs[0];
    if (!entry) return this.useFixture();

    this.packId = entry.id;
    this.registry.set(PACKID_KEY, this.packId);
    const pack = entry.pack as Pack;
    this.pack = pack;
    this.facts = toFactMap((pack.facts ?? []).map(toFactLite));

    const files = candidateDungeonFiles(pack);
    let spec: DungeonSpec | null = null;
    for (const file of files) {
      const res = await getPackAsset(this.packId, file);
      if (!res) continue;
      const json = await res.json().catch(() => null);
      if (isDungeonSpec(json)) {
        spec = json;
        break;
      }
    }
    if (!spec) {
      throw new Error(
        `no dungeon spec found in pack "${this.packId}" (looked for ${files.join(', ')})`,
      );
    }
    this.spec = spec;
  }

  private useFixture(): void {
    this.spec = devSpecJson as unknown as DungeonSpec;
    this.facts = toFactMap(devFactsJson as unknown as FactLite[]);
    this.pack = null;
  }

  private readProgress(): DungeonProgress {
    const d = services.save.get().dungeon;
    if (d && Array.isArray(d.cleared)) {
      // only trust cleared ids that exist in *this* spec (guards a stale save vs a changed pack)
      const valid = d.cleared.filter((id) => this.spec.rooms.some((r) => r.id === id));
      return { roomIndex: firstUnclearedIndex(this.spec.rooms, valid), cleared: valid };
    }
    return { roomIndex: 0, cleared: [] };
  }

  private hasResumableProgress(): boolean {
    return this.progress.cleared.length > 0 && !this.allCleared();
  }

  private allCleared(): boolean {
    return firstUnclearedIndex(this.spec.rooms, this.progress.cleared) >= this.spec.rooms.length;
  }

  // ---- map + status ---------------------------------------------------------

  private drawMap(): void {
    this.view.renderMap(this.spec, this.progress, this.handlers);
  }

  private refreshStatus(): void {
    const sd = services.save.get();
    this.view.setStatus(sd.hp, PARTY_MAX_HP, sd.streak);
  }

  private teachingFacts(room: DungeonRoom): FactLite[] {
    return (room.teaching ?? [])
      .map((id) => this.facts.get(id))
      .filter((f): f is FactLite => !!f);
  }

  // ---- node interaction -----------------------------------------------------

  private onRoom(index: number): void {
    if (this.busy) return;
    const state = nodeState(index, this.spec.rooms, this.progress.cleared);
    if (state === 'locked') {
      this.view.toast('The way is sealed — clear the vault before it.', 'warn');
      this.view.shakeNode(index);
      return;
    }
    if (state === 'cleared') {
      const room = this.spec.rooms[index];
      void this.view.showBlurbCard(room, this.teachingFacts(room), { revisit: true });
      return;
    }
    void this.enterRoom(index);
  }

  private async onCamp(opts: { persist?: boolean } = {}): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const before = services.save.get().hp;
    await services.save.save({ hp: PARTY_MAX_HP, scene: 'vaults', dungeon: this.progress });
    this.refreshStatus();
    await this.view.showCampCard(opts.persist ? 'persist' : 'wait', { before, after: PARTY_MAX_HP });
    this.busy = false;
  }

  private offerResume(): void {
    const idx = Math.min(
      firstUnclearedIndex(this.spec.rooms, this.progress.cleared),
      this.spec.rooms.length - 1,
    );
    const name = this.spec.rooms[idx]?.name ?? 'the descent';
    void this.view.showResumeChoice(name).then((choice) => {
      if (choice === 'camp') void this.onCamp();
      else this.view.focusNode(idx);
    });
  }

  // ---- room sequence --------------------------------------------------------

  private async enterRoom(index: number, opts: { mode?: 'card' | 'drive' } = {}): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const room = this.spec.rooms[index];
    const facts = this.teachingFacts(room);

    // 'card' (dev screenshot): show my entry card and stop — never opens the
    // teaching modal (which awaits a dismiss and would hang a headless capture).
    if (opts.mode === 'card') {
      await this.view.showBlurbCard(room, facts, { mode: 'persist' });
      this.busy = false;
      return;
    }

    const driving = opts.mode === 'drive';
    await this.view.showBlurbCard(room, facts, { mode: driving ? 'auto' : 'wait' });
    // discovered documents (encounters agent's modal) — skipped only in auto-drive
    if (!driving && room.teaching?.length) await services.showTeaching(facts);

    // teeth-but-fair: persist progress BEFORE combat so a wipe never costs story
    await services.save.save({ scene: 'vaults', dungeon: this.progress });
    await this.doCombat(room);
  }

  /**
   * Hand off to combat. sim=true (dev / packless) synthesizes a victory inline so
   * the loop closes without the real CombatScene; otherwise scene.start('combat')
   * and a one-shot game-level listener stashes the outcome for our next create().
   */
  private doCombat(room: DungeonRoom): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.sim) {
        void this.view.combatFlash(room).then(() => {
          this.time.delayedCall(SIM_COMBAT_MS, () => {
            const outcome: CombatOutcome = { outcome: 'victory', hpLost: 0, results: [] };
            void this.resolveCombat(room.id, outcome).then(() => resolve());
          });
        });
      } else {
        this.game.events.once('combat:resolved', (outcome: CombatOutcome) => {
          this.registry.set(PENDING_KEY, { roomId: room.id, outcome } as Pending);
        });
        const launch: CombatLaunch = {
          packId: this.packId ?? 'dev',
          room,
          seed: this.seed,
          returnScene: 'vaults',
        };
        this.scene.start('combat', launch);
        // this scene shuts down here; the promise never resolves (dev awaits use sim)
      }
    });
  }

  private async resolveCombat(
    roomId: string,
    outcome: CombatOutcome,
  ): Promise<{ transitioned: boolean }> {
    const room = this.spec.rooms.find((r) => r.id === roomId);
    if (!room) {
      this.busy = false;
      return { transitioned: false };
    }

    await this.applyHp(-outcome.hpLost);

    if (outcome.outcome === 'retreat') {
      // progress was persisted before combat — only the loot roll is forfeit (never story)
      this.view.toast('The Fade closes in — you wake at the hamlet camp.', 'warn');
      await this.wait(1000);
      this.scene.start('hamlet', { seed: this.seed });
      return { transitioned: true };
    }

    // gate door must open before the node can clear
    if (room.gate) {
      const gate = await this.runGate(room);
      if (gate.transitioned) return { transitioned: true };
    }

    if (room.boss) {
      await this.bossVictory(room);
      return { transitioned: true };
    }

    // normal / gate room cleared → mark, persist, unlock next, loot
    this.progress = markRoomCleared(this.progress, room.id, this.spec.rooms);
    await services.save.save({ dungeon: this.progress });
    this.drawMap();
    this.refreshStatus();
    this.view.lootToast(`${room.name} falls quiet. You pocket a Faded Coin.`);
    this.busy = false;
    return { transitioned: false };
  }

  /** free_recall gate: pass (≥0.5) opens; miss costs HP with immediate retry; HP-out = Fade retreat. */
  private async runGate(room: DungeonRoom): Promise<{ transitioned: boolean }> {
    const gate = room.gate!;
    for (let attempt = 0; attempt < 20; attempt++) {
      const res = await services.runEncounter({
        context: 'drill',
        encounterId: gate.encounterId,
        kinds: ['free_recall'],
        packId: this.packId ?? 'dev',
        seed: this.seed + attempt,
      });
      // Record the gate drill to SRS on BOTH paths, before branching — a failed ward
      // is exactly the Leitner demotion signal, and it was being dropped. (Combat
      // records its own encounters; the gate is the one encounter we run ourselves.)
      for (const fid of res.factIds) await services.srs.record(fid, res.quality, res.encounterId);
      if (res.quality >= 0.5) {
        this.view.toast('The ward yields. The door grinds open.', 'good');
        return { transitioned: false };
      }
      await this.applyHp(-GATE_FAIL_HP);
      this.refreshStatus();
      this.view.toast(`The door holds fast. (-${GATE_FAIL_HP})`, 'warn');
      if (services.save.get().hp <= 0) {
        this.view.toast('The Fade closes in — you wake at the hamlet camp.', 'warn');
        await this.wait(1000);
        this.scene.start('hamlet', { seed: this.seed });
        return { transitioned: true };
      }
    }
    // safety valve — never hard-lock the crawl
    this.view.toast('The ward finally yields.', 'good');
    return { transitioned: false };
  }

  private async bossVictory(room: DungeonRoom): Promise<void> {
    this.progress = markRoomCleared(this.progress, room.id, this.spec.rooms);
    const streak = services.save.get().streak + 1;
    const reward = (this.pack ? rewardText(bossQuest(this.pack)) : null) ?? DEV_REWARD;
    await services.save.save({ dungeon: this.progress, streak, scene: 'hamlet' });
    await this.view.vaultOpensBeat(reward, streak);
    this.scene.start('hamlet', { seed: this.seed });
  }

  private async applyHp(delta: number): Promise<void> {
    if (!delta) return;
    const cur = services.save.get().hp ?? PARTY_MAX_HP;
    const hp = Math.max(0, Math.min(PARTY_MAX_HP, cur + delta));
    await services.save.save({ hp });
  }

  // ---- dev screenshot driver (only fires with ?auto=) -----------------------

  private async runAuto(): Promise<void> {
    const rooms = this.spec.rooms;
    const first = firstUnclearedIndex(rooms, this.progress.cleared);
    switch (this.auto) {
      case 'enter':
        if (first < rooms.length) await this.enterRoom(first, { mode: 'card' });
        break;
      case 'win':
        if (first < rooms.length) await this.enterRoom(first, { mode: 'drive' });
        break;
      case 'teach': {
        // integration capture: the encounters modal fed by our resolved facts
        const room = rooms[first < rooms.length ? first : 0];
        this.markReadyOnce();
        void services.showTeaching(this.teachingFacts(room));
        break;
      }
      case 'camp':
        await this.onCamp({ persist: true });
        break;
      case 'full': {
        // full-playthrough smoke: drive every room in order (teach → sim fight →
        // gate → clear), ending on the boss finale → hamlet. Exercises the gate.
        for (let guard = 0; guard < rooms.length + 2; guard++) {
          const idx = firstUnclearedIndex(rooms, this.progress.cleared);
          if (idx >= rooms.length) break;
          await this.enterRoom(idx, { mode: 'drive' });
        }
        break;
      }
      case 'boss':
      case 'bossbeat': {
        const bossIdx = rooms.findIndex((r) => r.boss);
        for (let i = 0; i < bossIdx; i++) {
          this.progress = markRoomCleared(this.progress, rooms[i].id, rooms);
        }
        await services.save.save({ dungeon: this.progress });
        this.drawMap();
        if (bossIdx < 0) break;
        if (this.auto === 'bossbeat') {
          const reward = (this.pack ? rewardText(bossQuest(this.pack)) : null) ?? DEV_REWARD;
          await this.view.vaultOpensBeat(reward, services.save.get().streak + 1, { hold: true });
        } else {
          await this.enterRoom(bossIdx, { mode: 'drive' });
        }
        break;
      }
      default:
        break;
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }
}

// ---- helpers ----------------------------------------------------------------

function toFactLite(f: Fact): FactLite {
  return {
    id: f.id,
    type: f.type,
    statement: f.statement,
    detail: f.detail,
    source_ref: f.source_ref
      ? {
          file: f.source_ref.file,
          loc: f.source_ref.loc == null ? undefined : String(f.source_ref.loc),
          quote: f.source_ref.quote,
        }
      : undefined,
  };
}

function toFactMap(facts: FactLite[]): Map<string, FactLite> {
  return new Map(facts.map((f) => [f.id, f]));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
