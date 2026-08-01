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
import { roomClearLoot, bossLoot } from '../../../inventory/economy';
import { itemById } from '../../../inventory/catalog';
import { openInventoryPane } from '../../../inventory/ui/inventoryPane';
import {
  firstUnclearedIndex,
  markRoomCleared,
  nodeState,
  type DungeonProgress,
} from './roomFlow';
import { candidateDungeonFiles, isDungeonSpec, bossQuest, rewardText } from './specResolve';
import { VaultView, type NodeHandlers } from './VaultView';
import { FIXTURE_PACK_ID } from '../../combat/fixtures';
import devSpecJson from './__fixtures__/dev.dungeon.json';
import devFactsJson from './__fixtures__/dev.facts.json';

const PENDING_KEY = 'vaults:pendingOutcome';
const PACKID_KEY = 'vaults:packId';
const RUN_HARVEST_KEY = 'vaults:runHarvest';
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

/**
 * §3.2 — the Night's Ledger tallies ACCUMULATED across a whole crawl. DungeonScene restarts on
 * every real battle (doCombat's scene.start('combat')), so run-scoped state can't live in scene
 * fields; it rides the game registry (survives scene restarts, like PENDING_KEY). In-memory only
 * — a mid-run reload forfeits the tally, which is acceptable: the harvest is a ceremony shown at
 * run end, not a persisted record.
 */
interface RunHarvest {
  /** distinct factIds answered q1 across the run — "Held against the Fade" */
  held: string[];
  reclaimed: number;
  newWelds: number;
  gold: number;
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
  private satchelBusy = false;

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
    // crucible V1-16 — dev=1 always resolves rooms/boss content from the packless
    // fixture (loadSpecAndFacts below), regardless of any real packId handed in
    // (HamletScene's chosen province, or one left in the registry from an earlier
    // real session). Letting that real id survive here used to form a fixture/real
    // hybrid: a fixture-only branchEncounterId requested against a real pack that
    // never defines it, silently substituting an unrelated real encounter mid-fight
    // (encounters/engine.ts's pick() candidates[0] fallback). Force the SAME fixture
    // marker CombatScene's own dev-boss reconciler already recognizes (crucible #11,
    // FIXTURE_PACK_ID) instead — never a stale real id — so doCombat/runGate below
    // always launch an all-fixture or all-real object, never a mix.
    this.packId = this.dev
      ? null
      : (data?.packId ?? (this.registry.get(PACKID_KEY) as string | undefined) ?? null);
    this.busy = false;
    this.didReady = false;
    this.facts = new Map();
    this.pack = null;
  }

  create(): void {
    // The Ledger Deep — the vaults' hushed explore leitmotif (supersedes the v1
    // deliberate-silence design). Combat returns via scene.start, so this same
    // line also swaps the battle motif back to the explore theme after a fight.
    try {
      music.play('vaults');
    } catch {
      /* audio is optional; never let it block the scene */
    }
    this.view = new VaultView(this);
    this.handlers = {
      onRoom: (i) => this.onRoom(i),
      onCamp: () => void this.onCamp(),
      onSatchel: () => void this.onSatchel(),
    };
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
    await services.inventory.ready(); // warms the wallet before the camp satchel button can be used
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

    // §3.2 — no pending outcome means a fresh vault entry (not a battle return): start a new
    // crawl's Night's Ledger harvest. Battle returns above skip this, so the tally accumulates.
    this.resetHarvest();

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
        `The archive holds no charted map for "${this.packId}" — its vaults remain unmarked.`,
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
    // supersession-reteach.md §4 — an outdated truth must never be re-taught as current, and
    // the new truth waits for the Clerk's ceremony; both are suspended facts. Tolerant of a
    // stub amendments service (then nothing is suspended and the room teaches as before).
    let ids = room.teaching ?? [];
    try { ids = services.amendments.eligible(ids); } catch { /* stub/offline */ }
    return ids.map((id) => this.facts.get(id)).filter((f): f is FactLite => !!f);
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
      // crucible V1-20 — 'continue' used to only focusNode() (a cosmetic pulse tween)
      // instead of actually entering the room, leaving scene/progress unchanged.
      if (choice === 'camp') void this.onCamp();
      else void this.enterRoom(idx);
    });
  }

  // ---- room sequence --------------------------------------------------------

  private async enterRoom(index: number, opts: { mode?: 'card' | 'drive' } = {}): Promise<void> {
    if (this.busy) return;

    // crucible #7 — re-entering a room (and thus combat) at 0 pooled HP used to skip the
    // turn engine straight into an unwinnable instant defeat (checkEnd sees no living party
    // unit before the player can ever act), so combat must never launch at 0 HP.
    // crucible V1-1 — bouncing the player all the way to hamlet here (as runGate's and
    // resolveCombat's retreat branches correctly do when the Fade wins mid-crawl) used to be
    // a dead-end signpost-wise instead: hamlet shows no HP indicator, so a player who wandered
    // back in at 0 HP saw nothing wrong, and the vaults' own halo affordance points straight
    // back at this exact "wrong" node. Route through onCamp()'s own heal-and-toast in place
    // instead (it owns `busy` for the card it shows) — the wrong click becomes the fix.
    if (services.save.get().hp <= 0) {
      this.view.toast("The Fade recoils at the threshold — it carries you back to the camp's hearth.", 'warn');
      // dev auto-drivers (?auto=) must never block on a click that will never come — mirrors
      // runAuto()'s own 'camp' case, which passes persist:true for the same reason.
      await this.onCamp({ persist: !!this.auto });
      return;
    }

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
          packId: this.packId ?? FIXTURE_PACK_ID,
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
      // crucible V1-3 — persist scene:'hamlet' BEFORE starting the scene (bossVictory's
      // pattern below), so a reload in the ~1s toast window resumes hamlet, matching what
      // the player actually sees, instead of reopening the resume-choice dialog in vaults.
      await services.save.save({ scene: 'hamlet' });
      // progress was persisted before combat — only the loot roll is forfeit (never story)
      this.view.toast('The Fade closes in — you wake at the hamlet camp.', 'warn');
      await this.wait(1000);
      // §3.2 the Night's Ledger — the run ends here; fold this last battle in, then show the whole
      // crawl's harvest before the walk home (no loot on a retreat, streak unchanged).
      this.accrueHarvest(outcome, 0);
      await this.runNightLedger('retreat', services.save.get().streak);
      this.scene.start('hamlet', { seed: this.seed });
      return { transitioned: true };
    }

    // crucible V1-12 — credit the combat win (mark + persist) immediately, before any
    // gate runs, so a gate wipe (HP exhausted mid-drill, below) can never re-litigate a
    // fight already won (Fable_SPEC.md:31 — wipes cost the loot roll, never story
    // progress). Idempotent, so bossVictory's own final save just carries this forward.
    this.progress = markRoomCleared(this.progress, room.id, this.spec.rooms);
    await services.save.save({ dungeon: this.progress });

    // gate door must open before the node can clear
    if (room.gate) {
      const gate = await this.runGate(room);
      if (gate.transitioned) return { transitioned: true };
    }

    if (room.boss) {
      await this.bossVictory(outcome);
      return { transitioned: true };
    }

    // normal / gate room cleared → bump the streak, unlock next, loot (inventory-handoff §4)
    // crucible #5 — the hearth streak used to bump independently inside CombatScene the
    // instant victory was declared (persisted well before this resume-only settlement could
    // ever run), so a reload in that gap kept the streak but lost this room's progress/loot.
    // Bumping it HERE instead — in the same save call as dungeon progress, only reachable
    // once the pending outcome has actually been recovered — means a reload before this
    // point loses (or a completed run keeps) the streak together with everything else.
    const streak = services.save.get().streak + 1;
    await services.save.save({ dungeon: this.progress, streak });
    this.drawMap();
    this.refreshStatus();
    const gold = await this.grantRoomLoot(room);
    // §3.2 — fold this room into the run harvest; the Night's Ledger shows ONLY at run end (boss
    // victory / retreat), never mid-crawl (a per-room card would be five interruptions per vault).
    this.accrueHarvest(outcome, gold);
    this.busy = false;
    return { transitioned: false };
  }

  /** Room-clear gold + a 35% trinket roll, banked immediately (inventory-handoff §4). Returns the
   *  gold granted, for the Night's Ledger harvest (§3.2). */
  private async grantRoomLoot(room: DungeonRoom): Promise<number> {
    const roomIndex = this.spec.rooms.findIndex((r) => r.id === room.id);
    const rng = mulberry32((this.seed + roomIndex * 7919 + 1) >>> 0);
    const loot = roomClearLoot(roomIndex, rng);
    await services.inventory.addGold(loot.gold);
    if (loot.trinketId) await services.inventory.grantItem(loot.trinketId);
    const trinketName = loot.trinketId ? itemById(loot.trinketId)?.name : null;
    this.view.lootToast(
      trinketName
        ? `${room.name} falls quiet. +${loot.gold} coin, and a ${trinketName} glints in the dust.`
        : `${room.name} falls quiet. +${loot.gold} coin.`,
    );
    return loot.gold;
  }

  /** §3.2 — start a fresh crawl's harvest (called on a fresh vault entry, not a battle return). */
  private resetHarvest(): void {
    this.registry.set(RUN_HARVEST_KEY, { held: [], reclaimed: 0, newWelds: 0, gold: 0 } as RunHarvest);
  }

  /** §3.2 — fold one battle's outcome (+ its room loot) into the run harvest. "Held" is a distinct
   *  factId set across the whole crawl; reclaimed/newWelds/gold sum. Called on EVERY battle result. */
  private accrueHarvest(outcome: CombatOutcome, gold: number): void {
    const h = (this.registry.get(RUN_HARVEST_KEY) as RunHarvest | undefined) ?? {
      held: [], reclaimed: 0, newWelds: 0, gold: 0,
    };
    const held = new Set(h.held);
    for (const r of outcome.results) if (r.quality === 1) for (const id of r.factIds) held.add(id);
    this.registry.set(RUN_HARVEST_KEY, {
      held: [...held],
      reclaimed: h.reclaimed + (outcome.reclaimed ?? 0),
      newWelds: h.newWelds + (outcome.newWelds ?? 0),
      gold: h.gold + gold,
    } as RunHarvest);
  }

  /**
   * §3.2 — the Night's Ledger run-harvest overlay (encounters agent's UI, via services). Shows the
   * WHOLE crawl accumulated in the registry (not just the last battle). Fires only at run end —
   * boss victory and retreat. Best-effort: a missing overlay service must never strand the walk home.
   */
  private async runNightLedger(kind: 'victory' | 'retreat', streak: number): Promise<void> {
    const h = (this.registry.get(RUN_HARVEST_KEY) as RunHarvest | undefined) ?? {
      held: [], reclaimed: 0, newWelds: 0, gold: 0,
    };
    try {
      await services.showNightLedger(
        { outcome: kind, held: h.held.length, welds: h.newWelds, reclaimed: h.reclaimed, gold: h.gold, streak },
        { auto: !!this.auto },
      );
    } catch {
      /* best-effort: never block the walk home */
    }
  }

  /** free_recall gate: pass (≥0.5) opens; miss costs HP with immediate retry; HP-out = Fade retreat. */
  private async runGate(room: DungeonRoom): Promise<{ transitioned: boolean }> {
    const gate = room.gate!;
    for (let attempt = 0; attempt < 20; attempt++) {
      const res = await services.runEncounter({
        context: 'drill',
        encounterId: gate.encounterId,
        kinds: ['free_recall'],
        packId: this.packId ?? FIXTURE_PACK_ID,
        seed: this.seed + attempt,
      });
      // Record the gate drill to SRS on BOTH paths, before branching — a failed ward
      // is exactly the Leitner demotion signal, and it was being dropped. (Combat
      // records its own encounters; the gate is the one encounter we run ourselves.)
      for (const fid of res.factIds) {
        await services.srs.record(fid, res.quality, res.encounterId, this.facts.get(fid)?.type);
      }
      if (res.quality >= 0.5) {
        this.view.toast('The ward yields. The door grinds open.', 'good');
        return { transitioned: false };
      }
      await this.applyHp(-GATE_FAIL_HP);
      this.refreshStatus();
      this.view.toast(`The door holds fast. (-${GATE_FAIL_HP} HP)`, 'warn');
      if (services.save.get().hp <= 0) {
        // crucible V1-3 — persist scene:'hamlet' before scene.start (bossVictory's
        // pattern), so a reload in the ~1s toast window resumes hamlet, not a
        // resume-choice dialog back in vaults.
        await services.save.save({ scene: 'hamlet' });
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

  private async bossVictory(outcome: CombatOutcome): Promise<void> {
    // already marked + persisted by resolveCombat right after combat victory (crucible V1-12)
    const streak = services.save.get().streak + 1;
    const reward = (this.pack ? rewardText(bossQuest(this.pack)) : null) ?? DEV_REWARD;

    // Boss bounty: gold + the guaranteed Warden Signet + a boss-weighted trinket (inventory-handoff §4).
    const rng = mulberry32((this.seed + 104729) >>> 0);
    const loot = bossLoot(rng);
    await services.inventory.addGold(loot.gold);
    await services.inventory.grantItem(loot.relicId);
    if (loot.trinketId) await services.inventory.grantItem(loot.trinketId);
    const trinketName = loot.trinketId ? itemById(loot.trinketId)?.name : null;
    const lootLine = trinketName
      ? ` The Warden yields ${loot.gold} coin, their signet, and a ${trinketName}.`
      : ` The Warden yields ${loot.gold} coin and their signet.`;

    await services.save.save({ dungeon: this.progress, streak, scene: 'hamlet' });
    // §3.2 — fold the boss battle + bounty into the run harvest; the finale plays its full staged
    // reveal FIRST, then the accumulated Night's Ledger, then home.
    this.accrueHarvest(outcome, loot.gold);
    await this.view.vaultOpensBeat(reward + lootLine, streak);
    await this.runNightLedger('victory', streak);
    this.scene.start('hamlet', { seed: this.seed });
  }

  /** Open the Satchel from the camp card (inventory-handoff §9). Not gated on `busy` —
   *  the camp card that hosts this button holds `busy` true for its whole lifetime. */
  private async onSatchel(): Promise<void> {
    if (this.satchelBusy) return;
    this.satchelBusy = true;
    try {
      this.input.keyboard!.enabled = false;
      await openInventoryPane();
      this.input.keyboard!.enabled = true;
      this.input.keyboard!.resetKeys();
    } finally {
      this.satchelBusy = false;
    }
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

/** Deterministic PRNG for loot rolls (same tiny mulberry32 as VaultView.ts/HamletScene.ts). */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
