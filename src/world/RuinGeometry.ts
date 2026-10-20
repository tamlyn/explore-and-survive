/**
 * Block geometry for the ruins: oriented boxes merged into one indexed
 * mesh. UVs are each block's position in its own rotation frame, so the
 * courses run on unbroken across neighbouring blocks of a wall. A
 * per-vertex ground height lets the shader grime the foot of the walls.
 */

import { BufferAttribute, BufferGeometry } from 'three';
import type { Block, Ground } from './RuinPlan';

/** metres per texture repeat (the scan covers about 1.5 m) */
const TILE = 1.5;

/** per face: normal axis, then the axes carrying u and v; the buried −y face is skipped */
const FACES: [number, number, number][] = [
  [0, 2, 1],
  [2, 0, 1],
  [1, 0, 2],
];

function rotate(q: Block['q'], v: [number, number, number]): [number, number, number] {
  const [qx, qy, qz, qw] = q;
  const [x, y, z] = v;
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx];
}

/** blocks → one indexed geometry with position, normal, tangent, uv and ground */
export function blockGeometry(blocks: Block[], ground: Ground): BufferGeometry {
  const faces = blocks.length * 5;
  const pos = new Float32Array(faces * 12);
  const nrm = new Float32Array(faces * 12);
  const tan = new Float32Array(faces * 16);
  const uvs = new Float32Array(faces * 8);
  const gnd = new Float32Array(faces * 4);
  const idx = new Uint32Array(faces * 6);
  let f = 0;
  for (const b of blocks) {
    const h = [b.hx, b.hy, b.hz];
    // the centre in the block's own frame anchors the texture to the wall
    const conj: Block['q'] = [-b.q[0], -b.q[1], -b.q[2], b.q[3]];
    const fc = rotate(conj, [b.x, b.y, b.z]);
    for (const [a, ua, va] of FACES) {
      for (const sign of a === 1 ? [1] : [1, -1]) {
        const axis = (k: number): [number, number, number] => [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0];
        const n = rotate(b.q, axis(a).map((c) => c * sign) as [number, number, number]);
        const t = rotate(b.q, axis(ua));
        const bt = rotate(b.q, axis(va));
        // bitangent = cross(n, t) · w
        const cx = n[1] * t[2] - n[2] * t[1];
        const cy = n[2] * t[0] - n[0] * t[2];
        const cz = n[0] * t[1] - n[1] * t[0];
        const w = cx * bt[0] + cy * bt[1] + cz * bt[2] >= 0 ? 1 : -1;
        const corners: [number, number][] = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ];
        for (let k = 0; k < 4; k++) {
          const [su, sv] = corners[k] as [number, number];
          const l: [number, number, number] = [0, 0, 0];
          l[a] = sign * (h[a] as number);
          l[ua] = su * (h[ua] as number);
          l[va] = sv * (h[va] as number);
          const r = rotate(b.q, l);
          const v = f * 4 + k;
          pos.set([b.x + r[0], b.y + r[1], b.z + r[2]], v * 3);
          nrm.set(n, v * 3);
          tan.set([t[0], t[1], t[2], w], v * 4);
          uvs.set([((fc[ua] as number) + l[ua]) / TILE, ((fc[va] as number) + l[va]) / TILE], v * 2);
          gnd[v] = ground.height(b.x + r[0], b.z + r[2]);
        }
        // w = n · (t × bt): positive when u then v turn anticlockwise about n
        const ccw = w > 0;
        const v0 = f * 4;
        idx.set(ccw ? [v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3] : [v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2], f * 6);
        f++;
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nrm, 3));
  geo.setAttribute('tangent', new BufferAttribute(tan, 4));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setAttribute('ground', new BufferAttribute(gnd, 1));
  geo.setIndex(new BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}
