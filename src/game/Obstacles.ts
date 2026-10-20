/**
 * Obstacles — collision for the scattered world (tree trunks, boulders,
 * slabs, large/medium stones, logs, stumps). The instances live in GPU
 * scatter buffers; the scene reads them back once and hands them here as
 * raw (A, B) arrays.
 *
 * There are ~10⁵ of them, so colliders are streamed: ObstacleField indexes
 * every instance on a coarse grid, and ObstacleStreamer keeps Rapier
 * colliders only for those near a focus point (the player).
 *
 * Instance layout (matches Scatter / VegInstance):
 *   A = (x, y, z, scale)   B = (yaw, leanX, leanZ, idF)   idF = cls·8 + variant
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics, Rapier, Surface } from './Physics';

/** per (class, variant) collision shape in the instance's local space */
export type ObstacleTemplate =
  | { kind: 'trunk'; radius: number; height: number }
  | { kind: 'hull'; points: Float32Array; surface: Surface };

export interface InstanceArrays {
  A: Float32Array;
  B: Float32Array;
  count: number;
}

/** local → world for one instance; mirrors instanceVeg (scale, yaw, lean shear) */
export function instanceToWorld(
  lx: number,
  ly: number,
  lz: number,
  A: ArrayLike<number>,
  B: ArrayLike<number>,
  i: number,
  out: { x: number; y: number; z: number },
): void {
  const s = A[i * 4 + 3] as number;
  const yaw = B[i * 4] as number;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const x = lx * s;
  const y = ly * s;
  const z = lz * s;
  out.x = x * c + z * sn + (B[i * 4 + 1] as number) * y + (A[i * 4] as number);
  out.y = y + (A[i * 4 + 1] as number);
  out.z = z * c - x * sn + (B[i * 4 + 2] as number) * y + (A[i * 4 + 2] as number);
}

export function templateKey(idF: number): number {
  return Math.round(idF);
}

interface Entry {
  src: InstanceArrays;
  i: number;
  template: ObstacleTemplate;
}

/** spatial index over every instance that has a collision template */
export class ObstacleField {
  readonly size: number;
  private readonly entries: Entry[] = [];
  private readonly cells = new Map<number, number[]>();

  constructor(
    sources: InstanceArrays[],
    templates: Map<number, ObstacleTemplate>,
    private readonly cellSize = 32,
  ) {
    for (const src of sources) {
      for (let i = 0; i < src.count; i++) {
        const template = templates.get(templateKey(src.B[i * 4 + 3] as number));
        if (!template) continue;
        const id = this.entries.length;
        this.entries.push({ src, i, template });
        const key = this.cellKey(
          Math.floor((src.A[i * 4] as number) / cellSize),
          Math.floor((src.A[i * 4 + 2] as number) / cellSize),
        );
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(id);
      }
    }
    this.size = this.entries.length;
  }

  /** ids of obstacles whose base lies within `r` of (x, z) */
  near(x: number, z: number, r: number): number[] {
    const out: number[] = [];
    const r2 = r * r;
    const c0x = Math.floor((x - r) / this.cellSize);
    const c1x = Math.floor((x + r) / this.cellSize);
    const c0z = Math.floor((z - r) / this.cellSize);
    const c1z = Math.floor((z + r) / this.cellSize);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const list = this.cells.get(this.cellKey(cx, cz));
        if (!list) continue;
        for (const id of list) {
          const { src, i } = this.entries[id] as Entry;
          const dx = (src.A[i * 4] as number) - x;
          const dz = (src.A[i * 4 + 2] as number) - z;
          if (dx * dx + dz * dz <= r2) out.push(id);
        }
      }
    }
    return out;
  }

  /** squared horizontal distance from (x, z) to obstacle `id`'s base */
  distanceSq(id: number, x: number, z: number): number {
    const { src, i } = this.entries[id] as Entry;
    const dx = (src.A[i * 4] as number) - x;
    const dz = (src.A[i * 4 + 2] as number) - z;
    return dx * dx + dz * dz;
  }

  surface(id: number): Surface {
    const { template } = this.entries[id] as Entry;
    return template.kind === 'trunk' ? 'wood' : template.surface;
  }

  /** world-space collider description for obstacle `id` */
  colliderDesc(rapier: Rapier, id: number): RAPIER.ColliderDesc | null {
    const { src, i, template } = this.entries[id] as Entry;
    const ax = src.A[i * 4] as number;
    const ay = src.A[i * 4 + 1] as number;
    const az = src.A[i * 4 + 2] as number;
    const s = src.A[i * 4 + 3] as number;
    if (template.kind === 'trunk') {
      // lean is a few degrees at most — an upright cylinder is close enough
      const half = (template.height * s) / 2;
      return rapier.ColliderDesc.cylinder(half, template.radius * s).setTranslation(ax, ay + half, az);
    }
    const pts = template.points;
    const world = new Float32Array(pts.length);
    const p = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < pts.length; k += 3) {
      instanceToWorld(pts[k] as number, pts[k + 1] as number, pts[k + 2] as number, src.A, src.B, i, p);
      // relative to the base keeps the hull numerically small
      world[k] = p.x - ax;
      world[k + 1] = p.y - ay;
      world[k + 2] = p.z - az;
    }
    return rapier.ColliderDesc.convexHull(world)?.setTranslation(ax, ay, az) ?? null;
  }

  private cellKey(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }
}

/** keeps colliders alive for obstacles within `radius` of the focus point */
export class ObstacleStreamer {
  private readonly live = new Map<number, RAPIER.Collider>();
  private lastX = Infinity;
  private lastZ = Infinity;

  constructor(
    private readonly physics: Physics,
    private readonly field: ObstacleField,
    private readonly radius = 40,
    /** refresh only after the focus moves this far */
    private readonly hysteresis = 6,
  ) {}

  get activeCount(): number {
    return this.live.size;
  }

  update(x: number, z: number): void {
    if (Math.hypot(x - this.lastX, z - this.lastZ) < this.hysteresis) return;
    this.lastX = x;
    this.lastZ = z;
    // keep a margin beyond the add radius so small moves don't churn
    const keep = new Set(this.field.near(x, z, this.radius + this.hysteresis));
    for (const [id, collider] of this.live) {
      if (!keep.has(id)) {
        this.physics.removeCollider(collider);
        this.live.delete(id);
      }
    }
    const r2 = this.radius * this.radius;
    for (const id of keep) {
      if (this.live.has(id) || this.field.distanceSq(id, x, z) > r2) continue;
      const desc = this.field.colliderDesc(this.physics.rapier, id);
      if (desc) this.live.set(id, this.physics.addCollider(desc, this.field.surface(id)));
    }
  }
}
