import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadRapier, Physics, type Rapier } from './Physics';
import { FIXED_DT } from './Player';
import { Vehicle, type VehicleWorld } from './Vehicle';
import { KINDS, VEHICLES, type VehicleKind } from './VehicleSpec';

let rapier: Rapier;
let physics: Physics | null = null;

beforeAll(async () => {
  rapier = await loadRapier();
});
afterEach(() => {
  physics?.dispose();
  physics = null;
});

const DRY: VehicleWorld = { waterAt: () => -100, edge: Infinity };

function setup(kind: VehicleKind): Vehicle {
  const res = 257;
  physics = new Physics(rapier, { heights: new Float32Array(res * res), res, worldSize: 2048 });
  return new Vehicle(physics, kind, { x: 0, y: 0.3, z: 0 }, 0);
}

function run(v: Vehicle, seconds: number, world: VehicleWorld = DRY): void {
  for (let t = 0; t < seconds; t += FIXED_DT) {
    v.tick(FIXED_DT, world);
    physics!.step();
    v.record();
  }
}

describe.each(KINDS)('Vehicle (%s)', (kind) => {
  it('settles on its wheels at the height it was modelled', () => {
    const v = setup(kind);
    run(v, 3);
    const t = v.body.translation();
    expect(t.y).toBeCloseTo(0, 1);
    expect(v.upright).toBe(true);
    expect(Math.abs(v.body.linvel().y)).toBeLessThan(0.05);
    const w = v.wheel(0, { steer: 0, spin: 0, hubY: 0 });
    expect(w.hubY).toBeCloseTo(VEHICLES[kind].wheels[0]!.at.y, 1);
  });

  it('drives forward along −z, up to its top speed', () => {
    const v = setup(kind);
    run(v, 1);
    v.driven = true;
    v.controls.throttle = 1;
    run(v, 3);
    expect(v.speed).toBeGreaterThan(8);
    expect(v.body.translation().z).toBeLessThan(-10);
    expect(Math.abs(v.body.translation().x)).toBeLessThan(0.5);
    run(v, 20);
    expect(v.speed).toBeLessThan(VEHICLES[kind].topSpeed + 1);
    expect(v.speed).toBeGreaterThan(VEHICLES[kind].topSpeed - 3);
  });

  it('steers left and right', () => {
    for (const steer of [-1, 1]) {
      const v = setup(kind);
      run(v, 1);
      v.driven = true;
      v.controls.throttle = 0.6;
      v.controls.steer = steer;
      run(v, 2);
      // yaw grows turning left
      expect(Math.sign(v.yaw)).toBe(-steer);
      expect(v.upright).toBe(true);
      physics!.dispose();
      physics = null;
    }
  });

  it('brakes to a stop, then reverses', () => {
    const v = setup(kind);
    run(v, 1);
    v.driven = true;
    v.controls.throttle = 1;
    run(v, 3);
    v.controls.throttle = -1;
    run(v, 3);
    expect(v.speed).toBeLessThan(0);
    run(v, 4);
    expect(v.speed).toBeLessThan(-3);
  });

  it('stays put with nobody driving', () => {
    const v = setup(kind);
    run(v, 1);
    v.body.setLinvel({ x: 0, y: 0, z: -5 }, true);
    run(v, 3);
    expect(Math.abs(v.speed)).toBeLessThan(0.1);
  });
});

describe('Vehicle', () => {
  it('holds on a hill with the driver off the throttle', () => {
    const res = 257;
    const heights = new Float32Array(res * res);
    // rising 1 in 5 towards −z
    for (let j = 0; j < res; j++) heights.fill(((res / 2 - j) * 8) / 5, j * res, (j + 1) * res);
    physics = new Physics(rapier, { heights, res, worldSize: 2048 });
    const v = new Vehicle(physics, 'buggy', { x: 0, y: 1.5, z: 0 }, 0);
    run(v, 2);
    v.driven = true;
    run(v, 4);
    expect(Math.abs(v.speed)).toBeLessThan(0.3);
  });

  it('floats in deep water rather than sinking out of sight', () => {
    const lake: VehicleWorld = { waterAt: () => 1.5, edge: Infinity };
    const v = setup('buggy');
    run(v, 4, lake);
    expect(v.body.translation().y).toBeGreaterThan(0.6);
  });

  it('is kept inside the world edge', () => {
    const edged: VehicleWorld = { waterAt: () => -100, edge: 20 };
    const v = setup('buggy');
    run(v, 1, edged);
    v.driven = true;
    v.controls.throttle = 1;
    run(v, 6, edged);
    expect(v.body.translation().z).toBeGreaterThanOrEqual(-20.01);
  });

  it('stays put while the physics only refreshes its queries', () => {
    const v = setup('buggy');
    v.body.setLinvel({ x: 0, y: -3, z: 2 }, true);
    for (let i = 0; i < 20; i++) physics!.refresh();
    const { x, y, z } = v.body.translation();
    expect([x, y, z].map((n) => +n.toFixed(6))).toEqual([0, 0.3, 0]);
  });

  it('gets back on its wheels', () => {
    const v = setup('rover');
    v.body.setRotation({ x: 1, y: 0, z: 0, w: 0 }, true);
    run(v, 2);
    expect(v.upright).toBe(false);
    v.right();
    run(v, 2);
    expect(v.upright).toBe(true);
  });

  it('is wrecked when worn through, and goes nowhere', () => {
    const v = setup('buggy');
    run(v, 1);
    v.driven = true;
    v.hurt(VEHICLES.buggy.hp, { x: 0, y: 0, z: 0 });
    expect(v.wrecked).toBe(true);
    v.controls.throttle = 1;
    run(v, 2);
    expect(Math.abs(v.speed)).toBeLessThan(0.1);
  });
});
