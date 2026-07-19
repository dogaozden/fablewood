import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import './scenes'; // side-effect: registers all scenes
import { getRegisteredScenes, hasScene, DEFAULT_SCENE } from './SceneRegistry';

/**
 * Mounts the Phaser game inside React. Dev-only URL params drive the harness:
 *   ?scene=<key>  jump straight to any registered scene (default: boot)
 *   ?seed=<n>     deterministic seed handed to the scene's init()
 * Scenes are added but not auto-started, then the requested one is started through
 * the normal boot path so init/preload/create all run.
 */
export function PhaserGame() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    const params = new URLSearchParams(window.location.search);
    const requested = params.get('scene') ?? DEFAULT_SCENE;
    const sceneKey = hasScene(requested) ? requested : DEFAULT_SCENE;
    const seedParam = params.get('seed');
    const seed =
      seedParam !== null && seedParam !== '' && !Number.isNaN(Number(seedParam))
        ? Number(seedParam)
        : undefined;

    window.__FABLEWOOD_READY = false;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      backgroundColor: '#241b2f',
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 960,
        height: 540,
      },
      scene: [],
    });
    window.__FABLEWOOD_GAME = game;

    for (const { key, scene } of getRegisteredScenes()) {
      game.scene.add(key, scene, false);
    }
    game.scene.start(sceneKey, { seed });

    return () => {
      game.destroy(true);
      window.__FABLEWOOD_READY = false;
      window.__FABLEWOOD_GAME = undefined;
    };
  }, []);

  return <div className="phaser-root" ref={containerRef} />;
}
