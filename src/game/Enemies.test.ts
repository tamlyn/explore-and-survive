import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EnemySpawn } from '../world/EnemyPlan';
import { Building, type PieceView } from './Building';
import { Enemies, type EnemyFx, type EnemyTarget, type RobotView } from './Enemies';
import { loadRapier, Physics, type Rapier } from './Physics';
import { PlayerMotor, type Vec3 } from './PlayerMotor';
import { ROBOTS } from './RobotSpec';

let rapier: Rapier;
let physics: Physics | null = null;
beforeAll(async () => {
  rapier = await loadRapier();
});
afterEach(() => {
  physics?.dispose();
  physics = null;
});

const DT = 1 / 60;

class StubView implements RobotView {
  static live = 0;
  pos: Vec3 = { x: 0, y: 0, z: 0 };
  constructor() {
    StubView.live++;
  }
  place(x: number, y: number, z: number): void {
    this.pos = { x, y, z };
  }
  pose(): void {}
  update(): void {}
  dispose(): void {
    StubView.live--;
  }
}

interface Setup {
  enemies: Enemies;
  player: EnemyTarget & { hp: number; at: (x: number, z: number) => void };
  shots: number;
  /** where the last round left from */
  lastFrom: Vec3 | null;
  run: (seconds: number) => void;
}

function setup(
  spawns: EnemySpawn[],
  walls: { x: number; z: number; hx: number; hz: number }[] = [],
  waterAt = (): number => -10,
): Setup {
  const res = 257;
  physics = new Physics(rapier, { heights: new Float32Array(res * res), res, worldSize: res });
  const p = physics;
  for (const w of walls) p.addCollider(rapier.ColliderDesc.cuboid(w.hx, 3, w.hz).setTranslation(w.x, 3, w.z), 'stone');
  const motor = new PlayerMotor(rapier, p.world);
  const player = {
    hp: 100,
    aim: { x: 0, y: 1.3, z: 0 },
    speed: 0,
    get alive() {
      return this.hp > 0;
    },
    hurt(damage: number) {
      this.hp -= damage;
    },
    at(x: number, z: number) {
      motor.teleport(x, 0, z);
      this.aim = { x, y: 1.3, z };
    },
  };
  player.at(0, 0);
  p.tag(motor.collider, null, player);
  p.step();
  const s: Setup = {
    enemies: null as unknown as Enemies,
    player,
    shots: 0,
    lastFrom: null,
    run: (seconds) => {
      for (let t = 0; t < seconds; t += DT) {
        s.enemies.update(DT, player.aim);
        s.enemies.tick(DT);
        p.step();
      }
    },
  };
  const fx: EnemyFx = {
    shot: (from) => {
      s.shots++;
      s.lastFrom = from;
    },
    destroyed: () => {},
  };
  const world = { physics: p, groundAt: () => 0, waterAt };
  s.enemies = new Enemies(spawns, p, world, { create: () => new StubView() }, player, fx);
  return s;
}

const gunner = (x: number, z: number): EnemySpawn => ({ kind: 'walkerGun', x, z, roam: 2 });

const NO_VIEW: PieceView = { add: () => 0, remove: () => {}, wear: () => {} };

/** a wall across z = −4 from x = 0 to 4, between a robot ahead and the player */
function walledIn(spawn: EnemySpawn): Setup & { building: Building } {
  const s = setup([spawn]);
  const building = new Building(physics!, NO_VIEW, { broke: () => {} });
  building.place({ kind: 'wall', i: 0, j: -1, y: 0, dir: 0 });
  s.player.at(2, 0);
  physics!.step();
  return { ...s, building };
}

describe('Enemies', () => {
  it('wakes robots near the player and puts far ones to sleep', () => {
    StubView.live = 0;
    const { enemies, player, run } = setup([gunner(0, 100), gunner(0, -200)]);
    run(0.1);
    expect(enemies.awakeCount).toBe(1);
    player.at(0, -150);
    run(1);
    expect(enemies.awakeCount).toBe(1);
    expect(StubView.live).toBe(1);
  });

  it('a gunner that knows where the player is shoots them', () => {
    const s = setup([gunner(0, -25)]);
    s.run(0.1);
    s.enemies.hear(s.player.aim);
    s.run(15);
    expect(s.shots).toBeGreaterThan(5);
    expect(s.player.hp).toBeLessThan(100);
  });

  it('rounds leave from the gun, not from somewhere above it', () => {
    for (const kind of ['walkerGun', 'bruteGun', 'droneGun'] as const) {
      const s = setup([{ kind, x: 0, z: -20, roam: 0.1 }]);
      s.run(0.1);
      s.enemies.hear(s.player.aim);
      s.run(10);
      const [robot] = s.enemies.snapshot();
      const from = s.lastFrom!;
      expect(Math.hypot(from.x - robot!.x, from.z - robot!.z)).toBeLessThan(1.5);
      expect(from.y - robot!.y).toBeGreaterThan(0.5);
      expect(from.y - robot!.y).toBeLessThan(2.5);
      // ahead of the robot, towards the player
      expect(from.z).toBeGreaterThan(robot!.z);
      physics?.dispose();
      physics = null;
    }
  });

  it('a wall gives cover', () => {
    // a long wall between the two, too long to walk around in the time
    const s = setup([gunner(0, -25)], [{ x: 0, z: -10, hx: 40, hz: 0.3 }]);
    s.run(0.1);
    s.enemies.hear(s.player.aim);
    s.run(15);
    expect(s.shots).toBe(0);
    expect(s.player.hp).toBe(100);
  });

  it("robots shoot down the player's wall, then the player", () => {
    const s = walledIn(gunner(2, -25));
    s.run(0.1);
    s.enemies.hear(s.player.aim);
    s.run(10);
    expect(s.building.count).toBe(1);
    expect(s.player.hp).toBe(100);
    s.run(40);
    expect(s.building.count).toBe(0);
    expect(s.player.hp).toBeLessThan(100);
  });

  it("brawlers break the player's wall to get at them", () => {
    const s = walledIn({ kind: 'brute', x: 2, z: -8, roam: 0.1 });
    s.run(0.1);
    s.enemies.hear(s.player.aim);
    s.run(25);
    expect(s.building.count).toBe(0);
  });

  it('a hit alerts the robot, and enough of them destroy it for good', () => {
    // facing away from the player, too far to notice them
    const s = setup([gunner(0, -30)]);
    s.run(0.1);
    const robot = physics!.castRay({ x: 0, y: 1, z: -1 }, { x: 0, y: 0, z: -1 }, 60, undefined);
    expect(robot?.target).not.toBeNull();
    robot!.target!.hurt(10, s.player.aim);
    s.run(8);
    expect(s.shots).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) robot!.target!.hurt(10, s.player.aim);
    expect(s.enemies.destroyedCount).toBe(1);
    const shots = s.shots;
    s.run(3);
    expect(s.shots).toBe(shots);
    // gone for good: out of range and back
    s.player.at(0, 400);
    s.run(1);
    s.player.at(0, 0);
    s.run(1);
    expect(s.enemies.awakeCount).toBe(0);
  });

  it('names the robot a ray hits by its place in the plan', () => {
    const s = setup([gunner(0, 200), gunner(0, -30)]);
    s.run(0.1);
    const hit = physics!.castRay({ x: 0, y: 1, z: -1 }, { x: 0, y: 0, z: -1 }, 60, undefined);
    expect(s.enemies.describe(hit!.target!)).toBe('R2 walkerGun patrol 60/60');
    expect(s.enemies.describe(s.player)).toBeNull();
  });

  it('robots come to look when they hear a shot', () => {
    const s = setup([{ kind: 'walker', x: 40, z: 0, roam: 2 }]);
    s.player.at(0, 80);
    s.run(0.6);
    s.enemies.hear({ x: 0, y: 1.7, z: 30 });
    let closest = Infinity;
    for (let i = 0; i < 20; i++) {
      s.run(1);
      const [robot] = s.enemies.snapshot();
      closest = Math.min(closest, Math.hypot(robot!.x, robot!.z - 30));
    }
    expect(closest).toBeLessThan(3);
  });

  it('drones come down to the player\'s level to fight', () => {
    const s = setup([{ kind: 'drone', x: 0, z: -6, roam: 2 }]);
    s.run(0.1);
    s.enemies.hear(s.player.aim);
    s.run(4);
    const [drone] = s.enemies.snapshot();
    expect(drone!.state).toBe('hunt');
    expect(drone!.y + ROBOTS.drone.eye).toBeCloseTo(s.player.aim.y, 0);
    // face to face, not overhead
    expect(Math.hypot(drone!.x, drone!.z)).toBeGreaterThan(0.6);
    expect(s.player.hp).toBeLessThan(100);
  });

  it("robots don't shoot each other", () => {
    // a brawler just behind the player, where the gunner's misses go
    const s = setup([gunner(0, -25), { kind: 'walker', x: 0, z: 1.5, roam: 0.1 }]);
    s.run(0.1);
    s.enemies.hear(s.player.aim);
    s.run(10);
    expect(s.shots).toBeGreaterThan(0);
    expect(s.enemies.snapshot().every((r) => r.hp === ROBOTS[r.kind].hp)).toBe(true);
  });

  it('drones hover over water, not under it', () => {
    const s = setup([{ kind: 'drone', x: 0, z: 60, roam: 5 }], [], () => 3);
    s.run(4);
    const [drone] = s.enemies.snapshot();
    expect(drone!.y).toBeCloseTo(3 + ROBOTS.drone.hover, 1);
  });

  it('drones hover', () => {
    const s = setup([{ kind: 'drone', x: 0, z: 60, roam: 5 }]);
    s.run(3);
    const [drone] = s.enemies.snapshot();
    expect(drone!.y).toBeCloseTo(ROBOTS.drone.hover, 1);
  });
});
