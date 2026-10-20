/**
 * Hitscan: where a shot fired along a ray lands. Water has no collider (the
 * player wades on a floor, not a body), so a hit below the water line is
 * moved up to where the ray crossed the surface.
 */

import type RAPIER from '@dimforge/rapier3d-compat';
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

export function traceShot(
  physics: Physics,
  origin: Vec3,
  dir: Vec3,
  range: number,
  waterAt: ((x: number, z: number) => number) | null,
  exclude?: RAPIER.Collider,
): Impact | null {
  const hit = physics.castRay(origin, dir, range, exclude);
  if (!hit) return null;
  const water = waterAt ? waterAt(hit.x, hit.z) : -Infinity;
  if (hit.y < water && dir.y < 0) {
    const t = Math.max(0, (water - origin.y) / dir.y);
    return {
      x: origin.x + dir.x * t,
      y: water,
      z: origin.z + dir.z * t,
      normal: { x: 0, y: 1, z: 0 },
      surface: 'water',
    };
  }
  return { x: hit.x, y: hit.y, z: hit.z, normal: hit.normal, surface: hit.surface ?? 'stone' };
}
