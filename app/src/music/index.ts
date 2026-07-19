// Public surface for the app. Import the player + motif data from here.
//
//   import { createPlayer } from "./music";          // preloaded player
//   const music = createPlayer();
//   await music.resume();     // from a user gesture (click / keypress)
//   music.play("hamlet");     // or "battle"
//   music.setMuted(true);

export * from "./types";
export { hamlet } from "./hamlet";
export { battle } from "./battle";
export { MusicPlayer, resumeAudioContext } from "./player";

import { hamlet } from "./hamlet";
import { battle } from "./battle";
import { MusicPlayer } from "./player";

/** The two v1 leitmotifs. */
export const MOTIFS = [hamlet, battle];

/** A player preloaded with both motifs. */
export function createPlayer(): MusicPlayer {
  return new MusicPlayer(MOTIFS);
}
