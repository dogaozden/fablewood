// ============================================================================
// "THE LEDGER DEEP" — the Preference Vaults EXPLORE leitmotif of FABLEWOOD.
// ============================================================================
//
// WORLD (Fable_SPEC §3): the space BETWEEN fights — lantern-lit strongrooms,
// shelves of sealed term-sheets, gold sleeping in the dark. Register: hushed,
// subterranean, ledger-solemn. Sparser and darker than the hamlet; tense, but
// without combat's drive. The brief in one line: make gold feel HEAVY.
// (This replaces the v1 "explore in deliberate silence" design.)
//
// THEORY
//   Key/mode : D aeolian (natural minor: D E F G A B♭ C). Battle borrowed the
//              ♭6 (B♭) for its "teeth" bridge; down here the borrowed darkness
//              IS the home mode. One dorian B♮ glimmer survives (bars 4–5 and
//              the bar-5 bass) — the lantern, not the sun.
//   Meter    : 4/4.  Tempo: quarter = 66 — EXACTLY HALF of battle's 132. The
//              vaults are the fight holding its breath: same pulse, half speed.
//   Form     : A(0–7) · B(8–13) · settle(14–15) = 16 bars ≈ 58s, loops whole.
//   Register : everything sits LOW. Lute ceiling F4 ≈ the hamlet lead's FLOOR
//              (D4); bells two octaves below hamlet's sparkle; bass dips to
//              A1/B♭1. Dark = low ceiling, heavy = deep floor.
//
// ── THE TRANSFORMATION (family kinship, all audible) ────────────────────────
// The hamlet HEAD is 5̂ 1̂ 2̂ 3̂; battle darkened it to A D E F. Down here:
//
//   1. AUGMENTATION ~26:1 — the A-section HARMONY IS THE HEAD: drone roots
//      A(2 bars) D(2) E(2) F(2) trace the darkened head one note per ~7.3s
//      (hamlet states it in 0.28s eighths). The tune is in the walls, asleep.
//   2. The lute quotes the same head at 8:1 / one octave below battle's riff
//      (bars 2–3: A3 D4 E4 F4 in slow quarters — the combat riff, dormant).
//   3. The INVERTED head (5̂ 2̂ 1̂ ♭7̂ = A E D C, battle's falling form) governs
//      the B section twice over: roots fall A→E→D→C (bars 8–11, one bar each),
//      and the lute states battle's intro counter-line VERBATIM at half speed
//      (bar 8: A3 E4 D4 C4 — same pitches, ♩=66 vs 132).
//   4. Bars 12–13 sink to the ♭VI (B♭) and a HOLLOW v (A, no leading-tone —
//      battle earns its C♯; the deep has no such pull). Deepest notes of the
//      piece: B♭1 → A1, a half-step settling like a scale coming to rest.
//
// WEIGHT, not drive: no snare, no hats, no eighth-note engine. A MembraneSynth
// heart thuds once per TWO bars in A (battle's kick fires ~16× as often), and
// only quickens to once per bar in B — tension gathers, never marches. Bass
// notes are placed like single coins on a scale; bells are hamlet's sparkle
// lowered two octaves into dull gold glints. Bar 15 is true silence except the
// drone — each loop is reborn out of hush, so the seam reads as a phrase-turn.
// ============================================================================

import type { Motif, Note } from "./types";
import { S } from "./notation";

// --- Drone (poly triangle fifths — the walls breathe once per bar) ----------
// Roots carry the augmented darkened head (A A D D E E F F), then the falling
// inverted head (A E D C from above), then ♭VI → hollow v → home. The E chords
// take the dorian B♮ fifth: the one lantern-glimmer in an aeolian dark.
const DRONE_BARS: Array<[string, string, number, number]> = [
  ["A2", "E3", 0.13, 0.11], // 0  ── augmented head: 5̂ …
  ["A2", "E3", 0.13, 0.11], // 1
  ["D3", "A3", 0.13, 0.11], // 2  ── … 1̂ …
  ["D3", "A3", 0.13, 0.11], // 3
  ["E3", "B3", 0.13, 0.11], // 4  ── … 2̂ (B♮ fifth = lantern) …
  ["E3", "B3", 0.13, 0.11], // 5
  ["F3", "C4", 0.14, 0.11], // 6  ── … ♭3̂. The battle head, ~26:1 slower.
  ["F3", "C4", 0.14, 0.11], // 7
  ["A3", "E4", 0.14, 0.12], // 8  ── inverted head, falling from above: 5̂ …
  ["E3", "B3", 0.14, 0.11], // 9  ── … 2̂ …
  ["D3", "A3", 0.13, 0.11], // 10 ── … 1̂ …
  ["C3", "G3", 0.13, 0.11], // 11 ── … ♭7̂
  ["Bb2", "F3", 0.15, 0.12], // 12 ── ♭VI: the teeth as ground. Gravest bar.
  ["A2", "E3", 0.13, 0.11], // 13 ── hollow v (no C♯ down here)
  ["D3", "A3", 0.12, 0.10], // 14 ── home
  ["D3", "A3", 0.12, 0.10], // 15 ── home, alone — the loop wraps out of hush
];
const DRONE: Note[] = DRONE_BARS.flatMap(([root, fifth, vr, vf], bar) => [
  { time: S(bar, 0, 0), note: root, dur: "1n", vel: vr },
  { time: S(bar, 0, 0), note: fifth, dur: "1n", vel: vf },
]);

// --- Bass (mono triangle — single coins set down on a scale) ----------------
// One weighed note per harmonic station, detached, with a quiet fifth answer
// on the off-bars of the A section. B section doubles the placement rate with
// the roots (quiet urgency), bottoming out on B♭1 → A1 — the heaviest coins.
const BASS: Note[] = [
  { time: S(0, 0, 0), note: "A2", dur: "2n", vel: 0.40 },
  { time: S(1, 2, 0), note: "E2", dur: "4n", vel: 0.32 },
  { time: S(2, 0, 0), note: "D2", dur: "2n", vel: 0.42 },
  { time: S(3, 2, 0), note: "A2", dur: "4n", vel: 0.32 },
  { time: S(4, 0, 0), note: "E2", dur: "2n", vel: 0.40 },
  { time: S(5, 2, 0), note: "B2", dur: "4n", vel: 0.30 }, // dorian B♮ echo
  { time: S(6, 0, 0), note: "F2", dur: "2n", vel: 0.42 },
  { time: S(7, 2, 0), note: "C3", dur: "4n", vel: 0.32 },
  { time: S(8, 0, 0), note: "A2", dur: "2n", vel: 0.42 }, // B: inverted head roots
  { time: S(9, 0, 0), note: "E2", dur: "2n", vel: 0.40 },
  { time: S(10, 0, 0), note: "D2", dur: "2n", vel: 0.40 },
  { time: S(11, 0, 0), note: "C2", dur: "2n", vel: 0.40 },
  { time: S(12, 0, 0), note: "Bb1", dur: "2n.", vel: 0.46 }, // the heaviest coin
  { time: S(13, 0, 0), note: "A1", dur: "2n", vel: 0.40 }, // …settles a half-step
  { time: S(14, 0, 0), note: "D2", dur: "2n", vel: 0.42 },
  { time: S(15, 2, 0), note: "A2", dur: "8n.", vel: 0.30 }, // breath before the wrap
];

// --- Lute (mono pluck — the hamlet's voice, humming home-fragments in the dark)
// Same PluckSynth as the hamlet lead, dulled (lower dampening, softer attack
// noise): the same instrument heard underground. Sparse phrases with real
// silences; ceiling F4 — beneath the hamlet lead's entire range.
const LUTE: Note[] = [
  // bars 2–3 — the darkened head at walking speed (battle's riff at 8:1, −1 oct)
  { time: S(2, 1, 0), note: "A3", dur: "4n", vel: 0.36 },
  { time: S(2, 2, 0), note: "D4", dur: "4n", vel: 0.38 },
  { time: S(2, 3, 0), note: "E4", dur: "4n", vel: 0.38 },
  { time: S(3, 0, 0), note: "F4", dur: "2n", vel: 0.40 }, // ♭3̂ held — the dark arrival
  // bar 5 — head-tail fragment, falling
  { time: S(5, 1, 0), note: "E4", dur: "4n", vel: 0.34 },
  { time: S(5, 2, 0), note: "D4", dur: "2n", vel: 0.32 },
  // bars 6–7 — relative-major glow (the lantern finds the gold), kneeling to F3
  { time: S(6, 2, 0), note: "C4", dur: "4n", vel: 0.34 },
  { time: S(6, 3, 0), note: "A3", dur: "4n", vel: 0.32 },
  { time: S(7, 0, 0), note: "F3", dur: "2n", vel: 0.34 },
  // bar 8 — battle's intro counter-line VERBATIM at half speed: the inverted head
  { time: S(8, 0, 0), note: "A3", dur: "4n", vel: 0.38 },
  { time: S(8, 1, 0), note: "E4", dur: "4n", vel: 0.40 },
  { time: S(8, 2, 0), note: "D4", dur: "4n", vel: 0.38 },
  { time: S(8, 3, 0), note: "C4", dur: "4n", vel: 0.36 },
  // bar 10 — its tail, echoed softer
  { time: S(10, 1, 0), note: "D4", dur: "4n", vel: 0.32 },
  { time: S(10, 2, 0), note: "C4", dur: "4n", vel: 0.30 },
  // bar 11 — drift toward the dark: B♭ pre-echo over the C drone
  { time: S(11, 2, 0), note: "A3", dur: "4n", vel: 0.30 },
  { time: S(11, 3, 0), note: "Bb3", dur: "4n", vel: 0.32 },
  // bar 12 — tacet: the deep B♭ speaks alone (bass + drone + bell)
  // bar 13 — hollow answer over the bare v
  { time: S(13, 1, 0), note: "E4", dur: "4n", vel: 0.30 },
  { time: S(13, 2, 0), note: "C4", dur: "4n", vel: 0.28 },
  // bar 14 — the head's FIRST INTERVAL only: 5̂→1̂. Home remembered, not reached.
  { time: S(14, 1, 0), note: "A3", dur: "4n", vel: 0.32 },
  { time: S(14, 2, 0), note: "D4", dur: "2n", vel: 0.34 },
  // bar 15 — tacet: a full bar of air before the loop returns
];

// --- Bells (poly FM — hamlet's sparkle, two octaves down: gold glints) ------
// Six tolls per loop. Longer decay than hamlet's dings (2.8s vs 1.6s): coins
// ringing in stone. Range B♭2–E4, farther and duller than the hamlet's D6 air.
const BELLS: Note[] = [
  { time: S(1, 2, 0), note: "A3", dur: "2n", vel: 0.20 }, // first glint in the dark
  { time: S(4, 0, 0), note: "E4", dur: "2n", vel: 0.18 }, // the lantern-B♮ bar opens
  { time: S(7, 2, 0), note: "F3", dur: "2n", vel: 0.22 }, // relays the lute's low F3
  { time: S(9, 0, 0), note: "E3", dur: "2n", vel: 0.18 },
  { time: S(12, 0, 0), note: "Bb2", dur: "1n", vel: 0.24 }, // the dark toll (lowest)
  { time: S(14, 0, 0), note: "D3", dur: "1n", vel: 0.20 }, // home — the ledger closes
];

// --- Heart (membrane — battle's kick, asleep) --------------------------------
// One soft thud per two bars in A (battle strikes ~16× as often), per bar in
// B, doubled once under the bar-12 toll (a skipped heartbeat), absent in 15.
const HEART: Note[] = [
  { time: S(0, 0, 0), note: "D1", dur: "4n", vel: 0.38 },
  { time: S(2, 0, 0), note: "D1", dur: "4n", vel: 0.38 },
  { time: S(4, 0, 0), note: "D1", dur: "4n", vel: 0.38 },
  { time: S(6, 0, 0), note: "D1", dur: "4n", vel: 0.38 },
  { time: S(8, 0, 0), note: "D1", dur: "4n", vel: 0.40 },
  { time: S(9, 0, 0), note: "D1", dur: "4n", vel: 0.40 },
  { time: S(10, 0, 0), note: "D1", dur: "4n", vel: 0.42 },
  { time: S(11, 0, 0), note: "D1", dur: "4n", vel: 0.42 },
  { time: S(12, 0, 0), note: "D1", dur: "4n", vel: 0.46 },
  { time: S(12, 2, 0), note: "D1", dur: "4n", vel: 0.34 }, // the skipped beat
  { time: S(13, 0, 0), note: "D1", dur: "4n", vel: 0.40 },
  { time: S(14, 0, 0), note: "D1", dur: "4n", vel: 0.38 },
];

export const vaults: Motif = {
  id: "vaults",
  title: "The Ledger Deep",
  key: "D aeolian (one dorian B♮ glimmer)",
  meter: [4, 4],
  bpm: 66, // exactly half of battle's 132 — the fight holding its breath
  lengthBars: 16,
  loopStartBar: 0,
  reverbWet: 0.45, // the wettest of the three: cavern air over 58s of hush
  tracks: [
    {
      name: "drone", // breathing open fifths — the augmented head in the walls
      synth: {
        kind: "Synth",
        poly: true,
        options: {
          oscillator: { type: "triangle" },
          envelope: { attack: 0.9, decay: 0.5, sustain: 0.8, release: 2.2 },
        },
      },
      gainDb: -15,
      notes: DRONE,
    },
    {
      name: "bass", // hamlet's triangle low end, slowed — coins on a scale
      synth: {
        kind: "Synth",
        options: {
          oscillator: { type: "triangle" },
          envelope: { attack: 0.03, decay: 0.4, sustain: 0.5, release: 0.7 },
        },
      },
      gainDb: -9,
      notes: BASS,
    },
    {
      name: "lute", // hamlet's pluck voice, dulled for the dark
      synth: {
        kind: "PluckSynth",
        options: { attackNoise: 0.8, dampening: 2400, resonance: 0.92 },
      },
      gainDb: -5,
      notes: LUTE,
    },
    {
      name: "bells", // hamlet's FM bells, −2 octaves + longer toll: gold glints
      synth: {
        kind: "FMSynth",
        poly: true,
        options: {
          harmonicity: 3,
          modulationIndex: 8,
          oscillator: { type: "sine" },
          envelope: { attack: 0.005, decay: 2.8, sustain: 0, release: 2.8 },
          modulation: { type: "sine" },
          modulationEnvelope: { attack: 0.005, decay: 0.5, sustain: 0, release: 0.5 },
        },
      },
      gainDb: -16,
      notes: BELLS,
    },
    {
      name: "heart", // battle's membrane kick, softened and slowed 8:1
      synth: {
        kind: "MembraneSynth",
        options: {
          pitchDecay: 0.08,
          octaves: 4,
          oscillator: { type: "sine" },
          envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.6 },
        },
      },
      gainDb: -10,
      notes: HEART,
    },
  ],
};
