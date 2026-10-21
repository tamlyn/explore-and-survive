/**
 * PlayerMotor — the player's physical body (robots reuse it with their own
 * capsule): a kinematic capsule moved by
 * Rapier's character controller (slides along obstacles, steps over small
 * rocks, refuses walls steeper than MAX_CLIMB, snaps down gentle descents).
 * Gravity and jumping are integrated here; horizontal intent comes from the
 * caller. Knows nothing about input or cameras, so any rig (first- or
 * third-person) can sit on top.
 */

import type RAPIER from '@dimforge/rapier3d-compat';

type Rapier = typeof RAPIER;

export const CAPSULE_RADIUS = 0.3;
export const CAPSULE_HALF_HEIGHT = 0.6;
export const EYE_HEIGHT = 1.7;
export const GRAVITY = 22; // m/s² — game-feel gravity, not 9.81
export const JUMP_V0 = 7.0; // → ~1.1 m apex
const STEP_HEIGHT = 0.4;
const SNAP_DOWN = 0.5;
const MAX_CLIMB = (50 * Math.PI) / 180;
/** eye stays this far above water (there is no underwater rendering) */
export const WADE_CLEAR = 0.45;

export type WaterProbe = (x: number, z: number) => number;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Capsule {
  radius: number;
  halfHeight: number;
}

const PLAYER: Capsule = { radius: CAPSULE_RADIUS, halfHeight: CAPSULE_HALF_HEIGHT };

export class PlayerMotor {
  readonly feet: Vec3 = { x: 0, y: 0, z: 0 };
  grounded = false;
  velY = 0;
  /** downward speed at the most recent landing (0 when none this step) */
  landingSpeed = 0;

  /** the capsule — shots from the eye start inside it and must skip it */
  readonly collider: RAPIER.Collider;
  private readonly body: RAPIER.RigidBody;
  private readonly kcc: RAPIER.KinematicCharacterController;
  /** feet → capsule centre */
  private readonly centerY: number;

  constructor(
    rapier: Rapier,
    private readonly world: RAPIER.World,
    private readonly waterAt: WaterProbe | null = null,
    capsule: Capsule = PLAYER,
  ) {
    this.centerY = capsule.halfHeight + capsule.radius;
    this.body = world.createRigidBody(rapier.RigidBodyDesc.kinematicPositionBased());
    this.collider = world.createCollider(
      rapier.ColliderDesc.capsule(capsule.halfHeight, capsule.radius),
      this.body,
    );
    this.kcc = world.createCharacterController(0.02);
    this.kcc.enableAutostep(STEP_HEIGHT, 0.15, false);
    this.kcc.enableSnapToGround(SNAP_DOWN);
    this.kcc.setMaxSlopeClimbAngle(MAX_CLIMB);
    this.kcc.setMinSlopeSlideAngle(MAX_CLIMB);
  }

  /**
   * Nearest place around (x, z) where the capsule stands without touching
   * any obstacle (trunk, rock…), searched in rings out to `maxR`; falls back
   * to (x, z) itself. Feet sit on `groundAt` or the wade floor, whichever is
   * higher.
   */
  clearSpotNear(x: number, z: number, groundAt: (x: number, z: number) => number, maxR = 6): Vec3 {
    const feetAt = (px: number, pz: number): Vec3 => {
      const wade = this.waterAt ? this.waterAt(px, pz) + WADE_CLEAR - EYE_HEIGHT : -Infinity;
      return { x: px, y: Math.max(groundAt(px, pz), wade) + 0.05, z: pz };
    };
    for (let r = 0; r <= maxR; r += 0.5) {
      const n = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 0.5);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const spot = feetAt(x + Math.cos(a) * r, z + Math.sin(a) * r);
        if (this.fits(spot)) return spot;
      }
    }
    return feetAt(x, z);
  }

  private fits(feet: Vec3): boolean {
    let blocked = false;
    this.world.intersectionsWithShape(
      { x: feet.x, y: feet.y + this.centerY, z: feet.z },
      { x: 0, y: 0, z: 0, w: 1 },
      this.collider.shape,
      () => {
        blocked = true;
        return false;
      },
      undefined,
      undefined,
      this.collider,
    );
    return !blocked;
  }

  /** place the feet at a point, at rest */
  teleport(x: number, y: number, z: number): void {
    this.feet.x = x;
    this.feet.y = y;
    this.feet.z = z;
    this.velY = 0;
    this.grounded = false;
    this.body.setTranslation({ x, y: y + this.centerY, z }, true);
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  /**
   * Advance one fixed step. `vx`/`vz` are the desired horizontal velocity
   * (m/s); `jump` launches only when grounded.
   */
  step(vx: number, vz: number, jump: boolean, dt: number): void {
    this.landingSpeed = 0;
    if (jump && this.grounded) {
      this.velY = JUMP_V0;
      this.grounded = false;
    }
    // velocity-Verlet half-step keeps the jump apex exact at any dt
    const dy = (this.velY - GRAVITY * dt * 0.5) * dt;
    this.velY -= GRAVITY * dt;

    this.kcc.computeColliderMovement(this.collider, { x: vx * dt, y: dy, z: vz * dt });
    const mv = this.kcc.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.kcc.computedGrounded();
    if (this.grounded && this.velY < 0) {
      if (!wasGrounded) this.landingSpeed = -this.velY;
      this.velY = 0;
    }
    // ceiling: kill upward speed when the move was blocked from above
    if (this.velY > 0 && mv.y < dy * 0.5) this.velY = 0;

    this.feet.x += mv.x;
    this.feet.y += mv.y;
    this.feet.z += mv.z;

    if (this.waterAt) {
      const floor = this.waterAt(this.feet.x, this.feet.z) + WADE_CLEAR - EYE_HEIGHT;
      if (this.feet.y < floor) {
        this.feet.y = floor;
        if (this.velY < 0) this.velY = 0;
        this.grounded = true;
      }
    }

    this.place();
  }

  /** advance one fixed step airborne: no gravity, any direction (m/s) */
  fly(vx: number, vy: number, vz: number, dt: number): void {
    this.landingSpeed = 0;
    this.velY = 0;
    this.grounded = false;
    this.kcc.computeColliderMovement(this.collider, { x: vx * dt, y: vy * dt, z: vz * dt });
    const mv = this.kcc.computedMovement();
    this.feet.x += mv.x;
    this.feet.y += mv.y;
    this.feet.z += mv.z;
    this.place();
  }

  private place(): void {
    this.body.setNextKinematicTranslation({
      x: this.feet.x,
      y: this.feet.y + this.centerY,
      z: this.feet.z,
    });
  }

  dispose(): void {
    this.world.removeCharacterController(this.kcc);
    this.world.removeRigidBody(this.body);
  }
}
