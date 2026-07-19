export interface FablewoodState {
  scene: string;
  title: string;
  seed: number;
}

/**
 * Called by a scene at the end of create() to signal the game is up and rendering.
 * This is the contract shot.mjs and e2e wait on — every future scene should call it.
 */
export function markReady(state: FablewoodState): void {
  window.__FABLEWOOD_STATE = state;
  window.__FABLEWOOD_READY = true;
}
