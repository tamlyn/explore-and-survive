import { beforeAll, describe, expect, it } from 'vitest';
import { sampleGrid } from '../world/GridSample';
import { loadRapier, Physics, type Rapier, type TerrainGrid } from './Physics';

let rapier: Rapier;
beforeAll(async () => {
  rapier = await loadRapier();
});

/** planar ramps (distinct slopes in x and z) so any axis or row/column
 *  mix-up shows, and bilinear == triangle interpolation everywhere */
function rampGrid(res: number, worldSize: number): TerrainGrid {
  const heights = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) heights[j * res + i] = 10 + i * 0.5 + j * 2;
  }
  return { heights, res, worldSize };
}

describe('terrain heightfield collider', () => {
  it('matches the CPU bilinear lookup at and between samples', () => {
    const grid = rampGrid(16, 64);
    const physics = new Physics(rapier, grid);
    for (const [x, z] of [
      [0, 0],
      [-20, 13],
      [17.3, -9.1],
      [29, 29],
      [-29, -29],
    ] as const) {
      const expected = sampleGrid(grid.heights, grid.res, grid.worldSize, x, z);
      expect(physics.groundY(x, z)).toBeCloseTo(expected, 3);
    }
    physics.dispose();
  });

  it('has no ground outside the world', () => {
    const physics = new Physics(rapier, rampGrid(8, 32));
    expect(physics.groundY(100, 0)).toBeNull();
    physics.dispose();
  });
});
