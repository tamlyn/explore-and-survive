/**
 * Places — names for where things are, so a playtest report and the code
 * mean the same spot: settlements S1, S2… in planning order (S1 is the one
 * in view of the spawn), their buildings S1.B1… and beacons, and compass
 * headings with north towards −z. The names hold for a given seed.
 */

import { BEACON, type Checkpoint } from './CheckpointPlan';
import { PROP_RADIUS, type Prop } from './PropPlan';
import type { RuinSite } from './RuinPlan';

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** a point this close outside a wall or prop still counts as on it (m) */
const MARGIN = 0.4;

/** degrees clockwise from north of the direction (dx, dz) */
export function heading(dx: number, dz: number): number {
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** e.g. "NE 47°" */
export function compass(deg: number): string {
  return `${POINTS[Math.round(deg / 45) % 8]} ${Math.round(deg)}°`;
}

export interface Bearing {
  name: string;
  distance: number;
  /** degrees clockwise from north */
  heading: number;
}

export class Places {
  constructor(
    readonly sites: readonly RuinSite[],
    private readonly props: readonly Prop[],
    private readonly checkpoints: readonly Checkpoint[],
  ) {}

  /** e.g. "S3" */
  name(site: number): string {
    return siteName(site);
  }

  /** the `n` closest settlements to (x, z), closest first */
  nearest(x: number, z: number, n: number): Bearing[] {
    return this.sites
      .map((s, i) => ({ name: siteName(i), distance: Math.hypot(s.x - x, s.z - z), heading: heading(s.x - x, s.z - z) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, n);
  }

  /** the building, beacon or prop standing at (x, z), if any, e.g.
   *  "S3.B2", "S3 beacon" or "S3 car" */
  at(x: number, z: number): string | null {
    for (const [i, site] of this.sites.entries()) {
      for (const [j, b] of site.buildings.entries()) {
        const c = Math.cos(b.yaw);
        const s = Math.sin(b.yaw);
        const dx = x - b.x;
        const dz = z - b.z;
        const lx = dx * c - dz * s;
        const lz = dx * s + dz * c;
        if (Math.abs(lx) <= b.width / 2 + MARGIN && Math.abs(lz) <= b.depth / 2 + MARGIN) {
          return `${siteName(i)}.B${j + 1}`;
        }
      }
    }
    for (const c of this.checkpoints) {
      if (Math.abs(x - c.x) <= BEACON.plinth.half + MARGIN && Math.abs(z - c.z) <= BEACON.plinth.half + MARGIN) {
        return `${siteName(c.site)} beacon`;
      }
    }
    for (const p of this.props) {
      if (Math.hypot(p.x - x, p.z - z) > PROP_RADIUS[p.kind] + MARGIN) continue;
      const [site] = this.nearest(p.x, p.z, 1);
      return site ? `${site.name} ${p.kind}` : p.kind;
    }
    return null;
  }
}

function siteName(i: number): string {
  return `S${i + 1}`;
}
