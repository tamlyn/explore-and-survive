/**
 * Free-fly camera — the debug/tooling view (bookmarks, ?cam=, flythrough,
 * probes). WASD + E/Q to move, Shift ×6, Alt ×0.15, wheel scales speed.
 * Holds a soft clearance above terrain and water (there is no underwater
 * rendering). Game controls (the player) live in src/game.
 */

import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import type { CamPose } from './Hooks';
import type { Input } from './Input';

const FORWARD = new Vector3();
const RIGHT = new Vector3();
const MOVE = new Vector3();

/** terrain/water heights at (x, z) — installed by the world scene */
export type GroundProbe = (x: number, z: number) => { ground: number; water: number };

const GROUND_CLEAR = 1.4;
const WATER_CLEAR = 0.45;

export class FlyCamera {
  yaw = 0;
  pitch = 0;
  /** m/s, wheel-scaled */
  speed = 24;
  baseFov: number;
  groundProbe: GroundProbe | null = null;

  private readonly vel = new Vector3();

  constructor(readonly camera: PerspectiveCamera) {
    this.baseFov = camera.fov;
  }

  update(dt: number, input: Input): void {
    const look = input.takeLook();
    this.yaw -= look.yaw;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - look.pitch));
    const wheel = input.takeWheel();
    if (wheel !== 0) {
      this.speed = Math.min(2000, Math.max(0.5, this.speed * Math.pow(1.15, -wheel)));
    }
    this.applyRotation();

    FORWARD.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    RIGHT.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    MOVE.set(0, 0, 0);
    if (input.held('KeyW')) MOVE.add(FORWARD);
    if (input.held('KeyS')) MOVE.sub(FORWARD);
    if (input.held('KeyD')) MOVE.add(RIGHT);
    if (input.held('KeyA')) MOVE.sub(RIGHT);
    if (input.held('KeyE')) MOVE.y += 1;
    if (input.held('KeyQ')) MOVE.y -= 1;
    let target = 0;
    if (MOVE.lengthSq() > 0) {
      MOVE.normalize();
      target = this.speed;
      if (input.held('ShiftLeft') || input.held('ShiftRight')) target *= 6;
      if (input.held('AltLeft')) target *= 0.15;
    }
    this.vel.lerp(MOVE.multiplyScalar(target), 1 - Math.exp(-dt * 9));
    this.camera.position.addScaledVector(this.vel, dt);

    if (this.groundProbe) {
      const c = this.camera.position;
      const g = this.groundProbe(c.x, c.z);
      c.y = Math.max(c.y, g.ground + GROUND_CLEAR, g.water + WATER_CLEAR);
    }
    // matrices fresh for every subsystem updateFn that runs after this one
    this.camera.updateMatrixWorld();
  }

  setPose(pose: CamPose): void {
    this.camera.position.set(pose.p[0], pose.p[1], pose.p[2]);
    this.yaw = pose.yaw;
    this.pitch = pose.pitch;
    this.vel.set(0, 0, 0);
    if (pose.fov !== undefined) this.baseFov = pose.fov;
    if (this.camera.fov !== this.baseFov) {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
    this.applyRotation();
    // recompose matrixWorld/matrixWorldInverse NOW: subsystems copy camera
    // state in their own updateFns and must never read a stale matrix
    this.camera.updateMatrixWorld();
  }

  getPose(): CamPose {
    const p = this.camera.position;
    return { p: [p.x, p.y, p.z], yaw: this.yaw, pitch: this.pitch, fov: this.baseFov };
  }

  private applyRotation(): void {
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }
}
