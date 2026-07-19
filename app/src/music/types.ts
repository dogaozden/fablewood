// FABLEWOOD — music data contract.
//
// A leitmotif is PURE DATA: metadata + a set of instrument tracks, each track a
// list of timed notes. player.ts turns this into sound with Tone.js; nothing in
// this file (or in hamlet.ts / battle.ts) imports Tone, so the data can be read,
// validated, or transformed with zero audio dependencies.
//
// TIME NOTATION — Tone.js "bars:beats:sixteenths" (bars 0-indexed):
//   - A "beat" is a QUARTER note (Tone convention), regardless of meter.
//   - beatsPerBar = (meter.num / meter.den) * 4  →  6/8 = 3 beats, 4/4 = 4 beats.
//   - sixteenths run 0..3 within a beat.
//   See notation.ts for the helpers that build these strings deterministically.

/** Which Tone.js instrument a track is voiced on. */
export type SynthKind =
  | "PluckSynth" // warm plucked lead / marimba-ish
  | "Synth" // basic subtractive (mono or poly)
  | "FMSynth" // bell / metallic accents
  | "AMSynth"
  | "MembraneSynth" // kick-like percussion (pitched)
  | "NoiseSynth" // snare / hat percussion (unpitched)
  | "MetalSynth"; // bright metallic hat / accent

/** How to construct a track's instrument. `options` is passed to the Tone ctor. */
export interface SynthSpec {
  kind: SynthKind;
  /** Wrap the voice in a Tone.PolySynth so chords / overlaps ring together. */
  poly?: boolean;
  // deno-lint-ignore no-explicit-any — Tone's per-synth option shapes vary.
  options?: Record<string, unknown>;
}

/** One scheduled note. `note` is omitted only for unpitched noise percussion. */
export interface Note {
  /** "bars:beats:sixteenths", e.g. "4:2:0". */
  time: string;
  /** Scientific pitch, e.g. "F#5", "Bb2". Omitted for NoiseSynth hits. */
  note?: string;
  /** Tone duration token: "16n", "8n", "8n.", "4n", "4n.", "2n", "2n.", "1n". */
  dur: string;
  /** Velocity 0..1. */
  vel: number;
}

export interface Track {
  name: string;
  synth: SynthSpec;
  /** Per-track level in dB (0 = unity, negative = quieter). Keeps the mix balanced. */
  gainDb: number;
  notes: Note[];
}

export interface Motif {
  id: string;
  title: string;
  /** Human notes: key, mode, register rationale. */
  key: string;
  /** [numerator, denominator], e.g. [6, 8]. */
  meter: [number, number];
  /** Quarter-note BPM for Tone.Transport. */
  bpm: number;
  /** Total length in bars (== loopEnd bar). */
  lengthBars: number;
  /** Loop region start bar (default 0). Battle uses this to play its intro once. */
  loopStartBar: number;
  /** Reverb wet 0..1 applied on the master bus while this motif plays. */
  reverbWet: number;
  tracks: Track[];
}
