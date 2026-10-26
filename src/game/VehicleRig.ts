/**
 * VehicleRig — the camera while driving: in the driver's seat, turning with
 * the car and the driver's look, or (third person) following behind it,
 * swinging round after the car's heading and pulled in short of anything
 * that would come between it and the car.
 */

import type { PerspectiveCamera } from 'three';
import { Quaternion, Vector3 } from 'three';
import { aimDirection } from '../core/CameraAim';
import type { Vec3 } from './PlayerMotor';
import type { Pose, Vehicle } from './Vehicle';

export type DriveView = 'first' | 'third';

/** the chase camera looks down at the car this steeply (rad)… */
const CHASE_PITCH = -0.22;
/** …and swings round after its heading at this rate (1/s) */
const CHASE_FOLLOW = 4;
/** it stays this far short of what's behind it, and above the ground (m) */
const CHASE_CLEAR = 0.3;
const CHASE_GROUND = 0.5;

export interface RigWorld {
  /** how far a ray goes before it meets something, other than `v`'s hull */
  reach(from: Vec3, dir: Vec3, max: number, v: Vehicle): number;
  groundAt(x: number, z: number): number;
}

const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const Q = new Quaternion();
const LOOK = new Quaternion();
const EYE: Vec3 = { x: 0, y: 0, z: 0 };
const TARGET = new Vector3();
const AHEAD = new Vector3();

export class VehicleRig {
  view: DriveView = 'third';
  /** the heading the chase camera has swung round to */
  private heading = 0;
  /** the camera's aim, for reports: yaw left +, pitch up + */
  yaw = 0;
  pitch = 0;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly world: RigWorld,
  ) {}

  reset(v: Vehicle): void {
    this.heading = v.yaw;
  }

  update(dt: number, v: Vehicle, pose: Pose, lookYaw: number, lookPitch: number): void {
    const cam = this.camera;
    if (this.view === 'first') {
      v.toWorld(v.spec.seat, EYE, pose);
      cam.position.set(EYE.x, EYE.y, EYE.z);
      LOOK.setFromAxisAngle(Y, lookYaw).multiply(Q.setFromAxisAngle(X, lookPitch));
      cam.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w).multiply(LOOK);
      const f = AHEAD.set(0, 0, -1).applyQuaternion(cam.quaternion);
      this.yaw = Math.atan2(-f.x, -f.z);
      this.pitch = Math.asin(Math.max(-1, Math.min(1, f.y)));
    } else {
      // turn the short way round after the car
      const turn = Math.atan2(Math.sin(v.yaw - this.heading), Math.cos(v.yaw - this.heading));
      this.heading += turn * (1 - Math.exp(-CHASE_FOLLOW * dt));
      this.yaw = this.heading + lookYaw;
      this.pitch = Math.max(-1.3, Math.min(0.5, CHASE_PITCH + lookPitch));
      TARGET.set(pose.p.x, pose.p.y + v.spec.chase.height, pose.p.z);
      const ahead = aimDirection(this.yaw, this.pitch);
      const back = { x: -ahead.x, y: -ahead.y, z: -ahead.z };
      const max = v.spec.chase.distance;
      const d = Math.max(0.5, Math.min(max, this.world.reach(TARGET, back, max, v) - CHASE_CLEAR));
      const x = TARGET.x + back.x * d;
      const z = TARGET.z + back.z * d;
      const y = Math.max(TARGET.y + back.y * d, this.world.groundAt(x, z) + CHASE_GROUND);
      cam.position.set(x, y, z);
      cam.lookAt(TARGET);
    }
    cam.updateMatrixWorld();
  }
}
