import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadRapier, Physics, type Rapier, type TerrainGrid } from './Physics';
import {
  CAPSULE_RADIUS,
  EYE_HEIGHT,
  GRAVITY,
  JUMP_V0,
  PlayerMotor,
  WADE_CLEAR,
  type WaterProbe,
} from './PlayerMotor';

const DT = 1 / 60;
let rapier: Rapier;
let physics: Physics | null = null;

beforeAll(async () => {
  rapier = await loadRapier();
});
afterEach(() => {
  physics?.dispose();
  physics = null;
});

/** heightfield over ±64 m; `h(x, z)` sampled at the grid's sample centres */
function terrain(h: (x: number, z: number) => number): TerrainGrid {
  const res = 129;
  const worldSize = 129;
  const heights = new Float32Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = ((i + 0.5) / res - 0.5) * worldSize;
      const z = ((j + 0.5) / res - 0.5) * worldSize;
      heights[j * res + i] = h(x, z);
    }
  }
  return { heights, res, worldSize };
}

function setup(h: (x: number, z: number) => number = () => 0, water: WaterProbe | null = null) {
  physics = new Physics(rapier, terrain(h));
  const motor = new PlayerMotor(rapier, physics.world, water);
  return { physics, motor };
}

function addFixed(desc: InstanceType<Rapier['ColliderDesc']>, x: number, y: number, z: number): void {
  if (!physics) throw new Error('no physics');
  physics.world.createCollider(desc.setTranslation(x, y, z));
  physics.step();
}

function run(motor: PlayerMotor, seconds: number, vx = 0, vz = 0, jump = false): void {
  if (!physics) throw new Error('no physics');
  for (let t = 0; t < seconds; t += DT) {
    motor.step(vx, vz, jump, DT);
    physics.step();
  }
}

describe('PlayerMotor', () => {
  it('falls onto the ground and comes to rest', () => {
    const { motor } = setup();
    motor.teleport(0, 3, 0);
    run(motor, 1.5);
    expect(motor.feet.y).toBeCloseTo(0, 1);
    expect(motor.grounded).toBe(true);
    expect(motor.velY).toBe(0);
  });

  it('walks at the requested speed on flat ground', () => {
    const { motor } = setup();
    motor.teleport(0, 0.05, 0);
    run(motor, 0.2);
    const x0 = motor.feet.x;
    run(motor, 1, 4, 0);
    expect(motor.feet.x - x0).toBeCloseTo(4, 0);
  });

  it('never passes through a tree trunk', () => {
    const { motor } = setup();
    addFixed(rapier.ColliderDesc.cylinder(4, 0.4), 3, 4, 0);
    motor.teleport(0, 0.05, 0);
    let closest = Infinity;
    for (let t = 0; t < 3; t += DT) {
      motor.step(4, 0, false, DT);
      physics?.step();
      closest = Math.min(closest, Math.hypot(motor.feet.x - 3, motor.feet.z));
    }
    // pushing straight in eventually slides round the trunk — fine — but the
    // capsule must never overlap it
    expect(closest).toBeGreaterThan(0.4 + CAPSULE_RADIUS - 0.01);
  });

  it('slides along a trunk when moving diagonally into it', () => {
    const { motor } = setup();
    addFixed(rapier.ColliderDesc.cylinder(4, 0.4), 3, 4, 0);
    motor.teleport(0, 0.05, 0);
    run(motor, 2, 4, 0.5);
    expect(motor.feet.z).toBeGreaterThan(1.2);
  });

  it('steps over a small rock but not a waist-high one', () => {
    const low = setup();
    addFixed(rapier.ColliderDesc.cuboid(0.5, 0.15, 2), 3, 0.15, 0);
    low.motor.teleport(0, 0.05, 0);
    run(low.motor, 2, 4, 0);
    expect(low.motor.feet.x).toBeGreaterThan(5);
    physics?.dispose();

    const high = setup();
    addFixed(rapier.ColliderDesc.cuboid(0.5, 0.5, 2), 3, 0.5, 0);
    high.motor.teleport(0, 0.05, 0);
    run(high.motor, 2, 4, 0);
    expect(high.motor.feet.x).toBeLessThan(2.5);
  });

  it('jumps to the designed apex height', () => {
    const { motor } = setup();
    motor.teleport(0, 0.05, 0);
    run(motor, 0.3);
    let apex = motor.feet.y;
    motor.step(0, 0, true, DT);
    physics?.step();
    for (let t = 0; t < 1; t += DT) {
      motor.step(0, 0, false, DT);
      physics?.step();
      apex = Math.max(apex, motor.feet.y);
    }
    expect(apex).toBeCloseTo((JUMP_V0 * JUMP_V0) / (2 * GRAVITY), 1);
    expect(motor.grounded).toBe(true);
  });

  it('reports landing speed once when touching down', () => {
    const { motor } = setup();
    motor.teleport(0, 3, 0);
    let landings = 0;
    let speed = 0;
    for (let t = 0; t < 1.5; t += DT) {
      motor.step(0, 0, false, DT);
      physics?.step();
      if (motor.landingSpeed > 0) {
        landings++;
        speed = motor.landingSpeed;
      }
    }
    expect(landings).toBe(1);
    expect(speed).toBeGreaterThan(8);
  });

  it('stays grounded walking down a gentle slope', () => {
    const { motor } = setup((x) => -0.4 * x);
    motor.teleport(-10, 4.05, 0);
    run(motor, 0.5);
    let airborne = 0;
    for (let t = 0; t < 2; t += DT) {
      motor.step(4.6, 0, false, DT);
      physics?.step();
      if (!motor.grounded) airborne++;
    }
    expect(airborne).toBe(0);
  });

  it('cannot walk up a 60° slope', () => {
    const { motor } = setup((x) => Math.max(0, (x - 2) * Math.tan((60 * Math.PI) / 180)));
    motor.teleport(0, 0.05, 0);
    run(motor, 3, 4, 0);
    expect(motor.feet.y).toBeLessThan(1);
  });

  it('keeps the eye above deep water', () => {
    const waterY = 2;
    const { motor } = setup(() => 0, () => waterY);
    motor.teleport(0, 0.05, 0);
    run(motor, 1);
    expect(motor.feet.y + EYE_HEIGHT).toBeCloseTo(waterY + WADE_CLEAR, 3);
    expect(motor.grounded).toBe(true);
  });
});
