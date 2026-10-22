import { describe, expect, it } from 'vitest';
import { compass, heading, Places } from './Places';
import type { Prop } from './PropPlan';
import type { Building, RuinSite } from './RuinPlan';

const house = (x: number, z: number, yaw = 0): Building => ({ x, z, yaw, width: 8, depth: 4, storeys: 1, seed: 0 });
const sites: RuinSite[] = [
  { x: 0, z: -100, buildings: [house(0, -100), house(10, -100, Math.PI / 2)] },
  { x: 200, z: 0, buildings: [house(200, 0)] },
];
const car: Prop = { kind: 'car', x: 0, y: 0, z: -115, q: [0, 0, 0, 1] };
const places = new Places(sites, [car], [{ site: 1, x: 190, y: 0, z: 10 }]);

describe('heading', () => {
  it('runs clockwise from north, which is −z', () => {
    expect(heading(0, -1)).toBeCloseTo(0);
    expect(heading(1, 0)).toBeCloseTo(90);
    expect(heading(0, 1)).toBeCloseTo(180);
    expect(heading(-1, 0)).toBeCloseTo(270);
  });

  it('names the nearest compass point', () => {
    expect(compass(0)).toBe('N 0°');
    expect(compass(47)).toBe('NE 47°');
    expect(compass(350)).toBe('N 350°');
  });
});

describe('Places', () => {
  it('names settlements in planning order, closest first', () => {
    const [a, b] = places.nearest(0, 0, 2);
    expect(a).toMatchObject({ name: 'S1', distance: 100 });
    expect(a!.heading).toBeCloseTo(0);
    expect(b).toMatchObject({ name: 'S2', distance: 200 });
    expect(b!.heading).toBeCloseTo(90);
  });

  it('names the building a point is on, turned or not', () => {
    expect(places.at(3.9, -100)).toBe('S1.B1');
    // the second house is turned a quarter, so it is long along z
    expect(places.at(10, -103.9)).toBe('S1.B2');
    expect(places.at(13.9, -100)).toBeNull();
  });

  it('names props by their settlement', () => {
    expect(places.at(1, -115)).toBe('S1 car');
  });

  it('names beacons by their settlement', () => {
    expect(places.at(190.5, 10)).toBe('S2 beacon');
    expect(places.name(1)).toBe('S2');
  });
});
