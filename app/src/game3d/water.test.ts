import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { woodlandWater } from './water';

function setup() {
  const water = woodlandWater();
  const scene = new T.Scene();
  scene.add(water.mesh);
  scene.updateMatrixWorld(true);
  const camera = new T.PerspectiveCamera(44, 1, .1, 150);
  camera.position.set(5, 15, 30);
  camera.lookAt(5, .7, 1);
  camera.updateMatrixWorld(true);
  const originalTarget = new T.WebGLRenderTarget(8, 8);
  let currentTarget = originalTarget;
  const renderer = {
    xr: { enabled: true },
    shadowMap: { autoUpdate: true },
    state: { buffers: { depth: { setMask: vi.fn() } } },
    autoClear: true,
    getRenderTarget: () => currentTarget,
    setRenderTarget: (target: T.WebGLRenderTarget) => { currentTarget = target; },
    render: vi.fn<(scene: T.Scene, camera: T.Camera) => void>(),
  };
  const render = () => water.mesh.onBeforeRender(renderer as unknown as T.WebGLRenderer,
    scene, camera, water.mesh.geometry, water.mesh.material as T.Material, null as never);
  const dispose = () => {
    water.dispose();
    water.mesh.geometry.dispose();
    (water.mesh.material as T.Material).dispose();
    originalTarget.dispose();
  };
  return { water, scene, renderer, originalTarget, render, dispose };
}

describe('woodland water reflection lifecycle', () => {
  it('never renders a reflection during normal overrides and limits scene renders to four per second', () => {
    const f = setup();
    const override = new T.MeshNormalMaterial();
    expect(f.water.reflection.ready.value).toBe(0);
    f.scene.overrideMaterial = override;
    f.render();
    expect(f.renderer.render).not.toHaveBeenCalled();
    expect(f.water.reflection.ready.value).toBe(0);
    f.scene.overrideMaterial = null;
    f.render();
    f.water.update(.249);
    f.render();
    expect(f.renderer.render).toHaveBeenCalledTimes(1);
    f.water.update(.25);
    f.render();
    expect(f.renderer.render).toHaveBeenCalledTimes(2);
    expect(f.renderer.getRenderTarget()).toBe(f.originalTarget);
    expect(f.water.mesh.visible).toBe(true);
    override.dispose();
    f.dispose();
  });

  it('projects world-space consumers through the reflected camera and avoids framebuffer feedback', () => {
    const f = setup();
    f.renderer.render.mockImplementation(() => {
      expect(f.water.reflection.texture.value).toBeNull();
    });
    f.render();
    expect(f.water.reflection.ready.value).toBe(1);
    expect(f.water.reflection.texture.value).toBe(f.water.mesh.getRenderTarget().texture);
    const reflectedCamera = f.renderer.render.mock.calls[0][1] as T.Camera;
    for (const point of [new T.Vector3(4.5, .1, 10), new T.Vector3(0, -.28, -5)]) {
      const expected = point.clone().project(reflectedCamera);
      const actual = point.clone().applyMatrix4(f.water.reflection.projection);
      expect(actual.x).toBeCloseTo(expected.x * .5 + .5, 7);
      expect(actual.y).toBeCloseTo(expected.y * .5 + .5, 7);
    }
    f.dispose();
  });

  it('restores scene and renderer state after a reflected material throws, then allows a retry', () => {
    const f = setup();
    f.renderer.render.mockImplementationOnce(() => { throw new Error('reflected material failed'); });
    expect(f.render).toThrow('reflected material failed');
    expect(f.water.mesh.visible).toBe(true);
    expect(f.water.reflection.ready.value).toBe(0);
    expect(f.water.reflection.texture.value).toBe(f.water.mesh.getRenderTarget().texture);
    expect(f.renderer.getRenderTarget()).toBe(f.originalTarget);
    expect(f.renderer.shadowMap.autoUpdate).toBe(true);
    expect(f.renderer.xr.enabled).toBe(true);
    f.render();
    expect(f.renderer.render).toHaveBeenCalledTimes(2);
    const release = vi.fn();
    f.water.mesh.getRenderTarget().addEventListener('dispose', release);
    f.dispose();
    expect(release).toHaveBeenCalledOnce();
  });
});
