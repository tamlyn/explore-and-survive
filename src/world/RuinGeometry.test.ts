import { describe, expect, it } from 'vitest';
import { blockGeometry } from './RuinGeometry';
import type { Block, Ground } from './RuinPlan';

const flat: Ground = { height: () => 0, water: () => -1 };
const yaw = 0.7;
const q: Block['q'] = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

function block(x: number, z: number): Block {
  return { x, y: 1, z, hx: 0.5, hy: 1, hz: 0.25, q, solid: true };
}

describe('blockGeometry', () => {
  it('winds every face outward and skips the buried bottom', () => {
    const geo = blockGeometry([block(3, -2)], flat);
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    const idx = geo.getIndex()!;
    expect(idx.count / 3).toBe(10);
    for (let t = 0; t < idx.count; t += 3) {
      const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      const e1 = [p.getX(b) - p.getX(a), p.getY(b) - p.getY(a), p.getZ(b) - p.getZ(a)];
      const e2 = [p.getX(c) - p.getX(a), p.getY(c) - p.getY(a), p.getZ(c) - p.getZ(a)];
      const cross = [
        e1[1]! * e2[2]! - e1[2]! * e2[1]!,
        e1[2]! * e2[0]! - e1[0]! * e2[2]!,
        e1[0]! * e2[1]! - e1[1]! * e2[0]!,
      ];
      const dot = cross[0]! * n.getX(a) + cross[1]! * n.getY(a) + cross[2]! * n.getZ(a);
      expect(dot).toBeGreaterThan(0);
      expect(n.getY(a)).toBeGreaterThan(-0.5);
    }
  });

  it('continues the texture across neighbouring blocks of a wall', () => {
    // two blocks side by side along the wall's local x
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const geo = blockGeometry([block(0, 0), block(c, -s)], flat);
    const p = geo.getAttribute('position');
    const n = geo.getAttribute('normal');
    const uv = geo.getAttribute('uv');
    // where the blocks meet, coincident vertices on faces pointing the same
    // way must carry the same uv
    const byPlace = new Map<string, number[]>();
    for (let v = 0; v < p.count; v++) {
      const key = [p.getX(v), p.getY(v), p.getZ(v), n.getX(v), n.getY(v), n.getZ(v)]
        .map((x) => x.toFixed(4))
        .join();
      byPlace.set(key, [...(byPlace.get(key) ?? []), v]);
    }
    const pairs = [...byPlace.values()].filter((vs) => vs.length > 1);
    expect(pairs.length).toBeGreaterThanOrEqual(6);
    for (const [a, b] of pairs) {
      expect(uv.getX(a!)).toBeCloseTo(uv.getX(b!), 5);
      expect(uv.getY(a!)).toBeCloseTo(uv.getY(b!), 5);
    }
  });

  it('records the ground height under each vertex', () => {
    const geo = blockGeometry([block(0, 0)], { height: (x) => x * 0.1, water: () => -1 });
    const p = geo.getAttribute('position');
    const g = geo.getAttribute('ground');
    for (let v = 0; v < p.count; v++) expect(g.getX(v)).toBeCloseTo(p.getX(v) * 0.1, 5);
  });
});
