// ============================================================================
// "THE VAULT-WARDEN" — boss-entrance sting. ONE-SHOT, non-looping (~11s).
// ============================================================================
//
// WORLD: the Warden rises from the vault floor — the moment the dungeon's held
// breath becomes a fight. Fires ONCE at the boss intro; combat then takes over
// with music.play('battle') (registered loop: false → replaying the sting on a
// rematch restarts it; the player exempts one-shots from the same-id no-op).
//
// ── THE QUOTE (the craft requirement: battle's intervals, slowed + lowered) ──
//   Bar 0 : battle's compressed HEAD — A D E F, hammered as 16ths at ♩=132
//           (0.11s/note) — is declaimed in QUARTERS at ♩=66 (0.91s/note):
//           8:1 slower, TWO octaves lower (A2 D3 E3 F3), on battle's own
//           sawtooth. The riff you fight to, monumentalized.
//   Bar 1 : battle's INVERTED head (the intro counter-line, A3 E4 D4 C4 in
//           quarters at 132) at exactly HALF speed, ONE octave lower
//           (A2 E3 D3 C3). When combat begins, its intro states this same
//           line an octave up — the sting hands the thought to the fight.
//   Bar 2 : landing. D2 toll under a D+B♭ shadow-chord — the ♭6 "teeth"
//           sonority battle saves for its bridge, here the Warden's own color.
//           No C♯ anywhere: the Warden does not resolve, it ARRIVES.
//
// Tempo 66 = the vaults' pulse (the sting erupts from the explore theme);
// combat at 132 then doubles it — the architecture is 66 → sting 66 → 132.
// All voices are family palette: battle's saw + kick + noise, the vaults'
// triangle shadow + bell. Total 3 bars at 4/4 ≈ 10.9s, most of the last bar
// being the toll's ring-out into the boss-phase overlay.
// ============================================================================

import type { Motif, Note } from "./types";
import { S } from "./notation";

// --- Maw (mono saw — battle's lead timbre, slowed envelope): the quotes -----
const MAW: Note[] = [
  // bar 0 — the darkened HEAD, 8:1 and −2 octaves: A D E F in quarters
  { time: S(0, 0, 0), note: "A2", dur: "4n", vel: 0.62 },
  { time: S(0, 1, 0), note: "D3", dur: "4n", vel: 0.66 },
  { time: S(0, 2, 0), note: "E3", dur: "4n", vel: 0.66 },
  { time: S(0, 3, 0), note: "F3", dur: "4n", vel: 0.70 },
  // bar 1 — the INVERTED head, 2:1 and −1 octave: A E D C falling
  { time: S(1, 0, 0), note: "A2", dur: "4n", vel: 0.66 },
  { time: S(1, 1, 0), note: "E3", dur: "4n", vel: 0.64 },
  { time: S(1, 2, 0), note: "D3", dur: "4n", vel: 0.62 },
  { time: S(1, 3, 0), note: "C3", dur: "4n", vel: 0.60 },
  // bar 2 — landing: the lowest statement, one long D
  { time: S(2, 0, 0), note: "D2", dur: "1n", vel: 0.70 },
];

// --- Shadow (poly triangle — the vaults' drone voice, risen to meet it) -----
// A pedal 5̂ under both quote bars (dominant dread), then the landing chord:
// D + B♭ above — tonic wearing the ♭6 teeth.
const SHADOW: Note[] = [
  { time: S(0, 0, 0), note: "A1", dur: "1n", vel: 0.30 },
  { time: S(0, 0, 0), note: "E2", dur: "1n", vel: 0.24 },
  { time: S(1, 0, 0), note: "A1", dur: "1n", vel: 0.30 },
  { time: S(1, 0, 0), note: "E2", dur: "1n", vel: 0.24 },
  { time: S(2, 0, 0), note: "D2", dur: "1n", vel: 0.34 },
  { time: S(2, 0, 0), note: "Bb2", dur: "1n", vel: 0.30 },
];

// --- Doom (membrane — battle's kick made ceremonial) ------------------------
const DOOM: Note[] = [
  { time: S(0, 0, 0), note: "D1", dur: "4n", vel: 0.90 },
  { time: S(1, 0, 0), note: "D1", dur: "4n", vel: 0.70 },
  { time: S(2, 0, 0), note: "D1", dur: "4n", vel: 0.95 },
  { time: S(2, 2, 0), note: "D1", dur: "4n", vel: 0.60 }, // the after-shock
];

// --- Strike (noise — one burst of scattering coin-dust as it rises) ---------
const STRIKE: Note[] = [{ time: S(0, 0, 0), dur: "8n", vel: 0.55 }];

// --- Knell (FM bell — the vault's own gold, tolling for you) ----------------
const KNELL: Note[] = [
  { time: S(0, 0, 0), note: "A3", dur: "2n", vel: 0.22 }, // the scatter's ring
  { time: S(2, 0, 0), note: "D3", dur: "1n", vel: 0.30 }, // the landing toll
];

export const warden: Motif = {
  id: "warden",
  title: "The Vault-Warden",
  key: "D minor (♭6 shadow, no leading-tone)",
  meter: [4, 4],
  bpm: 66, // the vaults' pulse — combat will double it
  lengthBars: 3,
  loopStartBar: 0,
  loop: false, // one-shot: plays once, rings out; play('battle') takes over
  reverbWet: 0.5,
  tracks: [
    {
      name: "maw", // battle's saw lead, slowed — the quotes
      synth: {
        kind: "Synth",
        options: {
          oscillator: { type: "sawtooth" },
          envelope: { attack: 0.04, decay: 0.3, sustain: 0.6, release: 0.5 },
        },
      },
      gainDb: -6,
      notes: MAW,
    },
    {
      name: "shadow", // the vaults' triangle drone, risen
      synth: {
        kind: "Synth",
        poly: true,
        options: {
          oscillator: { type: "triangle" },
          envelope: { attack: 0.2, decay: 0.4, sustain: 0.7, release: 2.5 },
        },
      },
      gainDb: -13,
      notes: SHADOW,
    },
    {
      name: "doom", // battle's membrane kick, heavier
      synth: {
        kind: "MembraneSynth",
        options: {
          pitchDecay: 0.06,
          octaves: 5,
          oscillator: { type: "sine" },
          envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.5 },
        },
      },
      gainDb: -5,
      notes: DOOM,
    },
    {
      name: "strike", // battle's noise voice — one ceremonial burst
      synth: {
        kind: "NoiseSynth",
        options: {
          noise: { type: "white" },
          envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 },
        },
      },
      gainDb: -12,
      notes: STRIKE,
    },
    {
      name: "knell", // the vaults' bell voice
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
      gainDb: -14,
      notes: KNELL,
    },
  ],
};
