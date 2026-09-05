/**
 * «Onward» Arc 1 — the T1 beats (design spec §5/§7; canonical text
 * docs/story/onward/arc-01-the-road-that-waits.md, production appendix).
 * Card prose is curated VERBATIM from the canonical chapter — Fable-authored;
 * never edited here. The eligibility table is the appendix's trigger column.
 */
import type { BeatContext, SaveData, StoryBeat, StorySurface } from '../game/contracts';

/** The shipped first vault's boss room id (packs/vc-law preference-vaults spec).
 *  A plain string constant, content-neutral, used ONLY to backfill the hook for
 *  saves that beat the Warden before the story layer existed. Zero-pack builds
 *  simply never match it. */
export const GRANDFATHERED_BOSS_ROOM = 'room.warden';

export function bossVaultOpened(save: SaveData): boolean {
  return (save.dungeon?.cleared ?? []).includes(GRANDFATHERED_BOSS_ROOM);
}

/** T2 scaffolding marker (spec ruling R20): every player-visible string this wave ships
 *  carries this prefix, so the placeholder census can find them and the drift guard can
 *  exempt them. Curated prose replaces the whole string, prefix included. */
export const PLACEHOLDER = '[T2-PLACEHOLDER]';

export interface Seen {
  isSeen(beatId: string): boolean;
}

type ArcBeat = StoryBeat & {
  surface: StorySurface;
  eligible(seen: Seen, save: SaveData, ctx?: BeatContext): boolean;
};
/** «Onward» Arc 1's engine spec id (scenes/dungeon/engineSpecs.ts's ROAD_SPEC_ID). Duplicated
 *  as a plain string rather than imported: story/ must not import from game/scenes/ (the
 *  provider/consumer direction is one-way — contracts.ts header). engineSpecs.test.ts pins
 *  the id itself; the T2 eligibility tests pin this copy. */
const ROAD_SPEC = 'arc01-road';
const clearedIn = (save: SaveData): readonly string[] => save.dungeon?.cleared ?? [];

export const T1_BEATS: ReadonlyArray<ArcBeat> = [
  {
    id: 'onward-01.dark-answers',
    surface: 'hamlet-entry',
    title: 'The Dark Answers',
    pages: [
      'At the south gate, Gatewarden Alder set the bar as he has set it every dusk of his office, and before it dropped he asked the dark road his question, as the office has asked it time out of mind: *Who goes, and what do you carry?* And he waited his three breaths, out of courtesy, in case the dark should finally answer. On the first breath, nothing, as there had been nothing for thirty years of asking. On the second breath, far down the road where the sure ground gives out and the grey begins, a small light rose.',
      'It came up the road as if the road were the only thing in the world it was sure of, and it reached the gate-lamp that hangs above the bar, and it pressed itself to the glass the way cold hands press to a fire. And the gate-lamp’s flame stood up. Gold, with morning in it. The way a door opens for someone long expected. At first light Alder came up the lane to find the Keeper, and his knock was the knock of a man who has rehearsed a sentence all night and knows it will come out plain anyway. “Keeper,” he said. “The gate was answered.”',
    ],
    margin:
      'Entered: one small light, at the south gate, answering the question. Went on to the water. Weather clear. —C.',
    eligible: (seen, save) => bossVaultOpened(save) && !seen.isSeen('onward-01.dark-answers'),
  },
  {
    id: 'onward-01.barred-road',
    surface: 'south-gate',
    title: 'The Barred Road',
    pages: [
      'The road runs sure for the first mile — and at the end of the sure mile, there it was, as it had been all their lives: the barrier. Not a deadfall, not a tangle of thorn, not the grey itself. A fence. A good one — post and rail, true-set, whitewashed every spring, with a bench beside it facing homeward. A barrier maintained with love. Mark that, for it is worth a whole vault of learning: love is how you know the barriers that will be hardest to take down.',
      '“The road ends here,” said Old Hollis, “and a mercy it does.” It was Tamsin who answered him — Tamsin the drover, who had droved the near loop for years with her cart and her mule Barley, and had the songs and the mile for an inheritance. “Something walked in off the far road last night, and it’s the first thing in thirty years that’s come *this* way up it. I mean to see what the road says to that.”',
    ],
    eligible: (seen) => seen.isSeen('onward-01.dark-answers') && !seen.isSeen('onward-01.barred-road'),
  },
  {
    id: 'onward-01.fable-waywright',
    surface: 'tavern',
    title: 'The Fable of the Waywright',
    pages: [
      'That evening Berry waited until the arguing had worn itself to a hum, and wiped her hands, and said, “Well. My grandmother had a tale about roads.” — In the years when lanterns were new, there lived a stone-cutter who could not carry a way in her head. Three times she was lost within sight of her own chimney-smoke. If a line would not stay in her head, she reasoned, it could stay in something harder. She cut the first waystone on the road she was most lost on, which was her own — and in its face she cut the stretch, plainly, deeply: where this road has come from, and where it is going, and how it goes.',
      'That was the craft, whole, in one line: the stone keeps the stretch, and the walker feeds the stone — read the way aloud as you pass, and the road is spoken daily by everyone who uses it. A gate asks who goes. A stone remembers where. — “My grandmother said her grandmother said there’s one not a mile past Hollis’s fence,” said Berry, into a tavern gone very quiet. “Under the moss on the left hand of the road. If anyone were walking that way.” She did not look at the Keeper when she said it.',
    ],
    eligible: (seen) => seen.isSeen('onward-01.barred-road') && !seen.isSeen('onward-01.fable-waywright'),
  },
];

/**
 * Beats IV–VIII. Ids are the canon doc's own, verbatim from its production appendix
 * (docs/story/onward/arc-01-the-road-that-waits.md:271-275) — never re-slugged here.
 *
 * ALL PROSE IS `[T2-PLACEHOLDER]` (spec ruling R20). The curated excerpts are the creative
 * block (spec §9 items 1-5) and land later as a pure data edit to this array: no eligibility
 * row, no surface, no id changes when they do.
 */
export const T2_BEATS: ReadonlyArray<ArcBeat> = [
  {
    id: 'onward-01.first-waystone',
    surface: 'road-entry',
    title: '[T2-PLACEHOLDER] The First Waystone',
    pages: [
      '[T2-PLACEHOLDER] Beat IV, page 1 — the stone under the moss, the cut lines, the reading that stumbles.',
      '[T2-PLACEHOLDER] Beat IV, page 2 — the hum that fits the gaps, the way said whole, the glow running in the carving.',
    ],
    eligible: (seen, _save, ctx) => ctx?.specId === ROAD_SPEC && !seen.isSeen('onward-01.first-waystone'),
  },
  {
    id: 'onward-01.the-middles',
    surface: 'road-entry',
    title: '[T2-PLACEHOLDER] The Middles',
    pages: [
      '[T2-PLACEHOLDER] Beat V, page 1 — stone by stone; what the unfed grey is actually like.',
      '[T2-PLACEHOLDER] Beat V, page 2 — the freed lines gathering at the edge of the singing, and the first one going home.',
    ],
    eligible: (seen, save, ctx) =>
      ctx?.specId === ROAD_SPEC &&
      seen.isSeen('onward-01.first-waystone') &&
      clearedIn(save).includes('ws-2') &&
      !seen.isSeen('onward-01.the-middles'),
  },
  {
    id: 'onward-01.hollis-promise',
    surface: 'road-entry',
    title: "[T2-PLACEHOLDER] Hollis's Promise",
    pages: [
      '[T2-PLACEHOLDER] Beat VI, page 1 — a lantern coming up the road at a run, past his own fence.',
      '[T2-PLACEHOLDER] Beat VI, page 2 — the brother, the old toll, and the name asked into a stone.',
    ],
    eligible: (seen, save, ctx) =>
      ctx?.specId === ROAD_SPEC &&
      seen.isSeen('onward-01.the-middles') &&
      clearedIn(save).includes('ws-3') &&
      !seen.isSeen('onward-01.hollis-promise'),
  },
  {
    id: 'onward-01.the-span',
    surface: 'boss-victory',
    title: '[T2-PLACEHOLDER] The Span and the Toll-Warden',
    pages: [
      '[T2-PLACEHOLDER] Beat VII, page 1 — the broken bridge, the waystation, the toll that was never silver.',
      '[T2-PLACEHOLDER] Beat VII, page 2 — the last shield, the round finished, the going-home light.',
    ],
    margin: '[T2-PLACEHOLDER] Clerk margin for the Span — the toll-ledger leaf and what it names.',
    eligible: (seen, _save, ctx) =>
      ctx?.specId === ROAD_SPEC && ctx?.roomId === 'span' && !seen.isSeen('onward-01.the-span'),
  },
  {
    id: 'onward-01.the-return',
    surface: 'return',
    title: '[T2-PLACEHOLDER] The Return',
    pages: [
      '[T2-PLACEHOLDER] Beat VIII, page 1 — the wisp-stream at dusk, the gate re-hung open and painted.',
      '[T2-PLACEHOLDER] Beat VIII, page 2 — the work-name given the old way, the map gaining its road, the page turning.',
    ],
    margin: '[T2-PLACEHOLDER] Clerk margin for the Return — chapter one closed, dated.',
    eligible: (seen) => seen.isSeen('onward-01.the-span') && !seen.isSeen('onward-01.the-return'),
  },
];

/** Arc 1 whole, canon order — what eligibility and the desk both read. `T1_BEATS` stays
 *  exported unchanged so its own shipped tests keep meaning what they meant. */
export const ARC1_BEATS: ReadonlyArray<ArcBeat> = [...T1_BEATS, ...T2_BEATS];

/**
 * Durable state a beat writes the first time it is seen. Applied by story/register.ts's
 * showBeat, in the same breath as markSeen and BEFORE the card renders, so a crash mid-card
 * can never lose the grant (the idempotence law T1 established for markSeen).
 *
 * `frag.name.01-span-ledger` is the design's own id, verbatim
 * (2026-08-15-onward-story-universe-design.md:116). `onward-01` is the arc id.
 */
export const BEAT_AFTER_EFFECTS: Readonly<Record<string, { grantFragment?: string; completeArc?: string }>> = {
  'onward-01.the-span': { grantFragment: 'frag.name.01-span-ledger' },
  'onward-01.the-return': { completeArc: 'onward-01' },
};

/** The one beat (if any) firing at this surface now — first eligible in canon order.
 *  Pure: a missing spec/room id simply matches no row, never throws (spec §6). */
export function nextBeatFor(
  surface: StorySurface,
  seen: Seen,
  save: SaveData,
  ctx?: BeatContext,
): StoryBeat | null {
  for (const b of ARC1_BEATS) {
    if (b.surface === surface && b.eligible(seen, save, ctx)) {
      const { id, title, pages, margin } = b;
      return margin === undefined ? { id, title, pages } : { id, title, pages, margin };
    }
  }
  return null;
}
