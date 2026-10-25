/**
 * Loot — what the player can pick up: ammo and medkits, either packed in
 * the settlements' crates (which go once taken) or dropped by destroyed
 * robots. Walking up to it takes it, but only when the player can use it,
 * so a crate waits until it's needed. The views draw it; this decides.
 */

import type { Box } from '../world/Box';
import type { PropKind } from '../world/PropPlan';
import type { Surface } from './Physics';
import type { Vec3 } from './PlayerMotor';

export type LootKind = 'ammo' | 'medkit';

export interface Haul {
  kind: LootKind;
  /** rounds, or hit points */
  amount: number;
}

/** what each kind of prop holds */
export const CACHE_LOOT: Partial<Record<PropKind, Haul>> = {
  ammoCrates: { kind: 'ammo', amount: 24 },
  woodCrate: { kind: 'medkit', amount: 40 },
};

/** a robot always leaves rounds, and sometimes a medkit */
const DROP_AMMO = { min: 6, max: 12 };
const DROP_MEDKIT = { chance: 0.3, amount: 25 };
/** the two lie this far apart (m) */
const DROP_SPREAD = 0.5;
/** of each kind on the ground at once; the oldest goes to make room */
export const MAX_DROPS = 48;

/** a prop with something in it */
export interface Cache extends Haul {
  box: Box & { surface: Surface };
}

export interface CacheView {
  take(i: number): void;
}

export interface DropView {
  /** an id for `remove` */
  add(kind: LootKind, x: number, y: number, z: number): number;
  remove(id: number): void;
}

/** how far past a crate's footprint the player reaches into it (m) */
const CACHE_REACH = 0.7;
/** how close the feet must come to a dropped pickup (m) */
const DROP_REACH = 1.2;

interface Drop extends Haul {
  x: number;
  y: number;
  z: number;
  id: number;
}

export class Loot {
  private readonly left: boolean[];
  private readonly drops: Drop[] = [];

  constructor(
    private readonly caches: readonly Cache[],
    private readonly cacheView: CacheView,
    private readonly dropView: DropView,
    private readonly random: () => number = Math.random,
  ) {
    this.left = caches.map(() => true);
  }

  /** what a robot destroyed at (x, z) leaves on the ground at `y` */
  drop(x: number, y: number, z: number): void {
    const r = this.random;
    const ammo = Math.round(DROP_AMMO.min + r() * (DROP_AMMO.max - DROP_AMMO.min));
    const medkit = r() < DROP_MEDKIT.chance;
    const a = r() * Math.PI * 2;
    const dx = medkit ? Math.cos(a) * DROP_SPREAD * 0.5 : 0;
    const dz = medkit ? Math.sin(a) * DROP_SPREAD * 0.5 : 0;
    this.add({ kind: 'ammo', amount: ammo }, x + dx, y, z + dz);
    if (medkit) this.add({ kind: 'medkit', amount: DROP_MEDKIT.amount }, x - dx, y, z - dz);
  }

  /** take everything within reach of the feet at `at` that `wants` will
   *  have, and say what it was */
  reach(at: Vec3, wants: (kind: LootKind) => boolean): Haul[] {
    const taken: Haul[] = [];
    this.caches.forEach((c, i) => {
      if (!this.left[i] || !wants(c.kind)) return;
      const { box } = c;
      if (Math.abs(at.y - box.y) > 2) return;
      if (Math.hypot(at.x - box.x, at.z - box.z) > Math.hypot(box.hx, box.hz) + CACHE_REACH) return;
      this.left[i] = false;
      this.cacheView.take(i);
      taken.push({ kind: c.kind, amount: c.amount });
    });
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      if (!wants(d.kind) || Math.hypot(at.x - d.x, at.y - d.y, at.z - d.z) > DROP_REACH) continue;
      this.drops.splice(i, 1);
      this.dropView.remove(d.id);
      taken.push({ kind: d.kind, amount: d.amount });
    }
    return taken;
  }

  private add(haul: Haul, x: number, y: number, z: number): void {
    const same = this.drops.filter((d) => d.kind === haul.kind);
    if (same.length >= MAX_DROPS) {
      const oldest = same[0]!;
      this.drops.splice(this.drops.indexOf(oldest), 1);
      this.dropView.remove(oldest.id);
    }
    this.drops.push({ ...haul, x, y, z, id: this.dropView.add(haul.kind, x, y, z) });
  }
}
