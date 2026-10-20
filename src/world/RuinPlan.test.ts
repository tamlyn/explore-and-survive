import { describe, expect, it } from 'vitest';
import {
  type Block,
  type Building,
  buildingBlocks,
  CLEAR_ALL,
  CLEAR_TREES,
  clearingMask,
  footprintRadius,
  type Ground,
  planRuins,
} from './RuinPlan';
import { WORLD_HALF, WORLD_SIZE } from './WorldConst';

const flat: Ground = { height: () => 200, water: () => 0 };
/** a lake covers x < 0 */
const lakeWest: Ground = { height: () => 200, water: (x) => (x < 0 ? 201 : 0) };
const spawn = { x: 0, z: 0, yaw: 0 };

function contains(b: Block, x: number, y: number, z: number): boolean {
  // into the block's frame: inverse-rotate by q (unit quaternion)
  const [qx, qy, qz, qw] = b.q;
  const px = x - b.x;
  const py = y - b.y;
  const pz = z - b.z;
  // v' = q* v q via the cross-product form
  const tx = 2 * (-qy * pz + qz * py);
  const ty = 2 * (-qz * px + qx * pz);
  const tz = 2 * (-qx * py + qy * px);
  const lx = px + qw * tx + (-qy * tz + qz * ty);
  const ly = py + qw * ty + (-qz * tx + qx * tz);
  const lz = pz + qw * tz + (-qx * ty + qy * tx);
  return Math.abs(lx) <= b.hx && Math.abs(ly) <= b.hy && Math.abs(lz) <= b.hz;
}

describe('planRuins', () => {
  it('is deterministic and puts the first site ahead of the spawn', () => {
    const a = planRuins(flat, 7, spawn);
    expect(planRuins(flat, 7, spawn)).toEqual(a);
    expect(a.length).toBeGreaterThan(10);
    const first = a[0]!;
    const d = Math.hypot(first.x, first.z);
    expect(d).toBeGreaterThanOrEqual(30);
    expect(d).toBeLessThanOrEqual(120);
    // yaw 0 looks −z
    expect(first.z).toBeLessThan(0);
  });

  it('keeps sites in the world, apart, and buildings from overlapping', () => {
    for (const site of planRuins(flat, 3, spawn)) {
      expect(Math.abs(site.x)).toBeLessThan(WORLD_HALF);
      expect(Math.abs(site.z)).toBeLessThan(WORLD_HALF);
      expect(site.buildings.length).toBeGreaterThan(0);
      site.buildings.forEach((b, i) => {
        for (const o of site.buildings.slice(i + 1)) {
          expect(Math.hypot(b.x - o.x, b.z - o.z)).toBeGreaterThan(footprintRadius(b) + footprintRadius(o));
        }
      });
    }
  });

  it('finds level spots for buildings on a hillside', () => {
    // a 35% slope between two terraces: too steep for most footprints
    const slope: Ground = {
      height: (x, z) => 200 + Math.max(-12, Math.min(12, z % 100)) * 0.35 + x * 0.02,
      water: () => 0,
    };
    const sites = planRuins(slope, 9, spawn);
    expect(sites.flatMap((s) => s.buildings).length).toBeGreaterThan(10);
    for (const site of sites) {
      for (const b of site.buildings) {
        const corners = [-1, 1].flatMap((u) =>
          [-1, 1].map((v) => {
            const c = Math.cos(b.yaw);
            const s = Math.sin(b.yaw);
            return slope.height(b.x + (u * b.width * c) / 2 + (v * b.depth * s) / 2, b.z - (u * b.width * s) / 2 + (v * b.depth * c) / 2);
          }),
        );
        expect(Math.max(...corners) - Math.min(...corners)).toBeLessThanOrEqual(1.8);
      }
    }
  });

  it('stays out of the water', () => {
    const sites = planRuins(lakeWest, 5, { x: 500, z: 0, yaw: 0 });
    expect(sites.length).toBeGreaterThan(0);
    for (const s of sites) expect(s.x).toBeGreaterThan(20);
  });
});

describe('buildingBlocks', () => {
  const house: Building = { x: 10, z: -4, yaw: 0.4, width: 8, depth: 6, storeys: 1, seed: 11 };

  it('stands walls inside the footprint, footed below the ground', () => {
    const walls = buildingBlocks(house, flat).filter((b) => b.solid);
    expect(walls.length).toBeGreaterThan(8);
    for (const w of walls) {
      expect(Math.hypot(w.x - house.x, w.z - house.z)).toBeLessThanOrEqual(footprintRadius(house));
      expect(w.y + w.hy).toBeLessThanOrEqual(200 + 2.9 + 0.3 + 1e-9);
    }
    const lowest = Math.min(...walls.map((w) => w.y - w.hy));
    expect(lowest).toBeCloseTo(200 - 0.4, 5);
  });

  it('leaves a doorway through some wall', () => {
    const solids = buildingBlocks(house, flat).filter((b) => b.solid);
    // walk the wall line of every side at door height looking for a gap
    const c = Math.cos(house.yaw);
    const s = Math.sin(house.yaw);
    const sides = [
      (u: number) => [u, -3 + 0.275],
      (u: number) => [u, 3 - 0.275],
      (u: number) => [-4 + 0.275, u],
      (u: number) => [4 - 0.275, u],
    ];
    const gap = sides.some((side) => {
      for (let u = -2; u <= 2; u += 0.1) {
        const [lx, lz] = side(u) as [number, number];
        const x = house.x + lx * c + lz * s;
        const z = house.z - lx * s + lz * c;
        if (!solids.some((b) => contains(b, x, 201, z))) return true;
      }
      return false;
    });
    expect(gap).toBe(true);
  });

  it('drops loose rubble on the ground', () => {
    const tall = { ...house, storeys: 2, seed: 4 };
    const rubble = buildingBlocks(tall, flat).filter((b) => !b.solid);
    expect(rubble.length).toBeGreaterThan(0);
    for (const r of rubble) expect(Math.abs(r.y - 200)).toBeLessThan(0.3);
  });
});

describe('clearingMask', () => {
  it('clears everything under a building and trees around it', () => {
    const res = 1024;
    const texel = WORLD_SIZE / res;
    const b: Building = { x: 100, z: -60, yaw: 0, width: 8, depth: 6, storeys: 1, seed: 1 };
    const mask = clearingMask([{ x: 100, z: -60, buildings: [b] }], res, WORLD_SIZE);
    const at = (x: number, z: number): number =>
      mask[Math.floor(z / texel + res / 2) * res + Math.floor(x / texel + res / 2)] as number;
    expect(at(100, -60)).toBe(CLEAR_ALL);
    expect(at(100 + footprintRadius(b) + 2, -60)).toBe(CLEAR_TREES);
    expect(at(100 + 20, -60)).toBe(0);
  });
});
