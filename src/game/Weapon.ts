/**
 * Weapon — magazine, spare rounds, rate of fire and reload as a small state
 * machine. Reloading draws on the spares, which only pickups replenish. It
 * decides *when* a shot happens; where it goes (the ray from the aim) and how
 * it looks (viewmodel, sound, impacts) belong to the caller, so the same
 * weapon works under any camera rig.
 */

export interface WeaponSpec {
  /** shortest gap between shots (s) */
  fireInterval: number;
  magazine: number;
  /** spare rounds to start with */
  spare: number;
  /** most spare rounds that can be carried */
  carry: number;
  reloadTime: number;
  /** m */
  range: number;
  /** hit points per round */
  damage: number;
  /** cone half-angle (rad) standing still; moving widens it */
  spread: number;
  /** upward aim kick per shot (rad) */
  recoil: number;
}

export const PISTOL: WeaponSpec = {
  fireInterval: 0.14,
  magazine: 12,
  spare: 24,
  carry: 60,
  reloadTime: 1.3,
  range: 200,
  damage: 25,
  spread: 0.004,
  recoil: 0.016,
};

/** a trigger press this close before the gun is ready still fires */
const TRIGGER_BUFFER = 0.15;

/** fire: a round left the barrel; dry: trigger on an empty magazine (a
 *  reload starts with it, if there are spares); reload / reloaded: start
 *  and end of a reload */
export type WeaponEvent = 'fire' | 'dry' | 'reload' | 'reloaded';

export class Weapon {
  ammo: number;
  spare: number;
  private cooldown = 0;
  private reloadLeft = 0;
  private pending = 0;

  constructor(readonly spec: WeaponSpec) {
    this.ammo = spec.magazine;
    this.spare = spec.spare;
  }

  /** take up to `n` spare rounds; how many there was room for */
  addSpare(n: number): number {
    const taken = Math.min(n, this.spec.carry - this.spare);
    this.spare += taken;
    return taken;
  }

  /** a full magazine and at least the starting spares, as after respawning */
  restock(): void {
    this.reloadLeft = 0;
    this.pending = 0;
    this.cooldown = 0;
    this.ammo = this.spec.magazine;
    this.spare = Math.max(this.spare, this.spec.spare);
  }

  get reloading(): boolean {
    return this.reloadLeft > 0;
  }

  /** 0 → 1 through a reload, 0 otherwise */
  get reloadProgress(): number {
    return this.reloading ? 1 - this.reloadLeft / this.spec.reloadTime : 0;
  }

  /** `trigger` is a fresh press (semi-automatic), `reload` the reload key */
  update(dt: number, trigger: boolean, reload: boolean): WeaponEvent | null {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.pending = trigger ? TRIGGER_BUFFER : Math.max(0, this.pending - dt);
    if (this.reloading) {
      this.pending = 0;
      this.reloadLeft -= dt;
      if (this.reloadLeft > 0) return null;
      this.reloadLeft = 0;
      const n = Math.min(this.spec.magazine - this.ammo, this.spare);
      this.ammo += n;
      this.spare -= n;
      return 'reloaded';
    }
    if (this.pending > 0 && this.cooldown === 0) {
      this.pending = 0;
      if (this.ammo === 0) {
        if (this.spare > 0) this.reloadLeft = this.spec.reloadTime;
        return 'dry';
      }
      this.ammo--;
      this.cooldown = this.spec.fireInterval;
      return 'fire';
    }
    if (reload && this.ammo < this.spec.magazine && this.spare > 0) {
      this.reloadLeft = this.spec.reloadTime;
      return 'reload';
    }
    return null;
  }
}

/** a direction within `spread` rad of unit vector `dir`, uniform over the
 *  cone's cross-section; `r1`, `r2` are uniform randoms in [0, 1) */
export function spreadDirection(
  dir: { x: number; y: number; z: number },
  spread: number,
  r1: number,
  r2: number,
): { x: number; y: number; z: number } {
  // any two axes perpendicular to dir
  const ux = Math.abs(dir.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let ax = dir.y * ux.z - dir.z * ux.y;
  let ay = dir.z * ux.x - dir.x * ux.z;
  let az = dir.x * ux.y - dir.y * ux.x;
  const al = Math.hypot(ax, ay, az);
  ax /= al;
  ay /= al;
  az /= al;
  const bx = dir.y * az - dir.z * ay;
  const by = dir.z * ax - dir.x * az;
  const bz = dir.x * ay - dir.y * ax;
  const r = Math.tan(spread) * Math.sqrt(r1);
  const th = r2 * Math.PI * 2;
  const p = r * Math.cos(th);
  const q = r * Math.sin(th);
  const x = dir.x + ax * p + bx * q;
  const y = dir.y + ay * p + by * q;
  const z = dir.z + az * p + bz * q;
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
}
