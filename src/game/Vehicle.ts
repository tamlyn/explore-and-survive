/**
 * Vehicle — one car in the physics world: a dynamic box riding on Rapier's
 * ray-cast wheels. Whoever drives it sets `controls`; without a driver the
 * brakes are on. It wears down as it's hurt and, worn through, is a wreck
 * that goes nowhere. Poses are kept for the last two physics ticks so it can
 * be drawn smoothly between them.
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import { Health } from './Health';
import { type Hittable, type Physics, WORLD_GRAVITY } from './Physics';
import type { Vec3 } from './PlayerMotor';
import { VEHICLES, type VehicleKind, type VehicleSpec } from './VehicleSpec';

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Pose {
  p: Vec3;
  q: Quat;
}

export interface VehicleControls {
  /** −1 full reverse/brake … 1 full ahead */
  throttle: number;
  /** −1 full left … 1 full right */
  steer: number;
  handbrake: boolean;
}

export interface WheelState {
  /** rad, positive turns left */
  steer: number;
  /** rad rolled forwards */
  spin: number;
  /** the hub's height in the vehicle's frame */
  hubY: number;
}

/** steering eases to where it's wanted at this rate (rad/s)… */
const STEER_RATE = 2.5;
/** …and turns half as far at this speed (m/s), so a fast car doesn't spin */
const STEER_FADE = 10;
/** reverse is slower than going forwards, and weaker */
const REVERSE = { speed: 1 / 3, force: 0.6 };
/** below this a pull back on the throttle stops braking and reverses (m/s) */
const CREEP = 1;
/** a parked car's brakes are only so firm, so it can still be shoved */
const PARKED_BRAKE = 0.5;
/** floats in water deeper than this; water drags it to a crawl */
const WADE = 0.5;
const WATER_DRAG = 2.5;
/** upright enough to drive: the roof's lean from vertical (cos) */
const UPRIGHT = 0.3;

const NO_CONTROLS: VehicleControls = { throttle: 0, steer: 0, handbrake: false };

export interface VehicleWorld {
  waterAt(x: number, z: number): number;
  /** x and z stay within ±edge */
  edge: number;
}

export class Vehicle implements Hittable {
  readonly spec: VehicleSpec;
  readonly health: Health;
  readonly controls: VehicleControls = { ...NO_CONTROLS };
  /** someone is at the wheel */
  driven = false;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly ctl: RAPIER.DynamicRayCastVehicleController;
  /** where each spring meets the body */
  private readonly mountY: number[];
  private steerNow = 0;
  private readonly prev: Pose = { p: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 } };
  private readonly cur: Pose = { p: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 } };

  constructor(
    private readonly physics: Physics,
    readonly kind: VehicleKind,
    at: Vec3,
    yaw: number,
    private readonly onHurt: (v: Vehicle, damage: number, from: Vec3) => void = () => {},
  ) {
    const spec = (this.spec = VEHICLES[kind]);
    this.health = new Health(spec.hp);
    const { rapier, world } = physics;
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(at.x, at.y, at.z)
        .setRotation(yawQuat(yaw))
        .setLinearDamping(0.05)
        .setAngularDamping(0.6)
        .setCcdEnabled(true),
    );
    const { center: c, half: h } = spec.hull;
    const b = spec.balance;
    const m = spec.mass;
    this.collider = world.createCollider(
      rapier.ColliderDesc.cuboid(h.x, h.y, h.z)
        .setTranslation(c.x, c.y, c.z)
        .setFriction(0.4)
        .setMassProperties(
          m,
          { x: b.x - c.x, y: b.y - c.y, z: b.z - c.z },
          { x: (m / 3) * (h.y ** 2 + h.z ** 2), y: (m / 3) * (h.x ** 2 + h.z ** 2), z: (m / 3) * (h.x ** 2 + h.y ** 2) },
          { x: 0, y: 0, z: 0, w: 1 },
        ),
      this.body,
    );
    physics.tag(this.collider, 'metal', this);

    const ctl = (this.ctl = world.createVehicleController(this.body));
    // Rapier drives along +x by default; ours face −z
    ctl.setIndexForwardAxis = 2;
    const s = spec.suspension;
    // the springs settle by this much under the car's weight
    const sag = WORLD_GRAVITY / (spec.wheels.length * s.stiffness);
    this.mountY = spec.wheels.map((w) => w.at.y + s.travel - sag);
    spec.wheels.forEach((w, i) => {
      ctl.addWheel({ x: w.at.x, y: this.mountY[i]!, z: w.at.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, s.travel, w.radius);
      ctl.setWheelSuspensionStiffness(i, s.stiffness);
      ctl.setWheelSuspensionCompression(i, s.compression);
      ctl.setWheelSuspensionRelaxation(i, s.relaxation);
      ctl.setWheelMaxSuspensionTravel(i, s.travel);
      ctl.setWheelMaxSuspensionForce(i, m * WORLD_GRAVITY * 2);
      ctl.setWheelFrictionSlip(i, spec.grip);
    });
    this.record();
    this.record();
  }

  get wrecked(): boolean {
    return this.health.dead;
  }

  /** m/s, positive going forwards */
  get speed(): number {
    return -this.ctl.currentVehicleSpeed();
  }

  /** wheels side down, not on its side or roof */
  get upright(): boolean {
    const { x, z } = this.body.rotation();
    // the body's up vector's y component
    return 1 - 2 * (x * x + z * z) > UPRIGHT;
  }

  /** the heading of its nose (0 faces −z, like the player's yaw) */
  get yaw(): number {
    const q = this.cur.q;
    // the body's forward (−z) in the world
    const fx = -2 * (q.x * q.z + q.w * q.y);
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    return Math.atan2(-fx, -fz);
  }

  hurt(damage: number, from: Vec3): void {
    if (this.wrecked) return;
    this.health.hurt(damage);
    this.onHurt(this, damage, from);
  }

  /** one fixed step before the physics world's: engine, brakes, steering */
  tick(dt: number, world: VehicleWorld): void {
    const { spec, ctl } = this;
    const live = this.driven && !this.wrecked;
    // a sleeping body keeps the impulses the wheels give it without moving,
    // until whatever wakes it lets them all go at once
    if (live) this.body.wakeUp();
    else if (this.body.isSleeping()) return;
    const s = this.speed;
    const { throttle, steer, handbrake } = live ? this.controls : NO_CONTROLS;
    const wet = this.wading(world);
    let engine = 0;
    let brake = live ? 0 : spec.brake * PARKED_BRAKE;
    if (throttle > 0) {
      if (s < -CREEP) brake = spec.brake;
      else if (s < spec.topSpeed) engine = throttle * spec.engine;
    } else if (throttle < 0) {
      if (s > CREEP) brake = spec.brake;
      else if (s > -spec.topSpeed * REVERSE.speed) engine = throttle * spec.engine * REVERSE.force;
    } else if (live && Math.abs(s) < CREEP) {
      // stopped on a hill, it holds rather than rolling away
      brake = spec.brake * PARKED_BRAKE;
    }
    if (wet) engine *= 0.3;
    const want = (steer * spec.steer) / (1 + Math.abs(s) / STEER_FADE);
    this.steerNow += Math.max(-STEER_RATE * dt, Math.min(STEER_RATE * dt, want - this.steerNow));
    spec.wheels.forEach((w, i) => {
      // positive steering turns left
      ctl.setWheelSteering(i, w.steers ? -this.steerNow : 0);
      // Rapier's forward is +z
      ctl.setWheelEngineForce(i, w.drives ? -engine : 0);
      ctl.setWheelBrake(i, handbrake && !w.steers ? spec.brake : brake);
    });
    this.keepIn(world.edge);
    ctl.updateVehicle(dt, this.physics.rapier.QueryFilterFlags.EXCLUDE_KINEMATIC | this.physics.rapier.QueryFilterFlags.EXCLUDE_DYNAMIC);
  }

  /** after the physics world's step: remember where it got to */
  record(): void {
    copyPose(this.cur, this.prev);
    const t = this.body.translation();
    const r = this.body.rotation();
    Object.assign(this.cur.p, { x: t.x, y: t.y, z: t.z });
    Object.assign(this.cur.q, { x: r.x, y: r.y, z: r.z, w: r.w });
  }

  /** the pose `alpha` of the way from the last tick to this one */
  pose(alpha: number, out: Pose): Pose {
    const { prev: a, cur: b } = this;
    out.p.x = a.p.x + (b.p.x - a.p.x) * alpha;
    out.p.y = a.p.y + (b.p.y - a.p.y) * alpha;
    out.p.z = a.p.z + (b.p.z - a.p.z) * alpha;
    nlerp(a.q, b.q, alpha, out.q);
    return out;
  }

  /** a point in the vehicle's frame, in the world, as of the last tick */
  toWorld(local: Vec3, out: Vec3, pose: Pose = this.cur): Vec3 {
    rotate(pose.q, local, out);
    out.x += pose.p.x;
    out.y += pose.p.y;
    out.z += pose.p.z;
    return out;
  }

  wheel(i: number, out: WheelState): WheelState {
    out.steer = this.ctl.wheelSteering(i) ?? 0;
    out.spin = -(this.ctl.wheelRotation(i) ?? 0);
    out.hubY = this.mountY[i]! - (this.ctl.wheelSuspensionLength(i) ?? this.spec.suspension.travel);
    return out;
  }

  /** set down at `at` on its wheels, facing `yaw`, at rest */
  moveTo(at: Vec3, yaw: number): void {
    const q = yawQuat(yaw);
    const p = { x: at.x, y: at.y, z: at.z };
    this.body.setTranslation(p, true);
    this.body.setRotation(q, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    // drawn straight there, not swept across from where it was
    Object.assign(this.cur.p, p);
    Object.assign(this.cur.q, q);
    copyPose(this.cur, this.prev);
  }

  /** whether it's in deep water, which holds it up and drags it back */
  private wading(world: VehicleWorld): boolean {
    const t = this.body.translation();
    const depth = world.waterAt(t.x, t.z) - t.y;
    const wet = depth > WADE;
    this.body.setLinearDamping(wet ? WATER_DRAG : 0.05);
    if (wet) {
      const lift = Math.min(1.5, (depth - WADE) / WADE + 0.5);
      this.body.resetForces(true);
      this.body.addForce({ x: 0, y: this.spec.mass * WORLD_GRAVITY * lift, z: 0 }, true);
    } else this.body.resetForces(false);
    return wet;
  }

  private keepIn(edge: number): void {
    const t = this.body.translation();
    if (Math.abs(t.x) <= edge && Math.abs(t.z) <= edge) return;
    const v = this.body.linvel();
    const clamp = (n: number): number => Math.max(-edge, Math.min(edge, n));
    this.body.setTranslation({ x: clamp(t.x), y: t.y, z: clamp(t.z) }, true);
    this.body.setLinvel({ x: Math.abs(t.x) > edge ? 0 : v.x, y: v.y, z: Math.abs(t.z) > edge ? 0 : v.z }, true);
  }

  dispose(): void {
    this.physics.untag(this.collider);
    this.physics.world.removeVehicleController(this.ctl);
    this.physics.world.removeRigidBody(this.body);
  }
}

export function yawQuat(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function copyPose(from: Pose, to: Pose): void {
  Object.assign(to.p, from.p);
  Object.assign(to.q, from.q);
}

function nlerp(a: Quat, b: Quat, t: number, out: Quat): void {
  // the short way round
  const s = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  const x = a.x + (b.x * s - a.x) * t;
  const y = a.y + (b.y * s - a.y) * t;
  const z = a.z + (b.z * s - a.z) * t;
  const w = a.w + (b.w * s - a.w) * t;
  const n = Math.hypot(x, y, z, w) || 1;
  out.x = x / n;
  out.y = y / n;
  out.z = z / n;
  out.w = w / n;
}

/** `v` turned by `q` */
export function rotate(q: Quat, v: Vec3, out: Vec3): Vec3 {
  // v + 2w(q×v) + 2q×(q×v)
  const cx = q.y * v.z - q.z * v.y;
  const cy = q.z * v.x - q.x * v.z;
  const cz = q.x * v.y - q.y * v.x;
  const x = v.x + 2 * (q.w * cx + q.y * cz - q.z * cy);
  const y = v.y + 2 * (q.w * cy + q.z * cx - q.x * cz);
  const z = v.z + 2 * (q.w * cz + q.x * cy - q.y * cx);
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}
