import * as T from 'three';

/** A fern crown with arched stems and paired, folded leaflets. */
export function fernGeometry(seed = 1): T.BufferGeometry {
  const varied = (n: number) => .5 + .5 * Math.sin(n * 17.731 + seed * 7.123);
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const vertex = (point: T.Vector3, tone: number) => {
    const index = positions.length / 3;
    positions.push(point.x, point.y, point.z);
    const color = new T.Color().setRGB(.24 * tone, .30 * tone, .21 * tone, T.SRGBColorSpace);
    colors.push(color.r, color.g, color.b);
    return index;
  };
  const fronds = 6 + seed % 3;
  for (let frond = 0; frond < fronds; frond++) {
    const angle = frond / fronds * Math.PI * 2 + varied(frond) * .45;
    const length = .65 + varied(frond + 11) * .85;
    const height = .35 + varied(frond + 31) * .65;
    const forward = new T.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const across = new T.Vector3(-forward.z, 0, forward.x);
    const center = (t: number) => forward.clone().multiplyScalar(t * length)
      .addScaledVector(across, Math.sin(t * 2.7) * (varied(frond + 51) - .5) * .25)
      .add(new T.Vector3(0, .06 + Math.sin(t * (1.8 + varied(frond + 17))) * height, 0));
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

/** Folded, curved leaves provide a broad silhouette beside the fine fern fronds. */
export function woodlandPlantGeometry(kind: 'broadleaf' | 'grass', seed = 1): T.BufferGeometry {
  const positions: number[] = [], colors: number[] = [], uvs: number[] = [], indices: number[] = [];
  const varied = (n: number) => .5 + .5 * Math.sin(n * 13.73 + seed * 8.17);
  const base = new T.Color(kind === 'broadleaf' ? '#a5af81' : '#667347');
  const leaves = kind === 'broadleaf' ? 8 : 14;
  const segments = 9;
  for (let leaf = 0; leaf < leaves; leaf++) {
    const angle = leaf / leaves * Math.PI * 2 + varied(leaf) * .7;
    const length = (kind === 'broadleaf' ? .7 : .5) + varied(leaf + 13) * .75;
    const height = (kind === 'broadleaf' ? .32 : .55) + varied(leaf + 37) * .55;
    const spread = kind === 'broadleaf' ? .18 + varied(leaf + 5) * .09 : .025 + varied(leaf + 5) * .025;
    const start = positions.length / 3;
    for (let row = 0; row <= segments; row++) {
      const t = (row + .025) / (segments + .05);
      const bend = angle + Math.sin(t * 2.5) * (varied(leaf + 19) - .5) * .6;
      const x = Math.cos(bend) * length * t, z = Math.sin(bend) * length * t;
      const y = .025 + Math.sin(t * 2.15) * height;
      const width = Math.pow(Math.sin(Math.PI * t), .8) * spread;
      for (const side of [-1, 0, 1]) {
        positions.push(x - Math.sin(bend) * width * side,
          y + (side === 0 ? width * .26 : 0), z + Math.cos(bend) * width * side);
        const tone = (.3 + .7 * Math.sqrt(t)) * (side === 0 ? 1.1 : .85 + varied(leaf + 3) * .2);
        colors.push(base.r * tone, base.g * tone, base.b * tone);
        uvs.push((side+1)*.5,t);
      }
      if (row === segments) continue;
      const a = start + row * 3;
      indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4,
        a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}
