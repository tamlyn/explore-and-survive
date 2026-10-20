/**
 * Player — the controllable character: aim (yaw/pitch), movement intent
 * (walk/sprint/jump) and a fixed-rate physics body. Camera rigs read its
 * state; it never touches a camera, so first- and third-person views are
 * interchangeable on top of it.
 *
 * Physics runs at FIXED_DT regardless of frame rate (the motor's collision
 * response and the jump arc stay identical at 20 or 144 fps); the eye
 * position handed to rigs is interpolated between the last two ticks.
 */

import { EYE_HEIGHT, type PlayerMotor, type Vec3 } from './PlayerMotor';

export const WALK_SPEED = 4.6; // m/s
export const SPRINT_MULT = 2.0;
const SLOW_MULT = 0.35;
const GROUND_ACCEL = 10; // exp-damp rate toward wish velocity
const AIR_ACCEL = 2.5; // reduced air control
export const FIXED_DT = 1 / 60;
/** longest frame simulated in full — beyond it the world slows rather than
 *  spiralling (a tab stall must not fire hundreds of ticks) */
const MAX_FRAME = 0.25;
/** a jump tap this close before touching down still jumps */
const JUMP_BUFFER = 0.15;
const PITCH_LIMIT = 1.55;

export interface PlayerInput {
  held(code: string): boolean;
  takePress(code: string): boolean;
  takeLook(): { yaw: number; pitch: number };
}

export class Player {
  yaw = 0;
  pitch = 0;
  /** render-rate eye position, interpolated between physics ticks */
  readonly eye: Vec3 = { x: 0, y: 0, z: 0 };
  /** current horizontal velocity (m/s) */
  readonly vel = { x: 0, z: 0 };
  sprinting = false;
  /** hardest landing (m/s downward) during the last update, 0 if none */
  landingSpeed = 0;

  private readonly prevFeet: Vec3 = { x: 0, y: 0, z: 0 };
  private acc = 0;
  private jumpBuffer = 0;

  constructor(
    private readonly motor: PlayerMotor,
    /** advances the shared physics world by one FIXED_DT tick */
    private readonly stepWorld: () => void,
  ) {}

  get grounded(): boolean {
    return this.motor.grounded;
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /** place the player with their feet at (x, y, z), at rest */
  spawn(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.motor.teleport(x, y, z);
    this.yaw = yaw;
    this.pitch = pitch;
    this.vel.x = 0;
    this.vel.z = 0;
    this.acc = 0;
    this.jumpBuffer = 0;
    Object.assign(this.prevFeet, this.motor.feet);
    this.setEye(1);
  }

  /** turn the aim (rad; yaw left +, pitch up +) */
  addAim(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch + dPitch));
  }

  update(dt: number, input: PlayerInput): void {
    const look = input.takeLook();
    this.addAim(-look.yaw, -look.pitch);
    if (input.takePress('Space')) this.jumpBuffer = JUMP_BUFFER;

    // wish velocity in the yaw plane — pitch never tilts the gait
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let fwd = 0;
    let side = 0;
    if (input.held('KeyW')) fwd += 1;
    if (input.held('KeyS')) fwd -= 1;
    if (input.held('KeyD')) side += 1;
    if (input.held('KeyA')) side -= 1;
    const len = Math.hypot(fwd, side);
    this.sprinting = len > 0 && (input.held('ShiftLeft') || input.held('ShiftRight'));
    let speed = len > 0 ? WALK_SPEED * (this.sprinting ? SPRINT_MULT : 1) : 0;
    if (input.held('AltLeft')) speed *= SLOW_MULT;
    const k = len > 0 ? speed / len : 0;
    const wishX = (-sin * fwd + cos * side) * k;
    const wishZ = (-cos * fwd - sin * side) * k;
    const holdJump = input.held('Space');

    this.landingSpeed = 0;
    this.acc += Math.min(dt, MAX_FRAME);
    while (this.acc >= FIXED_DT) {
      Object.assign(this.prevFeet, this.motor.feet);
      const damp = 1 - Math.exp(-FIXED_DT * (this.motor.grounded ? GROUND_ACCEL : AIR_ACCEL));
      this.vel.x += (wishX - this.vel.x) * damp;
      this.vel.z += (wishZ - this.vel.z) * damp;
      const wantsJump = holdJump || this.jumpBuffer > 0;
      if (wantsJump && this.motor.grounded) this.jumpBuffer = 0;
      this.motor.step(this.vel.x, this.vel.z, wantsJump, FIXED_DT);
      this.stepWorld();
      this.landingSpeed = Math.max(this.landingSpeed, this.motor.landingSpeed);
      this.jumpBuffer = Math.max(0, this.jumpBuffer - FIXED_DT);
      this.acc -= FIXED_DT;
    }
    this.setEye(this.acc / FIXED_DT);
  }

  private setEye(alpha: number): void {
    const a = this.prevFeet;
    const b = this.motor.feet;
    this.eye.x = a.x + (b.x - a.x) * alpha;
    this.eye.y = a.y + (b.y - a.y) * alpha + EYE_HEIGHT;
    this.eye.z = a.z + (b.z - a.z) * alpha;
  }
}
