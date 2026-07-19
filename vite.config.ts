import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fablewoodBridge } from './app/src/bridge/plugin';
import { fablewoodJudge } from './app/vite-judge-plugin';

// The repo root is the project. Source lives in app/; the bridge dev-plugin
// serves packs (read-only) and state (read/write) from disk. Neither packs nor
// state are ever bundled — the engine builds and runs with zero packs installed.
export default defineConfig({
  root: 'app',
  plugins: [react(), fablewoodBridge(), fablewoodJudge()],
  server: { port: 5173, strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
