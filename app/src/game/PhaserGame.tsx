import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import './scenes'; // side-effect: registers all scenes
import { getRegisteredScenes, hasScene, DEFAULT_SCENE } from './SceneRegistry';
import { GAME_TEARDOWN_EVENT } from './encounters/overlay';

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
      pixelArt: true,
      // Right-click is a deliberate gameplay gesture in combat (playerTarget), so the
      // native OS context menu must never leak over the canvas. Phaser scopes this
      // listener to the game's own canvas (config.inputMouseEventTarget, unset here,
      // defaults to `game.canvas`) — never document-wide.
      disableContextMenu: true,
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
    // Always enter through boot: it bakes real textures + warms services, then
    // forwards to the requested scene — so ?scene= jumps see real art too.
    game.scene.start('boot', sceneKey === 'boot' ? { seed } : { seed, next: sceneKey });

    // Scale.FIT computes against the parent's size at construction, which can
    // settle a frame later under flex layout — refresh next frame and on every
    // parent resize so the canvas never sits mis-fit until a manual resize.
    const raf = requestAnimationFrame(() => game.scale.refresh());
    const ro = new ResizeObserver(() => game.scale.refresh());
    ro.observe(parent);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      // Encounter overlays live on document.body, not under this component —
      // tell them the game is going away so none keeps floating over the shell.
      window.dispatchEvent(new Event(GAME_TEARDOWN_EVENT));
      game.destroy(true);
      window.__FABLEWOOD_READY = false;
      window.__FABLEWOOD_GAME = undefined;
    };
  }, []);

  return <div className="phaser-root" ref={containerRef} />;
}
