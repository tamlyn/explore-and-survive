import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadRapier, Physics, type Rapier } from './Physics';
import { PlayerMotor } from './PlayerMotor';
import { traceShot } from './Shot';

let rapier: Rapier;
let physics: Physics | null = null;
beforeAll(async () => {
  rapier = await loadRapier();
});
afterEach(() => {
  physics?.dispose();
  physics = null;
});

function flatWorld(): Physics {
  const res = 129;
  physics = new Physics(rapier, { heights: new Float32Array(res * res), res, worldSize: res });
  return physics;
}

const down45 = { x: 0, y: -Math.SQRT1_2, z: -Math.SQRT1_2 };

describe('traceShot', () => {
  it('hits the ground with an upward normal', () => {
    const p = flatWorld();
    const hit = traceShot(p, { x: 0, y: 10, z: 0 }, down45, 100, null);
    expect(hit?.surface).toBe('ground');
    expect(hit?.y).toBeCloseTo(0, 4);
    expect(hit?.z).toBeCloseTo(-10, 4);
    expect(hit?.normal.y).toBeCloseTo(1, 4);
  });

  it('reports the surface of tagged obstacles and misses beyond range', () => {
    const p = flatWorld();
    p.addCollider(rapier.ColliderDesc.cylinder(5, 0.5).setTranslation(0, 5, -20), 'wood');
    p.step();
    const fwd = { x: 0, y: 0, z: -1 };
    expect(traceShot(p, { x: 0, y: 1.7, z: 0 }, fwd, 100, null)?.surface).toBe('wood');
    expect(traceShot(p, { x: 0, y: 1.7, z: 0 }, fwd, 15, null)).toBeNull();
  });

  it('stops at the water surface', () => {
    const p = flatWorld();
    const hit = traceShot(p, { x: 0, y: 10, z: 0 }, down45, 100, () => 2);
    expect(hit?.surface).toBe('water');
    expect(hit?.y).toBe(2);
    expect(hit?.z).toBeCloseTo(-8, 4);
  });

  it('ignores the shooter', () => {
    const p = flatWorld();
    const motor = new PlayerMotor(rapier, p.world);
    motor.teleport(0, 0, 0);
    p.step();
    const hit = traceShot(p, { x: 0, y: 1.7, z: 0 }, { x: 0, y: -1, z: 0 }, 100, null, motor.collider);
    expect(hit?.surface).toBe('ground');
    expect(hit?.y).toBeCloseTo(0, 4);
  });
});
