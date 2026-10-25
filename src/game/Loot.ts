/**
 * Loot — what the player can pick up: medkits packed in the settlements'
 * crates (which go once taken), and the metal, wood and medkits left on the
 * ground by destroyed robots and felled trees. Walking up to it takes it,
 * but only when the player can use it, so a crate waits until it's needed.
 * The views draw it; this decides.
 */

import type { Box } from '../world/Box';
import type { PropKind } from '../world/PropPlan';
import type { Surface } from './Physics';
import type { Vec3 } from './PlayerMotor';

/** what's gathered to build and buy with */
export type Material = 'wood' | 'metal';
export type LootKind = 'medkit' | Material;

export interface Haul {
  kind: LootKind;
  /** hit points, or units of material */
  amount: number;
}

/** what each kind of prop holds */
export const CACHE_LOOT: Partial<Record<PropKind, Haul>> = {
  woodCrate: { kind: 'medkit', amount: 40 },
};

/** a robot always leaves scrap metal, and sometimes a medkit */
const WRECK_METAL = { min: 2, max: 5 };
const WRECK_MEDKIT = { chance: 0.3, amount: 25 };
/** what's left together lies within this radius (m) */
const DROP_SPREAD = 0.4;
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
  wreck(x: number, y: number, z: number): void {
    const r = this.random;
    const hauls: Haul[] = [{ kind: 'metal', amount: Math.round(WRECK_METAL.min + r() * (WRECK_METAL.max - WRECK_METAL.min)) }];
    if (r() < WRECK_MEDKIT.chance) hauls.push({ kind: 'medkit', amount: WRECK_MEDKIT.amount });
    this.scatter(hauls, x, y, z);
  }

  /** lay `hauls` on the ground round (x, y, z), evenly about a random turn */
  scatter(hauls: readonly Haul[], x: number, y: number, z: number): void {
    const turn = this.random() * Math.PI * 2;
    const r = hauls.length > 1 ? DROP_SPREAD : 0;
    hauls.forEach((h, i) => {
      const a = turn + (i / hauls.length) * Math.PI * 2;
      this.add(h, x + Math.cos(a) * r, y, z + Math.sin(a) * r);
    });
  }

  /** offer everything within reach of the feet at `at` to `use`, which
   *  says whether it was taken; each is offered after the last is used, so
   *  a second medkit isn't wasted on a player the first one healed */
  reach(at: Vec3, use: (haul: Haul) => boolean): void {
    this.caches.forEach((c, i) => {
      if (!this.left[i]) return;
      const { box } = c;
      if (Math.abs(at.y - box.y) > 2) return;
      if (Math.hypot(at.x - box.x, at.z - box.z) > Math.hypot(box.hx, box.hz) + CACHE_REACH) return;
      if (!use(c)) return;
      this.left[i] = false;
      this.cacheView.take(i);
    });
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      if (Math.hypot(at.x - d.x, at.y - d.y, at.z - d.z) > DROP_REACH || !use(d)) continue;
      this.drops.splice(i, 1);
      this.dropView.remove(d.id);
    }
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
