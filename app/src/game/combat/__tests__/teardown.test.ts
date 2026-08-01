import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Scene-teardown invariant, asserted over source text because the scenes themselves are
 * Phaser-bound and cannot be constructed under the node test env (`window is not defined`
 * at import).
 *
 * A full Game teardown — PhaserGame.tsx unmounting, e.g. the shell switching away from the
 * "Game" tab mid-battle — does NOT emit SHUTDOWN: Phaser's SceneManager.destroy() calls each
 * scene's Systems.destroy() directly and skips shutdown() entirely. HamletScene documents
 * and handles this with a twin DESTROY listener. CombatScene had only the SHUTDOWN one, so
 * on that path `destroyed` stayed false and every `if (this.destroyed) return` guard failed
 * open — including the ones protecting delayed calls and the awaited encounter overlays,
 * which resolve on their own setTimeout long after the scene is gone.
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(here, rel), 'utf8');

/** The handler body of `this.events.once(Phaser.Scenes.Events.<EVENT>, () => { ... })`. */
function teardownHandler(source: string, event: 'SHUTDOWN' | 'DESTROY'): string | null {
  const m = new RegExp(
    `events\\.once\\(\\s*Phaser\\.Scenes\\.Events\\.${event}\\s*,\\s*\\(\\)\\s*=>\\s*\\{([^}]*)\\}`,
  ).exec(source);
  return m ? m[1] : null;
}

describe('scene teardown listeners', () => {
  it('CombatScene marks itself destroyed on DESTROY, not only on SHUTDOWN', () => {
    const combat = src('../CombatScene.ts');
    const onDestroy = teardownHandler(combat, 'DESTROY');
    expect(onDestroy, 'CombatScene registers no DESTROY teardown listener').not.toBeNull();
    expect(onDestroy).toContain('destroyed = true');
    expect(teardownHandler(combat, 'SHUTDOWN')).toContain('destroyed = true');
  });

  it('HamletScene still carries the twin-listener idiom this mirrors', () => {
    const hamlet = src('../../scenes/hamlet/HamletScene.ts');
    expect(teardownHandler(hamlet, 'SHUTDOWN')).not.toBeNull();
    expect(teardownHandler(hamlet, 'DESTROY')).not.toBeNull();
  });
});
