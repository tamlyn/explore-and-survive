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
  const sites = planRuins(flat, 21, spawn);
  const props = planProps(sites, flat, 21);

  it('is deterministic and dresses most buildings', () => {
    expect(planProps(sites, flat, 21)).toEqual(props);
    const buildings = sites.flatMap((s) => s.buildings).length;
    expect(props.filter((p) => p.kind !== 'car').length).toBeGreaterThan(buildings * 1.5);
    expect(props.some((p) => p.kind === 'car')).toBe(true);
  });

  it('keeps clutter clear of walls and of each other', () => {
    const walls = sites.flatMap((s) => s.buildings.flatMap((b) => buildingBlocks(b, flat))).filter((b) => b.solid);
    const clashes: string[] = [];
    for (const p of props) {
      const r = PROP_RADIUS[p.kind];
      for (const w of walls) {
        if (Math.hypot(w.x - p.x, w.z - p.z) < 12 && distanceToBlock(w, p.x, p.z) <= r) clashes.push(`${p.kind} in a wall`);
      }
      for (const o of props) {
        if (o !== p && Math.hypot(o.x - p.x, o.z - p.z) <= r + PROP_RADIUS[o.kind]) clashes.push(`${p.kind} on ${o.kind}`);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('leaves a clear way through every doorway', () => {
    const blocked: string[] = [];
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
    expect(blocked).toEqual([]);
  });

  it('parks cars clear of the buildings, on the ground', () => {
    for (const car of props.filter((p) => p.kind === 'car')) {
      for (const b of sites.flatMap((s) => s.buildings)) {
        expect(Math.hypot(car.x - b.x, car.z - b.z)).toBeGreaterThan(footprintRadius(b) + PROP_RADIUS.car);
      }
      expect(car.y).toBeCloseTo(200, 0);
    }
  });

  it('stands upright on flat ground, tyres sometimes on their side', () => {
    const tilt = (q: number[]): number => 1 - 2 * (q[0]! ** 2 + q[2]! ** 2); // up · rotated up
    for (const p of props.filter((p) => p.kind !== 'tyre')) expect(tilt(p.q)).toBeCloseTo(1, 5);
    const tyres = props.filter((p) => p.kind === 'tyre').map((p) => tilt(p.q));
    expect(tyres.some((t) => Math.abs(t) < 1e-5)).toBe(true);
  });
});
