/**
 * Checkpoints — a beacon in every settlement for the player to find: a mast
 * on a stone plinth, standing in open ground near the middle, clear of the
 * houses, their doorways and the clutter. Pure layout like PropPlan; the
 * game decides what claiming one means (see game/Checkpoints).
 */

import type { Box } from './Box';
import { PROP_RADIUS, type Prop } from './PropPlan';
import { footprintRadius, type Ground, type RuinSite } from './RuinPlan';

export interface Checkpoint {
  /** index of its settlement */
  site: number;
  x: number;
  /** the ground under the plinth's centre */
  y: number;
  z: number;
}

/** beacon dimensions (m) */
export const BEACON = {
  plinth: { half: 0.45, height: 0.5 },
  mast: { radius: 0.08, height: 4 },
  lamp: { radius: 0.2 },
};

/** the plinth keeps this far from house footprints, which covers a doorway's
 *  path out, and from props (m) */
const HOUSE_CLEAR = 2.2;
const PROP_CLEAR = 1.2;
/** ground rise across the plinth it may stand on (m) */
const RELIEF = 0.35;
const RING_STEP = 2;
const MAX_REACH = 30;

function fits(ground: Ground, site: RuinSite, props: readonly Prop[], x: number, z: number): boolean {
  if (site.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < footprintRadius(b) + HOUSE_CLEAR)) return false;
  if (props.some((p) => Math.hypot(p.x - x, p.z - z) < PROP_RADIUS[p.kind] + PROP_CLEAR)) return false;
  const r = BEACON.plinth.half;
  const hs = [ground.height(x - r, z - r), ground.height(x + r, z - r), ground.height(x - r, z + r), ground.height(x + r, z + r)];
  if (Math.max(...hs) - Math.min(...hs) > RELIEF) return false;
  return ground.water(x, z) < ground.height(x, z) - 0.2;
}

/** one checkpoint per settlement where open ground can be found, on rings
 *  out from its centre */
export function planCheckpoints(sites: readonly RuinSite[], props: readonly Prop[], ground: Ground): Checkpoint[] {
  const out: Checkpoint[] = [];
  for (const [i, site] of sites.entries()) {
    const near = props.filter((p) => Math.hypot(p.x - site.x, p.z - site.z) < MAX_REACH + 10);
    search: for (let d = 0; d <= MAX_REACH; d += RING_STEP) {
      const steps = Math.max(1, Math.round((2 * Math.PI * d) / RING_STEP));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = site.x + Math.cos(a) * d;
        const z = site.z + Math.sin(a) * d;
        if (!fits(ground, site, near, x, z)) continue;
        out.push({ site: i, x, y: ground.height(x, z), z });
        break search;
      }
    }
  }
  return out;
}

/** what stops the player and bullets: the plinth (sunk into the ground on
 *  its low side) and the mast */
export function beaconBoxes(c: Checkpoint): (Box & { surface: 'stone' | 'metal' })[] {
  const { plinth, mast } = BEACON;
  const q: Box['q'] = [0, 0, 0, 1];
  const sink = 0.3;
  return [
    { x: c.x, y: c.y + (plinth.height - sink) / 2, z: c.z, hx: plinth.half, hy: (plinth.height + sink) / 2, hz: plinth.half, q, surface: 'stone' },
    { x: c.x, y: c.y + plinth.height + mast.height / 2, z: c.z, hx: mast.radius, hy: mast.height / 2, hz: mast.radius, q, surface: 'metal' },
  ];
}
