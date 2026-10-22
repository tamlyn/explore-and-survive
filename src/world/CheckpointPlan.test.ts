import { describe, expect, it } from 'vitest';
import { BEACON, beaconBoxes, planCheckpoints } from './CheckpointPlan';
import { planProps, PROP_RADIUS } from './PropPlan';
import { footprintRadius, type Ground, planRuins, type RuinSite } from './RuinPlan';

const flat: Ground = { height: () => 200, water: () => 0 };
const spawn = { x: 0, z: 0, yaw: 0 };

describe('planCheckpoints', () => {
  const worlds = [21, 22, 23].map((seed) => {
    const sites = planRuins(flat, seed, spawn);
    const props = planProps(sites, flat, seed);
    return { sites, props, checkpoints: planCheckpoints(sites, props, flat) };
  });

  it('puts one in every settlement, near its middle', () => {
    for (const { sites, checkpoints } of worlds) {
      expect(checkpoints.map((c) => c.site)).toEqual(sites.map((_, i) => i));
      for (const c of checkpoints) {
        const s = sites[c.site]!;
        expect(Math.hypot(c.x - s.x, c.z - s.z)).toBeLessThanOrEqual(30);
        expect(c.y).toBe(200);
      }
    }
  });

  it('keeps clear of houses and props', () => {
    for (const { sites, props, checkpoints } of worlds) {
      for (const c of checkpoints) {
        for (const b of sites[c.site]!.buildings) {
          expect(Math.hypot(b.x - c.x, b.z - c.z)).toBeGreaterThan(footprintRadius(b) + BEACON.plinth.half);
        }
        for (const p of props) {
          expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeGreaterThan(PROP_RADIUS[p.kind] + BEACON.plinth.half);
        }
      }
    }
  });

  it('skips settlements with no dry, level ground', () => {
    const site: RuinSite = { x: 0, z: 0, buildings: [] };
    const wet: Ground = { height: () => 0, water: () => 1 };
    const steep: Ground = { height: (x) => x, water: () => -1e9 };
    expect(planCheckpoints([site], [], wet)).toEqual([]);
    expect(planCheckpoints([site], [], steep)).toEqual([]);
    expect(planCheckpoints([site], [], flat)).toEqual([{ site: 0, x: 0, y: 200, z: 0 }]);
  });
});

describe('beaconBoxes', () => {
  it('stands the mast on the plinth, on the ground', () => {
    const [plinth, mast] = beaconBoxes({ site: 0, x: 5, y: 10, z: -3 });
    expect(plinth!.y + plinth!.hy).toBeCloseTo(10 + BEACON.plinth.height);
    // deep enough for the steepest ground a plinth may stand on
    expect(plinth!.y - plinth!.hy).toBeLessThan(10 - 0.35);
    expect(mast!.y - mast!.hy).toBeCloseTo(plinth!.y + plinth!.hy);
    expect(mast!).toMatchObject({ x: 5, z: -3 });
  });
});
