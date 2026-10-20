import { describe, expect, it } from 'vitest';
import { planProps, PROP_RADIUS } from './PropPlan';
import { alongWall, type Block, buildingBlocks, doorway, footprintRadius, type Ground, planRuins, wallRuns } from './RuinPlan';

const flat: Ground = { height: () => 200, water: () => 0 };
const spawn = { x: 0, z: 0, yaw: 0 };

/** horizontal distance from (x, z) to a yawed block's footprint */
function distanceToBlock(b: Block, x: number, z: number): number {
  // yaw from the y-only quaternion
  const yaw = 2 * Math.atan2(b.q[1], b.q[3]);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const dx = x - b.x;
  const dz = z - b.z;
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.hypot(Math.max(0, Math.abs(lx) - b.hx), Math.max(0, Math.abs(lz) - b.hz));
}

describe('planProps', () => {
  // a few worlds, so close neighbours turn up
  const worlds = [21, 22, 23].map((seed) => {
    const sites = planRuins(flat, seed, spawn);
    return { seed, sites, props: planProps(sites, flat, seed) };
  });

  it('is deterministic and dresses most buildings', () => {
    for (const { seed, sites, props } of worlds) {
      expect(planProps(sites, flat, seed)).toEqual(props);
      const buildings = sites.flatMap((s) => s.buildings).length;
      expect(props.filter((p) => p.kind !== 'car').length).toBeGreaterThan(buildings * 1.5);
      expect(props.some((p) => p.kind === 'car')).toBe(true);
    }
  });

  it('keeps clutter clear of walls and of each other', () => {
    const clashes: string[] = [];
    for (const { sites, props } of worlds) {
      const walls = sites.flatMap((s) => s.buildings.flatMap((b) => buildingBlocks(b, flat))).filter((b) => b.solid);
      for (const p of props) {
        const r = PROP_RADIUS[p.kind];
        for (const w of walls) {
          if (Math.hypot(w.x - p.x, w.z - p.z) < 12 && distanceToBlock(w, p.x, p.z) <= r) clashes.push(`${p.kind} in a wall`);
        }
        for (const o of props) {
          if (o !== p && Math.hypot(o.x - p.x, o.z - p.z) <= r + PROP_RADIUS[o.kind]) clashes.push(`${p.kind} on ${o.kind}`);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it("keeps one house's clutter out of its close neighbour's walls", () => {
    const clashes: number[] = [];
    for (let seed = 0; seed < 40; seed++) {
      // walls 3 m apart
      const site = {
        x: 0,
        z: 0,
        buildings: [
          { x: 0, z: 0, yaw: 0, width: 8, depth: 6, storeys: 1, seed },
          { x: 0, z: 9, yaw: 0, width: 8, depth: 6, storeys: 1, seed: seed + 100 },
        ],
      };
      const walls = site.buildings.flatMap((b) => buildingBlocks(b, flat)).filter((b) => b.solid);
      for (const p of planProps([site], flat, seed)) {
        if (walls.some((w) => distanceToBlock(w, p.x, p.z) <= PROP_RADIUS[p.kind])) clashes.push(seed);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('leaves a clear way through every doorway', () => {
    const blocked: string[] = [];
    for (const { sites, props } of worlds) {
      for (const b of sites.flatMap((s) => s.buildings)) {
        const door = doorway(b, flat);
        if (!door) continue;
        const w = wallRuns(b)[door.wall]!;
        const u = ((door.j0 + door.j1) / 2) * (w.length / w.columns);
        // a player-wide path from 1.5 m outside to 1.5 m inside
        for (let out = -1.5; out <= 1.5; out += 0.25) {
          const p = alongWall(b, w, u, out);
          for (const prop of props) {
            if (Math.hypot(prop.x - p.x, prop.z - p.z) < PROP_RADIUS[prop.kind] + 0.4) blocked.push(prop.kind);
          }
        }
      }
    }
    expect(blocked).toEqual([]);
  });

  it('parks cars clear of the buildings, on the ground', () => {
    for (const { sites, props } of worlds) {
      for (const car of props.filter((p) => p.kind === 'car')) {
        for (const b of sites.flatMap((s) => s.buildings)) {
          expect(Math.hypot(car.x - b.x, car.z - b.z)).toBeGreaterThan(footprintRadius(b) + PROP_RADIUS.car);
        }
        expect(car.y).toBeCloseTo(200, 0);
      }
    }
  });

  it('stands upright on flat ground', () => {
    // up · rotated up
    for (const p of worlds.flatMap((w) => w.props)) expect(1 - 2 * (p.q[0] ** 2 + p.q[2] ** 2)).toBeCloseTo(1, 5);
  });
});
