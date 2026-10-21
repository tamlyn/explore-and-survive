import { describe, expect, it } from 'vitest';
import { Rng } from '../core/Seed';
import { type BrainWorld, EnemyBrain } from './EnemyBrain';
import { ROBOTS, type RobotSpec } from './RobotSpec';

const DT = 1 / 60;
const open: BrainWorld = { dry: () => true, clear: () => true };

/** a body that goes wherever the brain asks, sliding along anything `blocked` */
class Sim {
  x: number;
  z: number;
  readonly brain: EnemyBrain;
  attacks: number[] = [];
  t = 0;

  constructor(
    spec: RobotSpec,
    x: number,
    z: number,
    world: BrainWorld = open,
    private readonly blocked: (x: number, z: number) => boolean = () => false,
  ) {
    this.x = x;
    this.z = z;
    this.brain = new EnemyBrain(spec, { x, z, roam: 10 }, new Rng(7), world);
  }

  run(seconds: number, player: { x: number; z: number } | null = null, each?: () => void): void {
    for (let end = this.t + seconds; this.t < end; this.t += DT) {
      if (this.brain.tick(DT, { x: this.x, z: this.z, seen: player })) this.attacks.push(this.t);
      const nx = this.x + this.brain.move.x * DT;
      const nz = this.z + this.brain.move.z * DT;
      if (!this.blocked(nx, this.z)) this.x = nx;
      if (!this.blocked(this.x, nz)) this.z = nz;
      each?.();
    }
  }
}

describe('EnemyBrain', () => {
  it('patrols around home, pausing between waypoints', () => {
    const sim = new Sim(ROBOTS.walker, 0, 0);
    let far = 0;
    let idle = 0;
    let path = 0;
    let px = 0;
    let pz = 0;
    sim.run(60, null, () => {
      far = Math.max(far, Math.hypot(sim.x, sim.z));
      if (sim.brain.pose === 'idle') idle++;
      path += Math.hypot(sim.x - px, sim.z - pz);
      px = sim.x;
      pz = sim.z;
    });
    expect(far).toBeLessThan(11);
    expect(path).toBeGreaterThan(10);
    expect(idle).toBeGreaterThan(60 * 10);
    expect(sim.brain.state).toBe('patrol');
  });

  it('gunmen stop at a distance and shoot on a cooldown, after a moment to react', () => {
    const spec = ROBOTS.walkerGun;
    const sim = new Sim(spec, 0, 0);
    const player = { x: 0, z: -30 };
    sim.run(10, player);
    expect(sim.brain.state).toBe('hunt');
    const d = Math.hypot(sim.x - player.x, sim.z - player.z);
    expect(d).toBeLessThanOrEqual(spec.attack.range);
    expect(d).toBeGreaterThan(spec.attack.range * 0.5);
    expect(sim.attacks[0]).toBeGreaterThan(0.7);
    const gaps = sim.attacks.slice(1).map((t, i) => t - sim.attacks[i]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(spec.attack.interval * 0.8 - DT);
    expect(sim.attacks.length).toBeGreaterThan(5);
  });

  it('brawlers run up close before striking', () => {
    const spec = ROBOTS.walker;
    const sim = new Sim(spec, 0, 0);
    const player = { x: 12, z: 0 };
    let firstAt = Infinity;
    sim.run(6, player, () => {
      if (sim.attacks.length && firstAt === Infinity) firstAt = Math.hypot(sim.x - player.x, sim.z - player.z);
    });
    expect(sim.attacks.length).toBeGreaterThan(2);
    expect(firstAt).toBeLessThanOrEqual(spec.attack.range);
  });

  it('an attack lands only if the player is still in sight when it does', () => {
    const sim = new Sim(ROBOTS.walker, 0, 0);
    const player = { x: 1, z: 0 };
    let landedUnseen = 0;
    // in sight until the wind-up starts, then gone
    let seen: { x: number; z: number } | null = player;
    for (let i = 0; i < 300; i++) {
      if (sim.brain.tick(DT, { x: sim.x, z: sim.z, seen }) && !seen) landedUnseen++;
      if (sim.brain.pose === 'attack') seen = null;
    }
    expect(landedUnseen).toBe(0);
  });

  it('searches where the player was last seen, then goes back to patrolling', () => {
    const sim = new Sim(ROBOTS.walker, 0, 0);
    sim.run(0.5, { x: 20, z: 0 });
    expect(sim.brain.state).toBe('hunt');
    let closest = Infinity;
    let searched = false;
    sim.run(20, null, () => {
      if (sim.brain.state === 'search') searched = true;
      closest = Math.min(closest, Math.hypot(sim.x - 20, sim.z));
    });
    expect(searched).toBe(true);
    expect(closest).toBeLessThan(1.5);
    expect(sim.brain.state).toBe('patrol');
  });

  it('goes to investigate a shot it heard', () => {
    const sim = new Sim(ROBOTS.walker, 0, 0);
    sim.brain.alert(0, 25);
    expect(sim.brain.state).toBe('search');
    sim.run(12);
    expect(Math.hypot(sim.x, sim.z - 25)).toBeLessThan(2);
  });

  it('walkers keep out of the water', () => {
    // a river along x > 5
    const world: BrainWorld = { dry: (x) => x < 5, clear: () => true };
    const sim = new Sim(ROBOTS.walker, 0, 0, world);
    let wet = false;
    sim.run(20, { x: 30, z: 0 }, () => {
      if (sim.x >= 5) wet = true;
    });
    expect(wet).toBe(false);
  });

  it('sidesteps out from against a wall', () => {
    // a wall between robot and player, ending at z = ±3
    const blocked = (x: number, z: number): boolean => x > 2 && x < 3 && Math.abs(z) < 3;
    const sim = new Sim(ROBOTS.walker, 0, 0, open, blocked);
    sim.run(8, { x: 8, z: 0 });
    expect(sim.x).toBeGreaterThan(3);
  });

  it('does nothing once dead', () => {
    const sim = new Sim(ROBOTS.walkerGun, 0, 0);
    sim.brain.die();
    sim.run(5, { x: 0, z: -10 });
    expect(sim.attacks).toEqual([]);
    expect(sim.x).toBe(0);
    expect(sim.brain.pose).toBe('dead');
  });
});
