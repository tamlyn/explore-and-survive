import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boxColliderDesc, type Hittable, loadRapier, Physics, type Rapier } from './Physics';
import { FIXED_DT } from './Player';
import type { Vehicle } from './Vehicle';
import type { VehicleView } from './VehicleModels';
import { ENTER_REACH, Vehicles } from './Vehicles';
import { VEHICLES } from './VehicleSpec';

let rapier: Rapier;
let physics: Physics | null = null;

beforeAll(async () => {
  rapier = await loadRapier();
});
afterEach(() => {
  physics?.dispose();
  physics = null;
});

const VIEW: VehicleView = { place: () => {}, wear: () => {}, dispose: () => {} };

class Dummy implements Hittable {
  taken: number[] = [];
  hurt(damage: number): void {
    this.taken.push(damage);
  }
}

/** rising towards −z by `slope` (m per m) */
function setup(water = -100, immune?: (t: Hittable) => boolean, slope = 0): { fleet: Vehicles; wrecks: Vehicle[]; rams: number[] } {
  const res = 129;
  const worldSize = 1024;
  const heights = new Float32Array(res * res);
  for (let j = 0; j < res; j++) heights.fill(-((j + 0.5) / res - 0.5) * worldSize * slope, j * res, (j + 1) * res);
  physics = new Physics(rapier, { heights, res, worldSize });
  const wrecks: Vehicle[] = [];
  const rams: number[] = [];
  const fleet = new Vehicles(
    physics,
    { waterAt: () => water, groundAt: (_, z) => -z * slope, edge: 500 },
    { create: () => VIEW },
    { rammed: (_, d) => rams.push(d), wrecked: (v) => wrecks.push(v) },
    immune,
  );
  return { fleet, wrecks, rams };
}

function run(fleet: Vehicles, seconds: number): void {
  for (let t = 0; t < seconds; t += FIXED_DT) {
    fleet.tick(FIXED_DT);
    physics!.step();
    fleet.record();
  }
}

/** a solid post at (x, z) that a car can hit */
function post(x: number, z: number, target: Hittable): void {
  const c = physics!.addCollider(boxColliderDesc(physics!.rapier, { x, y: 1, z, hx: 0.5, hy: 1, hz: 0.5, q: [0, 0, 0, 1] }), 'stone');
  physics!.tag(c, null, target);
  physics!.step();
}

describe('Vehicles', () => {
  it('puts a car down where it was asked, if there is room', () => {
    const { fleet } = setup();
    const v = fleet.place('buggy', 10, 20, 0)!;
    const t = v.body.translation();
    expect(t.x).toBeCloseTo(10);
    expect(t.z).toBeCloseTo(20);
  });

  it('puts it beside whatever stands in the way', () => {
    const { fleet } = setup();
    post(0, 0, new Dummy());
    const t = fleet.place('rover', 0, 0, 0)!.body.translation();
    expect(Math.hypot(t.x, t.z)).toBeGreaterThan(1);
  });

  it('turns it to find room to drive off', () => {
    const { fleet } = setup();
    post(0, -4, new Dummy());
    const v = fleet.place('buggy', 0, 0, 0)!;
    const t = v.body.translation();
    expect(t.x).toBeCloseTo(0);
    expect(Math.abs(v.yaw)).toBeGreaterThan(1);
  });

  it('faces the way asked up a gentle slope', () => {
    const { fleet } = setup(-100, undefined, 1 / 8);
    const v = fleet.place('rover', 0, 0, 0)!;
    const t = v.body.translation();
    expect(Math.hypot(t.x, t.z)).toBeLessThan(0.1);
    expect(v.yaw).toBeCloseTo(0);
  });

  it('puts nothing down in a lake', () => {
    const { fleet } = setup(5);
    expect(fleet.place('buggy', 0, 0, 0)).toBeNull();
  });

  it('lets the player in from beside it, not from afar', () => {
    const { fleet } = setup();
    const v = fleet.place('buggy', 0, 0, 0)!;
    run(fleet, 0.5);
    const side = VEHICLES.buggy.hull.half.x + ENTER_REACH / 2;
    expect(fleet.reachable({ x: -side, y: 0, z: 0 })).toBe(v);
    expect(fleet.reachable({ x: -side - ENTER_REACH, y: 0, z: 0 })).toBeNull();
    expect(fleet.reachable({ x: 0, y: 10, z: 0 })).toBeNull();
  });

  it('rams what it drives into, harder the faster, and is hurt a little', () => {
    const { fleet, rams } = setup();
    const v = fleet.place('buggy', 0, 0, 0)!;
    const robot = new Dummy();
    post(0, -40, robot);
    run(fleet, 0.5);
    v.driven = true;
    v.controls.throttle = 1;
    run(fleet, 5);
    expect(robot.taken.length).toBe(1);
    expect(robot.taken[0]).toBeGreaterThan(40);
    expect(rams).toEqual(robot.taken);
    expect(v.health.hp).toBeLessThan(VEHICLES.buggy.hp);
  });

  it('hurts nothing it only passes by', () => {
    const { fleet } = setup();
    const v = fleet.place('buggy', 0, 0, 0)!;
    const beside = new Dummy();
    post(VEHICLES.buggy.hull.half.x + 0.7, -30, beside);
    run(fleet, 0.5);
    v.driven = true;
    v.controls.throttle = 1;
    run(fleet, 4);
    expect(v.body.translation().z).toBeLessThan(-40);
    expect(beside.taken).toEqual([]);
  });

  it('rams what it reverses into', () => {
    const { fleet } = setup();
    const v = fleet.place('buggy', 0, 0, 0)!;
    const behind = new Dummy();
    post(0, 20, behind);
    run(fleet, 0.5);
    v.driven = true;
    v.controls.throttle = -1;
    run(fleet, 5);
    expect(behind.taken.length).toBe(1);
  });

  it('does no harm at a crawl', () => {
    const { fleet } = setup();
    const v = fleet.place('buggy', 0, 0, 0)!;
    const wall = new Dummy();
    post(0, -4, wall);
    run(fleet, 0.5);
    v.driven = true;
    v.controls.throttle = 0.2;
    run(fleet, 3);
    expect(wall.taken).toEqual([]);
  });

  it('never rams the driver', () => {
    const driver = new Dummy();
    const { fleet } = setup(-100, (t) => t === driver);
    const v = fleet.place('buggy', 0, 0, 0)!;
    post(0, -40, driver);
    run(fleet, 0.5);
    v.driven = true;
    v.controls.throttle = 1;
    run(fleet, 5);
    expect(driver.taken).toEqual([]);
  });

  it('says when a car is wrecked', () => {
    const { fleet, wrecks } = setup();
    const v = fleet.place('buggy', 0, 0, 0)!;
    v.hurt(100, { x: 0, y: 0, z: 0 });
    expect(wrecks).toEqual([]);
    v.hurt(VEHICLES.buggy.hp, { x: 0, y: 0, z: 0 });
    v.hurt(10, { x: 0, y: 0, z: 0 });
    expect(wrecks).toEqual([v]);
  });
});
