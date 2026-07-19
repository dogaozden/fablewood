// Deterministic notation helpers. No randomness — these only build the
// "bars:beats:sixteenths" position strings and repetitive backing patterns
// (bass drive, percussion) so the composition files stay legible. Every melodic
// line is still authored note-by-note; only the mechanical repeats live here.

import type { Note } from "./types";

/**
 * Hamlet is in 6/8. Tone treats a 6/8 bar as 3 quarter-note "beats", so its six
 * eighth-notes fall on sixteenth positions 0,2,4,6,8,10. E(bar, i) maps eighth
 * index i (0..5) to the correct "bar:beat:sixteenth" string.
 */
export function E(bar: number, i: number): string {
  const flatSx = i * 2; // eighth -> sixteenth grid
  const beat = Math.floor(flatSx / 4);
  const sx = flatSx % 4;
  return `${bar}:${beat}:${sx}`;
}

/** Battle is in 4/4 — a plain "bar:beat:sixteenth" position (beats 0..3, sx 0..3). */
export function S(bar: number, beat: number, sx: number): string {
  return `${bar}:${beat}:${sx}`;
}

/** Clone a phrase to a later bar (used for AABA / A-repeats). Bar-shift only. */
export function shiftBars(notes: Note[], offset: number): Note[] {
  return notes.map((n) => {
    const [bar, beat, sx] = n.time.split(":").map(Number);
    return { ...n, time: `${bar + offset}:${beat}:${sx}` };
  });
}

// --- Backing pattern builders (battle) --------------------------------------

const EIGHTHS_44: Array<[number, number]> = [
  [0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2], [3, 0], [3, 2],
];

/**
 * One bar of driving eighth-note bass: root x6 then a push up to the fifth x2.
 * The relentless root pulse is the battle "engine"; the fifth push gives forward
 * lean into the next bar.
 */
export function bassBar(bar: number, root: string, fifth: string, vel: number): Note[] {
  const pitches = [root, root, root, root, root, root, fifth, fifth];
  return EIGHTHS_44.map(([beat, sx], i) => ({
    time: S(bar, beat, sx),
    note: pitches[i],
    dur: "8n",
    vel,
  }));
}

/** Hits on the given quarter-note beats of a bar (kick/snare). `note` optional (noise). */
export function onBeats(
  bar: number,
  beats: number[],
  dur: string,
  vel: number,
  note?: string,
): Note[] {
  return beats.map((b) => ({
    time: S(bar, b, 0),
    ...(note ? { note } : {}),
    dur,
    vel,
  }));
}

/** Eight straight eighth-note hits across a 4/4 bar (hi-hat pulse, unpitched). */
export function eighthHats(bar: number, dur: string, vel: number): Note[] {
  return EIGHTHS_44.map(([beat, sx]) => ({ time: S(bar, beat, sx), dur, vel }));
}

/** Flatten a per-bar builder across a list of bars. */
export function acrossBars(bars: number[], build: (bar: number) => Note[]): Note[] {
  return bars.flatMap(build);
}
