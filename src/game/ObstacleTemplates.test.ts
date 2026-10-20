import { BoxGeometry, IcosahedronGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { hullPoints } from './ObstacleTemplates';

describe('hullPoints', () => {
  it('reduces a box to its corners', () => {
    const pts = hullPoints(new BoxGeometry(2, 1, 1, 3, 3, 3));
    expect(pts.length / 3).toBe(8);
  });

  it('keeps every point that lies on the hull of a convex mesh', () => {
    const ico = new IcosahedronGeometry(1, 0);
    expect(hullPoints(ico).length / 3).toBe(12);
  });
});
