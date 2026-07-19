// ============================================================================
// "THE CLEARING" — the home-hamlet leitmotif of FABLEWOOD.
// ============================================================================
//
// WORLD (Fable_SPEC §3): the lantern-lit clearing at the heart of the Fablewood,
// tavern-warmed, where every expedition departs and returns. Register: cozy &
// whimsical. This theme plays A LOT (it IS the dashboard), so it is written for
// background listening — a gentle dynamic arc, real rests to breathe, nothing in
// a shrill register, and no hook sharp enough to grate on the hundredth loop.
//
// THEORY
//   Key/mode : D major, mixolydian-inflected (the ♭7 = C♮ appears at the folk
//              cadences in bars 5 and 7 — that lowered leading-tone is the "old
//              tune" warmth; a true C♯ leading-tone is saved for the bridge, to
//              pull back home).
//   Meter    : 6/8, a lilting compound-duple folk sway.
//   Tempo    : quarter = 108  →  dotted-quarter pulse ≈ 72/min. Unhurried walk.
//   Form     : A A B A' (32 bars ≈ 53s). A = an 8-bar period; B is a lyrical,
//              sustained bridge that leans on the dominant to set up the return.
//   Register : lead D4–A5 (warm, never shrill), bass D2–A2, open-fifth pad in
//              octave 3, sparse bell sparkle no higher than D6.
//
// THE SHARED MOTIF (this is what battle.ts transforms — see that file):
//   HEAD = scale degrees 5̂ 1̂ 2̂ 3̂  (A4 D5 E5 F♯5): a rising perfect-fourth kick
//   up to the tonic, then two warm steps up to the bright major third. Hopeful,
//   open, "the path home rising." It opens bars 0, 4, 8, 12 and closes the piece.
//
// Instrumentation is Tone.js synths only (no samples): a warm plucked lead, a
// soft open-fifth pad, a gentle triangle bass, and bell accents that enter only
// from the A-repeat onward so the first statement stays plain.
// ============================================================================

import type { Motif, Note } from "./types";
import { E, shiftBars } from "./notation";

// --- A section (bars 0–7): the tune ----------------------------------------
// An 8-bar period. Antecedent (0–3) rises to the A5 peak and falls; consequent
// (4–7) restates the head and cadences down to a low tonic with mixolydian color.
const A_LEAD: Note[] = [
  // bar 0 — HEAD: 5̂ 1̂ 2̂ · 3̂(held). Rise to the bright third.
  { time: E(0, 0), note: "A4", dur: "8n", vel: 0.58 },
  { time: E(0, 1), note: "D5", dur: "8n", vel: 0.60 },
  { time: E(0, 2), note: "E5", dur: "8n", vel: 0.60 },
  { time: E(0, 3), note: "F#5", dur: "4n.", vel: 0.64 },
  // bar 1 — 2̂ 1̂ 6̂ · 5̂(held). Fall to rest on the dominant.
  { time: E(1, 0), note: "E5", dur: "8n", vel: 0.56 },
  { time: E(1, 1), note: "D5", dur: "8n", vel: 0.54 },
  { time: E(1, 2), note: "B4", dur: "8n", vel: 0.52 },
  { time: E(1, 3), note: "A4", dur: "4n.", vel: 0.50 },
  // bar 2 — 5̂ 1̂ 3̂ · 5̂(peak A5, held). The antecedent's emotional high point.
  { time: E(2, 0), note: "A4", dur: "8n", vel: 0.58 },
  { time: E(2, 1), note: "D5", dur: "8n", vel: 0.62 },
  { time: E(2, 2), note: "F#5", dur: "8n", vel: 0.66 },
  { time: E(2, 3), note: "A5", dur: "4n.", vel: 0.70 },
  // bar 3 — 4̂ 3̂ 2̂ · 1̂(held). Stepwise descent home.
  { time: E(3, 0), note: "G5", dur: "8n", vel: 0.60 },
  { time: E(3, 1), note: "F#5", dur: "8n", vel: 0.56 },
  { time: E(3, 2), note: "E5", dur: "8n", vel: 0.52 },
  { time: E(3, 3), note: "D5", dur: "4n.", vel: 0.50 },
  // bar 4 — HEAD restated: 5̂ 1̂ 2̂ · 3̂(held).
  { time: E(4, 0), note: "A4", dur: "8n", vel: 0.58 },
  { time: E(4, 1), note: "D5", dur: "8n", vel: 0.60 },
  { time: E(4, 2), note: "E5", dur: "8n", vel: 0.60 },
  { time: E(4, 3), note: "F#5", dur: "4n.", vel: 0.64 },
  // bar 5 — 2̂ 1̂ ♭7̂ · 1̂. Mixolydian: C♮ leans up to the tonic (folk cadence).
  { time: E(5, 0), note: "E5", dur: "8n", vel: 0.56 },
  { time: E(5, 1), note: "D5", dur: "8n", vel: 0.54 },
  { time: E(5, 2), note: "C5", dur: "8n", vel: 0.52 },
  { time: E(5, 3), note: "D5", dur: "4n.", vel: 0.54 },
  // bar 6 — 5̂ 6̂ 1̂ · 2̂. A gentle rise, gathering for the close.
  { time: E(6, 0), note: "A4", dur: "8n", vel: 0.54 },
  { time: E(6, 1), note: "B4", dur: "8n", vel: 0.54 },
  { time: E(6, 2), note: "D5", dur: "8n", vel: 0.56 },
  { time: E(6, 3), note: "E5", dur: "4n.", vel: 0.56 },
  // bar 7 — 1̂ ♭7̂ 5̂ · 1̂(low). Mixolydian fall to a grounded low tonic. Home.
  { time: E(7, 0), note: "D5", dur: "8n", vel: 0.54 },
  { time: E(7, 1), note: "C5", dur: "8n", vel: 0.50 },
  { time: E(7, 2), note: "A4", dur: "8n", vel: 0.48 },
  { time: E(7, 3), note: "D4", dur: "4n.", vel: 0.46 },
];

// --- B section (bars 16–23): the bridge ------------------------------------
// Contrast by texture: long, lyrical dotted-quarters instead of flowing eighths.
// Wistful high descent, a reach back to the A5 peak, then a C♯ leading-tone and a
// dominant pedal that pull the ear home for the A' return. Ends with a full rest.
const B_LEAD: Note[] = [
  // bar 16 — 3̂ . 2̂ . (high, sustained, wistful)
  { time: E(16, 0), note: "F#5", dur: "4n.", vel: 0.52 },
  { time: E(16, 3), note: "E5", dur: "4n.", vel: 0.50 },
  // bar 17 — 1̂ . 2̂ .
  { time: E(17, 0), note: "D5", dur: "4n.", vel: 0.50 },
  { time: E(17, 3), note: "E5", dur: "4n.", vel: 0.52 },
  // bar 18 — 3̂ . 5̂ . (reach back up to the A5 peak)
  { time: E(18, 0), note: "F#5", dur: "4n.", vel: 0.56 },
  { time: E(18, 3), note: "A5", dur: "4n.", vel: 0.62 },
  // bar 19 — 4̂ 3̂ 2̂ · 1̂. Descent.
  { time: E(19, 0), note: "G5", dur: "8n", vel: 0.56 },
  { time: E(19, 1), note: "F#5", dur: "8n", vel: 0.52 },
  { time: E(19, 2), note: "E5", dur: "8n", vel: 0.50 },
  { time: E(19, 3), note: "D5", dur: "4n.", vel: 0.48 },
  // bar 20 — 5̂ . 6̂ .
  { time: E(20, 0), note: "A4", dur: "4n.", vel: 0.48 },
  { time: E(20, 3), note: "B4", dur: "4n.", vel: 0.50 },
  // bar 21 — 7̂ . 1̂ . (C♯ leading-tone — the ONE place we sharpen it, to pull home)
  { time: E(21, 0), note: "C#5", dur: "4n.", vel: 0.54 },
  { time: E(21, 3), note: "D5", dur: "4n.", vel: 0.56 },
  // bar 22 — 2̂ 3̂ 4̂ · 2̂. Hovering, building anticipation over the dominant.
  { time: E(22, 0), note: "E5", dur: "8n", vel: 0.54 },
  { time: E(22, 1), note: "F#5", dur: "8n", vel: 0.54 },
  { time: E(22, 2), note: "G5", dur: "8n", vel: 0.52 },
  { time: E(22, 3), note: "E5", dur: "4n.", vel: 0.50 },
  // bar 23 — 2̂ 7̂ 5̂ · (rest). A breath before A' returns — silence that resets.
  { time: E(23, 0), note: "E5", dur: "8n", vel: 0.48 },
  { time: E(23, 1), note: "C#5", dur: "8n", vel: 0.46 },
  { time: E(23, 2), note: "A4", dur: "8n", vel: 0.44 },
];

// --- Bass (gentle triangle, two dotted-quarter pulses/bar, "boom · boom") ----
// Detached quarter-notes leave an eighth of air after each pulse: the 6/8 lilt.
// Harmony under A: I · V · I · IV→I · I · ♭VII · IV · I(turnaround to V).
const A_BASS: Note[] = [
  { time: E(0, 0), note: "D2", dur: "4n", vel: 0.42 }, { time: E(0, 3), note: "D2", dur: "4n", vel: 0.38 },
  { time: E(1, 0), note: "A2", dur: "4n", vel: 0.42 }, { time: E(1, 3), note: "A2", dur: "4n", vel: 0.38 },
  { time: E(2, 0), note: "D2", dur: "4n", vel: 0.42 }, { time: E(2, 3), note: "D2", dur: "4n", vel: 0.38 },
  { time: E(3, 0), note: "G2", dur: "4n", vel: 0.42 }, { time: E(3, 3), note: "D2", dur: "4n", vel: 0.38 }, // IV→I
  { time: E(4, 0), note: "D2", dur: "4n", vel: 0.42 }, { time: E(4, 3), note: "D2", dur: "4n", vel: 0.38 },
  { time: E(5, 0), note: "C2", dur: "4n", vel: 0.42 }, { time: E(5, 3), note: "C2", dur: "4n", vel: 0.38 }, // ♭VII
  { time: E(6, 0), note: "G2", dur: "4n", vel: 0.42 }, { time: E(6, 3), note: "G2", dur: "4n", vel: 0.38 },
  { time: E(7, 0), note: "D2", dur: "4n", vel: 0.42 }, { time: E(7, 3), note: "A2", dur: "4n", vel: 0.40 }, // turnaround
];
const B_BASS: Note[] = [
  { time: E(16, 0), note: "B2", dur: "4n", vel: 0.40 }, { time: E(16, 3), note: "B2", dur: "4n", vel: 0.36 }, // vi
  { time: E(17, 0), note: "G2", dur: "4n", vel: 0.40 }, { time: E(17, 3), note: "G2", dur: "4n", vel: 0.36 }, // IV
  { time: E(18, 0), note: "D2", dur: "4n", vel: 0.40 }, { time: E(18, 3), note: "D2", dur: "4n", vel: 0.36 }, // I
  { time: E(19, 0), note: "A2", dur: "4n", vel: 0.40 }, { time: E(19, 3), note: "D2", dur: "4n", vel: 0.36 }, // V→I
  { time: E(20, 0), note: "D2", dur: "4n", vel: 0.40 }, { time: E(20, 3), note: "D2", dur: "4n", vel: 0.36 }, // I
  { time: E(21, 0), note: "A2", dur: "4n", vel: 0.40 }, { time: E(21, 3), note: "A2", dur: "4n", vel: 0.36 }, // V
  { time: E(22, 0), note: "A2", dur: "4n", vel: 0.40 }, { time: E(22, 3), note: "A2", dur: "4n", vel: 0.36 }, // V pedal
  { time: E(23, 0), note: "A2", dur: "4n", vel: 0.40 }, { time: E(23, 3), note: "A2", dur: "4n", vel: 0.34 }, // V → A'
];

// --- Pad (open fifths, one voicing per chord, full-bar sustain) -------------
// Open fifths (no third) keep it airy and cozy rather than cloying.
const A_PAD: Note[] = [
  { time: E(0, 0), note: "D3", dur: "2n.", vel: 0.15 }, { time: E(0, 0), note: "A3", dur: "2n.", vel: 0.13 },
  { time: E(1, 0), note: "A3", dur: "2n.", vel: 0.15 }, { time: E(1, 0), note: "E4", dur: "2n.", vel: 0.12 },
  { time: E(2, 0), note: "D3", dur: "2n.", vel: 0.15 }, { time: E(2, 0), note: "A3", dur: "2n.", vel: 0.13 },
  // bar 3 splits IV→I
  { time: E(3, 0), note: "G3", dur: "4n.", vel: 0.15 }, { time: E(3, 0), note: "D4", dur: "4n.", vel: 0.12 },
  { time: E(3, 3), note: "D3", dur: "4n.", vel: 0.15 }, { time: E(3, 3), note: "A3", dur: "4n.", vel: 0.12 },
  { time: E(4, 0), note: "D3", dur: "2n.", vel: 0.15 }, { time: E(4, 0), note: "A3", dur: "2n.", vel: 0.13 },
  { time: E(5, 0), note: "C3", dur: "2n.", vel: 0.15 }, { time: E(5, 0), note: "G3", dur: "2n.", vel: 0.13 },
  { time: E(6, 0), note: "G3", dur: "2n.", vel: 0.15 }, { time: E(6, 0), note: "D4", dur: "2n.", vel: 0.12 },
  // bar 7 splits I→V turnaround
  { time: E(7, 0), note: "D3", dur: "4n.", vel: 0.15 }, { time: E(7, 0), note: "A3", dur: "4n.", vel: 0.12 },
  { time: E(7, 3), note: "A3", dur: "4n.", vel: 0.15 }, { time: E(7, 3), note: "E4", dur: "4n.", vel: 0.12 },
];
const B_PAD: Note[] = [
  { time: E(16, 0), note: "B3", dur: "2n.", vel: 0.14 }, { time: E(16, 0), note: "F#4", dur: "2n.", vel: 0.11 },
  { time: E(17, 0), note: "G3", dur: "2n.", vel: 0.14 }, { time: E(17, 0), note: "D4", dur: "2n.", vel: 0.11 },
  { time: E(18, 0), note: "D3", dur: "2n.", vel: 0.14 }, { time: E(18, 0), note: "A3", dur: "2n.", vel: 0.12 },
  { time: E(19, 0), note: "A3", dur: "4n.", vel: 0.14 }, { time: E(19, 0), note: "E4", dur: "4n.", vel: 0.11 },
  { time: E(19, 3), note: "D3", dur: "4n.", vel: 0.14 }, { time: E(19, 3), note: "A3", dur: "4n.", vel: 0.11 },
  { time: E(20, 0), note: "D3", dur: "2n.", vel: 0.14 }, { time: E(20, 0), note: "A3", dur: "2n.", vel: 0.12 },
  { time: E(21, 0), note: "A3", dur: "2n.", vel: 0.14 }, { time: E(21, 0), note: "E4", dur: "2n.", vel: 0.11 },
  { time: E(22, 0), note: "A3", dur: "2n.", vel: 0.14 }, { time: E(22, 0), note: "E4", dur: "2n.", vel: 0.11 },
  { time: E(23, 0), note: "A3", dur: "2n.", vel: 0.13 }, { time: E(23, 0), note: "E4", dur: "2n.", vel: 0.10 },
];

// --- Bells (sparse sparkle) -------------------------------------------------
// Enter only from the A-repeat (bar 8) so the first statement of the tune stays
// plain. Single soft dings on section downbeats and at the melodic A5 peaks.
const BELLS: Note[] = [
  { time: E(8, 0), note: "D6", dur: "4n", vel: 0.20 }, // A-repeat begins
  { time: E(10, 3), note: "A5", dur: "4n", vel: 0.22 }, // peak (mirrors bar 2)
  { time: E(16, 0), note: "F#5", dur: "4n", vel: 0.18 }, // bridge begins
  { time: E(18, 3), note: "A5", dur: "4n", vel: 0.22 }, // bridge peak
  { time: E(24, 0), note: "D6", dur: "4n", vel: 0.20 }, // A' begins
  { time: E(26, 3), note: "A5", dur: "4n", vel: 0.22 }, // A' peak
];

// AABA' assembly: A(0–7) · A-repeat(8–15) · B(16–23) · A'(24–31).
const lead: Note[] = [...A_LEAD, ...shiftBars(A_LEAD, 8), ...B_LEAD, ...shiftBars(A_LEAD, 24)];
const bass: Note[] = [...A_BASS, ...shiftBars(A_BASS, 8), ...B_BASS, ...shiftBars(A_BASS, 24)];
const pad: Note[] = [...A_PAD, ...shiftBars(A_PAD, 8), ...B_PAD, ...shiftBars(A_PAD, 24)];

export const hamlet: Motif = {
  id: "hamlet",
  title: "The Clearing",
  key: "D major (mixolydian-inflected)",
  meter: [6, 8],
  bpm: 108, // quarter = 108 → dotted-quarter pulse ≈ 72
  lengthBars: 32,
  loopStartBar: 0,
  reverbWet: 0.32,
  tracks: [
    {
      name: "lead", // warm plucked lute/harp — the singing voice
      synth: {
        kind: "PluckSynth",
        options: { attackNoise: 0.9, dampening: 3200, resonance: 0.9 },
      },
      gainDb: -3,
      notes: lead,
    },
    {
      name: "pad", // soft open-fifth wash for warmth
      synth: {
        kind: "Synth",
        poly: true,
        options: {
          oscillator: { type: "triangle" },
          envelope: { attack: 0.45, decay: 0.3, sustain: 0.7, release: 1.3 },
        },
      },
      gainDb: -17,
      notes: pad,
    },
    {
      name: "bass", // gentle triangle low end
      synth: {
        kind: "Synth",
        options: {
          oscillator: { type: "triangle" },
          envelope: { attack: 0.02, decay: 0.25, sustain: 0.45, release: 0.4 },
        },
      },
      gainDb: -8,
      notes: bass,
    },
    {
      name: "bells", // FM bell sparkle, let ring
      synth: {
        kind: "FMSynth",
        poly: true,
        options: {
          harmonicity: 3,
          modulationIndex: 5,
          oscillator: { type: "sine" },
          envelope: { attack: 0.005, decay: 1.6, sustain: 0, release: 1.6 },
          modulation: { type: "sine" },
          modulationEnvelope: { attack: 0.005, decay: 0.3, sustain: 0, release: 0.3 },
        },
      },
      gainDb: -14,
      notes: BELLS,
    },
  ],
};
