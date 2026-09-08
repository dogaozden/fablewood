import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Motif } from '../types';

const fake = vi.hoisted(() => ({
  now: 10,
  sampleTime: 0.001,
  parts: [] as Array<(time: number, event: unknown) => void>,
  voices: [] as Array<{ kind: string; triggerAttackRelease: ReturnType<typeof vi.fn> }>,
}));

vi.mock('tone', () => {
  class FakeVoice {
    triggerAttackRelease = vi.fn();
    connect(): void {}
    dispose(): void {}

    constructor(kind: string) {
      fake.voices.push({ kind, triggerAttackRelease: this.triggerAttackRelease });
    }
  }

  class FakeGain {
    gain = { value: 1 };
    constructor(_value?: number, _units?: string) {}
    connect(): void {}
    dispose(): void {}
  }

  class FakeReverb extends FakeGain {
    wet = { value: 0 };
    toDestination(): void {}
  }

  class FakePart {
    constructor(callback: (time: number, event: unknown) => void, _events: unknown[]) {
      fake.parts.push(callback);
    }
    start(): void {}
    stop(): void {}
    dispose(): void {}
  }

  const transport = {
    stop: vi.fn(),
    cancel: vi.fn(),
    start: vi.fn(),
    bpm: { value: 0 },
    timeSignature: [4, 4],
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    position: 0,
    seconds: 0,
  };
  const destination = { mute: false };

  return {
    Synth: class extends FakeVoice { constructor() { super('Synth'); } },
    FMSynth: class extends FakeVoice { constructor() { super('FMSynth'); } },
    AMSynth: class extends FakeVoice { constructor() { super('AMSynth'); } },
    PluckSynth: class extends FakeVoice { constructor() { super('PluckSynth'); } },
    MembraneSynth: class extends FakeVoice { constructor() { super('MembraneSynth'); } },
    MetalSynth: class extends FakeVoice { constructor() { super('MetalSynth'); } },
    NoiseSynth: class extends FakeVoice { constructor() { super('NoiseSynth'); } },
    PolySynth: class extends FakeVoice {
      constructor(_cls: unknown) { super('PolySynth'); }
      set(): void {}
    },
    Gain: FakeGain,
    Reverb: FakeReverb,
    Part: FakePart,
    Time: () => ({ toSeconds: () => 0.5 }),
    now: () => fake.now,
    getContext: () => ({ sampleRate: 1 / fake.sampleTime }),
    getTransport: () => transport,
    getDestination: () => destination,
    start: vi.fn(async () => {}),
  };
});

import { MusicPlayer } from '../player';

const motif: Motif = {
  id: 'timing-test',
  title: 'Timing test',
  key: 'C',
  meter: [4, 4],
  bpm: 120,
  lengthBars: 1,
  loopStartBar: 0,
  reverbWet: 0,
  tracks: [
    {
      name: 'pitched',
      synth: { kind: 'Synth' },
      gainDb: 0,
      notes: [{ time: '0:0:0', note: 'C4', dur: '4n', vel: 0.7 }],
    },
    {
      name: 'unpitched',
      synth: { kind: 'NoiseSynth' },
      gainDb: 0,
      notes: [{ time: '0:0:0', dur: '4n', vel: 0.3 }],
    },
  ],
};

beforeEach(() => {
  fake.now = 10;
  fake.sampleTime = 0.001;
  fake.parts.length = 0;
  fake.voices.length = 0;
});

describe('MusicPlayer transport callback timing', () => {
  it('sample-spaces stale/equal pitched attacks while retaining a future attack', () => {
    const player = new MusicPlayer();
    player.loadMotif(motif);
    const pitchedPart = fake.parts[0];
    const pitchedVoice = fake.voices[0].triggerAttackRelease;

    pitchedPart(9, motif.tracks[0].notes[0]);
    pitchedPart(9, motif.tracks[0].notes[0]);
    pitchedPart(12, motif.tracks[0].notes[0]);

    expect(pitchedVoice.mock.calls.map((call) => call[2])).toEqual([10, 10.001, 12]);
    expect(pitchedVoice.mock.calls[0]).toEqual(['C4', 0.48, 10, 0.7]);
  });

  it('uses the unpitched signature with the same monotonic audio-clock spacing', () => {
    const player = new MusicPlayer();
    player.loadMotif(motif);
    const unpitchedPart = fake.parts[1];
    const unpitchedVoice = fake.voices[1].triggerAttackRelease;

    unpitchedPart(10, motif.tracks[1].notes[0]);
    unpitchedPart(10, motif.tracks[1].notes[0]);
    unpitchedPart(13, motif.tracks[1].notes[0]);

    expect(unpitchedVoice.mock.calls.map((call) => call[1])).toEqual([10, 10.001, 13]);
    expect(unpitchedVoice.mock.calls[0]).toEqual([0.48, 10, 0.3]);
  });
});
