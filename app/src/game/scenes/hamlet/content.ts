/**
 * Hamlet NPC dialogue, in-register per Fable_SPEC §3 / slice-blueprint §5:
 * Berry warm & chatty, the Clerk terse & dry, Gatewarden Alder formal. Pure data
 * builders — the scene feeds them live SRS/save numbers.
 */
import type { Conversation } from '../../dialogue/types';

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export interface Province {
  id: string;
  title: string;
  factIds: string[];
}

/** The Gilded Acorn — Berry Bramblemaid. Rumor points at the due queue; hearth = streak. */
export function berryConv(due: number, streak: number): Conversation {
  const pages = ['Well met, Keeper! Pull up a stool — the hearth is yours.'];

  if (due > 0) {
    pages.push(
      `Folk in from the Coast swear the Waterfall Gallery groans again. ${plural(due, 'fable')} stir restless in the dark — the Fade's been gnawing while you were away.`,
    );
  } else {
    pages.push(
      "And the Ledger rests easy tonight — not a fable stirring, not a whisper of the Fade. Rare and welcome.",
    );
  }

  if (streak > 0) {
    pages.push(
      `Your hearthfire stands ${plural(streak, 'night')} tall now. The whole Acorn feels it when a Keeper keeps their streak.`,
    );
  } else {
    pages.push('Kindle a streak out there and watch this old hearth blaze. I do love a good blaze.');
  }

  return { speaker: 'Berry Bramblemaid', pages, portrait: 'portrait.berry' };
}

/** The Records Office — the Laconic Clerk. Verdict-brief; SRS made diegetic. */
export function clerkConv(due: number, lastPlayed: string): Conversation {
  const pages: string[] = [];
  pages.push(due > 0 ? `${plural(due, 'fable')} due.` : 'Nothing due. The Ledger holds.');

  if (lastPlayed) {
    const d = new Date(lastPlayed);
    const when = Number.isNaN(d.getTime()) ? lastPlayed : d.toLocaleDateString();
    pages.push(`Last entry: ${when}. The Ledger remembers.`);
  } else {
    pages.push('No entry for you yet. There will be.');
  }

  pages.push('Renew them, or watch them Fade. Your ledger. Not mine.');
  return { speaker: 'The Laconic Clerk', pages, portrait: 'portrait.clerk' };
}

/** The South Gate — Gatewarden Alder. Province select (installed packs). */
export function alderConv(provinces: Province[]): Conversation {
  if (provinces.length === 0) {
    return {
      speaker: 'Gatewarden Alder',
      pages: [
        'The roads are quiet, Keeper. No province calls for a warden today.',
        'Return when the Ledger has grown, and I will open the gate.',
      ],
      portrait: 'portrait.alder',
    };
  }
  return {
    speaker: 'Gatewarden Alder',
    pages: [
      'Beyond this gate lies the Venture Coast — and past its treaties, the Preference Vaults.',
      'Which province will you ride for?',
    ],
    choices: [
      ...provinces.map((p) => ({ label: p.title, value: p.id })),
      { label: 'Not yet', value: '__cancel__' },
    ],
    portrait: 'portrait.alder',
  };
}

export function alderFarewell(): Conversation {
  return {
    speaker: 'Gatewarden Alder',
    pages: ['Then ride well. The Fade fears a Keeper who remembers.'],
    portrait: 'portrait.alder',
  };
}

/** Mira the Factor — the wares-and-trade stop (inventory-handoff §9). */
export function factorConv(): Conversation {
  return {
    speaker: 'Mira the Factor',
    pages: ['Keeper! Coin to spend, or loot to weigh? My ledger is open either way.'],
    choices: [
      { label: 'Browse wares', value: 'shop' },
      { label: 'Never mind', value: '__cancel__' },
    ],
    portrait: 'portrait.mira',
  };
}

/** Keeper's Cottage — no NPC, the Keeper's own quiet beat. */
export function cottageConv(): Conversation {
  return {
    speaker: "Keeper's Cottage",
    pages: [
      'You bank the hearth and set your pack by the door. The trophies of fallen provinces glint on the shelf.',
      'Your journey is recorded. Rest easy, Keeper — the Ledger is safe here.',
    ],
  };
}

export function wellspringEmpty(): Conversation {
  return {
    speaker: 'The Wellspring',
    pages: ['The waters lie still. No fables stir here yet — bring a province home, and the pool will wake.'],
  };
}

export function wellspringIntro(): Conversation {
  return {
    speaker: 'The Wellspring',
    pages: [
      'The pool shivers, and three fables rise glimmering to the surface.',
      'Recall them true, and the waters will reward you.',
    ],
  };
}

export function wellspringOutro(streak: number): Conversation {
  return {
    speaker: 'The Wellspring',
    pages: [
      `The waters still. Your streak stands ${plural(streak, 'night')} tall, and a small bounty glimmers in the shallows.`,
    ],
  };
}
