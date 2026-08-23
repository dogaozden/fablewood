/**
 * «Onward» Arc 1 — the T1 beats (design spec §5/§7; canonical text
 * docs/story/onward/arc-01-the-road-that-waits.md, production appendix).
 * Card prose is curated VERBATIM from the canonical chapter — Fable-authored;
 * never edited here. The eligibility table is the appendix's trigger column.
 */
import type { SaveData, StoryBeat, StorySurface } from '../game/contracts';

/** The shipped first vault's boss room id (packs/vc-law preference-vaults spec).
 *  A plain string constant, content-neutral, used ONLY to backfill the hook for
 *  saves that beat the Warden before the story layer existed. Zero-pack builds
 *  simply never match it. */
export const GRANDFATHERED_BOSS_ROOM = 'room.warden';

export function bossVaultOpened(save: SaveData): boolean {
  return (save.dungeon?.cleared ?? []).includes(GRANDFATHERED_BOSS_ROOM);
}

export interface Seen {
  isSeen(beatId: string): boolean;
}

type T1Beat = StoryBeat & {
  surface: StorySurface;
  eligible(seen: Seen, save: SaveData): boolean;
};

export const T1_BEATS: ReadonlyArray<T1Beat> = [
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

/** The one beat (if any) firing at this surface now — first eligible in canon order. */
export function nextBeatFor(surface: StorySurface, seen: Seen, save: SaveData): StoryBeat | null {
  for (const b of T1_BEATS) {
    if (b.surface === surface && b.eligible(seen, save)) {
      const { id, title, pages, margin } = b;
      return margin === undefined ? { id, title, pages } : { id, title, pages, margin };
    }
  }
  return null;
}
