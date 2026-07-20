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

/**
 * Resume the audio context on a real user gesture. Re-checks the ACTUAL AudioContext
 * state on every call (instead of a one-shot flag) so it recovers from EVERY
 * suspension, not just the first — e.g. the tab is backgrounded a second time, or the
 * OS changes audio routes mid-session. No-ops once already running (so a gesture
 * during normal play never restarts the current motif), and never attempts a resume
 * before the first real gesture: both call sites (BootScene's title-screen `enter()`,
 * App.tsx's persistent window pointerdown/keydown listeners) only invoke this from an
 * actual gesture handler, and the context starts 'suspended' until one arrives.
 */
export async function resumeMusicOnce(): Promise<void> {
  if (Tone.getContext().state === 'running') return;
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
