import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  instanceToWorld,
  ObstacleField,
  ObstacleStreamer,
  type InstanceArrays,
  type ObstacleTemplate,
} from './Obstacles';
import { loadRapier, Physics, type Rapier } from './Physics';
import { CAPSULE_RADIUS, PlayerMotor } from './PlayerMotor';

let rapier: Rapier;
let physics: Physics | null = null;
beforeAll(async () => {
  rapier = await loadRapier();
});
afterEach(() => {
  physics?.dispose();
  physics = null;
});

interface Inst {
  x: number;
  y?: number;
  z: number;
  s?: number;
  yaw?: number;
  leanX?: number;
  leanZ?: number;
  id: number;
}

function arrays(list: Inst[]): InstanceArrays {
  const A = new Float32Array(list.length * 4);
  const B = new Float32Array(list.length * 4);
  list.forEach((o, i) => {
    A.set([o.x, o.y ?? 0, o.z, o.s ?? 1], i * 4);
    B.set([o.yaw ?? 0, o.leanX ?? 0, o.leanZ ?? 0, o.id], i * 4);
  });
  return { A, B, count: list.length };
}

const TRUNK: ObstacleTemplate = { kind: 'trunk', radius: 0.4, height: 8 };
/** 1 m cube sitting on its base */
const CUBE: ObstacleTemplate = {
  kind: 'hull',
  surface: 'stone',
  points: new Float32Array([
    -0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 1, -0.5, 0.5, 1, -0.5, -0.5, 1, 0.5, 0.5, 1,
    0.5,
  ]),
};
const TEMPLATES = new Map<number, ObstacleTemplate>([
  [0, TRUNK], // cls 0 variant 0
  [8 * 20, CUBE], // StoneL variant 0
]);

describe('instanceToWorld', () => {
  it('scales, yaws and shears like the vegetation shader', () => {
    const { A, B } = arrays([{ x: 10, y: 5, z: -3, s: 2, yaw: Math.PI / 2, leanX: 0.1, leanZ: -0.2, id: 0 }]);
    const out = { x: 0, y: 0, z: 0 };
    instanceToWorld(1, 2, 0, A, B, 0, out);
    // scaled (2, 4, 0); yaw 90°: rx = x·cos + z·sin = 0, rz = z·cos − x·sin = −2;
    // shear adds lean·y: x += 0.4, z += −0.8
    expect(out.x).toBeCloseTo(10 + 0 + 0.4);
    expect(out.y).toBeCloseTo(5 + 4);
    expect(out.z).toBeCloseTo(-3 - 2 - 0.8);
  });
});

describe('ObstacleField', () => {
  it('finds exactly the obstacles within the radius', () => {
    const list: Inst[] = [];
    for (let i = 0; i < 400; i++) list.push({ x: Math.sin(i * 12.9898) * 300, z: Math.cos(i * 78.233) * 300, id: 0 });
    const field = new ObstacleField([arrays(list)], TEMPLATES);
    const got = field.near(20, -15, 70).sort((a, b) => a - b);
    const want = list
      .map((o, i) => [i, Math.hypot(o.x - 20, o.z + 15)] as const)
      .filter(([, d]) => d <= 70)
      .map(([i]) => i);
    expect(got).toEqual(want);
  });

  it('skips instances without a template (understory, pebbles)', () => {
    const field = new ObstacleField([arrays([{ x: 0, z: 0, id: 8 * 11 }, { x: 1, z: 0, id: 0 }])], TEMPLATES);
    expect(field.size).toBe(1);
  });
});

describe('ObstacleStreamer', () => {
  function flatWorld(): Physics {
    const res = 257;
    physics = new Physics(rapier, { heights: new Float32Array(res * res), res, worldSize: res });
    return physics;
  }

  it('adds colliders near the focus and drops them once it moves away', () => {
    const p = flatWorld();
    const field = new ObstacleField(
      [arrays([{ x: 5, z: 0, id: 0 }, { x: 100, z: 0, id: 0 }, { x: 103, z: 4, id: 160 }])],
      TEMPLATES,
    );
    const streamer = new ObstacleStreamer(p, field, 40);
    streamer.update(0, 0);
    expect(streamer.activeCount).toBe(1);
    streamer.update(100, 0);
    expect(streamer.activeCount).toBe(2);
    expect(p.world.colliders.len()).toBe(1 + 2); // terrain + two near obstacles
  });

  it('streamed trunks and rocks block the player', () => {
    const p = flatWorld();
    const field = new ObstacleField(
      [arrays([{ x: 4, z: 0, id: 0 }, { x: 0, z: 4, s: 1.5, id: 160 }])],
      TEMPLATES,
    );
    const streamer = new ObstacleStreamer(p, field, 40);
    streamer.update(0, 0);
    p.step();

    const walk = (vx: number, vz: number, seconds: number, onStep?: (m: PlayerMotor) => void): PlayerMotor => {
      const motor = new PlayerMotor(rapier, p.world);
      motor.teleport(0, 0.02, 0);
      for (let t = 0; t < seconds; t += 1 / 60) {
        motor.step(vx, vz, false, 1 / 60);
        p.step();
        onStep?.(motor);
      }
      return motor;
    };
    let closest = Infinity;
    const toTrunk = walk(4, 0, 2, (m) => {
      closest = Math.min(closest, Math.hypot(m.feet.x - 4, m.feet.z));
    });
    expect(closest).toBeGreaterThan(0.4 + CAPSULE_RADIUS - 0.01);
    toTrunk.dispose();
    const toRock = walk(0, 4, 2);
    // 1.5 m rock: too tall to step onto, face at z = 4 − 0.75
    expect(toRock.feet.z).toBeLessThan(4 - 0.75 - CAPSULE_RADIUS + 0.02);
  });
});
