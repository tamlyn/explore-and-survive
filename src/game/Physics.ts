/**
 * Physics — the Rapier world the game layer shares: the terrain as a
 * heightfield collider plus whatever bodies the game adds (player, streamed
 * obstacles). Stepped at a fixed rate by its owner.
 */

import RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;

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

export class Physics {
  readonly world: RAPIER.World;

  constructor(
    readonly rapier: Rapier,
    terrain: TerrainGrid | null,
  ) {
    this.world = new rapier.World({ x: 0, y: 0, z: 0 });
    if (terrain) this.world.createCollider(terrainColliderDesc(rapier, terrain));
    // colliders only become visible to queries once the broad phase has run
    this.world.step();
  }

  step(): void {
    this.world.step();
  }

  /** straight-down ray: first surface height under (x, z), or null */
  groundY(x: number, z: number, fromY = 1e4): number | null {
    const ray = new this.rapier.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 2e4, true);
    return hit ? fromY - hit.timeOfImpact : null;
  }

  dispose(): void {
    this.world.free();
  }
}
