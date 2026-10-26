/**
 * Vehicles — the cars the player has bought, wherever they were left. Each
 * is put down on clear, dry ground, stays where it's parked and is drawn
 * between physics ticks. A driven car ploughs into whatever it meets: robots,
 * the player's building, other cars — hurting it by how fast it was going,
 * and itself a little.
 */

import type { Box } from '../world/Box';
import type { Hittable, Physics } from './Physics';
import type { Vec3 } from './PlayerMotor';
import { type Pose, rotate, Vehicle, type VehicleWorld, type WheelState, yawQuat } from './Vehicle';
import type { VehicleView, VehicleViews } from './VehicleModels';
import { VEHICLES, type VehicleKind } from './VehicleSpec';

/** slower than this a bump does no harm (m/s)… */
const RAM_MIN = 4;
/** …faster, each m/s above it does this much */
const RAM_DAMAGE = 8;
/** and the car takes this share of it */
const RAM_SELF = 0.15;
/** the same thing isn't hurt twice within this (s) */
const RAM_COOLDOWN = 0.5;
/** what's this close ahead of the hull is about to be hit (m) */
const RAM_REACH = 0.4;
/** how far around the asked-for spot a new car may be put (m) */
const PLACE_REACH = 14;
/** a new car is dropped from this high above the ground (m)… */
const DROP = 0.25;
/** …with this much clear ground ahead of it, to drive off (m) */
const RUNWAY = 4;
/** the player gets in from this close to the hull (m) */
export const ENTER_REACH = 1.2;

export interface FleetWorld extends VehicleWorld {
  groundAt(x: number, z: number): number;
}

export interface FleetFx {
  /** a driven car hit something hard enough to hurt it */
  rammed(at: Vec3, damage: number): void;
  wrecked(v: Vehicle, at: Vec3): void;
}

interface Parked {
  vehicle: Vehicle;
  view: VehicleView;
}

const P: Vec3 = { x: 0, y: 0, z: 0 };
/** a new car faces the way asked if it can, or else turns to find room */
const TURNS = [0, Math.PI / 2, -Math.PI / 2, Math.PI];
const POSE: Pose = { p: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 } };
const WHEELS: WheelState[] = Array.from({ length: 4 }, () => ({ steer: 0, spin: 0, hubY: 0 }));

export class Vehicles {
  private readonly all: Parked[] = [];
  /** what a car has rammed lately, and for how much longer it's spared */
  private readonly spared = new Map<Hittable, number>();

  constructor(
    private readonly physics: Physics,
    private readonly world: FleetWorld,
    private readonly views: VehicleViews,
    private readonly fx: FleetFx,
    /** targets ramming never hurts: the driver */
    private readonly immune: (t: Hittable) => boolean = () => false,
  ) {}

  get list(): Vehicle[] {
    return this.all.map((p) => p.vehicle);
  }

  /**
   * A new `kind` on clear, dry ground as near (x, z) as there is room for,
   * facing `yaw` or else whichever way it can drive off — or null if
   * there's nowhere.
   */
  place(kind: VehicleKind, x: number, z: number, yaw: number): Vehicle | null {
    const spot = this.spotNear(kind, x, z, yaw);
    if (!spot) return null;
    const vehicle = new Vehicle(this.physics, kind, spot, spot.yaw, (v) => {
      if (v.wrecked) this.fx.wrecked(v, v.toWorld(v.spec.hull.centre, { x: 0, y: 0, z: 0 }));
    });
    this.all.push({ vehicle, view: this.views.create(kind) });
    return vehicle;
  }

  /** the nearest car the player at `feet` can get into, wrecks included */
  reachable(feet: Vec3): Vehicle | null {
    let best: Vehicle | null = null;
    let bestD = ENTER_REACH;
    for (const { vehicle: v } of this.all) {
      const d = outside(v, feet);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  /** one fixed step, before the physics world's */
  tick(dt: number): void {
    for (const [t, left] of this.spared) {
      if (left <= dt) this.spared.delete(t);
      else this.spared.set(t, left - dt);
    }
    for (const { vehicle } of this.all) {
      vehicle.tick(dt, this.world);
      if (vehicle.driven && !vehicle.wrecked) this.ram(vehicle);
    }
  }

  /** after the physics world's step */
  record(): void {
    for (const { vehicle } of this.all) vehicle.record();
  }

  /** once per frame: draw each car `alpha` of the way between ticks */
  update(alpha: number): void {
    for (const { vehicle, view } of this.all) {
      WHEELS.forEach((w, i) => vehicle.wheel(i, w));
      view.place(vehicle.pose(alpha, POSE), WHEELS);
      view.wear(1 - vehicle.health.hp / vehicle.health.max);
    }
  }

  /** hurt whatever's about to be hit, by how fast it's coming */
  private ram(v: Vehicle): void {
    const speed = Math.abs(v.speed);
    if (speed < RAM_MIN) return;
    const damage = (speed - RAM_MIN) * RAM_DAMAGE;
    const box = hullBox(v, RAM_REACH);
    for (const t of this.physics.targetsIn(box)) {
      if (t === v || this.spared.has(t) || this.immune(t)) continue;
      this.spared.set(t, RAM_COOLDOWN);
      const at = v.toWorld(v.spec.hull.centre, { x: 0, y: 0, z: 0 });
      t.hurt(damage, at);
      v.hurt(damage * RAM_SELF, at);
      this.fx.rammed(at, damage);
    }
  }

  private spotNear(kind: VehicleKind, x: number, z: number, yaw: number): (Vec3 & { yaw: number }) | null {
    const { centre, half } = VEHICLES[kind].hull;
    // the hull and the runway ahead of it (−z)
    const clear = { x: centre.x, y: centre.y, z: centre.z - RUNWAY / 2 };
    for (let r = 0; r <= PLACE_REACH; r += 1.5) {
      const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 1.5);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        const ground = this.world.groundAt(px, pz);
        if (this.world.waterAt(px, pz) > ground - 0.1) continue;
        if (Math.abs(px) > this.world.edge || Math.abs(pz) > this.world.edge) continue;
        const y = ground + DROP;
        for (const turn of TURNS) {
          const q = yawQuat(yaw + turn);
          const c = rotate(q, clear, P);
          const box: Box = { x: px + c.x, y: y + c.y, z: pz + c.z, hx: half.x, hy: half.y, hz: half.z + RUNWAY / 2, q: [q.x, q.y, q.z, q.w] };
          if (!this.physics.occupied(box)) return { x: px, y, z: pz, yaw: yaw + turn };
        }
      }
    }
    return null;
  }
}

/** the hull in the world, grown by `margin` all round */
function hullBox(v: Vehicle, margin: number): Box {
  const { centre, half } = v.spec.hull;
  const c = v.toWorld(centre, { x: 0, y: 0, z: 0 });
  const r = v.body.rotation();
  return { x: c.x, y: c.y, z: c.z, hx: half.x + margin, hy: half.y + margin, hz: half.z + margin, q: [r.x, r.y, r.z, r.w] };
}

/** how far `p` is from the hull's sides, ignoring height unless it's well
 *  above or below; 0 inside */
function outside(v: Vehicle, p: Vec3): number {
  const { centre, half } = v.spec.hull;
  const t = v.body.translation();
  const r = v.body.rotation();
  // into the car's frame: undo its rotation
  const local = rotate({ x: -r.x, y: -r.y, z: -r.z, w: r.w }, { x: p.x - t.x, y: p.y - t.y, z: p.z - t.z }, P);
  if (local.y < centre.y - half.y - 2 || local.y > centre.y + half.y + 1) return Infinity;
  const dx = Math.max(0, Math.abs(local.x - centre.x) - half.x);
  const dz = Math.max(0, Math.abs(local.z - centre.z) - half.z);
  return Math.hypot(dx, dz);
}
