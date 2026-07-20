import type { FablewoodState } from './game/ready';

// Load-bearing test/screenshot harness contract. The boot path sets these once
// the active scene has finished create(); shot.mjs and e2e wait on __FABLEWOOD_READY.
declare global {
  interface Window {
    __FABLEWOOD_READY?: boolean;
    __FABLEWOOD_STATE?: FablewoodState;
    __FABLEWOOD_GAME?: import('phaser').Game;
    /** Dev/e2e-only: HamletScene.create() installs this behind `import.meta.env.DEV`
     *  (stripped from production builds). Warps the Keeper next to a named location's
     *  door; returns false if the id isn't recognized. Setup-only for e2e specs that
     *  don't need to prove real hamlet navigation. */
    __fwWarp?: (locationId: string) => boolean;
  }
}

export {};
