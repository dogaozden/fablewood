/**
 * Shared music singleton for scenes + shell. Scenes: music.play('hamlet'|'battle') /
 * music.stop(). The shell wires the first-gesture resume + mute persistence.
 */
import { createPlayer } from './index';

export const music = createPlayer();

// Dev-only handle so E2E/debug tooling can observe playback (Transport seconds,
// current motif). Stripped from production builds by the `import.meta.env.DEV` guard.
if (import.meta.env.DEV) {
  (globalThis as unknown as { __fwMusic?: typeof music }).__fwMusic = music;
}

let resumed = false;

/** Idempotent: resume the audio context on the first real user gesture. */
export async function resumeMusicOnce(): Promise<void> {
  if (resumed) return;
  resumed = true;
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
    resumed = false; // context still locked — allow a later gesture to retry
  }
}
