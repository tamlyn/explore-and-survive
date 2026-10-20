/**
 * Props — what people left behind in the settlements: a car under its cover
 * at the edge, barrels, jerrycans, crates and tyres against the walls inside
 * and out, never across a doorway. Pure layout like RuinPlan; the meshes and
 * collider sizes come from the models themselves (see Props).
 */

import { Quaternion, Vector3 } from 'three';
import { Rng } from '../core/Seed';
import { alongWall, doorway, footprintRadius, type Ground, type RuinSite, WALL, wallRuns } from './RuinPlan';

export type PropKind = 'car' | 'redBarrel' | 'blueBarrel' | 'jerrycan' | 'ammoCrates' | 'woodCrate' | 'tyre';

export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  /** rotation quaternion (x, y, z, w) */
  q: [number, number, number, number];
}

/** footprint radius used for spacing (m) */
export const PROP_RADIUS: Record<PropKind, number> = {
  car: 2.3,
  redBarrel: 0.32,
  blueBarrel: 0.36,
  jerrycan: 0.2,
  ammoCrates: 0.95,
  woodCrate: 0.42,
  tyre: 0.32,
};

/** how often each kind of clutter turns up against a wall */
const CLUTTER: [PropKind, number][] = [
  ['redBarrel', 1],
  ['blueBarrel', 2],
  ['jerrycan', 1.5],
  ['ammoCrates', 1],
  ['woodCrate', 1.5],
  ['tyre', 1.5],
];
const CAR_CHANCE = 0.6;
/** ground rise across a car's footprint it may stand on (m) */
const CAR_RELIEF = 0.8;
/** a doorway keeps a corridor this wide clear straight through it, and
 *  this far out either side (m) */
const DOOR_PATH_WIDTH = 1.6;
const DOOR_PATH_REACH = 2;

const UP = new Vector3(0, 1, 0);

/** stood on the ground: yawed, then tipped to the local slope */
function settle(ground: Ground, x: number, z: number, yaw: number, reach: number, local?: Quaternion): Prop['q'] {
  const dx = (ground.height(x + reach, z) - ground.height(x - reach, z)) / (2 * reach);
  const dz = (ground.height(x, z + reach) - ground.height(x, z - reach)) / (2 * reach);
  const n = new Vector3(-dx, 1, -dz).normalize();
  const q = new Quaternion().setFromUnitVectors(UP, n).multiply(new Quaternion().setFromAxisAngle(UP, yaw));
  if (local) q.multiply(local);
  return [q.x, q.y, q.z, q.w];
}

function segmentDistance(p: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const ex = b.x - a.x;
  const ez = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.z - a.z) * ez) / (ex * ex + ez * ez)));
  return Math.hypot(p.x - a.x - ex * t, p.z - a.z - ez * t);
}

function pick(rng: Rng): PropKind {
  const total = CLUTTER.reduce((t, [, w]) => t + w, 0);
  let r = rng.float() * total;
  for (const [kind, w] of CLUTTER) {
    r -= w;
    if (r < 0) return kind;
  }
  return CLUTTER[0]![0];
}

export function planProps(sites: RuinSite[], ground: Ground, seed: number): Prop[] {
  const props: Prop[] = [];
  sites.forEach((site, si) => {
    const rng = new Rng(seed).fork(String(si));
    const placed: Prop[] = [];
    const free = (x: number, z: number, r: number): boolean =>
      placed.every((p) => Math.hypot(p.x - x, p.z - z) > r + PROP_RADIUS[p.kind] + 0.05);

    for (const b of site.buildings) {
      const walls = wallRuns(b);
      const door = doorway(b, ground);
      let path: [{ x: number; z: number }, { x: number; z: number }] | null = null;
      if (door) {
        const dw = walls[door.wall]!;
        const du = ((door.j0 + door.j1) / 2) * (dw.length / dw.columns);
        path = [alongWall(b, dw, du, -DOOR_PATH_REACH), alongWall(b, dw, du, DOOR_PATH_REACH)];
      }
      const want = 2 + rng.int(4);
      for (let tries = 0, n = 0; tries < want * 4 && n < want; tries++) {
        const kind = pick(rng);
        const r = PROP_RADIUS[kind];
        const wi = rng.int(4);
        const w = walls[wi]!;
        const inside = rng.chance(0.5);
        // front and back runs include the corners, whose inner faces are the side walls
        const corner = inside && w.alongX ? WALL : 0;
        const u0 = corner + r;
        const u1 = w.length - corner - r;
        if (u1 <= u0) continue;
        const u = rng.range(u0, u1);
        const out = (WALL / 2 + r + (inside ? rng.range(0.02, 0.25) : rng.range(0.05, 1.2))) * (inside ? -1 : 1);
        const p = alongWall(b, w, u, out);
        if (!free(p.x, p.z, r)) continue;
        if (path && segmentDistance(p, path[0], path[1]) < r + DOOR_PATH_WIDTH / 2) continue;
        // long side along the wall, give or take
        const yaw = b.yaw + (w.alongX ? 0 : Math.PI / 2) + (rng.chance(0.5) ? Math.PI : 0) + rng.gauss() * 0.25;
        const flat = kind === 'tyre' && rng.chance(0.5) ? new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2) : undefined;
        placed.push({ kind, x: p.x, y: ground.height(p.x, p.z) - 0.02, z: p.z, q: settle(ground, p.x, p.z, yaw, r, flat) });
        n++;
      }
    }

    if (rng.chance(CAR_CHANCE)) {
      const r = PROP_RADIUS.car;
      for (let tries = 0; tries < 12; tries++) {
        const a = rng.float() * Math.PI * 2;
        const d = rng.range(6, 22);
        const x = site.x + Math.cos(a) * d;
        const z = site.z + Math.sin(a) * d;
        if (site.buildings.some((b) => Math.hypot(b.x - x, b.z - z) < footprintRadius(b) + r + 0.5)) continue;
        if (!free(x, z, r)) continue;
        const yaw = rng.float() * Math.PI * 2;
        const hs = [0, 1, 2, 3].map((k) => {
          const ca = yaw + (k * Math.PI) / 2;
          return ground.height(x + Math.cos(ca) * r, z + Math.sin(ca) * r);
        });
        if (Math.max(...hs) - Math.min(...hs) > CAR_RELIEF) continue;
        if (ground.water(x, z) > ground.height(x, z) - 0.2) continue;
        placed.push({ kind: 'car', x, y: ground.height(x, z) - 0.05, z, q: settle(ground, x, z, yaw, 1.5) });
        break;
      }
    }
    props.push(...placed);
  });
  return props;
}
