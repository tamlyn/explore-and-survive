import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadRapier, Physics, type Rapier } from './Physics';
import { ObstacleField, ObstacleStreamer } from './Obstacles';
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
    const hit = traceShot({ physics: p }, { x: 0, y: 10, z: 0 }, down45, 100);
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
    expect(traceShot({ physics: p }, { x: 0, y: 1.7, z: 0 }, fwd, 100)?.surface).toBe('wood');
    expect(traceShot({ physics: p }, { x: 0, y: 1.7, z: 0 }, fwd, 15)).toBeNull();
  });

  it('stops at the water surface', () => {
    const p = flatWorld();
    const hit = traceShot({ physics: p, waterAt: () => 2 }, { x: 0, y: 10, z: 0 }, down45, 100);
    expect(hit?.surface).toBe('water');
    expect(hit?.y).toBe(2);
    expect(hit?.z).toBeCloseTo(-8, 4);
  });

  it('hits obstacles beyond the stream radius, and the nearest one first', () => {
    const p = flatWorld();
    const trunk = { kind: 'trunk' as const, radius: 0.5, height: 10 };
    const at = (x: number, z: number): number[] => [x, 0, z, 1];
    const A = new Float32Array([...at(0, -12), ...at(0.3, -55), ...at(30, -30)]);
    const B = new Float32Array(12);
    const field = new ObstacleField([{ A, B, count: 3 }], new Map([[0, trunk]]));
    new ObstacleStreamer(p, field, 20).update(0, 0);
    p.step();
    const fwd = { x: 0, y: 0, z: -1 };
    const world = { physics: p, obstacles: field };
    // streamed and also in the field: the nearest wins either way
    expect(traceShot(world, { x: 0, y: 1.7, z: 0 }, fwd, 100)?.z).toBeCloseTo(-11.5, 3);
    // from behind the first trunk, the next is 40 m out — not streamed
    const far = traceShot(world, { x: 0, y: 1.7, z: -14 }, fwd, 100);
    expect(far?.surface).toBe('wood');
    expect(far?.z).toBeCloseTo(-55 + Math.sqrt(0.25 - 0.09), 3);
    expect(far?.normal.z).toBeGreaterThan(0.5);
  });

  it('ignores the shooter', () => {
    const p = flatWorld();
    const motor = new PlayerMotor(rapier, p.world);
    motor.teleport(0, 0, 0);
    p.step();
    const hit = traceShot({ physics: p, shooter: motor.collider }, { x: 0, y: 1.7, z: 0 }, { x: 0, y: -1, z: 0 }, 100);
    expect(hit?.surface).toBe('ground');
    expect(hit?.y).toBeCloseTo(0, 4);
  });
});
