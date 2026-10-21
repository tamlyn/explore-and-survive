import { describe, expect, it } from 'vitest';
import { pathLift } from './Bookmarks';

describe('pathLift', () => {
  // a level path at y = 10 over a ridge rising to 50 between x = 40 and 60
  const path = Array.from({ length: 101 }, (_, i) => ({ x: i, y: 10, z: 0 }));
  const floor = (x: number): number => (x >= 40 && x <= 60 ? 50 : 0);
  const lift = pathLift(path, floor, 20);

  it('clears the ground everywhere', () => {
    path.forEach((p, i) => expect(p.y + lift[i]!).toBeGreaterThanOrEqual(floor(p.x)));
  });

  it('eases up and down instead of jumping', () => {
    for (let i = 1; i < lift.length; i++) expect(Math.abs(lift[i]! - lift[i - 1]!)).toBeLessThan(4);
  });

  it('leaves the path alone away from the ridge', () => {
    expect(lift[10]).toBe(0);
    expect(lift[90]).toBe(0);
  });
});
