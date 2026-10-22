/**
 * Clearings — ground the vegetation scatter must leave alone: bare under
 * buildings and props, and free of trees and big debris for a margin
 * around them, so settlements stand in clearings and can be seen into.
 */

import { DataTexture, NearestFilter, RedFormat, UnsignedByteType } from 'three';
import { BEACON, type Checkpoint } from './CheckpointPlan';
import { PROP_RADIUS, type Prop } from './PropPlan';
import { footprintRadius, type RuinSite } from './RuinPlan';
import { WORLD_SIZE } from './WorldConst';

export interface Clearing {
  x: number;
  z: number;
  /** bare within this (m) */
  radius: number;
  /** and treeless this much further out (m) */
  margin: number;
}

/** mask levels: the scatter reads them as ½ and 1 */
export const CLEAR_TREES = 128;
export const CLEAR_ALL = 255;
/** thresholds on the sampled (0–1) mask for each level */
export const TREES_CLEARED = 0.25;
export const ALL_CLEARED = 0.75;

/** 2 m texels: fine enough for a house footprint */
const RES = 2048;
/** a trail is a treeless strip this wide (m) */
const TRAIL_WIDTH = 5;

export function settlementClearings(sites: RuinSite[], props: Prop[], checkpoints: Checkpoint[]): Clearing[] {
  return [
    ...sites.flatMap((s) => s.buildings.map((b) => ({ x: b.x, z: b.z, radius: footprintRadius(b) + 0.5, margin: 8 }))),
    ...props.map((p) => ({ x: p.x, z: p.z, radius: PROP_RADIUS[p.kind] + 0.3, margin: 2 })),
    ...checkpoints.map((c) => ({ x: c.x, z: c.z, radius: BEACON.plinth.half + 0.5, margin: 4 })),
  ];
}

/** a treeless strip from one point to another, as a chain of clearings */
export function trail(from: { x: number; z: number }, to: { x: number; z: number }): Clearing[] {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / (TRAIL_WIDTH / 2));
  return Array.from({ length: steps + 1 }, (_, k) => ({
    x: from.x + ((to.x - from.x) * k) / steps,
    z: from.z + ((to.z - from.z) * k) / steps,
    radius: 0,
    margin: TRAIL_WIDTH / 2,
  }));
}

/** world-spanning mask, row-major by z like the heightfield */
export function clearingMask(clearings: Clearing[], res: number, worldSize: number): Uint8Array {
  const mask = new Uint8Array(res * res);
  const texel = worldSize / res;
  for (const c of clearings) {
    const outer = c.radius + c.margin;
    const i0 = Math.max(0, Math.floor((c.x - outer) / texel + res / 2));
    const i1 = Math.min(res - 1, Math.ceil((c.x + outer) / texel + res / 2));
    const k0 = Math.max(0, Math.floor((c.z - outer) / texel + res / 2));
    const k1 = Math.min(res - 1, Math.ceil((c.z + outer) / texel + res / 2));
    for (let k = k0; k <= k1; k++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot((i + 0.5 - res / 2) * texel - c.x, (k + 0.5 - res / 2) * texel - c.z);
        const v = d <= c.radius ? CLEAR_ALL : d <= outer ? CLEAR_TREES : 0;
        if (v > (mask[k * res + i] as number)) mask[k * res + i] = v;
      }
    }
  }
  return mask;
}

export function clearingTexture(clearings: Clearing[]): DataTexture {
  const tex = new DataTexture(clearingMask(clearings, RES, WORLD_SIZE), RES, RES, RedFormat, UnsignedByteType);
  tex.magFilter = tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
