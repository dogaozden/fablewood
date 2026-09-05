/**
 * Installs services.story (contracts.ts StoryApi) — the story provider's register,
 * side-effect imported from game/providers.ts beside encounters/register.
 * DEV harness: ?story=<beatId> renders that beat's card directly on boot (the
 * ?overlay= pattern) — e2e/dev only, DEV-gated exactly like encounters/register's.
 */
import {
  services,
  type BeatContext,
  type SaveData,
  type StoryBeat,
  type StoryDestination,
  type StorySurface,
} from '../game/contracts';
import { StoryStore } from './store';
import { nextBeatFor, ARC1_BEATS, BEAT_AFTER_EFFECTS, PLACEHOLDER } from './beats';
import { showBeatCard, openDeskUi } from './ui';
import { CANTOS } from './cantos';
import { cantoUnlocked, onwardOpenPage, roadsFor, weldCount } from './books';

const store = new StoryStore();

/**
 * Engine destinations and what opens them (spec §4.3). Kept here rather than in a scene: the
 * gate asks, the provider answers. `arc01-road` opens once the Keeper has heard the fable —
 * beat III is the one that names the stone past Hollis's fence, so it is the earliest point
 * at which riding south is a thing the Keeper knows to do.
 *
 * `id: 'arc01-road'` is a deliberate duplicate of engineSpecs.ts's ROAD_SPEC_ID — the same
 * story/-must-not-import-scenes reason beats.ts's own ROAD_SPEC constant is duplicated
 * (contracts.ts header; beats.ts:32-36). Unlike that copy, this one is not yet independently
 * pinned by a test against the engine registry — flagged for the reviewer, not fixed here.
 */
const ENGINE_DESTINATIONS: ReadonlyArray<StoryDestination & { requiresBeat: string }> = [
  { id: 'arc01-road', title: `${PLACEHOLDER} The Road South`, requiresBeat: 'onward-01.fable-waywright' },
];

services.story = {
  ready: () => store.ready(),
  isSeen: (beatId: string) => store.isSeen(beatId),
  nextBeatFor: (surface: StorySurface, save: SaveData, ctx?: BeatContext): StoryBeat | null =>
    nextBeatFor(surface, store, save, ctx),
  showBeat: async (beat: StoryBeat, opts?: { auto?: boolean }): Promise<void> => {
    // Seen is stamped BEFORE the card resolves: a crash mid-card must not refire
    // the beat next launch (idempotence law, plan constraint 6). T2: a beat's durable
    // after-effects (the thread fragment, the arc completion) are stamped in the same
    // breath and for the same reason — a dismissed card the player never sees again must
    // never leave its grant unwritten.
    await store.markSeen(beat.id);
    const effects = BEAT_AFTER_EFFECTS[beat.id];
    if (effects?.grantFragment) await store.grantFragment(effects.grantFragment);
    if (effects?.completeArc) await store.completeArc(effects.completeArc);
    await showBeatCard(beat, opts);
  },
  openDesk: async (opts?: { auto?: boolean }): Promise<void> => {
    await Promise.all([store.ready(), services.srs.ready(), services.draw.indexReady()]);
    const welds = weldCount(services.draw.allFactIds(), (id) => services.srs.boxOf(id));
    const arcs = store.completedArcCount();
    await openDeskUi({
      cantos: CANTOS.map((c, i) => ({
        roman: c.roman,
        title: c.title,
        body: c.body,
        unlocked: cantoUnlocked(i, welds, arcs),
      })),
      onward: onwardOpenPage((id) => store.isSeen(id), { arcComplete: store.isArcComplete('onward-01') }),
      roads: roadsFor((id) => store.isArcComplete(id)),
    }, opts);
  },
  completedArcCount: () => store.completedArcCount(),
  engineDestinations: (): StoryDestination[] =>
    ENGINE_DESTINATIONS.filter((d) => store.isSeen(d.requiresBeat)).map(({ id, title }) => ({ id, title })),
};

// DEV-only direct-render harness: /?story=<beatId>
// `typeof window !== 'undefined'` guard matches encounters/register.ts's ?overlay=
// gate: vitest runs this file's whole import chain under environment:'node' (no
// jsdom), where import.meta.env.DEV is still true, so without this guard any test
// that imports story/register.ts directly (the same shape cross-pack.test.ts and
// census.test.ts use against encounters/register.ts) would throw on `window`.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const beatId = new URLSearchParams(window.location.search).get('story');
  if (beatId) {
    const beat = ARC1_BEATS.find((b) => b.id === beatId);
    if (beat) {
      const { id, title, pages, margin } = beat;
      void showBeatCard(margin === undefined ? { id, title, pages } : { id, title, pages, margin });
    }
  }
}
