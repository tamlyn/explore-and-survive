/**
 * Hitscan: where a shot fired along a ray lands. Nearby colliders come from
 * the physics world; obstacles beyond the stream radius are tested straight
 * from the obstacle field. Water has no collider (the player wades on a
 * floor, not a body), so a hit below the water line is moved up to where the
 * ray crossed the surface.
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import type { ObstacleField } from './Obstacles';
import type { Physics, Surface } from './Physics';
import type { Vec3 } from './PlayerMotor';

export type ImpactSurface = Surface | 'water';

export interface Impact {
  x: number;
  y: number;
  z: number;
  normal: Vec3;
  surface: ImpactSurface;
}

export interface ShotWorld {
  physics: Physics;
  obstacles?: ObstacleField | undefined;
  waterAt?: ((x: number, z: number) => number) | undefined;
  /** the shooter's own collider, which the ray starts inside */
  shooter?: RAPIER.Collider | undefined;
}

export function traceShot(world: ShotWorld, origin: Vec3, dir: Vec3, range: number): Impact | null {
  const near = world.physics.castRay(origin, dir, range, world.shooter);
  const far = world.obstacles?.castRay(world.physics.rapier, origin, dir, near?.distance ?? range) ?? null;
  const hit = far ?? near;
  if (!hit) return null;
  const distance = hit.distance;
  const x = origin.x + dir.x * distance;
  const y = origin.y + dir.y * distance;
  const z = origin.z + dir.z * distance;
  const water = world.waterAt ? world.waterAt(x, z) : -Infinity;
  if (y < water && dir.y < 0) {
    const t = Math.max(0, (water - origin.y) / dir.y);
    return {
      x: origin.x + dir.x * t,
      y: water,
      z: origin.z + dir.z * t,
      normal: { x: 0, y: 1, z: 0 },
      surface: 'water',
    };
  }
  return { x, y, z, normal: hit.normal, surface: hit.surface ?? 'stone' };
}
