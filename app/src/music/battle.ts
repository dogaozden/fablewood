// ============================================================================
// "THE VAULTS" — the grid-combat leitmotif of FABLEWOOD.
// ============================================================================
//
// WORLD (Fable_SPEC §3): the Preference Vaults — the first dungeon, term-sheet
// economics as a tactics fight. "Teeth, but fair": driving and tense, adventurous
// rather than horror. This is the same world as the hamlet turned dangerous, so
// the music is literally the hamlet's motif turned dangerous — kin, not stranger.
//
// THEORY
//   Key/mode : D dorian (D E F G A B C — a MINOR tonic with a raised 6th, B♮).
//              The raised 6 keeps it adventurous, not grim; the B-section borrows
//              the ♭6 (B♭, aeolian) for the "teeth" without tipping into horror.
//   Meter    : 4/4.  Tempo: quarter = 132. Driving.
//   Form     : intro(0–3) · A(4–11) · B(12–19) · turnaround(20–23) = 24 bars.
//              The intro plays ONCE (loopStartBar = 4); combat then loops 4→24
//              (≈36s) so there is no dead restart mid-fight.
//   Register : lead D4–A5 (bright but not shrill), bass D2–A2, low power-chord
//              pad, and composed percussion from synths (no samples): a
//              MembraneSynth kick and two NoiseSynth voices for snare and hat.
//
// ── THE TRANSFORMATION (this is the craft requirement) ──────────────────────
// The hamlet HEAD motif is  5̂ 1̂ 2̂ 3̂  =  A D E F♯  in D major, flowing in 6/8.
// The Vaults derive their material from it three ways, all audible:
//
//   1. MODE SHIFT (major → dorian): the major third 3̂ (F♯) is lowered to the
//      minor third ♭3̂ (F♮). The head becomes  5̂ 1̂ 2̂ ♭3̂ = A D E F.  Same
//      skeleton, darkened color. This is the battle LEAD's opening cell.
//
//   2. RHYTHMIC COMPRESSION: the hamlet head unfurls across a whole 6/8 bar
//      (dotted-quarter pulse). Here it is crushed into four straight SIXTEENTHS
//      on beat 1 — a single urgent stab, then hammered as a riff. Time compressed
//      ≈ 3:1.  (bars 4, 6, 20, 22 open with this compressed head.)
//
//   3. INVERSION: mirror the head's intervals about the tonic. Ascending it is
//      +P4, +M2, +M2; inverted it is −P4, −M2, −M2, giving  5̂ 2̂ 1̂ ♭7̂ = A E D C,
//      a FALLING line. This inverted head is stated nakedly by the counter-voice
//      in the intro (so the ear meets the kinship before the fight), then hammered
//      as the B-section climax (bar 16). Hamlet rises home; the Vaults fall away.
//
// A dorian B♮ passing-tone (bar 9) and a C♯ leading-tone at the dominant (bar 19)
// give the loop its pull back to the tonic.
// ============================================================================

import type { Motif, Note } from "./types";
import { acrossBars, bassBar, eighthHats, onBeats, S } from "./notation";

const bars = (a: number, b: number): number[] =>
  Array.from({ length: b - a }, (_, i) => a + i);

// --- LEAD: A section (bars 4–11) -------------------------------------------
// The transformed head (compressed + mode-shifted) as a driving riff, answered
// by its falling form, building to a high A5 statement and an Am lift.
const LEAD_A: Note[] = [
  // bar 4 (Dm) — COMPRESSED HEAD 5̂ 1̂ 2̂ ♭3̂ (16ths), then 2̂ · 1̂ · (5̂ pickup)
  { time: S(4, 0, 0), note: "A4", dur: "16n", vel: 0.70 },
  { time: S(4, 0, 1), note: "D5", dur: "16n", vel: 0.72 },
  { time: S(4, 0, 2), note: "E5", dur: "16n", vel: 0.72 },
  { time: S(4, 0, 3), note: "F5", dur: "16n", vel: 0.74 },
  { time: S(4, 1, 0), note: "E5", dur: "4n", vel: 0.66 },
  { time: S(4, 2, 0), note: "D5", dur: "4n", vel: 0.64 },
  { time: S(4, 3, 2), note: "A4", dur: "8n", vel: 0.58 },
  // bar 5 (C) — falling answer ♭3̂ 2̂ 1̂ ♭7̂ (16ths), then 1̂ · (5̂ pickup)
  { time: S(5, 0, 0), note: "F5", dur: "16n", vel: 0.70 },
  { time: S(5, 0, 1), note: "E5", dur: "16n", vel: 0.68 },
  { time: S(5, 0, 2), note: "D5", dur: "16n", vel: 0.66 },
  { time: S(5, 0, 3), note: "C5", dur: "16n", vel: 0.64 },
  { time: S(5, 1, 0), note: "D5", dur: "4n", vel: 0.62 },
  { time: S(5, 3, 2), note: "A4", dur: "8n", vel: 0.58 },
  // bar 6 (Dm) — compressed head again
  { time: S(6, 0, 0), note: "A4", dur: "16n", vel: 0.70 },
  { time: S(6, 0, 1), note: "D5", dur: "16n", vel: 0.72 },
  { time: S(6, 0, 2), note: "E5", dur: "16n", vel: 0.72 },
  { time: S(6, 0, 3), note: "F5", dur: "16n", vel: 0.74 },
  { time: S(6, 1, 0), note: "E5", dur: "4n", vel: 0.66 },
  { time: S(6, 2, 0), note: "D5", dur: "4n", vel: 0.64 },
  { time: S(6, 3, 2), note: "A4", dur: "8n", vel: 0.58 },
  // bar 7 (C) — falling answer, then a rising run 2̂ ♭3̂ 4̂ 5̂ up to the peak
  { time: S(7, 0, 0), note: "F5", dur: "16n", vel: 0.70 },
  { time: S(7, 0, 1), note: "E5", dur: "16n", vel: 0.68 },
  { time: S(7, 0, 2), note: "D5", dur: "16n", vel: 0.66 },
  { time: S(7, 0, 3), note: "C5", dur: "16n", vel: 0.64 },
  { time: S(7, 1, 0), note: "D5", dur: "4n", vel: 0.62 },
  { time: S(7, 2, 0), note: "E5", dur: "8n", vel: 0.64 },
  { time: S(7, 2, 2), note: "F5", dur: "8n", vel: 0.66 },
  { time: S(7, 3, 0), note: "G5", dur: "8n", vel: 0.70 },
  { time: S(7, 3, 2), note: "A5", dur: "8n", vel: 0.74 },
  // bar 8 (Dm) — high statement: 5̂(peak) · 4̂ ♭3̂ · 2̂ 1̂ · ♭3̂ 2̂
  { time: S(8, 0, 0), note: "A5", dur: "4n", vel: 0.76 },
  { time: S(8, 1, 0), note: "G5", dur: "8n", vel: 0.66 },
  { time: S(8, 1, 2), note: "F5", dur: "8n", vel: 0.64 },
  { time: S(8, 2, 0), note: "E5", dur: "8n", vel: 0.62 },
  { time: S(8, 2, 2), note: "D5", dur: "8n", vel: 0.60 },
  { time: S(8, 3, 0), note: "F5", dur: "8n", vel: 0.62 },
  { time: S(8, 3, 2), note: "E5", dur: "8n", vel: 0.60 },
  // bar 9 (C) — 1̂ ♭7̂ · 6̂ ♭7̂ (B♮ dorian color) · 1̂ · (5̂ pickup)
  { time: S(9, 0, 0), note: "D5", dur: "8n", vel: 0.60 },
  { time: S(9, 0, 2), note: "C5", dur: "8n", vel: 0.58 },
  { time: S(9, 1, 0), note: "B4", dur: "8n", vel: 0.58 }, // raised 6 — adventurous
  { time: S(9, 1, 2), note: "C5", dur: "8n", vel: 0.58 },
  { time: S(9, 2, 0), note: "D5", dur: "4n", vel: 0.60 },
  { time: S(9, 3, 2), note: "A4", dur: "8n", vel: 0.56 },
  // bar 10 (Am) — the lift: Am arpeggio up to A5, fall, land on 5̂, then breathe
  { time: S(10, 0, 0), note: "A4", dur: "16n", vel: 0.66 },
  { time: S(10, 0, 1), note: "C5", dur: "16n", vel: 0.68 },
  { time: S(10, 0, 2), note: "E5", dur: "16n", vel: 0.70 },
  { time: S(10, 0, 3), note: "A5", dur: "16n", vel: 0.74 },
  { time: S(10, 1, 0), note: "G5", dur: "8n", vel: 0.64 },
  { time: S(10, 1, 2), note: "E5", dur: "8n", vel: 0.62 },
  { time: S(10, 2, 0), note: "A4", dur: "4n", vel: 0.60 },
  // bar 11 (C) — descending turnaround run 4̂ ♭3̂ 2̂ 1̂ ♭7̂ 1̂ 2̂ ♭3̂ into the B section
  { time: S(11, 0, 0), note: "G5", dur: "8n", vel: 0.62 },
  { time: S(11, 0, 2), note: "F5", dur: "8n", vel: 0.60 },
  { time: S(11, 1, 0), note: "E5", dur: "8n", vel: 0.60 },
  { time: S(11, 1, 2), note: "D5", dur: "8n", vel: 0.58 },
  { time: S(11, 2, 0), note: "C5", dur: "8n", vel: 0.58 },
  { time: S(11, 2, 2), note: "D5", dur: "8n", vel: 0.58 },
  { time: S(11, 3, 0), note: "E5", dur: "8n", vel: 0.60 },
  { time: S(11, 3, 2), note: "F5", dur: "8n", vel: 0.62 },
];

// --- LEAD: B section (bars 12–19) — darker, ♭6 "teeth", inverted-head climax --
const LEAD_B: Note[] = [
  // bar 12 (Dm) — stark hammered outline 1̂ · 5̂ · ♭3̂ · 1̂
  { time: S(12, 0, 0), note: "D5", dur: "4n", vel: 0.70 },
  { time: S(12, 1, 0), note: "A4", dur: "4n", vel: 0.66 },
  { time: S(12, 2, 0), note: "F5", dur: "4n", vel: 0.68 },
  { time: S(12, 3, 0), note: "D5", dur: "4n", vel: 0.66 },
  // bar 13 (B♭) — descend from the ♭6: ♭6̂ 5̂ 4̂ ♭3̂ · ♭6̂ · 5̂ (the teeth)
  { time: S(13, 0, 0), note: "Bb4", dur: "8n", vel: 0.66 },
  { time: S(13, 0, 2), note: "A4", dur: "8n", vel: 0.62 },
  { time: S(13, 1, 0), note: "G4", dur: "8n", vel: 0.60 },
  { time: S(13, 1, 2), note: "F4", dur: "8n", vel: 0.58 },
  { time: S(13, 2, 0), note: "Bb4", dur: "4n", vel: 0.64 },
  { time: S(13, 3, 0), note: "A4", dur: "4n", vel: 0.62 },
  // bar 14 (C) — rising urgent: ♭7̂ 1̂ 2̂ 4̂ · ♭3̂ · 2̂
  { time: S(14, 0, 0), note: "C5", dur: "8n", vel: 0.62 },
  { time: S(14, 0, 2), note: "D5", dur: "8n", vel: 0.64 },
  { time: S(14, 1, 0), note: "E5", dur: "8n", vel: 0.66 },
  { time: S(14, 1, 2), note: "G5", dur: "8n", vel: 0.70 },
  { time: S(14, 2, 0), note: "F5", dur: "4n", vel: 0.66 },
  { time: S(14, 3, 0), note: "E5", dur: "4n", vel: 0.64 },
  // bar 15 (Dm) — settle onto a held tonic, ominous breath: ♭3̂ 2̂ · 1̂(held) · rest
  { time: S(15, 0, 0), note: "F5", dur: "8n", vel: 0.60 },
  { time: S(15, 0, 2), note: "E5", dur: "8n", vel: 0.58 },
  { time: S(15, 1, 0), note: "D5", dur: "2n", vel: 0.58 },
  // bar 16 (Dm) — INVERTED HEAD hammered x4: 5̂ 2̂ 1̂ ♭7̂ (A E D C), relentless
  ...acrossBars([16], (bar) =>
    [0, 1, 2, 3].flatMap((beat) => [
      { time: S(bar, beat, 0), note: "A4", dur: "16n", vel: 0.72 },
      { time: S(bar, beat, 1), note: "E5", dur: "16n", vel: 0.70 },
      { time: S(bar, beat, 2), note: "D5", dur: "16n", vel: 0.68 },
      { time: S(bar, beat, 3), note: "C5", dur: "16n", vel: 0.66 },
    ]),
  ),
  // bar 17 (B♭) — dark arpeggio churn: ♭6̂ ♭3̂ 1̂ ♭3̂ · ♭6̂ 5̂ · 5̂
  { time: S(17, 0, 0), note: "Bb4", dur: "8n", vel: 0.64 },
  { time: S(17, 0, 2), note: "F5", dur: "8n", vel: 0.66 },
  { time: S(17, 1, 0), note: "D5", dur: "8n", vel: 0.62 },
  { time: S(17, 1, 2), note: "F5", dur: "8n", vel: 0.64 },
  { time: S(17, 2, 0), note: "Bb4", dur: "8n", vel: 0.62 },
  { time: S(17, 2, 2), note: "A4", dur: "8n", vel: 0.60 },
  { time: S(17, 3, 0), note: "A4", dur: "4n", vel: 0.62 },
  // bar 18 (C) — build to climax: ♭7̂ 1̂ 2̂ 4̂ (x2 climbing) · 5̂(peak) · 4̂ ♭3̂
  { time: S(18, 0, 0), note: "C5", dur: "16n", vel: 0.66 },
  { time: S(18, 0, 1), note: "D5", dur: "16n", vel: 0.68 },
  { time: S(18, 0, 2), note: "E5", dur: "16n", vel: 0.70 },
  { time: S(18, 0, 3), note: "G5", dur: "16n", vel: 0.72 },
  { time: S(18, 1, 0), note: "C5", dur: "16n", vel: 0.68 },
  { time: S(18, 1, 1), note: "D5", dur: "16n", vel: 0.70 },
  { time: S(18, 1, 2), note: "E5", dur: "16n", vel: 0.72 },
  { time: S(18, 1, 3), note: "G5", dur: "16n", vel: 0.74 },
  { time: S(18, 2, 0), note: "A5", dur: "4n", vel: 0.78 },
  { time: S(18, 3, 0), note: "G5", dur: "8n", vel: 0.68 },
  { time: S(18, 3, 2), note: "F5", dur: "8n", vel: 0.66 },
  // bar 19 (A = V) — the dominant with a C♯ LEADING-TONE, pulling home to Dm
  { time: S(19, 0, 0), note: "A4", dur: "16n", vel: 0.70 },
  { time: S(19, 0, 1), note: "C#5", dur: "16n", vel: 0.72 }, // leading-tone
  { time: S(19, 0, 2), note: "E5", dur: "16n", vel: 0.72 },
  { time: S(19, 0, 3), note: "A5", dur: "16n", vel: 0.76 },
  { time: S(19, 1, 0), note: "E5", dur: "4n", vel: 0.66 },
  { time: S(19, 2, 0), note: "C#5", dur: "8n", vel: 0.64 },
  { time: S(19, 2, 2), note: "A4", dur: "8n", vel: 0.62 },
  { time: S(19, 3, 2), note: "A4", dur: "8n", vel: 0.58 }, // pickup into the turnaround
];

// --- LEAD: turnaround (bars 20–23) — big head restatement, then a fill to loop -
const LEAD_TURN: Note[] = [
  // bar 20 (Dm) — COMPRESSED HEAD, then a triumphant-tense leap to the A5 peak
  { time: S(20, 0, 0), note: "A4", dur: "16n", vel: 0.74 },
  { time: S(20, 0, 1), note: "D5", dur: "16n", vel: 0.76 },
  { time: S(20, 0, 2), note: "E5", dur: "16n", vel: 0.76 },
  { time: S(20, 0, 3), note: "F5", dur: "16n", vel: 0.78 },
  { time: S(20, 1, 0), note: "A5", dur: "4n", vel: 0.80 },
  { time: S(20, 2, 0), note: "G5", dur: "8n", vel: 0.68 },
  { time: S(20, 2, 2), note: "F5", dur: "8n", vel: 0.66 },
  { time: S(20, 3, 0), note: "E5", dur: "8n", vel: 0.64 },
  { time: S(20, 3, 2), note: "D5", dur: "8n", vel: 0.62 },
  // bar 21 (C) — falling answer, then pickup
  { time: S(21, 0, 0), note: "F5", dur: "16n", vel: 0.70 },
  { time: S(21, 0, 1), note: "E5", dur: "16n", vel: 0.68 },
  { time: S(21, 0, 2), note: "D5", dur: "16n", vel: 0.66 },
  { time: S(21, 0, 3), note: "C5", dur: "16n", vel: 0.64 },
  { time: S(21, 1, 0), note: "D5", dur: "4n", vel: 0.62 },
  { time: S(21, 3, 2), note: "A4", dur: "8n", vel: 0.58 },
  // bar 22 (Dm) — compressed head, then 2̂ · 1̂ · rest
  { time: S(22, 0, 0), note: "A4", dur: "16n", vel: 0.72 },
  { time: S(22, 0, 1), note: "D5", dur: "16n", vel: 0.74 },
  { time: S(22, 0, 2), note: "E5", dur: "16n", vel: 0.74 },
  { time: S(22, 0, 3), note: "F5", dur: "16n", vel: 0.76 },
  { time: S(22, 1, 0), note: "E5", dur: "4n", vel: 0.66 },
  { time: S(22, 2, 0), note: "D5", dur: "4n", vel: 0.64 },
  // bar 23 (A = V) — tumbling fill down, land on the dominant → drives to the loop
  { time: S(23, 0, 0), note: "F5", dur: "16n", vel: 0.68 },
  { time: S(23, 0, 1), note: "E5", dur: "16n", vel: 0.66 },
  { time: S(23, 0, 2), note: "D5", dur: "16n", vel: 0.66 },
  { time: S(23, 0, 3), note: "C5", dur: "16n", vel: 0.64 },
  { time: S(23, 1, 0), note: "B4", dur: "16n", vel: 0.64 }, // B♮
  { time: S(23, 1, 1), note: "A4", dur: "16n", vel: 0.62 },
  { time: S(23, 1, 2), note: "G4", dur: "16n", vel: 0.60 },
  { time: S(23, 1, 3), note: "F4", dur: "16n", vel: 0.58 },
  { time: S(23, 2, 0), note: "E4", dur: "8n", vel: 0.58 },
  { time: S(23, 2, 2), note: "A4", dur: "8n", vel: 0.60 },
  { time: S(23, 3, 0), note: "A4", dur: "4n", vel: 0.64 }, // dominant, drives to bar 4 (Dm)
];

// --- COUNTER: exposes the INVERTED HEAD (5̂ 2̂ 1̂ ♭7̂ = A E D C) --------------
// Intro bars 0–2 state it slowly and nakedly (kinship before the fight); bar 3
// turns it upward (5̂ ♭7̂ 1̂ 2̂) to hand off into the A-section head at bar 4.
const COUNTER: Note[] = [
  // bar 0 — inverted head, one note per beat
  { time: S(0, 0, 0), note: "A3", dur: "4n", vel: 0.50 },
  { time: S(0, 1, 0), note: "E4", dur: "4n", vel: 0.48 },
  { time: S(0, 2, 0), note: "D4", dur: "4n", vel: 0.46 },
  { time: S(0, 3, 0), note: "C4", dur: "4n", vel: 0.44 },
  // bar 1 — repeat
  { time: S(1, 0, 0), note: "A3", dur: "4n", vel: 0.50 },
  { time: S(1, 1, 0), note: "E4", dur: "4n", vel: 0.48 },
  { time: S(1, 2, 0), note: "D4", dur: "4n", vel: 0.46 },
  { time: S(1, 3, 0), note: "C4", dur: "4n", vel: 0.44 },
  // bar 2 — inverted head, ending up a step (♭3̂) to lift
  { time: S(2, 0, 0), note: "A3", dur: "4n", vel: 0.52 },
  { time: S(2, 1, 0), note: "E4", dur: "4n", vel: 0.50 },
  { time: S(2, 2, 0), note: "D4", dur: "4n", vel: 0.48 },
  { time: S(2, 3, 0), note: "F4", dur: "4n", vel: 0.50 },
  // bar 3 — turn it upward: 5̂ ♭7̂ 1̂ 2̂ (A C D E) into the head at bar 4
  { time: S(3, 0, 0), note: "A3", dur: "4n", vel: 0.54 },
  { time: S(3, 1, 0), note: "C4", dur: "4n", vel: 0.54 },
  { time: S(3, 2, 0), note: "D4", dur: "4n", vel: 0.56 },
  { time: S(3, 3, 0), note: "E4", dur: "4n", vel: 0.58 },
  // bar 16 — double the lead's inverted-head climax an octave down, for weight
  ...acrossBars([16], (bar) =>
    [0, 1, 2, 3].flatMap((beat) => [
      { time: S(bar, beat, 0), note: "A3", dur: "16n", vel: 0.50 },
      { time: S(bar, beat, 1), note: "E4", dur: "16n", vel: 0.48 },
      { time: S(bar, beat, 2), note: "D4", dur: "16n", vel: 0.46 },
      { time: S(bar, beat, 3), note: "C4", dur: "16n", vel: 0.44 },
    ]),
  ),
];

// --- BASS: relentless eighth-note drive (root ×6, push to the fifth ×2) ------
// Harmony: intro Dm pedal · A = i–♭VII alternating with an Am lift · B leans on
// the ♭VI (B♭, the teeth) and closes on the dominant. [root, fifth] per bar:
const BASS_CHORDS: Array<[string, string]> = [
  ["D2", "A2"], ["D2", "A2"], ["D2", "A2"], ["D2", "A2"], // 0–3 intro (Dm)
  ["D2", "A2"], ["C2", "G2"], ["D2", "A2"], ["C2", "G2"], // 4–7  Dm C Dm C
  ["D2", "A2"], ["C2", "G2"], ["A2", "E3"], ["C2", "G2"], // 8–11 Dm C Am C
  ["D2", "A2"], ["Bb2", "F3"], ["C2", "G2"], ["D2", "A2"], // 12–15 Dm B♭ C Dm
  ["D2", "A2"], ["Bb2", "F3"], ["C2", "G2"], ["A2", "E3"], // 16–19 Dm B♭ C A(V)
  ["D2", "A2"], ["C2", "G2"], ["D2", "A2"], ["A2", "E3"], // 20–23 Dm C Dm A(V)
];
const bassVel = (bar: number): number => (bar < 2 ? 0.40 : bar < 4 ? 0.46 : 0.50);
const BASS: Note[] = acrossBars(bars(0, 24), (bar) => {
  const [root, fifth] = BASS_CHORDS[bar];
  return bassBar(bar, root, fifth, bassVel(bar));
});

// --- PAD: low power-chord drone (root + fifth), whole-bar sustain, ambience ---
const PAD_CHORDS: Array<[string, string]> = BASS_CHORDS.map(([r]) => {
  const map: Record<string, [string, string]> = {
    D2: ["D3", "A3"], C2: ["C3", "G3"], A2: ["A2", "E3"], Bb2: ["Bb2", "F3"],
  };
  return map[r];
});
const PAD: Note[] = acrossBars(bars(0, 24), (bar) => {
  const [a, b] = PAD_CHORDS[bar];
  return [
    { time: S(bar, 0, 0), note: a, dur: "1n", vel: 0.12 },
    { time: S(bar, 0, 0), note: b, dur: "1n", vel: 0.10 },
  ];
});

// --- PERCUSSION (composed from synths, no samples) --------------------------
// Kick on 1 & 3 (plus a push on the "and" of 4 once the fight is on); snare on
// 2 & 4; hats on eighths. Intro ramps in: kick from bar 0, hats from bar 2,
// snare from bar 4 — so the drums build into the A section.
const KICK: Note[] = [
  ...acrossBars(bars(0, 24), (bar) => onBeats(bar, [0, 2], "8n", 0.72, "C1")),
  ...acrossBars(bars(4, 24), (bar) => [{ time: S(bar, 3, 2), note: "C1", dur: "8n", vel: 0.55 }]),
];
const SNARE: Note[] = [
  ...acrossBars(bars(4, 24), (bar) => onBeats(bar, [1, 3], "16n", 0.60)),
  // pickup fill into A (bar 3) and a busier fill on the turnaround (bar 23)
  { time: S(3, 3, 0), dur: "16n", vel: 0.50 },
  { time: S(3, 3, 2), dur: "16n", vel: 0.56 },
  { time: S(23, 2, 2), dur: "16n", vel: 0.52 },
  { time: S(23, 3, 2), dur: "16n", vel: 0.60 },
];
const HAT: Note[] = acrossBars(bars(2, 24), (bar) => eighthHats(bar, "16n", 0.20));

export const battle: Motif = {
  id: "battle",
  title: "The Vaults",
  key: "D dorian (aeolian ♭6 borrowed in the bridge)",
  meter: [4, 4],
  bpm: 132,
  lengthBars: 24,
  loopStartBar: 4, // intro plays once; combat loops bars 4→24
  reverbWet: 0.15,
  tracks: [
    {
      name: "lead", // driving saw lead — the transformed head
      synth: {
        kind: "Synth",
        options: {
          oscillator: { type: "sawtooth" },
          envelope: { attack: 0.005, decay: 0.12, sustain: 0.3, release: 0.12 },
        },
      },
      gainDb: -5,
      notes: [...LEAD_A, ...LEAD_B, ...LEAD_TURN],
    },
    {
      name: "counter", // exposes the inverted head (intro + bar-16 climax)
      synth: {
        kind: "Synth",
        options: {
          oscillator: { type: "square" },
          envelope: { attack: 0.01, decay: 0.15, sustain: 0.25, release: 0.15 },
        },
      },
      gainDb: -12,
      notes: COUNTER,
    },
    {
      name: "bass", // relentless saw drive
      synth: {
        kind: "Synth",
        options: {
          oscillator: { type: "sawtooth" },
          envelope: { attack: 0.005, decay: 0.14, sustain: 0.4, release: 0.1 },
        },
      },
      gainDb: -7,
      notes: BASS,
    },
    {
      name: "pad", // low power-chord ambience
      synth: {
        kind: "Synth",
        poly: true,
        options: {
          oscillator: { type: "sawtooth" },
          envelope: { attack: 0.6, decay: 0.4, sustain: 0.6, release: 0.8 },
        },
      },
      gainDb: -22,
      notes: PAD,
    },
    {
      name: "kick",
      synth: {
        kind: "MembraneSynth",
        options: {
          pitchDecay: 0.05,
          octaves: 6,
          oscillator: { type: "sine" },
          envelope: { attack: 0.001, decay: 0.38, sustain: 0, release: 0.4 },
        },
      },
      gainDb: -6,
      notes: KICK,
    },
    {
      name: "snare",
      synth: {
        kind: "NoiseSynth",
        options: {
          noise: { type: "white" },
          envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.05 },
        },
      },
      gainDb: -13,
      notes: SNARE,
    },
    {
      name: "hat",
      synth: {
        kind: "NoiseSynth",
        options: {
          noise: { type: "white" },
          envelope: { attack: 0.001, decay: 0.03, sustain: 0, release: 0.02 },
        },
      },
      gainDb: -20,
      notes: HAT,
    },
  ],
};
