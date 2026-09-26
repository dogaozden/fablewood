import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { WoodlandOcclusionPass } from './ambient-occlusion';

describe('woodland normal pass', () => {
  it.each([true, false])('restores leaf visibility and shadow policy after a failed pass (autoUpdate=%s)', autoUpdate => {
    const scene = new T.Scene();
    const leaf = new T.Object3D();
    leaf.userData.skipAO = true;
    scene.add(leaf);
    const pass = new WoodlandOcclusionPass(scene, new T.PerspectiveCamera());
    const renderer = { shadowMap: { autoUpdate } } as T.WebGLRenderer;
    const render = vi.spyOn(GTAOPass.prototype, 'render').mockImplementation(() => {
      expect(leaf.visible).toBe(false);
      expect(renderer.shadowMap.autoUpdate).toBe(false);
      throw new Error('render interrupted');
    });
    try {
      expect(() => pass.render(renderer, {} as T.WebGLRenderTarget, {} as T.WebGLRenderTarget, 0, false))
        .toThrow('render interrupted');
      expect(leaf.visible).toBe(true);
      expect(renderer.shadowMap.autoUpdate).toBe(autoUpdate);
    } finally {
      render.mockRestore();
      pass.dispose();
    }
  });
});
