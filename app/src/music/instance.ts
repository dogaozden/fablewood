/**
 * Shared music singleton for scenes + shell. Scenes: music.play('hamlet'|'battle') /
 * music.stop(). The shell wires the first-gesture resume + mute persistence.
 */
import { createPlayer } from './index';

export const music = createPlayer();

let resumed = false;

/** Idempotent: resume the audio context on the first real user gesture. */
export async function resumeMusicOnce(): Promise<void> {
  if (resumed) return;
  resumed = true;
  try {
    await music.resume();
  } catch {
    resumed = false; // context still locked — allow a later gesture to retry
  }
}
