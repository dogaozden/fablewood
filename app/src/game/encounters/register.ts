/**
 * Encounter + judge provider registration (side-effect install into `services`; contracts.ts).
 * Installs the real DOM overlay, the Laconic Clerk judge client, and the teaching modal.
 *
 * Packless-safe: if zero packs are installed we fall back to a self-contained fantasy fixture
 * so every kind is playable and screenshottable. Dev harness: ?overlay=<kind|teaching> opens
 * that kind straight from the fixture (how shot.mjs / e2e capture each one without combat).
 */
import { services, type EncounterRequest, type EncounterResult, type FactLite } from '../contracts';
import type { EncounterDifficulty, Fact, Pack } from '../../packs/types';
import { getPacks } from '../../bridge/client';
import { pick, reskin, stampDifficulty } from './engine';
import { presentEncounter, presentTeaching, presentNightLedger } from './overlay';
import { judge as judgeClient } from '../../judge/client';
import { FIXTURE_PACK, FIXTURE_TEACHING } from './fixtures';

function isPack(p: unknown): p is Pack {
  return !!p && typeof p === 'object' && Array.isArray((p as Pack).encounters) && !!(p as Pack).meta;
}

let packsPromise: Promise<Pack[]> | null = null;
function loadPacks(): Promise<Pack[]> {
  if (!packsPromise) {
    packsPromise = getPacks()
      .then((r) => r.packs.map((e) => e.pack).filter(isPack))
      .catch(() => []);
  }
  return packsPromise;
}

function factsFor(factIds: string[], pack: Pack): FactLite[] {
  const byId = new Map(pack.facts.map((f) => [f.id, f] as const));
  const out: FactLite[] = [];
  for (const id of factIds) {
    const f: Fact | undefined = byId.get(id);
    if (f) out.push({ id: f.id, type: f.type, statement: f.statement, detail: f.detail, source_ref: f.source_ref });
  }
  return out;
}

services.judge = judgeClient;

services.runEncounter = async (req: EncounterRequest): Promise<EncounterResult> => {
  const installed = await loadPacks();
  const packs = installed.length ? installed : [FIXTURE_PACK];
  const sourcePack = packs.find((p) => p.meta.id === req.packId) ?? packs[0];

  const chosen = pick(req, packs);
  if (!chosen) {
    return { encounterId: 'none', kind: req.kinds?.[0] ?? 'mcq', factIds: [], quality: 0, detail: 'The archive is empty.' };
  }
  const reskinned = reskin(chosen, req.seed);
  const facts = factsFor(chosen.fact_ids, sourcePack);
  const result = await presentEncounter(reskinned, facts, { context: req.context, judge: services.judge, flair: req.flair });
  return stampDifficulty(result, reskinned);
};

services.showTeaching = (facts: FactLite[]): Promise<void> => presentTeaching(facts);

services.showNightLedger = presentNightLedger;

// --- dev harness: ?overlay=<kind|teaching> -----------------------------------

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const kind = new URLSearchParams(window.location.search).get('overlay');
  if (kind) {
    const seedParam = Number(new URLSearchParams(window.location.search).get('seed'));
    const seed = Number.isFinite(seedParam) && seedParam !== 0 ? seedParam : 7;
    // Optional `&difficulty=1|2|3` (difficulty-rewards.md §7): forces the drawn tier so the
    // eyebrow's difficulty span can be shot at every tier without a classified pack. The
    // fixture encounters carry no `difficulty`, so without this every dev overlay renders
    // Lantern (difficultyOf's `?? 2`). Applied BEFORE reskin — reskin structuredClones its
    // input, so the override rides through untouched; omitting the param is a no-op, which
    // is why the existing ?overlay= specs are unaffected.
    const forcedParam = Number(new URLSearchParams(window.location.search).get('difficulty'));
    const forced: EncounterDifficulty | undefined =
      forcedParam === 1 || forcedParam === 2 || forcedParam === 3 ? forcedParam : undefined;
    const openDevOverlay = (): void => {
      if (kind === 'teaching') {
        void presentTeaching(FIXTURE_TEACHING);
        return;
      }
      const found = FIXTURE_PACK.encounters.find((e) => e.kind === kind);
      if (!found) return;
      const enc = forced === undefined ? found : { ...found, difficulty: forced };
      const facts = factsFor(enc.fact_ids, FIXTURE_PACK);
      void presentEncounter(reskin(enc, seed), facts, { context: 'drill', judge: services.judge });
    };
    // Wait for the real ready flag, not a fixed delay: the game engine (Phaser +
    // scenes) now loads in its own lazy chunk (bundle diet), so a flat timeout can
    // no longer assume window.__FABLEWOOD_GAME exists by the time it fires.
    // overlay.ts's quietGameKeyboard() silently no-ops without it, leaking the
    // hamlet's WASD/E/Space captures into this overlay's own text inputs.
    const openWhenReady = (): void => {
      if (window.__FABLEWOOD_READY) {
        setTimeout(openDevOverlay, 80); // let the canvas paint a frame first
        return;
      }
      setTimeout(openWhenReady, 30);
    };
    openWhenReady();
  }
}
