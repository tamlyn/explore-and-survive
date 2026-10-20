/**
 * Collision templates per (class, variant), derived from the same geometry the
 * vegetation library renders: trees get an upright trunk cylinder, rocks,
 * logs and stumps a convex hull. Everything else (understory, flowers,
 * pebbles, fallen branches) stays walk-through — the character controller's
 * step-up handles small stuff.
 */

import type { BufferGeometry } from 'three';
import { Vector3 } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { VegClass } from '../gpu/passes/Scatter';
import type { VegLib } from '../vegetation/VegLibrary';
import type { ObstacleTemplate } from './Obstacles';

const HULL_CLASSES = new Set<number>([
  VegClass.Log,
  VegClass.Stump,
  VegClass.Boulder,
  VegClass.Slab,
  VegClass.StoneL,
  VegClass.StoneM,
]);
const TREE_CLASS_LIMIT = 6;

export function obstacleTemplates(lib: VegLib): Map<number, ObstacleTemplate> {
  const out = new Map<number, ObstacleTemplate>();
  for (const pool of lib.pools) {
    const key = pool.cls * 8 + pool.variant;
    if (pool.cls < TREE_CLASS_LIMIT) {
      if (pool.trunkRadius) {
        out.set(key, { kind: 'trunk', radius: pool.trunkRadius, height: pool.height });
      }
    } else if (HULL_CLASSES.has(pool.cls)) {
      // the low-detail ring is plenty for a hull and far fewer points
      const geo = (pool.r2 ?? pool.r1)?.[0]?.geo;
      if (geo) out.set(key, { kind: 'hull', points: hullPoints(geo) });
    }
  }
  return out;
}

export function hullPoints(geo: BufferGeometry): Float32Array {
  const pos = geo.getAttribute('position');
  const pts: Vector3[] = [];
  for (let i = 0; i < pos.count; i++) pts.push(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  const hull = new ConvexHull().setFromPoints(pts);
  const seen = new Set<Vector3>();
  for (const face of hull.faces) {
    let edge = face.edge;
    do {
      seen.add(edge.head().point);
      edge = edge.next;
    } while (edge !== face.edge);
  }
  const out = new Float32Array(seen.size * 3);
  let k = 0;
  for (const p of seen) {
    out[k++] = p.x;
    out[k++] = p.y;
    out[k++] = p.z;
  }
  return out;
}
