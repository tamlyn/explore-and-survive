import { describe, expect, it } from 'vitest';
import { CLEAR_ALL, CLEAR_TREES, clearingMask, settlementClearings, trail } from './Clearing';
import type { Building } from './RuinPlan';
import { WORLD_SIZE } from './WorldConst';

describe('clearingMask', () => {
  it('clears everything under a building, prop or beacon and trees around it', () => {
    const res = 4096;
    const texel = WORLD_SIZE / res;
    const b: Building = { x: 100, z: -60, yaw: 0, width: 8, depth: 6, storeys: 1, seed: 1 };
    const car = { kind: 'car' as const, x: -300, z: 40, y: 0, q: [0, 0, 0, 1] as [number, number, number, number] };
    const mask = clearingMask(settlementClearings([{ x: 100, z: -60, buildings: [b] }], [car], [{ site: 0, x: 500, y: 0, z: 500 }]), res, WORLD_SIZE);
    const at = (x: number, z: number): number =>
      mask[Math.floor(z / texel + res / 2) * res + Math.floor(x / texel + res / 2)] as number;
    expect(at(100, -60)).toBe(CLEAR_ALL);
    expect(at(100 + 5 + 4, -60)).toBe(CLEAR_TREES);
    expect(at(100 + 20, -60)).toBe(0);
    expect(at(-300, 40)).toBe(CLEAR_ALL);
    expect(at(-300, 40 + 6)).toBe(0);
    expect(at(500, 500)).toBe(CLEAR_ALL);
    expect(at(503, 500)).toBe(CLEAR_TREES);
  });

  it('clears trees along a trail but leaves the ground', () => {
    const res = 4096;
    const mask = clearingMask(trail({ x: 0, z: 0 }, { x: 40, z: -30 }), res, WORLD_SIZE);
    const at = (x: number, z: number): number => mask[Math.floor(z + res / 2) * res + Math.floor(x + res / 2)] as number;
    for (const t of [0, 0.3, 0.77, 1]) expect(at(40 * t, -30 * t)).toBe(CLEAR_TREES);
    expect(at(20, -5)).toBe(0);
  });
});
