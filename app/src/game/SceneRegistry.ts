import type Phaser from 'phaser';

export type SceneClass = new (...args: never[]) => Phaser.Scene;

const registry = new Map<string, SceneClass>();

/** The scene booted when no ?scene= param is supplied. */
export const DEFAULT_SCENE = 'boot';

/** Register a scene under a key. Scenes register themselves in scenes/index.ts. */
export function registerScene(key: string, scene: SceneClass): void {
  registry.set(key, scene);
}

export function getRegisteredScenes(): { key: string; scene: SceneClass }[] {
  return [...registry.entries()].map(([key, scene]) => ({ key, scene }));
}

export function hasScene(key: string): boolean {
  return registry.has(key);
}
