/**
 * EnemyBrain — a robot's behaviour as a small state machine:
 *
 *   patrol — stroll between waypoints near home, pausing at each
 *   hunt   — the player is (or was just) in sight: close to attack range,
 *            face them and attack on a cooldown
 *   search — lost sight, or heard a shot: go to the spot, look around,
 *            give up and go back to patrolling
 *
 * Pure decision-making: senses come in (where the body is, whether the
 * player is in sight), intent goes out (velocity, heading, pose, whether an
 * attack lands). Line of sight, movement and damage belong to the caller.
 */

import type { Rng } from '../core/Seed';
import type { RobotSpec } from './RobotSpec';

export type BrainState = 'patrol' | 'hunt' | 'search' | 'dead';
export type Pose = 'idle' | 'walk' | 'run' | 'attack' | 'dead';

export interface BrainWorld {
  /** somewhere the robot may stand (walkers keep out of water) */
  dry(x: number, z: number): boolean;
  /** nothing solid on the straight walk between */
  clear(x0: number, z0: number, x1: number, z1: number): boolean;
}

export interface Senses {
  x: number;
  z: number;
  /** the player, if in sight */
  seen: { x: number; z: number } | null;
}

export interface Home {
  x: number;
  z: number;
  roam: number;
}

/** first sighting to first attack (s) — a moment to react */
const REACTION = 0.7;
/** out of sight this long, the hunt becomes a search (s) */
const LOSE_TIME = 2;
/** lingering where the player was last seen or heard (s) */
const SEARCH_TIME = 5;
/** hurrying, not charging: a fraction of a robot's run */
const SEARCH_PACE = 0.7;
const ARRIVE = 1.2;
/** gunmen hold this fraction of their range rather than close in */
const STAND_OFF = 0.7;
/** facing error within which an attack may start (rad) */
const AIM_TOLERANCE = 0.35;
/** a robot making less than this fraction of the progress it wants is stuck */
const STUCK_PROGRESS = 0.25;
const STUCK_TIME = 0.6;
const DETOUR_TIME = 1;

function angleTo(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** yaw facing along (dx, dz): 0 looks −z */
export function yawToward(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

export class EnemyBrain {
  state: BrainState = 'patrol';
  yaw: number;
  pose: Pose = 'idle';
  /** horizontal velocity wanted this tick (m/s) */
  readonly move = { x: 0, z: 0 };

  private target: { x: number; z: number } | null = null;
  private wait = 0;
  private cooldown = 0;
  /** ≥ 0 while an attack winds up */
  private windup = -1;
  private lostFor = 0;
  private stuckFor = 0;
  private detour = 0;
  private detourSide = 1;
  private lastX = NaN;
  private lastZ = 0;
  private wanted = 0;

  constructor(
    private readonly spec: RobotSpec,
    private readonly home: Home,
    private readonly rng: Rng,
    private readonly world: BrainWorld,
  ) {
    this.yaw = rng.float() * Math.PI * 2;
  }

  /** a shot heard or taken from (x, z): go and look */
  alert(x: number, z: number): void {
    if (this.state === 'dead') return;
    if (this.state === 'hunt' && this.lostFor === 0) return;
    if (this.state !== 'hunt') this.state = 'search';
    this.target = { x, z };
    this.wait = SEARCH_TIME;
  }

  /** the player is gone (respawned elsewhere): back to the rounds */
  forget(): void {
    if (this.state === 'dead') return;
    this.state = 'patrol';
    this.target = null;
    this.windup = -1;
  }

  die(): void {
    this.state = 'dead';
    this.pose = 'dead';
    this.move.x = 0;
    this.move.z = 0;
  }

  /** one fixed step; true when an attack lands on this one */
  tick(dt: number, s: Senses): boolean {
    if (this.state === 'dead') return false;
    this.trackProgress(dt, s);
    this.cooldown -= dt;

    if (s.seen) {
      if (this.state !== 'hunt') this.cooldown = Math.max(this.cooldown, REACTION);
      this.state = 'hunt';
      this.target = { x: s.seen.x, z: s.seen.z };
      this.lostFor = 0;
    } else if (this.state === 'hunt') {
      this.lostFor += dt;
      if (this.lostFor > LOSE_TIME) {
        this.state = 'search';
        this.wait = SEARCH_TIME;
      }
    }

    if (this.windup >= 0) return this.attacking(dt, s);
    if (this.state === 'hunt') this.hunt(dt, s);
    else if (this.state === 'search') this.search(dt, s);
    else this.patrol(dt, s);
    return false;
  }

  private attacking(dt: number, s: Senses): boolean {
    this.stop();
    this.pose = 'attack';
    if (this.target) this.turnToward(this.target.x - s.x, this.target.z - s.z, dt);
    this.windup -= dt;
    if (this.windup >= 0) return false;
    this.windup = -1;
    return s.seen !== null;
  }

  private hunt(dt: number, s: Senses): void {
    const t = this.target!;
    const dx = t.x - s.x;
    const dz = t.z - s.z;
    const d = Math.hypot(dx, dz);
    const { attack } = this.spec;
    const facing = Math.abs(angleTo(this.yaw, yawToward(dx, dz))) < AIM_TOLERANCE;
    if (s.seen && d <= attack.range && this.cooldown <= 0 && facing) {
      this.windup = attack.windup;
      this.cooldown = attack.interval * this.rng.range(0.8, 1.25);
      this.attacking(0, s);
      return;
    }
    const hold = s.seen && d < attack.range * (attack.ranged ? STAND_OFF : 0.8);
    if (hold) {
      this.stop();
      this.turnToward(dx, dz, dt);
      this.pose = 'idle';
    } else {
      this.steer(dx, dz, this.spec.run, dt, s);
    }
  }

  private search(dt: number, s: Senses): void {
    const t = this.target;
    if (t && Math.hypot(t.x - s.x, t.z - s.z) > ARRIVE) {
      if (this.steer(t.x - s.x, t.z - s.z, this.spec.run * SEARCH_PACE, dt, s)) return;
    }
    // there, or can't get there: look around for a while
    this.target = null;
    this.stop();
    this.pose = 'idle';
    this.yaw += dt * 0.8;
    this.wait -= dt;
    if (this.wait <= 0) this.state = 'patrol';
  }

  private patrol(dt: number, s: Senses): void {
    if (this.wait > 0) {
      this.wait -= dt;
      this.stop();
      this.pose = 'idle';
      return;
    }
    this.target ??= this.waypoint(s);
    const t = this.target;
    if (!t || Math.hypot(t.x - s.x, t.z - s.z) < ARRIVE || !this.steer(t.x - s.x, t.z - s.z, this.spec.walk, dt, s)) {
      this.target = null;
      this.wait = this.rng.range(2, 6);
      this.stop();
      this.pose = 'idle';
    }
  }

  private waypoint(s: Senses): { x: number; z: number } | null {
    for (let k = 0; k < 6; k++) {
      const a = this.rng.float() * Math.PI * 2;
      const r = this.home.roam * Math.sqrt(this.rng.float());
      const x = this.home.x + Math.cos(a) * r;
      const z = this.home.z + Math.sin(a) * r;
      if (this.world.dry(x, z) && this.world.clear(s.x, s.z, x, z)) return { x, z };
    }
    return null;
  }

  /** head along (dx, dz), turning first; false when the way is blocked */
  private steer(dx: number, dz: number, speed: number, dt: number, s: Senses): boolean {
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return false;
    let ux = dx / d;
    let uz = dz / d;
    if (this.detour > 0) {
      // sidestep whatever we're pressed against
      this.detour -= dt;
      [ux, uz] = [-uz * this.detourSide, ux * this.detourSide];
    }
    if (!this.world.dry(s.x + ux * 1.5, s.z + uz * 1.5)) {
      this.stop();
      return false;
    }
    if (this.stuckFor > STUCK_TIME) {
      this.stuckFor = 0;
      // only a hunt is worth working round an obstacle for
      if (this.state !== 'hunt') return false;
      this.detour = DETOUR_TIME;
      this.detourSide = this.rng.chance(0.5) ? 1 : -1;
    }
    this.turnToward(ux, uz, dt);
    // turn on the spot before setting off
    const along = Math.max(0, Math.cos(angleTo(this.yaw, yawToward(ux, uz))));
    this.move.x = ux * speed * along;
    this.move.z = uz * speed * along;
    this.wanted = speed * along;
    this.pose = speed > this.spec.walk * 1.2 ? 'run' : 'walk';
    return true;
  }

  private turnToward(dx: number, dz: number, dt: number): void {
    const err = angleTo(this.yaw, yawToward(dx, dz));
    const step = this.spec.turn * dt;
    this.yaw += Math.max(-step, Math.min(step, err));
  }

  private stop(): void {
    this.move.x = 0;
    this.move.z = 0;
    this.wanted = 0;
  }

  /** compares how far the body went with how far it was asked to go */
  private trackProgress(dt: number, s: Senses): void {
    if (this.wanted > 0.3) {
      const moved = Math.hypot(s.x - this.lastX, s.z - this.lastZ);
      if (moved < this.wanted * dt * STUCK_PROGRESS) this.stuckFor += dt;
      else this.stuckFor = Math.max(0, this.stuckFor - dt);
    }
    this.lastX = s.x;
    this.lastZ = s.z;
  }
}
