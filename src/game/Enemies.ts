/**
 * Enemies — the robots in play. Every planned robot waits as a spawn record;
 * those near the player wake with a body (a capsule on the shared character
 * controller), a brain and a view, and go back to sleep once left far
 * behind, forgetting where they wandered. Destroyed robots stay destroyed.
 *
 * Robots sense and shoot through the same ray casts as the player's gun: one
 * sees the player when a ray from its sensor reaches the player's capsule
 * first, and its rounds are traced, so walls, trees and rocks give cover.
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import { hashCombine, Rng } from '../core/Seed';
import type { EnemySpawn, RobotKind } from '../world/EnemyPlan';
import { type BrainWorld, EnemyBrain, type Pose } from './EnemyBrain';
import { Health } from './Health';
import type { Hittable, Physics } from './Physics';
import { WALK_SPEED } from './Player';
import { PlayerMotor, type Vec3 } from './PlayerMotor';
import { ROBOTS, type RobotSpec } from './RobotSpec';
import { type Impact, traceShot, type ShotWorld } from './Shot';
import { spreadDirection } from './Weapon';

/** robots wake within this of the player (m)… */
const WAKE_RADIUS = 120;
/** …and sleep beyond this */
const SLEEP_RADIUS = 140;
/** how often sleep and wake are checked (s) */
const ROSTER_INTERVAL = 0.5;
/** how often each robot looks for the player (s) */
const SENSE_INTERVAL = 0.25;
/** half-angle of a robot's view (rad); closer than NEAR it notices anyway */
const VIEW_HALF_ANGLE = 1.2;
const NEAR = 8;
/** gunshots carry this far (m) */
const HEARING = 60;
/** drones climb or sink towards their hover height at up to this (m/s) */
const HOVER_RATE = 3;
/** lowest a drone comes down to (m) */
const MIN_HOVER = 0.6;
/** a fallen drone drops this fast (m/s) */
const FALL_RATE = 6;

/** the player, as robots see it */
export interface EnemyTarget extends Hittable {
  /** where robots aim: the chest */
  readonly aim: Vec3;
  /** horizontal speed (m/s); a moving target is harder to hit */
  readonly speed: number;
  readonly alive: boolean;
}

export interface RobotView {
  place(x: number, y: number, z: number, yaw: number): void;
  pose(p: Pose): void;
  update(dt: number): void;
  /** the gun's muzzle in world space, if this robot carries one */
  muzzle(out: Vec3): boolean;
  dispose(): void;
}

export interface RobotViews {
  create(kind: RobotKind): RobotView;
}

export interface EnemyFx {
  /** a robot fired from `from` and the round stopped at `to`, on `hit` if
   *  it struck anything */
  shot(from: Vec3, to: Vec3, hit: Impact | null): void;
  destroyed(at: Vec3): void;
}

export interface EnemyWorld extends ShotWorld {
  groundAt(x: number, z: number): number;
  waterAt(x: number, z: number): number;
}

class Robot implements Hittable {
  readonly spec: RobotSpec;
  readonly health: Health;
  seen = false;
  senseIn: number;
  /** where a destroyed robot's view rests */
  readonly wreck: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    readonly index: number,
    readonly spawn: EnemySpawn,
    readonly motor: PlayerMotor,
    readonly brain: EnemyBrain,
    readonly view: RobotView,
    private readonly onHurt: (r: Robot, damage: number, from: Vec3) => void,
  ) {
    this.spec = ROBOTS[spawn.kind];
    this.health = new Health(this.spec.hp);
    // spread the ray casts over ticks
    this.senseIn = (index % 8) * (SENSE_INTERVAL / 8);
  }

  get dead(): boolean {
    return this.health.dead;
  }

  hurt(damage: number, from: Vec3): void {
    this.onHurt(this, damage, from);
  }

  /** the sensor: eye height above the capsule's base */
  eye(out: Vec3): Vec3 {
    const f = this.motor.feet;
    out.x = f.x;
    out.y = f.y + this.spec.eye;
    out.z = f.z;
    return out;
  }
}

const EYE: Vec3 = { x: 0, y: 0, z: 0 };
const MUZZLE: Vec3 = { x: 0, y: 0, z: 0 };

export class Enemies {
  private readonly awake = new Map<number, Robot>();
  private readonly destroyed = new Set<number>();
  private rosterIn = 0;
  private wakes = 0;
  private readonly rng: Rng;

  constructor(
    private readonly spawns: readonly EnemySpawn[],
    private readonly physics: Physics,
    private readonly world: EnemyWorld,
    private readonly views: RobotViews,
    private readonly target: EnemyTarget,
    private readonly fx: EnemyFx,
    private readonly seed = 0,
  ) {
    this.rng = new Rng(hashCombine(seed, 0x5eed));
  }

  /** robots currently awake, destroyed ones included */
  get awakeCount(): number {
    return this.awake.size;
  }

  get destroyedCount(): number {
    return this.destroyed.size;
  }

  /** awake robots, for tests and debugging */
  snapshot(): { kind: RobotKind; x: number; y: number; z: number; state: string; hp: number }[] {
    return [...this.awake.values()].map((r) => {
      const at = r.dead ? r.wreck : r.motor.feet;
      return { kind: r.spawn.kind, x: at.x, y: at.y, z: at.z, state: r.brain.state, hp: r.health.hp };
    });
  }

  /** a gunshot at `at`: robots in earshot come to look */
  hear(at: Vec3): void {
    for (const r of this.awake.values()) {
      const f = r.motor.feet;
      if (Math.hypot(f.x - at.x, f.z - at.z) < HEARING) r.brain.alert(at.x, at.z);
    }
  }

  /** the player respawned: nobody knows where they are */
  forget(): void {
    for (const r of this.awake.values()) {
      r.seen = false;
      r.brain.forget();
    }
  }

  /** wake and sleep robots around `focus`, and pose their views */
  update(dt: number, focus: Vec3): void {
    this.rosterIn -= dt;
    if (this.rosterIn <= 0) {
      this.rosterIn = ROSTER_INTERVAL;
      this.roster(focus);
    }
    for (const r of this.awake.values()) {
      if (r.dead) {
        if (r.spec.hover) r.wreck.y = Math.max(this.world.groundAt(r.wreck.x, r.wreck.z), r.wreck.y - FALL_RATE * dt);
        r.view.place(r.wreck.x, r.wreck.y, r.wreck.z, r.brain.yaw);
      } else {
        const f = r.motor.feet;
        r.view.place(f.x, f.y, f.z, r.brain.yaw);
      }
      r.view.pose(r.brain.pose);
      r.view.update(dt);
    }
  }

  /** one fixed step of every awake robot: look, think, act, move */
  tick(dt: number): void {
    for (const r of this.awake.values()) {
      if (r.dead) continue;
      r.senseIn -= dt;
      if (r.senseIn <= 0) {
        r.senseIn += SENSE_INTERVAL;
        r.seen = this.target.alive && this.sees(r);
      }
      const f = r.motor.feet;
      const seen = r.seen && this.target.alive ? this.target.aim : null;
      if (r.brain.tick(dt, { x: f.x, z: f.z, seen })) this.attack(r);
      const { move } = r.brain;
      if (r.spec.hover) {
        // cruise high, but come down to look the player in the eye
        const ground = this.world.groundAt(f.x, f.z);
        const level = seen ? Math.max(ground + MIN_HOVER, seen.y - r.spec.eye) : ground + r.spec.hover;
        const climb = level - f.y;
        r.motor.fly(move.x, Math.max(-HOVER_RATE, Math.min(HOVER_RATE, climb * 3)), move.z, dt);
      } else {
        r.motor.step(move.x, move.z, false, dt);
      }
    }
  }

  private sees(r: Robot): boolean {
    const eye = r.eye(EYE);
    const aim = this.target.aim;
    const dx = aim.x - eye.x;
    const dy = aim.y - eye.y;
    const dz = aim.z - eye.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > r.spec.sight) return false;
    if (d > NEAR) {
      // forward is (−sin yaw, −cos yaw)
      const ahead = (-Math.sin(r.brain.yaw) * dx - Math.cos(r.brain.yaw) * dz) / Math.hypot(dx, dz);
      if (ahead < Math.cos(VIEW_HALF_ANGLE)) return false;
    }
    const hit = traceShot(this.world, eye, { x: dx / d, y: dy / d, z: dz / d }, d + 1, r.motor.collider);
    return hit?.target === this.target;
  }

  private attack(r: Robot): void {
    const { attack } = r.spec;
    const aim = this.target.aim;
    const f = r.motor.feet;
    if (!attack.ranged) {
      const reach = attack.range + r.spec.radius;
      if (Math.hypot(aim.x - f.x, aim.z - f.z) <= reach && Math.abs(aim.y - (f.y + r.spec.eye)) < 2) {
        this.target.hurt(attack.damage, r.eye(EYE));
      }
      return;
    }
    const from = r.view.muzzle(MUZZLE) ? MUZZLE : r.eye(MUZZLE);
    const dx = aim.x - from.x;
    const dy = aim.y - from.y;
    const dz = aim.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    const moving = Math.min(1, this.target.speed / WALK_SPEED);
    const dir = spreadDirection(
      { x: dx / d, y: dy / d, z: dz / d },
      attack.spread * (1 + 2 * moving),
      this.rng.float(),
      this.rng.float(),
    );
    const range = attack.range * 1.5;
    const hit = traceShot(this.world, from, dir, range, r.motor.collider);
    hit?.target?.hurt(attack.damage, from);
    const to = hit ?? { x: from.x + dir.x * range, y: from.y + dir.y * range, z: from.z + dir.z * range };
    this.fx.shot({ ...from }, { x: to.x, y: to.y, z: to.z }, hit);
  }

  private hurt(r: Robot, damage: number, from: Vec3): void {
    if (r.dead) return;
    if (!r.health.hurt(damage)) {
      r.brain.alert(from.x, from.z);
      return;
    }
    r.brain.die();
    Object.assign(r.wreck, r.motor.feet);
    this.physics.untag(r.motor.collider);
    r.motor.dispose();
    this.destroyed.add(r.index);
    this.fx.destroyed({ ...r.wreck });
  }

  private roster(focus: Vec3): void {
    for (const r of this.awake.values()) {
      const at = r.dead ? r.wreck : r.motor.feet;
      if (Math.hypot(at.x - focus.x, at.z - focus.z) > SLEEP_RADIUS) this.sleep(r);
    }
    this.spawns.forEach((s, i) => {
      if (this.awake.has(i) || this.destroyed.has(i)) return;
      if (Math.hypot(s.x - focus.x, s.z - focus.z) < WAKE_RADIUS) this.wake(i, s);
    });
  }

  private wake(index: number, spawn: EnemySpawn): void {
    const spec = ROBOTS[spawn.kind];
    const { rapier } = this.physics;
    const motor = new PlayerMotor(rapier, this.physics.world, null, spec);
    const spot = motor.clearSpotNear(spawn.x, spawn.z, (x, z) => this.world.groundAt(x, z));
    motor.teleport(spot.x, spot.y + spec.hover, spot.z);
    const rng = new Rng(hashCombine(hashCombine(this.seed, index), this.wakes++));
    const brain = new EnemyBrain(spec, spawn, rng, this.brainWorld(spec, motor.collider));
    const robot = new Robot(index, spawn, motor, brain, this.views.create(spawn.kind), (r, d, from) =>
      this.hurt(r, d, from),
    );
    this.physics.tag(motor.collider, 'metal', robot);
    this.awake.set(index, robot);
  }

  private sleep(r: Robot): void {
    if (!r.dead) {
      this.physics.untag(r.motor.collider);
      r.motor.dispose();
    }
    r.view.dispose();
    this.awake.delete(r.index);
  }

  private brainWorld(spec: RobotSpec, self: RAPIER.Collider): BrainWorld {
    const { world } = this;
    return {
      // drones fly over water
      dry: spec.hover ? () => true : (x, z) => world.waterAt(x, z) < world.groundAt(x, z) - 0.05,
      clear: (x0, z0, x1, z1) => {
        const from = { x: x0, y: world.groundAt(x0, z0) + 0.8, z: z0 };
        const dx = x1 - x0;
        const dy = world.groundAt(x1, z1) + 0.8 - from.y;
        const dz = z1 - z0;
        const d = Math.hypot(dx, dy, dz);
        if (d < 1e-3) return true;
        return traceShot(world, from, { x: dx / d, y: dy / d, z: dz / d }, d, self) === null;
      },
    };
  }
}
