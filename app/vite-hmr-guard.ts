/**
 * Game-module HMR guard — Fablewood live-playtest hardening (never-edit-live-watched-tree).
 *
 * Phaser holds long-lived references to the scene/logic modules it instantiated at boot.
 * Letting Vite HOT-SWAP one of those under a running session patches the game into a corrupt
 * in-between state — a live save's scene pointer got flipped exactly this way during a
 * playtest. So any change under app/src/game/ forces a FULL PAGE RELOAD instead: the app
 * reboots the whole scene graph cleanly from state/ on disk. React UI + styles keep their
 * normal fast-refresh HMR (remounting the canvas wrapper is itself a clean reboot).
 */
import type { Plugin } from 'vite';

const GAME_TREE = /\/app\/src\/game\//;

export function fablewoodGameHmrGuard(): Plugin {
  return {
    name: 'fablewood-game-hmr-guard',
    apply: 'serve',
    handleHotUpdate({ file, server }) {
      if (!GAME_TREE.test(file)) return; // non-game files keep normal HMR
      server.ws.send({ type: 'full-reload' });
      return []; // swallow the hot-patch; the full reload above reboots the scene graph
    },
  };
}
