import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { trunkRadiusAt } from './Skeleton';
import type { SkelBranch, Skeleton } from './VegTypes';

function branch(level: number, ys: number[], radii: number[]): SkelBranch {
  return {
    level,
    pts: ys.map((y) => new Vector3(0, y, 0)),
    radii,
    dirs: ys.map(() => new Vector3(0, 1, 0)),
    len: (ys[ys.length - 1] as number) - (ys[0] as number),
    tParent: 0,
    broken: false,
  };
}

function skeleton(branches: SkelBranch[]): Skeleton {
  return { branches, anchors: [], height: 10, crownCenterY: 6, crownRadius: 2 };
}

describe('trunkRadiusAt', () => {
  it('interpolates the trunk radius, ignoring branches', () => {
    const skel = skeleton([
      branch(1, [0.8, 1.0], [3, 3]), // a low branch must not count
      branch(0, [0, 2, 4], [0.5, 0.3, 0.1]),
    ]);
    expect(trunkRadiusAt(skel, 1)).toBeCloseTo(0.4);
    expect(trunkRadiusAt(skel, 3)).toBeCloseTo(0.2);
  });

  it('is 0 above a short trunk', () => {
    expect(trunkRadiusAt(skeleton([branch(0, [0, 0.8], [0.3, 0.25])]), 1.2)).toBe(0);
  });
});
