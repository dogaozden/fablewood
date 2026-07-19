// Public surface for the app. Import the player + motif data from here.
//
//   import { createPlayer } from "./music";          // preloaded player
//   const music = createPlayer();
//   await music.resume();     // from a user gesture (click / keypress)
//   music.play("hamlet");     // or "battle" / "vaults" / "warden" (sting)
//   music.setMuted(true);

export * from "./types";
export { hamlet } from "./hamlet";
export { battle } from "./battle";
export { vaults } from "./vaults";
export { warden } from "./warden";
export { MusicPlayer, resumeAudioContext } from "./player";

import { hamlet } from "./hamlet";
import { battle } from "./battle";
import { vaults } from "./vaults";
import { warden } from "./warden";
import { MusicPlayer } from "./player";

/** The three leitmotifs + the one-shot Vault-Warden sting. */
export const MOTIFS = [hamlet, battle, vaults, warden];

/** A player preloaded with every motif. */
export function createPlayer(): MusicPlayer {
  return new MusicPlayer(MOTIFS);
}
