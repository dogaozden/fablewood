import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fablewoodBridge } from './app/src/bridge/plugin';
import { fablewoodJudge } from './app/vite-judge-plugin';
import { fablewoodGameHmrGuard } from './app/vite-hmr-guard';

// The repo root is the project. Source lives in app/; the bridge dev-plugin
// serves packs (read-only) and state (read/write) from disk. Neither packs nor
// state are ever bundled — the engine builds and runs with zero packs installed.
export default defineConfig({
  root: 'app',
  plugins: [react(), fablewoodBridge(), fablewoodJudge(), fablewoodGameHmrGuard()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // App.tsx lazy-loads the game engine (Phaser + all scenes/combat, and
    // transitively Tone) separately from the shell (React/Dashboard/Library),
    // so Dashboard/Library no longer pay for it — that chunk is ~250-290 kB each,
    // well under the 500 kB default. The remaining engine chunk stays big on
    // purpose: Phaser's own minified core alone is ~1.1 MB (verified via
    // node_modules/phaser/dist/phaser.min.js), before a single scene/combat/
    // encounter line of ours is added — there's no practical further split
    // without tree-shaking Phaser's internals module-by-module, which is a much
    // larger, riskier undertaking than this diet asked for. 1700 kB gives a little
    // headroom over today's ~1656 kB engine chunk while still flagging a genuine
    // regression (e.g. Tone or shell code accidentally leaking back into it).
    chunkSizeWarningLimit: 1700,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
