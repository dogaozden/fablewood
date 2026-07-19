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

  /** Play a registered motif by id. No-op if it's already the one playing. */
  play(id: string): void {
    if (this.currentId === id) return;
    const motif = this.registry.get(id);
    if (!motif) throw new Error(`MusicPlayer: unknown motif "${id}"`);
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
    transport.bpm.value = motif.bpm;
    transport.timeSignature = motif.meter;
    transport.loop = true;
    transport.loopStart = `${motif.loopStartBar}:0:0`;
    transport.loopEnd = `${motif.lengthBars}:0:0`;
    transport.position = 0;
    this.reverb.wet.value = motif.reverbWet;

    for (const track of motif.tracks) {
      const voice = buildInstrument(track.synth);
      const gain = new Tone.Gain(track.gainDb, "decibels");
      voice.connect(gain);
      gain.connect(this.master);

      const part = new Tone.Part((time, ev) => {
        const n = ev as Note;
        if (n.note !== undefined) {
          voice.triggerAttackRelease(n.note, n.dur, time, n.vel);
        } else {
          // Unpitched (NoiseSynth): triggerAttackRelease(duration, time, velocity)
          voice.triggerAttackRelease(n.dur, time, n.vel);
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

  /** Tap the master bus (pre-reverb) for a meter/analyser in dev UIs. */
  connectAnalyser(node: Tone.InputNode): void {
    this.master.connect(node);
  }

  private teardown(): void {
    for (const p of this.parts) {
      p.stop();
      p.dispose();
    }
    for (const v of this.voices) v.dispose();
    for (const g of this.gains) g.dispose();
    this.parts = [];
    this.voices = [];
    this.gains = [];
  }
}
