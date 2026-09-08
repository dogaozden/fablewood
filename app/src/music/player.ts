// ============================================================================
// FABLEWOOD music player — schedules Motif data onto Tone.Transport.
// ============================================================================
// The ONLY file here that imports Tone. Generic: it plays any Motif you register
// (see types.ts / index.ts), so the app can adopt it as-is. Signal chain:
//
//     each track's synth → per-track Gain(dB) → master Gain → Reverb → speakers
//
// Browsers block audio until a user gesture, so call resumeAudioContext() (or the
// instance method) from a click/keypress before play(). Switching motifs disposes
// every synth/part first, so nothing leaks.

import * as Tone from "tone";
import type { Motif, Note, SynthSpec } from "./types";

/**
 * Shorten each note's scheduled release by this many seconds so a release never
 * coincides with the next attack — most importantly at the loop seam, where the
 * last note's end meets the loop-restart note's attack. Coincident release/attack
 * on a monophonic Tone voice throws "Start time must be strictly greater than
 * previous start time" (async, on the Transport tick). ~20ms is inaudible.
 */
const RELEASE_GAP_S = 0.02;

/** Structural type satisfied by every Tone instrument we build. */
interface Voice {
  // Tone's per-synth trigger signatures differ (noise omits the note); widen here.
  triggerAttackRelease: (...args: unknown[]) => unknown;
  connect: (node: Tone.InputNode) => unknown;
  dispose: () => void;
}

/** Resume the AudioContext. MUST be called from a user gesture before play(). */
export async function resumeAudioContext(): Promise<void> {
  await Tone.start();
}

function makeVoice(spec: SynthSpec, Cls: unknown): Voice {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any — Tone's option
  // and constructor types are per-synth; the data-level types.ts is what matters.
  const C = Cls as any;
  if (spec.poly) {
    const poly = new Tone.PolySynth(C);
    if (spec.options) poly.set(spec.options as any);
    return poly as unknown as Voice;
  }
  return new C(spec.options as any) as Voice;
}

function buildInstrument(spec: SynthSpec): Voice {
  switch (spec.kind) {
    case "Synth":
      return makeVoice(spec, Tone.Synth);
    case "FMSynth":
      return makeVoice(spec, Tone.FMSynth);
    case "AMSynth":
      return makeVoice(spec, Tone.AMSynth);
    case "PluckSynth":
      return new Tone.PluckSynth(spec.options as any) as unknown as Voice;
    case "MembraneSynth":
      return new Tone.MembraneSynth(spec.options as any) as unknown as Voice;
    case "MetalSynth":
      return new Tone.MetalSynth(spec.options as any) as unknown as Voice;
    case "NoiseSynth":
      return new Tone.NoiseSynth(spec.options as any) as unknown as Voice;
  }
}

export class MusicPlayer {
  private registry = new Map<string, Motif>();
  private currentId: string | null = null;

  // Live audio nodes for the playing motif — disposed on stop/switch.
  private voices: Voice[] = [];
  private gains: Tone.Gain<"decibels">[] = [];
  private parts: Tone.Part[] = [];

  // Master bus, built once and kept for the player's lifetime.
  private master: Tone.Gain;
  private reverb: Tone.Reverb;

  constructor(motifs: Motif[] = []) {
    for (const m of motifs) this.registry.set(m.id, m);
    this.master = new Tone.Gain(1);
    this.reverb = new Tone.Reverb({ decay: 2.6, wet: 0 });
    this.master.connect(this.reverb);
    this.reverb.toDestination();
  }

  /** Resume audio (delegates to the module helper). Call from a user gesture. */
  async resume(): Promise<void> {
    await resumeAudioContext();
  }

  /** Registered motif ids, for building UIs. */
  ids(): string[] {
    return [...this.registry.keys()];
  }

  /** The id of the motif currently playing, or null. */
  current(): string | null {
    return this.currentId;
  }

  /** Current Transport position in seconds (dev/verification aid). */
  transportSeconds(): number {
    return Tone.getTransport().seconds;
  }

  /** Play a registered motif by id. No-op if it's already the one playing. */
  play(id: string): void {
    const motif = this.registry.get(id);
    if (!motif) throw new Error(`MusicPlayer: unknown motif "${id}"`);
    // Looping motifs no-op when already current; a one-shot (loop: false) always
    // restarts — replaying a sting is a fresh event, not a continuation.
    if (this.currentId === id && motif.loop !== false) return;
    this.loadMotif(motif);
    Tone.getTransport().start();
    this.currentId = id;
  }

  /**
   * Build the audio graph and schedule a motif (does NOT start the Transport —
   * play() does). Public so the app can play motifs outside the registry.
   */
  loadMotif(motif: Motif): void {
    this.teardown();

    const transport = Tone.getTransport();
    // Clean slate before (re)scheduling. On a motif SWITCH the Transport is still
    // running from the previous motif; stop + clear its event/state timeline so we
    // never call start() on an already-running Transport or leave stale events.
    transport.stop();
    transport.cancel(0);
    transport.bpm.value = motif.bpm;
    transport.timeSignature = motif.meter;
    // One-shot stings (loop: false) run past their length and ring out; the next
    // play() switches away through this same reset path.
    const looping = motif.loop !== false;
    transport.loop = looping;
    if (looping) {
      transport.loopStart = `${motif.loopStartBar}:0:0`;
      transport.loopEnd = `${motif.lengthBars}:0:0`;
    }
    transport.position = 0;
    this.reverb.wet.value = motif.reverbWet;

    for (const track of motif.tracks) {
      const voice = buildInstrument(track.synth);
      const gain = new Tone.Gain(track.gainDb, "decibels");
      voice.connect(gain);
      gain.connect(this.master);
      let lastAttackTime = Number.NEGATIVE_INFINITY;

      const part = new Tone.Part((time, ev) => {
        const n = ev as Note;
        // Transport callbacks can arrive after their scheduled audio time when the browser's
        // main thread is busy. Tone clamps every such Source.start() to currentTime; two late
        // callbacks for one monophonic voice can therefore collapse onto the same instant and
        // trip Tone's strict start-order assertion. Keep on-time/future events untouched, but
        // move a stale or equal attack onto the audio clock at least one sample after its
        // predecessor. One sample is the smallest meaningful Web Audio spacing.
        const attackTime = Math.max(
          time,
          Tone.now(),
          lastAttackTime + 1 / Tone.getContext().sampleRate,
        );
        lastAttackTime = attackTime;
        // Trim the release so it never coincides with the next attack (see
        // RELEASE_GAP_S) — this is what keeps the loop seam from crashing Tone.
        const durSecs = Tone.Time(n.dur).toSeconds();
        const safeDur = Math.max(durSecs - RELEASE_GAP_S, durSecs * 0.5);
        if (n.note !== undefined) {
          voice.triggerAttackRelease(n.note, safeDur, attackTime, n.vel);
        } else {
          // Unpitched (NoiseSynth): triggerAttackRelease(duration, time, velocity)
          voice.triggerAttackRelease(safeDur, attackTime, n.vel);
        }
      }, track.notes.map((n) => ({ ...n })));
      part.start(0);

      this.voices.push(voice);
      this.gains.push(gain);
      this.parts.push(part);
    }
  }

  /** Stop playback and free every synth/part for the current motif. */
  stop(): void {
    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);
    transport.position = 0;
    transport.loop = false;
    this.teardown();
    this.currentId = null;
  }

  /** Mute/unmute the master output. */
  setMuted(muted: boolean): void {
    Tone.getDestination().mute = muted;
  }

  isMuted(): boolean {
    return Tone.getDestination().mute;
  }

  /** Master output volume, 0 (silent) - 100 (full). Independent of mute — this scales
   *  the linear master Gain node; muting is still the separate Destination.mute flag. */
  setVolume(percent: number): void {
    const clamped = Math.min(100, Math.max(0, percent));
    this.master.gain.value = clamped / 100;
  }

  getVolume(): number {
    return Math.round(this.master.gain.value * 100);
  }

  /** Tap the master bus (pre-reverb) for a meter/analyser in dev UIs. */
  connectAnalyser(node: Tone.InputNode): void {
    this.master.connect(node);
  }

  private teardown(): void {
    for (const p of this.parts) {
      // stop(0), not stop(): with the Transport parked at position 0 (e.g. the
      // pre-gesture resume path: scene played a motif on a suspended context,
      // resumeMusicOnce stops it before restarting), Tone computes "now" as a
      // negative floating-point epsilon and Part.stop() throws a RangeError.
      // An explicit 0 is always in range; the part is disposed right after.
      p.stop(0);
      p.dispose();
    }
    for (const v of this.voices) v.dispose();
    for (const g of this.gains) g.dispose();
    this.parts = [];
    this.voices = [];
    this.gains = [];
  }
}
