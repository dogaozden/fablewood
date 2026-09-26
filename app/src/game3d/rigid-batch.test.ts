import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { batchRigidParts } from './rigid-batch';
import { character } from './characters';

const vertices = (root: T.Object3D) => {
  root.updateWorldMatrix(true, true);
  const result: string[] = [];
  root.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry;
    const positions = geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index++) {
      const point = new T.Vector3().fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld);
      result.push(`${object.material.id}:${point.toArray().map(value => value.toFixed(4)).join(',')}`);
    }
    if (geometry !== object.geometry) geometry.dispose();
  });
  return result.sort();
};

describe('rigid character detail batching', () => {
  it('restores the guardian arm after a strike instead of accumulating roll each frame', () => {
    const guardian = character('#514a66', true);
    guardian.update(1, false);
    const restingRoll = guardian.arms[1].rotation.z;
    guardian.strike!();
    for (let frame = 1; frame <= 20; frame++) guardian.update(1 + frame / 60, false);
    expect(guardian.arms[1].rotation.z).toBeGreaterThan(restingRoll - .23);
    guardian.update(2, false);
    expect(guardian.arms[1].rotation.z).toBe(restingRoll);
  });

  it('preserves geometry and material through joint movement while reducing meshes', () => {
    const material = new T.MeshStandardMaterial();
    const root = new T.Group();
    const joint = new T.Group();
    joint.position.set(2, 1, -3);
    root.add(joint);
    for (let index = 0; index < 3; index++) {
      const detail = new T.Mesh(new T.BoxGeometry(.2, .4, .1), material);
      detail.position.set(index * .3, index * .2, .1);
      detail.rotation.z = index * .15;
      detail.scale.set(1, 1.1, .8);
      detail.castShadow = detail.receiveShadow = true;
      joint.add(detail);
    }
    const unbatched = root.clone(true);
    batchRigidParts(root, new Set());
    expect(joint.children).toHaveLength(1);
    expect(joint.children[0]).toMatchObject({ castShadow: true, receiveShadow: true });
    for (const angle of [0, .4, -.7]) {
      joint.rotation.x = angle;
      unbatched.children[0].rotation.x = angle;
      expect(vertices(root)).toEqual(vertices(unbatched));
    }
  });

  it('retains animated meshes, transparent surfaces, and distinct joint boundaries', () => {
    const root = new T.Group();
    const material = new T.MeshStandardMaterial();
    const cape = new T.Mesh(new T.PlaneGeometry(), material);
    const glass = new T.Mesh(new T.PlaneGeometry(), new T.MeshStandardMaterial({ transparent: true }));
    const joint = new T.Group();
    const detail = new T.Mesh(new T.BoxGeometry(), material);
    root.add(cape, glass, detail, joint);
    joint.add(new T.Mesh(new T.BoxGeometry(), material));
    const before = vertices(root);
    batchRigidParts(root, new Set([cape]));
    expect(root.children).toEqual([cape, glass, detail, joint]);
    expect(joint.children).toHaveLength(1);
    expect(vertices(root)).toEqual(before);
  });
});
