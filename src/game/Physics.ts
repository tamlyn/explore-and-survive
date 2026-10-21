/**
 * Physics — the Rapier world the game layer shares: the terrain as a
 * heightfield collider plus whatever bodies the game adds (player, streamed
 * obstacles). Stepped at a fixed rate by its owner.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type { Box } from '../world/Box';
import type { Vec3 } from './PlayerMotor';

export type Rapier = typeof RAPIER;

/** what a static collider is made of — drives impact effects */
export type Surface = 'ground' | 'wood' | 'stone' | 'metal' | 'rubber';

/** something shots can hurt: the player, a robot */
export interface Hittable {
  hurt(damage: number, from: Vec3): void;
}

export interface RayHit {
  x: number;
  y: number;
  z: number;
  normal: { x: number; y: number; z: number };
  distance: number;
  /** null for colliders added without a surface (the player) */
  surface: Surface | null;
  target: Hittable | null;
}

/** CPU copy of the render heightfield: sample (i, j) sits at
 *  x = ((i + 0.5) / res − 0.5) · worldSize, likewise z; row-major by z */
export interface TerrainGrid {
  heights: Float32Array;
  res: number;
  worldSize: number;
}

let ready: Promise<Rapier> | null = null;

/** Rapier's WASM must initialise once before any other call */
export function loadRapier(): Promise<Rapier> {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}

/**
 * Heightfield collider matching the CPU terrain lookup. Rapier wants a
 * column-major matrix whose rows run along z, centred on the collider — the
 * transpose of our row-major-by-z grid. The first/last samples sit half a
 * texel inside the world edge, so the field spans (res − 1) texels.
 */
export function terrainColliderDesc(rapier: Rapier, grid: TerrainGrid): RAPIER.ColliderDesc {
  const { heights, res, worldSize } = grid;
  const colMajor = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) colMajor[i * res + j] = heights[j * res + i] as number;
  }
  const span = ((res - 1) / res) * worldSize;
  return rapier.ColliderDesc.heightfield(res - 1, res - 1, colMajor, { x: span, y: 1, z: span });
}

export function boxColliderDesc(rapier: Rapier, b: Box): RAPIER.ColliderDesc {
  const [x, y, z, w] = b.q;
  return rapier.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.x, b.y, b.z).setRotation({ x, y, z, w });
}

export class Physics {
  readonly world: RAPIER.World;
  private readonly terrain: RAPIER.Collider | null;
  /** collider handle → surface */
  private readonly surfaces = new Map<number, Surface>();
  /** collider handle → who it hurts */
  private readonly targets = new Map<number, Hittable>();

  constructor(
    readonly rapier: Rapier,
    terrain: TerrainGrid | null,
  ) {
    this.world = new rapier.World({ x: 0, y: 0, z: 0 });
    this.terrain = terrain ? this.addCollider(terrainColliderDesc(rapier, terrain), 'ground') : null;
    // colliders only become visible to queries once the broad phase has run
    this.world.step();
  }

  step(): void {
    this.world.step();
  }

  /** a static collider of the given surface */
  addCollider(desc: RAPIER.ColliderDesc, surface: Surface): RAPIER.Collider {
    const collider = this.world.createCollider(desc);
    this.surfaces.set(collider.handle, surface);
    return collider;
  }

  removeCollider(collider: RAPIER.Collider): void {
    this.untag(collider);
    this.world.removeCollider(collider, false);
  }

  /** what a body's collider is made of, and who a shot into it hurts */
  tag(collider: RAPIER.Collider, surface: Surface | null, target: Hittable | null = null): void {
    if (surface) this.surfaces.set(collider.handle, surface);
    if (target) this.targets.set(collider.handle, target);
  }

  untag(collider: RAPIER.Collider): void {
    this.surfaces.delete(collider.handle);
    this.targets.delete(collider.handle);
  }

  /** first solid hit along a ray; `dir` must be unit length */
  castRay(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDistance: number,
    exclude?: RAPIER.Collider,
  ): RayHit | null {
    const ray = new this.rapier.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxDistance, true, undefined, undefined, exclude);
    if (!hit) return null;
    const p = ray.pointAt(hit.timeOfImpact);
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      distance: hit.timeOfImpact,
      surface: this.surfaces.get(hit.collider.handle) ?? null,
      target: this.targets.get(hit.collider.handle) ?? null,
    };
  }

  /** height of the terrain collider's surface under (x, z) — obstacles
   *  ignored — or null outside the world */
  terrainY(x: number, z: number): number | null {
    if (!this.terrain) return null;
    const fromY = 1e4;
    const ray = new this.rapier.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const toi = this.terrain.castRay(ray, 2e4, true);
    return toi >= 0 ? fromY - toi : null;
  }

  dispose(): void {
    this.world.free();
  }
}
