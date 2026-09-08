import * as T from 'three';

/** A fern crown with arched stems and paired, folded leaflets. */
export function fernGeometry(): T.BufferGeometry {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const vertex = (point: T.Vector3, tone: number) => {
    const index = positions.length / 3;
    positions.push(point.x, point.y, point.z);
    const color = new T.Color().setRGB(.20 * tone, .34 * tone, .15 * tone, T.SRGBColorSpace);
    colors.push(color.r, color.g, color.b);
    return index;
  };
  for (let frond = 0; frond < 9; frond++) {
    const angle = frond / 9 * Math.PI * 2 + .12;
    const length = .8 + .25 * Math.sin(frond * 13.1);
    const forward = new T.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const across = new T.Vector3(-forward.z, 0, forward.x);
    const center = (t: number) => forward.clone().multiplyScalar(t * length).add(new T.Vector3(0, .08 + Math.sin(t * 2.2) * .7, 0));
    for (let segment = 1; segment < 12; segment++) {
      const t = segment / 12, base = center(t);
      const spread = .28 * Math.sin(t * Math.PI) + .025;
      for (const side of [-1, 1]) {
        const tip = base.clone().addScaledVector(across, side * spread).addScaledVector(forward, .13).add(new T.Vector3(0, -.04, 0));
        const axis = tip.clone().sub(base), width = forward.clone().multiplyScalar(.075 * (1 - t * .6));
        const tone = .8 + t * .4;
        const a = vertex(base, tone * .65);
        const b = vertex(base.clone().addScaledVector(axis, .43).sub(width), tone);
        const c = vertex(tip, tone * 1.1);
        const d = vertex(base.clone().addScaledVector(axis, .53).add(width), tone);
        const ridge = vertex(base.clone().addScaledVector(axis, .48).add(new T.Vector3(0, .025, 0)), tone * 1.1);
        indices.push(a, b, ridge, b, c, ridge, c, d, ridge, d, a, ridge);
      }
      const next = center(t + 1 / 12), stemWidth = across.clone().multiplyScalar(.009 * (1 - t));
      const a = vertex(base.clone().sub(stemWidth), 1), b = vertex(base.clone().add(stemWidth), 1);
      const c = vertex(next.clone().sub(stemWidth), 1), d = vertex(next.clone().add(stemWidth), 1);
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
