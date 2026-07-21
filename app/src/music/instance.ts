/**
 * Shared music singleton for scenes + shell. Scenes: music.play('hamlet'|'battle'|
 * 'vaults') / music.stop(); 'warden' is the one-shot boss sting. The shell wires
 * the first-gesture resume + mute persistence.
 */
import * as Tone from 'tone';
import { createPlayer } from './index';

export const music = createPlayer();

// Dev-only handle so E2E/debug tooling can observe playback (Transport seconds,
// current motif). Stripped from production builds by the `import.meta.env.DEV` guard.
if (import.meta.env.DEV) {
  (globalThis as unknown as { __fwMusic?: typeof music }).__fwMusic = music;
}

// Single-flight guard for the resume+rebuild below (crucible v1 finding V1-4). The
// `state==='running'` check in resumeMusicOnce is synchronous, but everything after it
// isn't — so two overlapping (unawaited) calls arriving while a resume is already
// underway (e.g. ~30 mashed key/pointer events while the context is mid-resume from a
// backgrounding) would otherwise BOTH pass that check and each run their own
// stop()+play() rebuild. Two Transport restarts landing at the same clock instant trip
// Tone's own ordering assertion ("Start time must be strictly greater than previous
// start time"). Memoizing the in-flight promise means every overlapping caller just
// awaits the SAME resume+rebuild instead of starting a second one. It's cleared once
// settled (below) so a LATER, non-overlapping call — e.g. after a genuinely new
// suspension — still resumes again: this preserves the resume-on-every-suspension fix
// from crucible #8 (see instance.test.ts) rather than reintroducing that bug's one-shot
// flag.
let inFlightResume: Promise<void> | null = null;

async function resumeAndRestart(): Promise<void> {
  try {
    await music.resume();
    // A play() issued before the gesture ran against a suspended context — restart
    // the current motif so it audibly begins now (scenes call play() in create()).
    const cur = music.current();
    if (cur) {
      music.stop();
      music.play(cur);
    }
  } catch {
    /* context still locked — a later gesture will retry (state stays non-running) */
  }
}

/**
 * Resume the audio context on a real user gesture. Re-checks the ACTUAL AudioContext
 * state on every call (instead of a one-shot flag) so it recovers from EVERY
 * suspension, not just the first — e.g. the tab is backgrounded a second time, or the
 * OS changes audio routes mid-session. No-ops once already running (so a gesture
 * during normal play never restarts the current motif), and never attempts a resume
 * before the first real gesture: both call sites (BootScene's title-screen `enter()`,
 * App.tsx's persistent window pointerdown/keydown listeners) only invoke this from an
 * actual gesture handler, and the context starts 'suspended' until one arrives.
 *
 * Rapid/overlapping calls (see `inFlightResume` above) never start a second concurrent
 * resume+rebuild, and `resumeAndRestart` never throws — so this never rejects,
 * regardless of input speed.
 */
export async function resumeMusicOnce(): Promise<void> {
  if (Tone.getContext().state === 'running') return;
  if (!inFlightResume) {
    inFlightResume = resumeAndRestart().finally(() => {
      inFlightResume = null;
    });
  }
  await inFlightResume;
}
