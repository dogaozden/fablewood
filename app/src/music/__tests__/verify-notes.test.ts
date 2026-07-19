// Structural verification of the leitmotif note DATA — the vitest port of
// staging/music/verify-notes.ts, so the checker runs against the app's live
// copies on every test run. It validates: real pitches in a sane register,
// times on the meter grid, no event overruns the loop, velocities in (0,1],
// known durations, and — the class that crashed Tone in real battles — no
// double-booked or overlapping notes on a MONOPHONIC voice. Poly tracks may
// share start times (chords); mono tracks may not.
//
// Loop-seam discipline: a mono note ending exactly on the loop boundary meets
// the loop-restart attack next cycle. The player's RELEASE_GAP_S makes that
// safe, but NEW tracks are held to a stricter bar: composed with air before
// the wrap, no boundary-enders at all (asserted below for vaults/warden).

import { describe, expect, it } from "vitest";
import type { Motif } from "../types";
import { MOTIFS, vaults, warden } from "../index";

const DUR_SX: Record<string, number> = {
  "16n": 1, "8n": 2, "8n.": 3, "4n": 4, "4n.": 6, "2n": 8, "2n.": 12, "1n": 16,
};
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function toMidi(note: string): number | null {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(note);
  if (!m) return null;
  let n = PC[m[1]];
  if (m[2] === "#") n += 1;
  if (m[2] === "b") n -= 1;
  return 12 * (parseInt(m[3], 10) + 1) + n;
}

interface CheckResult {
  issues: string[];
  /** Mono notes whose release lands exactly on the loop boundary (mitigated
   *  by the player release-gap, but flagged so the dependency stays visible). */
  seamFlags: string[];
}

function check(motif: Motif): CheckResult {
  const issues: string[] = [];
  const seamFlags: string[] = [];
  const fail = (t: string, msg: string) => issues.push(`[${motif.id}/${t}] ${msg}`);

  const beatsPerBar = (motif.meter[0] / motif.meter[1]) * 4;
  if (!Number.isInteger(beatsPerBar)) fail("-", `meter → ${beatsPerBar} beats/bar (not integer)`);
  if (motif.loopStartBar < 0 || motif.loopStartBar >= motif.lengthBars) {
    fail("-", `loopStartBar ${motif.loopStartBar} outside [0, ${motif.lengthBars})`);
  }
  if (!(motif.reverbWet >= 0 && motif.reverbWet <= 1)) fail("-", `reverbWet ${motif.reverbWet} out of [0,1]`);

  const loopEndSx = motif.lengthBars * beatsPerBar * 4;
  const loopStartSx = motif.loopStartBar * beatsPerBar * 4;

  for (const track of motif.tracks) {
    const noise = track.synth.kind === "NoiseSynth";
    const poly = track.synth.poly === true;
    if (track.notes.length === 0) fail(track.name, "track has no notes");

    const evs: Array<{ start: number; end: number; time: string; label: string }> = [];

    for (const n of track.notes) {
      if (!(n.vel > 0 && n.vel <= 1)) fail(track.name, `vel ${n.vel} out of (0,1] @ ${n.time}`);

      const dsx = DUR_SX[n.dur];
      if (dsx === undefined) {
        fail(track.name, `unknown dur "${n.dur}" @ ${n.time}`);
        continue;
      }
      const tm = /^(\d+):(\d+):(\d+)$/.exec(n.time);
      if (!tm) {
        fail(track.name, `unparseable time "${n.time}"`);
        continue;
      }
      const bar = Number(tm[1]);
      const beat = Number(tm[2]);
      const sx = Number(tm[3]);
      if (beat >= beatsPerBar) fail(track.name, `beat ${beat} ≥ ${beatsPerBar}/bar @ ${n.time}`);
      if (sx > 3) fail(track.name, `sixteenth ${sx} > 3 @ ${n.time}`);
      if (bar >= motif.lengthBars) fail(track.name, `bar ${bar} ≥ length ${motif.lengthBars} @ ${n.time}`);
      const startSx = bar * beatsPerBar * 4 + beat * 4 + sx;
      if (startSx + dsx > loopEndSx) fail(track.name, `event +${n.dur} overruns loop end @ ${n.time}`);

      if (noise) {
        if (n.note !== undefined) fail(track.name, `noise voice should have no pitch, got ${n.note} @ ${n.time}`);
      } else {
        if (n.note === undefined) {
          fail(track.name, `missing pitch @ ${n.time}`);
          continue;
        }
        const mid = toMidi(n.note);
        if (mid === null) {
          fail(track.name, `invalid pitch "${n.note}" @ ${n.time}`);
          continue;
        }
        if (mid < 20 || mid > 96) fail(track.name, `pitch ${n.note} (midi ${mid}) outside sane [20,96] @ ${n.time}`);
      }

      evs.push({ start: startSx, end: startSx + dsx, time: n.time, label: n.note ?? "noise" });
    }

    // Mono-voice collision rules (Tone throws "Start time must be strictly
    // greater than previous start time" on violation, async on a Transport tick).
    evs.sort((a, b) => a.start - b.start || a.end - b.end);
    if (!poly) {
      for (let i = 0; i < evs.length - 1; i++) {
        const a = evs[i];
        const b = evs[i + 1];
        if (a.start === b.start) {
          fail(track.name, `duplicate start (double-booked mono voice) @ ${a.time}: ${a.label} & ${b.label}`);
        } else if (a.end > b.start) {
          fail(track.name, `mono overlap: ${a.time}(${a.label}) ends ${a.end} > next start ${b.start} (${b.time})`);
        }
      }
      // Loop-seam class — only meaningful when the motif actually loops.
      if (motif.loop !== false) {
        const endsAtBoundary = evs.filter((e) => e.end === loopEndSx);
        const startsAtLoop = evs.some((e) => e.start === loopStartSx);
        if (endsAtBoundary.length && startsAtLoop) {
          for (const e of endsAtBoundary) {
            seamFlags.push(`[${motif.id}/${track.name}] ${e.time} (${e.label})`);
          }
        }
      }
    }
  }
  return { issues, seamFlags };
}

describe("leitmotif note data", () => {
  it("registers unique motif ids", () => {
    expect(new Set(MOTIFS.map((m) => m.id)).size).toBe(MOTIFS.length);
  });

  it.each(MOTIFS.map((m) => [m.id, m] as const))(
    "%s: pitches, grid, loop math, velocities, mono-voice collisions",
    (_id, motif) => {
      expect(check(motif).issues).toEqual([]);
    },
  );

  it("new tracks (vaults, warden) have NO mono notes ending on the loop boundary", () => {
    // Stricter than the mitigated hamlet/battle seam flags: the new tracks are
    // composed with air before the wrap, so nothing leans on the release-gap.
    expect(check(vaults).seamFlags).toEqual([]);
    expect(check(warden).seamFlags).toEqual([]);
  });

  it("warden is a one-shot sting in budget (≤ 12s)", () => {
    expect(warden.loop).toBe(false);
    const beatsPerBar = (warden.meter[0] / warden.meter[1]) * 4;
    const secs = warden.lengthBars * beatsPerBar * (60 / warden.bpm);
    expect(secs).toBeLessThanOrEqual(12);
  });

  it("vaults loops whole and sits under the hamlet lead's register", () => {
    expect(vaults.loop).not.toBe(false);
    expect(vaults.loopStartBar).toBe(0);
    const highest = Math.max(
      ...vaults.tracks.flatMap((t) => t.notes.map((n) => (n.note ? toMidi(n.note)! : -Infinity))),
    );
    expect(highest).toBeLessThanOrEqual(toMidi("F4")!); // hamlet lead floor is D4
  });

  // Negative cases: the checker itself must catch the crash class it guards.
  it("catches a double-booked mono start", () => {
    const bad: Motif = {
      ...vaults,
      tracks: [{
        name: "m", synth: { kind: "Synth" }, gainDb: 0,
        notes: [
          { time: "0:0:0", note: "C3", dur: "4n", vel: 0.5 },
          { time: "0:0:0", note: "E3", dur: "4n", vel: 0.5 },
        ],
      }],
    };
    expect(check(bad).issues.join("\n")).toMatch(/duplicate start/);
  });

  it("catches a mono overlap", () => {
    const bad: Motif = {
      ...vaults,
      tracks: [{
        name: "m", synth: { kind: "Synth" }, gainDb: 0,
        notes: [
          { time: "0:0:0", note: "C3", dur: "2n", vel: 0.5 },
          { time: "0:1:0", note: "E3", dur: "4n", vel: 0.5 },
        ],
      }],
    };
    expect(check(bad).issues.join("\n")).toMatch(/mono overlap/);
  });

  it("catches an event overrunning the loop end", () => {
    const bad: Motif = {
      ...vaults,
      lengthBars: 1,
      tracks: [{
        name: "m", synth: { kind: "Synth" }, gainDb: 0,
        notes: [{ time: "0:3:0", note: "C3", dur: "2n", vel: 0.5 }],
      }],
    };
    expect(check(bad).issues.join("\n")).toMatch(/overruns loop end/);
  });

  it("flags the mono loop-seam boundary class (mitigated, but visible)", () => {
    const seamy: Motif = {
      ...vaults,
      lengthBars: 1,
      tracks: [{
        name: "m", synth: { kind: "Synth" }, gainDb: 0,
        notes: [
          { time: "0:0:0", note: "C3", dur: "4n", vel: 0.5 },
          { time: "0:3:0", note: "E3", dur: "4n", vel: 0.5 }, // ends exactly at bar 1
        ],
      }],
    };
    expect(check(seamy).seamFlags.length).toBe(1);
  });
});
