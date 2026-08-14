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
import { embersOf, TRIM_HEAL_CORRECT, TRIM_HEAL_MISS } from '../../rest/embers';
import { seededShuffle } from '../../recency';
import type { Fact, Pack } from '../../../packs/types';
import { getPacks, getPackAsset } from '../../../bridge/client';
import { music } from '../../../music/instance';
import { roomClearLoot, bossLoot, type Edge } from '../../../inventory/economy';
import { itemById } from '../../../inventory/catalog';
import { openInventoryPane } from '../../../inventory/ui/inventoryPane';
import {
  firstUnclearedIndex,
  markGatePending,
  markRoomCleared,
  nodeState,
  type DungeonProgress,
} from './roomFlow';
import { candidateDungeonFiles, isDungeonSpec, bossQuest, rewardText, rewardXp } from './specResolve';
import { VaultView, type NodeHandlers } from './VaultView';
import { FIXTURE_PACK_ID } from '../../combat/fixtures';
import devSpecJson from './__fixtures__/dev.dungeon.json';
import devFactsJson from './__fixtures__/dev.facts.json';
import { grantXp } from '../../progression/grant';
import { levelUpRows } from '../../progression/ceremony';
import { maxHpForLevel } from '../../progression/xp';

const PENDING_KEY = 'vaults:pendingOutcome';
const PACKID_KEY = 'vaults:packId';
const RUN_HARVEST_KEY = 'vaults:runHarvest';
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
  /** wave 1 — whether THIS crawl's fact lookup + teaching draws go through the global draw
   *  index (every installed pack) or the pre-wave-1 single-pack chain. Decided once, in
   *  loadSpecAndFacts(); see dungeonDrawReady() for the two ways it lands false. */
  private drawGlobal = false;
  /** Test-support only: fact ids resolved by the most recent teachingFacts() call
   *  (e2e-interleave's teaching-mix.spec.ts reads this via dungeonTeachingDebug() to prove
   *  which pack(s) a teaching room actually introduced from). Replaced on every call. */
  private teachingSurfaced: string[] = [];

  private view!: VaultView;
  private handlers!: NodeHandlers;
  private busy = false;
  private didReady = false;
  private satchelBusy = false;
  /** Trim the Lantern's own lock — never `busy`/`satchelBusy` (the camp card that hosts this
   *  button holds neither for its lifetime; see onSatchel's own precedent). */
  private trimBusy = false;
  /** Debug only: the most recently resolved Trim encounter's quality, and the net count of
   *  Embers Trim has actually spent this scene lifetime (a spend immediately undone by a
   *  packless-edge refund does not count). See trimDebug(). */
  private trimLastQuality: number | null = null;
  private trimEmbersSpent = 0;

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
    this.drawGlobal = false;
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
      onTrim: () => void this.onTrim(),
    };
    this.view.renderChrome(this.handlers.onTrim);
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

    // Wave-1 draw service (design §5) — teaching may introduce material from ANY installed
    // pack, so the fact lookup spans the global draw index rather than just this crawl's own
    // launch pack. dungeonDrawReady() mirrors combatDrawReady()/wellspringDrawReady(): only an
    // index-load failure falls back to the legacy single-pack lookup below.
    this.drawGlobal = await dungeonDrawReady();
    this.facts = this.drawGlobal
      ? toFactMap(
          services.draw
            .allFactIds()
            .map((id) => services.draw.factOf(id))
            .filter((f): f is Fact => !!f)
            .map(toFactLite),
        )
      : toFactMap((pack.facts ?? []).map(toFactLite));

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
      // same guard for a shut ward: only a room *this* spec still gates, and only one the
      // save does not also call cleared, is a ward the crawl can still be standing before.
      const pending = this.spec.rooms.find((r) => r.id === d.gatePending && !!r.gate);
      const gatePending = pending && !valid.includes(pending.id) ? pending.id : undefined;
      return { roomIndex: firstUnclearedIndex(this.spec.rooms, valid), cleared: valid, gatePending };
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
    const lvl = sd.level ?? 1;
    this.view.setStatus(sd.hp, maxHpForLevel(lvl), sd.streak, embersOf(sd), lvl, sd.lanternLight ?? false);
  }

  private teachingFacts(room: DungeonRoom, roomIndex: number): FactLite[] {
    let ids: string[];
    if (this.drawGlobal) {
      // Wave-1 draw service (design §5) — room.teaching's literal fact ids are schema-tolerated
      // but IGNORED here: a teaching room introduces the next new material from ANY installed
      // pack (services.draw.fresh) instead of a fixed author-picked list. Its LENGTH still tunes
      // how many facts this room introduces (defaults to 2 when the room has no teaching field
      // at all). Amendment-suspension is handled inside fresh() itself (draw/register.ts's
      // `eligible` dep), so no separate services.amendments.eligible() pass is needed here.
      //
      // Seed varies per ROOM, not a scene-constant — a frozen seed would let drawNew's
      // rotation-start pack monopolize every teaching room's introductions for the whole crawl
      // (T8's seed-trap discovery: a fixed seed still returns an interleaved array, but the
      // SAME pack leads every single draw for the scene's lifetime).
      const count = room.teaching?.length ?? 2;
      const seed = (this.seed + roomIndex * 7919 + 3) >>> 0;
      ids = services.draw.fresh({ count, seed, now: Date.now() });
      // fix round 1 (certification finding) — an EXHAUSTED global pool (every installed fact
      // already has an SRS record) returns [] here, which used to leave the room dead: no
      // card, no modal, even though the pre-wave-1 room always had content (its authored
      // scroll never depended on SRS history). Fall back to that scripted content — a re-read,
      // not new material — rather than go silent. A PARTIAL draw (>=1 fresh fact) stands as
      // published, uncombined with the scripted ids: new-first is the design, not a top-up.
      if (ids.length === 0) ids = this.scriptedTeachingIds(room);
    } else {
      // Draw-index-down fallback: the pre-wave-1 literal-ids chain, verbatim.
      ids = this.scriptedTeachingIds(room);
    }
    const facts = ids.map((id) => this.facts.get(id)).filter((f): f is FactLite => !!f);
    this.teachingSurfaced = facts.map((f) => f.id);
    return facts;
  }

  /** The pre-wave-1 authored scroll: room.teaching's literal ids, amendment-filtered. Used as
   *  teachingFacts()'s legacy (draw-index-down) path AND — fix round 1 — as the drawGlobal
   *  path's exhausted-pool fallback (services.draw.fresh() found nothing left unseen).
   *  supersession-reteach.md §4 — an outdated truth must never be re-taught as current, and the
   *  new truth waits for the Clerk's ceremony; both are suspended facts. Tolerant of a stub
   *  amendments service (then nothing is suspended and the room teaches as authored). */
  private scriptedTeachingIds(room: DungeonRoom): string[] {
    let ids = room.teaching ?? [];
    try { ids = services.amendments.eligible(ids); } catch { /* stub/offline */ }
    return ids;
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
      void this.view.showBlurbCard(room, this.teachingFacts(room, index), { revisit: true });
      return;
    }
    void this.enterRoom(index);
  }

  private async onCamp(opts: { persist?: boolean } = {}): Promise<void> {
    // The hearth is its own map node (VaultView.campNode → handlers.onCamp), not routed through
    // onRoom's busy guard — so a held lock (066ca1f: resolveCombat holds `busy` across its whole
    // settlement, and the map is drawn partway through that window) used to drop this click with
    // zero trace. For a 0-HP party the hearth is the only way to heal, so a silent no-op here
    // reads as a soft-lock. Reject visibly instead (onRoom's own locked-node pattern below); the
    // player can just click the hearth again once the lock clears.
    if (this.busy) {
      this.view.toast('The hearth is still settling — give it a breath.', 'warn');
      return;
    }
    this.busy = true;
    const before = services.save.get().hp;
    const after = maxHpForLevel(services.save.get().level ?? 1);
    await services.save.save({ hp: after, scene: 'vaults', dungeon: this.progress });
    this.refreshStatus();
    await this.view.showCampCard(opts.persist ? 'persist' : 'wait', { before, after });
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
    const facts = this.teachingFacts(room, index);

    // 'card' (dev screenshot): show my entry card and stop — never opens the
    // teaching modal (which awaits a dismiss and would hang a headless capture).
    if (opts.mode === 'card') {
      await this.view.showBlurbCard(room, facts, { mode: 'persist' });
      this.busy = false;
      return;
    }

    // A ward left shut by an HP-out mid-drill (resolveCombat's gatePending): the fight here
    // is already won and must never be re-fought, so skip the teaching and the battle and
    // settle straight back into the gate. resolveCombat owns `busy` from here.
    if (this.progress.gatePending === room.id) {
      await this.resolveCombat(room.id, { outcome: 'victory', hpLost: 0, results: [] });
      return;
    }

    const driving = opts.mode === 'drive';
    await this.view.showBlurbCard(room, facts, { mode: driving ? 'auto' : 'wait' });
    // discovered documents (encounters agent's modal) — skipped only in auto-drive. Gates on
    // the RESOLVED facts, not room.teaching (schema-tolerated-ignored post-conversion, design
    // §5): a room with no authored teaching field can still introduce fresh material
    // (teachingFacts()'s count defaults to 2), and the blurb card's teaser line above is
    // already driven by facts.length (VaultView.showBlurbCard's hasTeaser) — this must track
    // the same value, or the teaser's "the ledger will show them" promise goes unfulfilled.
    if (!driving && facts.length) await services.showTeaching(facts);

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
    // crucible-2 — this method RELEASES `busy` on every exit that leaves us in the vaults,
    // but only doCombat's sim path ever took it (enterRoom's acquire upstream). On the
    // battle-return path (bootFlow's pending outcome) the whole settlement — HP, progress,
    // the gate drill, the streak, the loot grant — therefore ran with the map drawn and
    // unlocked, so a click on the next node sailed through and launched a second battle on
    // top of an unfinished one. Take the lock where it is given back; the sim path already
    // holds it, so this is idempotent.
    this.busy = true;
    const room = this.spec.rooms.find((r) => r.id === roomId);
    if (!room) {
      this.busy = false;
      return { transitioned: false };
    }
    // Wave 4 Task 5 — accumulated across this room's gate drill (if any) + its own room-clear
    // grant; ONE ceremony card presents inside this post-combat/boss beat sequence
    // (leveling.spec.ts's beat law), never per-source. Task 6 seeds it with the battle's own
    // mid-fight renewals, FIRST: they were earned before anything below, so the card lists
    // them in the order they happened. The boss path inherits this same array (bossVictory's
    // `pending` argument, its only call site), so the battle levels reach the boss card too
    // without a second prepend that would list every one of them twice.
    const pending: number[] = [...(outcome.levelsGained ?? [])];

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
      // Wave 4 — a wise withdrawal that banked a level still deserves its lantern: the same
      // beat the wipe branch below gets, after the retreat's own ledger closes (Constraint 10
      // forbids only a mid-ledger card). The GATE's HP-out retreat keeps its own recorded
      // skip — that path is Task 5's, and its toast + Ledger already own that beat.
      await this.presentPendingLevelUp(pending);
      this.scene.start('hamlet', { seed: this.seed });
      return { transitioned: true };
    }

    if (outcome.outcome === 'wipe') {
      // Death's Door exhausted (Concordance Ch. I) — heavier than a retreat, but the same
      // shape: persist scene:'hamlet' BEFORE starting the scene (same reload-safety as the
      // retreat branch above), and this branch must preempt the room-credit fall-through
      // below entirely — a wipe never credits the room, never bumps the streak, never
      // grants room loot, never writes SRS/story state (Fable_SPEC.md:31 — wipes cost only
      // the loot roll). The keepsake itself was already stripped in CombatScene; this
      // branch only reports it to the Ledger.
      await services.save.save({ scene: 'hamlet' });
      this.view.toast('The Fade closes in — something is lost to it.', 'warn');
      await this.wait(1000);
      // §3.2 the Night's Ledger — fold this last battle in (no gold on a wipe, streak unchanged).
      this.accrueHarvest(outcome, 0);
      await this.runNightLedger('wipe', services.save.get().streak, outcome.wipeReport?.keepsakeId ?? null);
      // Wave 4 — the road remembers you even in defeat: a level crossed on a death save is
      // still a level. AFTER the wipe ledger closes, never during it (Constraint 10 forbids
      // only a mid-ledger card), and last thing before the walk home.
      await this.presentPendingLevelUp(pending);
      this.scene.start('hamlet', { seed: this.seed });
      return { transitioned: true };
    }

    // crucible V1-12 — credit the combat win (mark + persist) immediately, before any
    // gate runs, so a gate wipe (HP exhausted mid-drill, below) can never re-litigate a
    // fight already won (Fable_SPEC.md:31 — wipes cost the loot roll, never story
    // progress). Idempotent, so bossVictory's own final save just carries this forward.
    // crucible-2 — but a WARDED room was being credited as fully cleared here too, so an
    // HP-out mid-drill counted as passage: the node came back marked ✓ with its gate, its
    // loot and its streak silently gone forever (a cleared node only ever re-shows its
    // blurb). Credit the two halves separately instead — the fight is banked as a pending
    // ward (enterRoom resumes straight into the drill, never re-fighting), and the room
    // only joins `cleared` once the ward actually yields, below.
    this.progress = room.gate
      ? markGatePending(this.progress, room.id)
      : markRoomCleared(this.progress, room.id, this.spec.rooms);
    await services.save.save({ dungeon: this.progress });

    // gate door must open before the node can clear
    if (room.gate) {
      const gate = await this.runGate(room, outcome);
      if (gate.transitioned) return { transitioned: true };
      this.progress = markRoomCleared(this.progress, room.id, this.spec.rooms);
      await services.save.save({ dungeon: this.progress });
      pending.push(...gate.pending);
    }

    if (room.boss) {
      await this.bossVictory(outcome, pending);
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
    // Ch. IV final-review I1 — grantRoomLoot's own offerLantern can spend (or refund) the
    // lantern via a save write, and nothing between here and the refreshStatus() above
    // repaints the header glyph afterward: repaint again now the spend has settled, so "lit
    // when held, guttered when spent" (the chapter's own UI text) holds on the one screen the
    // player is watching when they spend it. The boss site needs no equivalent call — it ends
    // in scene.start('hamlet'), which tears the scene down regardless.
    this.refreshStatus();
    // §3.2 — fold this room into the run harvest; the Night's Ledger shows ONLY at run end (boss
    // victory / retreat), never mid-crawl (a per-room card would be five interruptions per vault).
    this.accrueHarvest(outcome, gold);
    // Wave 4 Task 5, wire 3 — flawless (never bloodied) pays more than a bloodied clear.
    // Reads damageTaken, NOT hpLost: hpLost is a delta the scene re-anchors to 0 on every
    // mid-battle save.hp rewrite (satchel heal, death's-door revival, a level-up's pool bump),
    // so a battle that was bloodied, healed, then finished clean used to collect the flawless
    // grant. `?? 0` keeps the two synthetic outcomes that omit the field (the sim victory and
    // the gate-pending resume) crediting flawless exactly as they do today — neither fought a
    // battle in which damage could have been taken.
    pending.push(...grantXp((outcome.damageTaken ?? 0) === 0 ? 'room-clear-flawless' : 'room-clear'));
    await this.presentPendingLevelUp(pending);
    this.busy = false;
    return { transitioned: false };
  }

  /** Wave 4 Task 5 — presents the level-up ceremony for any levels accumulated this beat
   *  (Constraint 6: ONE card, every level gained). Best-effort, matching runNightLedger's own
   *  tolerance just below: a missing/stub overlay service must never strand the walk home.
   *  No-op when nothing was gained (levelUpRows returns null). `this.auto` mirrors
   *  runNightLedger's own auto-drive threading — the dev harness (?auto=full/win) can cross a
   *  level threshold mid-run and must never hang on a click that won't come. */
  private async presentPendingLevelUp(levels: number[]): Promise<void> {
    const ceremony = levelUpRows(levels);
    if (!ceremony) return;
    try {
      await services.showLevelUp(ceremony.rows, { auto: !!this.auto });
    } catch {
      /* best-effort: never block the surrounding beat */
    }
  }

  /** Ch. IV — offer the loot-advantage spend when a Lantern-light is held. Auto-drive
   *  always raises (a hung prompt would strand sim/auto runs — presentPendingLevelUp's
   *  own auto-threading rule). Consume-before-benefit; the no-trinket refund lives at
   *  the call sites (trim's spend-first-refund idiom). */
  private async offerLantern(troveName: string): Promise<Edge> {
    // Guarded read (T4 review ruling): a save fault means "no lantern", never a thrown loot grant.
    let held = false;
    try { held = services.save.get()?.lanternLight === true; } catch { /* offline → no lantern */ }
    if (!held) return 'none';
    const choice = this.auto ? 'raise' : await this.view.showLanternChoice(troveName);
    if (choice !== 'raise') return 'none';
    await services.save.save({ lanternLight: false });
    return 'advantage';
  }

  /** Room-clear gold + a 35% trinket roll, banked immediately (inventory-handoff §4). Returns the
   *  gold granted, for the Night's Ledger harvest (§3.2). */
  private async grantRoomLoot(room: DungeonRoom): Promise<number> {
    const roomIndex = this.spec.rooms.findIndex((r) => r.id === room.id);
    const rng = mulberry32((this.seed + roomIndex * 7919 + 1) >>> 0);
    const edge = await this.offerLantern(room.name);
    const loot = roomClearLoot(roomIndex, rng, edge);
    await services.inventory.addGold(loot.gold);
    if (loot.trinketId) await services.inventory.grantItem(loot.trinketId);
    const trinketName = loot.trinketId ? itemById(loot.trinketId)?.name : null;
    const lanternSuffix = edge === 'advantage' && loot.trinketId ? " — drawn by the lantern's light." : '';
    const base = trinketName
      ? `${room.name} falls quiet. +${loot.gold} coin, and a ${trinketName} glints in the dust${lanternSuffix || '.'}`
      : `${room.name} falls quiet. +${loot.gold} coin.`;
    // The 35% drop gate missed — advantage never touched it (chapter: rarity only). Honest
    // refund, trim's idiom. Folded into the SAME toast as the gold line (not a second,
    // separately-timed lootToast()) — two toasts fire from the same fixed screen position
    // (VaultView.toast), so back-to-back calls here render as illegible overlapping text;
    // confirmed by eyes-on screenshot during authoring (task-7-report.md).
    const refunding = edge === 'advantage' && !loot.trinketId;
    if (refunding) await services.save.save({ lanternLight: true });
    this.view.lootToast(
      refunding
        ? `${base} The lantern flares — but only dust glitters back. Its light returns to you.`
        : base,
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
  private async runNightLedger(
    kind: 'victory' | 'retreat' | 'wipe',
    streak: number,
    keepsakeId?: string | null,
  ): Promise<void> {
    const h = (this.registry.get(RUN_HARVEST_KEY) as RunHarvest | undefined) ?? {
      held: [], reclaimed: 0, newWelds: 0, gold: 0,
    };
    try {
      await services.showNightLedger(
        {
          outcome: kind,
          held: h.held.length,
          welds: h.newWelds,
          reclaimed: h.reclaimed,
          gold: h.gold,
          streak,
          keepsakeId,
        },
        { auto: !!this.auto },
      );
    } catch {
      /* best-effort: never block the walk home */
    }
  }

  /** free_recall gate: pass (≥0.5) opens; miss costs HP with immediate retry; HP-out = Fade retreat.
   *  `outcome` is the room's already-won combat result (resolveCombat's caller), needed here so an
   *  HP-out mid-gate can fold it into the Night's Ledger harvest, same as any other run-ending retreat. */
  private async runGate(
    room: DungeonRoom,
    outcome: CombatOutcome,
  ): Promise<{ transitioned: boolean; pending: number[] }> {
    const gate = room.gate!;
    // Wave 4 Task 5, wire 4 — the gate's own free_recall drill pays the same 'renewal' rule as
    // the Wellspring (wire 1): quality === 1 ONLY, one grant per attempt. Alongside (not
    // conflated with) the flat 'gate' grant on the pass branch below — both legitimate,
    // accumulated together and returned for the caller's ONE combined ceremony card.
    const pending: number[] = [];
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
      if (res.quality === 1) pending.push(...grantXp('renewal', { applyHp: true }));
      if (res.quality >= 0.5) {
        this.view.toast('The ward yields. The door grinds open.', 'good');
        pending.push(...grantXp('gate'));
        return { transitioned: false, pending };
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
        // §3.2 the Night's Ledger — a gate HP-out is a run-ending retreat too (fun-review follow-up:
        // this path used to skip the ledger entirely). Mirror resolveCombat's own retreat branch:
        // fold this room's already-won combat in with no gold (no loot on a retreat), then show it.
        // No ceremony on this path (a retreat's own toast + Night's Ledger already own this
        // beat) — any renewal XP banked above this point is still persisted (grantXp writes
        // immediately), only its card is skipped.
        this.accrueHarvest(outcome, 0);
        await this.runNightLedger('retreat', services.save.get().streak);
        this.scene.start('hamlet', { seed: this.seed });
        return { transitioned: true, pending };
      }
    }
    // safety valve — never hard-lock the crawl. Not a documented 'gate' pass branch (task-5-
    // brief.md wire 4 scopes to the toast above), so no additional XP here; any renewal grants
    // already accumulated above still ride home in `pending`.
    this.view.toast('The ward finally yields.', 'good');
    return { transitioned: false, pending };
  }

  /** `pending` — levels already accumulated upstream this beat (resolveCombat's own gate-drill
   *  renewals, if this boss room was also gated; Wave 4 Task 5) — merged with this method's own
   *  boss/quest grants into ONE ceremony card, never a separate one per source. */
  private async bossVictory(outcome: CombatOutcome, pending: number[] = []): Promise<void> {
    // already marked + persisted by resolveCombat right after combat victory (crucible V1-12)
    const streak = services.save.get().streak + 1;
    const quest = this.pack ? bossQuest(this.pack) : undefined;
    const reward = (quest ? rewardText(quest) : null) ?? DEV_REWARD;

    const edge = await this.offerLantern("the Warden's trove");
    // Boss bounty: gold + the guaranteed Warden Signet + a boss-weighted trinket (inventory-handoff §4).
    const rng = mulberry32((this.seed + 104729) >>> 0);
    const loot = bossLoot(rng, edge);
    await services.inventory.addGold(loot.gold);
    await services.inventory.grantItem(loot.relicId);
    if (loot.trinketId) await services.inventory.grantItem(loot.trinketId);
    const trinketName = loot.trinketId ? itemById(loot.trinketId)?.name : null;
    const lanternSuffix = edge === 'advantage' && loot.trinketId ? " — drawn by the lantern's light." : '';
    const lootLine = trinketName
      ? ` The Warden yields ${loot.gold} coin, their signet, and a ${trinketName}${lanternSuffix || '.'}`
      : ` The Warden yields ${loot.gold} coin and their signet.`;
    if (edge === 'advantage' && !loot.trinketId) {
      // Boss loot always attempts a trinket (no 35% gate here, unlike a room clear) — this
      // only fires if the trinket pool is empty outright. Honest refund, trim's idiom (same
      // shape as grantRoomLoot's own block).
      await services.save.save({ lanternLight: true });
      this.view.lootToast('The lantern flares — but only dust glitters back. Its light returns to you.');
    }

    await services.save.save({ dungeon: this.progress, streak, scene: 'hamlet' });
    // Wave 4 Task 5, wire 5 — the flat boss grant, then the quest's own pack-authored xp
    // reward (specResolve.ts's rewardText keeps formatting the reward string; rewardXp reads
    // the same {xp,item} shape's numeric half, now also GRANTED, not just displayed).
    pending.push(...grantXp('boss'));
    const questXp = rewardXp(quest);
    if (questXp) pending.push(...grantXp('quest', { amount: questXp }));
    // §3.2 — fold the boss battle + bounty into the run harvest; the finale plays its full staged
    // reveal FIRST, then the accumulated Night's Ledger, then the level-up ceremony (if any) —
    // matching the retreat/wipe branches above (Constraint 10: the card never upstages a
    // ledger; fix round 1, 2026-08-13 — grantXp('boss')'s flat +150 crosses L1→L2 on any fresh
    // save, so this order was reachable on the very first boss kill, not an edge case).
    this.accrueHarvest(outcome, loot.gold);
    await this.view.vaultOpensBeat(reward + lootLine, streak);
    await this.runNightLedger('victory', streak);
    await this.presentPendingLevelUp(pending);
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

  /**
   * Trim the Lantern (Concordance Ch. II) — spend one Ember for one due question between
   * rooms, at the camp. Guards first (own `trimBusy` lock — never `busy`/`satchelBusy`, so it
   * can never entangle with onCamp's or onSatchel's locks), then spends FIRST and respects the
   * result (consume.ts's idiom, transposed to a save-patch): the Ember is gone the instant the
   * save call resolves, and is refunded only on the one edge that can't ask anything — a
   * packless/exhausted draw. A full party never wastes an Ember; refusing costs nothing.
   */
  private async onTrim(): Promise<void> {
    if (this.trimBusy) return;
    this.trimBusy = true;

    const save = services.save.get();
    if (embersOf(save) === 0) {
      this.view.toast('The ember pouch is empty. The hearth refills it come night.', 'warn');
      this.trimBusy = false;
      return;
    }
    if (save.hp >= maxHpForLevel(save.level ?? 1)) {
      this.view.toast('The lantern burns steady — nothing to trim.', 'warn');
      this.trimBusy = false;
      return;
    }

    await services.save.save({ embers: embersOf(save) - 1 });
    this.trimEmbersSpent += 1;

    const seed = (this.seed + (this.progress?.cleared.length ?? 0) * 8191 + 5) >>> 0;
    const factId = this.trimDraw(seed);
    if (!factId) {
      // packless edge: nothing anywhere to ask. Refund against the FRESHEST save (never the
      // stale `save` read above) — a night at the hearth or another Trim could have moved it.
      const cur = services.save.get();
      await services.save.save({ embers: embersOf(cur) + 1 });
      this.trimEmbersSpent -= 1;
      this.view.toast('Nothing stirs in the Ledger tonight. The ember is yours again.', 'warn');
      this.refreshStatus();
      this.trimBusy = false;
      return;
    }

    const res = await services.runEncounter({
      context: 'drill',
      kinds: ['free_recall'],
      factIds: [factId],
      packId: this.packId ?? FIXTURE_PACK_ID,
      seed,
    });
    for (const fid of res.factIds) {
      await services.srs.record(fid, res.quality, res.encounterId, this.facts.get(fid)?.type);
    }

    // DD-KNOB-1 (knob RT-1): partial credit (0.5) heals as a MISS, not a half-measure.
    const correct = res.quality >= 1;
    await this.applyHp(correct ? TRIM_HEAL_CORRECT : TRIM_HEAL_MISS);
    // Set only after applyHp's save round-trips: trimDebug()'s marker means "drill fully
    // settled, writes included," not "graded, persistence still pending" (e2e harness contract).
    this.trimLastQuality = res.quality;
    this.view.toast(
      correct
        ? 'The flame answers. The party mends (+4).'
        : 'A guttering flicker — the rest still soothes (+1).',
      correct ? 'good' : 'warn',
    );
    this.refreshStatus();
    this.trimBusy = false;
  }

  /**
   * The one-question ladder behind Trim — schedule (due) → introduction (fresh, kind-blind) →
   * seed-shuffled pool, exactly the three-tier shape globalDraw()/ddDraw() use in combat (W1
   * laws), collapsed into a single try/catch (unlike combat's per-tier tolerance): Trim has a
   * clean, cheap way to fail — refund and bail — so a fault anywhere in the ladder is treated
   * the same as a genuinely empty pool rather than degrading tier by tier.
   */
  private trimDraw(seed: number): string | null {
    try {
      const now = Date.now();
      const due = services.draw.due({ kinds: ['free_recall'], count: 1, seed, now });
      if (due[0]) return due[0];
      const fresh = services.draw.fresh({ count: 1, seed, now });
      if (fresh[0]) return fresh[0];
      const pool = services.amendments.eligible(services.draw.allFactIds());
      return seededShuffle(pool, mulberry32(seed))[0] ?? null;
    } catch {
      return null;
    }
  }

  private async applyHp(delta: number): Promise<void> {
    if (!delta) return;
    const save = services.save.get();
    const max = maxHpForLevel(save.level ?? 1);
    const cur = save.hp ?? max;
    const hp = Math.max(0, Math.min(max, cur + delta));
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
        const idx = first < rooms.length ? first : 0;
        const room = rooms[idx];
        this.markReadyOnce();
        void services.showTeaching(this.teachingFacts(room, idx));
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

  /** Debug: the map node hover tooltip's live alpha + rendered name/blurb (e2e-only —
   *  fun-review §3.6a; Phaser-drawn, not DOM, so a spec can't read this via a locator). */
  tooltipDebug(): { alpha: number; name: string; blurb: string } | null {
    return this.view.tooltipDebug();
  }

  /** Debug: the status-line Trim button's live absolute bounds (e2e-only — fix round 1). */
  trimButtonBounds(): { top: number; bottom: number; left: number; right: number } | null {
    return this.view.trimButtonBounds();
  }

  /** Debug: fact ids resolved by the most recent teachingFacts() call (e2e-only — mirrors
   *  HamletScene.wellspringDrillDebug()/CombatScene.castSurfacedDebug()'s precedent). */
  dungeonTeachingDebug(): string[] {
    return [...this.teachingSurfaced];
  }

  /** Debug: Trim the Lantern's last resolved quality (null = never resolved one) + the net
   *  count of Embers it has actually spent this scene lifetime (e2e-only — deathsdoor-style). */
  trimDebug(): { lastQuality: number | null; embersSpent: number } {
    return { lastQuality: this.trimLastQuality, embersSpent: this.trimEmbersSpent };
  }
}

// ---- helpers ----------------------------------------------------------------

let warnedDungeonDrawFailure = false;

/**
 * Wave-1 draw service readiness gate for the crawl's fact lookup + teaching draws — mirrors
 * encounters/register.ts's resolveCrossPack(), HamletScene's wellspringDrawReady(), and
 * CombatScene's combatDrawReady(): await ONLY services.draw.indexReady() (never the fuller
 * ready(), which can reject early on an unrelated srs/amendments failure while the index is
 * still mid-build), catch, warn once, and let loadSpecAndFacts() fall back to the legacy
 * single-pack lookup rather than throw or hang. A crawl must never stall on the picker.
 */
async function dungeonDrawReady(): Promise<boolean> {
  try {
    await services.draw.indexReady();
    return true;
  } catch {
    if (!warnedDungeonDrawFailure) {
      warnedDungeonDrawFailure = true;
      console.warn('[dungeon] services.draw index failed to load — falling back to the legacy single-pack lookup');
    }
    return false;
  }
}

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
