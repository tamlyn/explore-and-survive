/**
 * Driver — the player at the wheel: W and S for the throttle (S brakes, then
 * reverses), A and D to steer, Space for the handbrake, and the mouse to
 * look about, which eases back to straight ahead once left alone on the
 * move. Advances the world at the same fixed rate as the Player does on
 * foot; the car is drawn between ticks by `alpha`.
 */

import { FIXED_DT, type PlayerInput } from './Player';
import type { Vehicle } from './Vehicle';

/** longest frame simulated in full, as on foot */
const MAX_FRAME = 0.25;
/** how far the driver can look round (rad) */
const LOOK_YAW = 2.6;
const LOOK_PITCH = 1.2;
/** the view eases back ahead after the mouse rests this long (s)… */
const RECENTER_AFTER = 1.2;
/** …at this rate (1/s), once the car is moving faster than this (m/s) */
const RECENTER_RATE = 2;
const RECENTER_SPEED = 3;

export class Driver {
  /** where the driver looks, from straight ahead: yaw left +, pitch up + */
  lookYaw = 0;
  lookPitch = 0;
  private vehicleV: Vehicle | null = null;
  private acc = 0;
  private resting = 0;

  constructor(
    /** advances the shared physics world by one FIXED_DT tick */
    private readonly stepWorld: () => void,
  ) {}

  get vehicle(): Vehicle | null {
    return this.vehicleV;
  }

  /** how far between the last tick and the next the frame falls */
  get alpha(): number {
    return this.acc / FIXED_DT;
  }

  take(v: Vehicle): void {
    this.vehicleV = v;
    v.driven = true;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.acc = 0;
    this.resting = 0;
  }

  /** step out, leaving the car with its brakes on */
  leave(): Vehicle | null {
    const v = this.vehicleV;
    if (v) {
      v.driven = false;
      Object.assign(v.controls, { throttle: 0, steer: 0, handbrake: false });
    }
    this.vehicleV = null;
    return v;
  }

  update(dt: number, input: PlayerInput): void {
    const v = this.vehicleV;
    if (!v) return;
    const look = input.takeLook();
    this.lookYaw = Math.max(-LOOK_YAW, Math.min(LOOK_YAW, this.lookYaw - look.yaw));
    this.lookPitch = Math.max(-LOOK_PITCH, Math.min(LOOK_PITCH, this.lookPitch - look.pitch));
    this.resting = look.yaw || look.pitch ? 0 : this.resting + dt;
    if (this.resting > RECENTER_AFTER && Math.abs(v.speed) > RECENTER_SPEED) {
      const k = Math.exp(-RECENTER_RATE * dt);
      this.lookYaw *= k;
      this.lookPitch *= k;
    }
    const key = (code: string): number => (input.held(code) ? 1 : 0);
    v.controls.throttle = key('KeyW') - key('KeyS');
    v.controls.steer = key('KeyD') - key('KeyA');
    v.controls.handbrake = input.held('Space');

    this.acc += Math.min(dt, MAX_FRAME);
    while (this.acc >= FIXED_DT) {
      this.stepWorld();
      this.acc -= FIXED_DT;
    }
  }
}
