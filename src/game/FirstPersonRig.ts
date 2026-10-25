/**
 * FirstPersonRig — puts the camera at the player's eye and layers on the
 * walking feel: stride-matched head bob and roll, a sprung dip on hard
 * landings and a sprint FOV kick. Reads player state only; another rig
 * (third-person) can replace it without touching movement.
 */

import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import { aimCamera } from '../core/CameraAim';
import { type Spring, stepSpring } from '../core/Spring';
import { WALK_SPEED, SPRINT_MULT } from './Player';
import type { Vec3 } from './PlayerMotor';

const STRIDE_RATE = 1.7; // rad of stride phase per meter at walk speed
const BOB_Y_WALK = 0.026; // m
const BOB_Y_SPRINT_ADD = 0.018; // extra at full sprint
const BOB_LATERAL = 0.55; // fraction of vertical amp, applied on right axis
const BOB_ROLL = 0.0032; // rad
const SPRINT_FOV_ADD = 6; // deg
const DIP_K = 150; // landing-dip spring stiffness
const DIP_C = 18; // landing-dip spring damping
/** landings softer than this (walking off a kerb) don't dip */
const DIP_MIN_SPEED = 3;

export interface RigSubject {
  readonly eye: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly speed: number;
  readonly grounded: boolean;
  readonly sprinting: boolean;
  readonly landingSpeed: number;
}

const RIGHT = new Vector3();

export class FirstPersonRig {
  baseFov: number;

  private stridePhase = 0;
  private bobK = 0; // smoothed 0..1+ speed factor driving bob amplitude
  private readonly dip: Spring = { x: 0, v: 0 };
  private fovKick = 0;

  constructor(private readonly camera: PerspectiveCamera) {
    this.baseFov = camera.fov;
  }

  reset(): void {
    this.stridePhase = 0;
    this.bobK = 0;
    this.dip.x = 0;
    this.dip.v = 0;
    this.fovKick = 0;
  }

  update(dt: number, p: RigSubject): void {
    const speedK = Math.min(p.speed / WALK_SPEED, SPRINT_MULT);
    // bob amplitude factor: fades in/out, zero while airborne
    const bobTarget = p.grounded ? Math.min(speedK, 1.3) : 0;
    this.bobK += (bobTarget - this.bobK) * (1 - Math.exp(-dt * 8));
    // stride cadence rises SUB-linearly with speed (sprint = longer strides,
    // not double-time steps); frozen while airborne — no steps in the air
    if (p.grounded && p.speed > 0.3) {
      this.stridePhase += STRIDE_RATE * WALK_SPEED * (0.55 + 0.45 * Math.min(speedK, 2)) * dt;
    }
    const ampY = (BOB_Y_WALK + BOB_Y_SPRINT_ADD * Math.max(Math.min(speedK - 1, 1), 0)) * this.bobK;
    const bobY = Math.sin(this.stridePhase * 2) * ampY;
    const bobX = Math.sin(this.stridePhase) * ampY * BOB_LATERAL;
    const roll = Math.sin(this.stridePhase) * BOB_ROLL * this.bobK;

    // landing dip ∝ impact speed
    if (p.landingSpeed > DIP_MIN_SPEED) this.dip.v -= Math.min(p.landingSpeed * 0.035, 0.2) * 9;
    stepSpring(this.dip, DIP_K, DIP_C, dt);

    const fovTarget =
      p.sprinting && p.grounded && p.speed > WALK_SPEED * 1.15 ? SPRINT_FOV_ADD : 0;
    this.fovKick += (fovTarget - this.fovKick) * (1 - Math.exp(-dt * 6));
    const fov = this.baseFov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    const cam = this.camera;
    aimCamera(cam, p.yaw, p.pitch, roll);
    RIGHT.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    cam.position.set(p.eye.x, p.eye.y + bobY + this.dip.x, p.eye.z).addScaledVector(RIGHT, bobX);
    // matrices fresh for every subsystem updateFn that runs after this one
    cam.updateMatrixWorld();
  }
}
