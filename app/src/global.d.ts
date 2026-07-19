import type { FablewoodState } from './game/ready';

// Load-bearing test/screenshot harness contract. The boot path sets these once
// the active scene has finished create(); shot.mjs and e2e wait on __FABLEWOOD_READY.
declare global {
  interface Window {
    __FABLEWOOD_READY?: boolean;
    __FABLEWOOD_STATE?: FablewoodState;
    __FABLEWOOD_GAME?: unknown;
  }
}

export {};
