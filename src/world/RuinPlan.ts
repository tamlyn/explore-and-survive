/**
 * Ruins — where the abandoned settlements stand and what is left of them.
 * Pure layout, no rendering: sites are picked from the CPU heightfield (dry,
 * gentle ground below the treeline), each holds a few roofless stone
 * buildings, and every building comes out as oriented blocks (wall runs and
 * rubble) that the renderer and the physics both consume.
 */

import { Rng } from '../core/Seed';
import { TREELINE, WORLD_HALF } from './WorldConst';

export interface Ground {
  height(x: number, z: number): number;
  /** water surface; at or below the ground where it is dry */
  water(x: number, z: number): number;
}

export interface Building {
  x: number;
  z: number;
  yaw: number;
  /** outer size along local x and z (m) */
  width: number;
  depth: number;
  storeys: number;
  seed: number;
}

export interface RuinSite {
  x: number;
  z: number;
  buildings: Building[];
}

/** an oriented box */
export interface Block {
  x: number;
  y: number;
  z: number;
  /** half extents */
  hx: number;
  hy: number;
  hz: number;
  /** rotation quaternion (x, y, z, w) */
  q: [number, number, number, number];
  /** stops the player and bullets; loose rubble doesn't */
  solid: boolean;
}

const SITE_CELL = 320;
const SITE_CHANCE = 0.55;
const SITE_TRIES = 4;
const SITE_RADIUS = 24;
/** height spread a site may have across its ring (m) — hillside hamlets
 *  are fine as long as each house finds a level spot */
const SITE_RELIEF = 10;
/** height spread under one building's corners (m); the downhill wall
 *  shows it as a plinth */
const BUILDING_RELIEF = 1.8;
/** the first site sits this far from the spawn, so it's in view at the start */
const FIRST_SITE_MIN = 30;
const FIRST_SITE_MAX = 120;

const WALL = 0.55;
const COURSE = 0.3;
const STOREY = 2.9;
const COLUMN = 0.6;
/** walls reach this far below the lowest ground under them */
const FOOTING = 0.4;

export function footprintRadius(b: Building): number {
  return Math.hypot(b.width, b.depth) / 2;
}

function siteFits(ground: Ground, x: number, z: number): boolean {
  if (Math.abs(x) > WORLD_HALF - 64 || Math.abs(z) > WORLD_HALF - 64) return false;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const r = k === 8 ? 0 : SITE_RADIUS;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    const h = ground.height(px, pz);
    if (ground.water(px, pz) > h - 0.2) return false;
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return hi - lo <= SITE_RELIEF && hi < TREELINE - 150;
}

/** the first fitting spot on rings around the spawn, nearest the facing first */
function firstSite(ground: Ground, spawn: { x: number; z: number; yaw: number }): { x: number; z: number } | null {
  for (let d = FIRST_SITE_MIN; d <= FIRST_SITE_MAX; d += 10) {
    for (let k = 0; k < 18; k++) {
      // 0, +1, −1, +2, −2… steps of 20° away from the facing direction
      const off = Math.ceil(k / 2) * (k % 2 ? 1 : -1) * 0.35;
      const yaw = spawn.yaw + off;
      const x = spawn.x - Math.sin(yaw) * d;
      const z = spawn.z - Math.cos(yaw) * d;
      if (siteFits(ground, x, z)) return { x, z };
    }
  }
  return null;
}

function buildingFits(ground: Ground, b: Building): boolean {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  let lo = Infinity;
  let hi = -Infinity;
  for (const [lx, lz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const px = b.x + ((lx * b.width) / 2) * c + ((lz * b.depth) / 2) * s;
    const pz = b.z - ((lx * b.width) / 2) * s + ((lz * b.depth) / 2) * c;
    const h = ground.height(px, pz);
    if (ground.water(px, pz) > h - 0.2) return false;
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return hi - lo <= BUILDING_RELIEF;
}

function layoutSite(rng: Rng, ground: Ground, x: number, z: number): RuinSite {
  const site: RuinSite = { x, z, buildings: [] };
  // a settlement shares one street grid
  const heading = rng.float() * Math.PI * 2;
  const want = 1 + rng.int(4);
  for (let tries = 0; tries < 60 && site.buildings.length < want; tries++) {
    const a = rng.float() * Math.PI * 2;
    const r = Math.sqrt(rng.float()) * (SITE_RADIUS - 7);
    const b: Building = {
      x: x + Math.cos(a) * r,
      z: z + Math.sin(a) * r,
      yaw: heading + (rng.chance(0.5) ? Math.PI / 2 : 0) + rng.gauss() * 0.04,
      width: rng.range(6, 11),
      depth: rng.range(4.5, 8),
      storeys: rng.chance(0.3) ? 2 : 1,
      seed: rng.u32(),
    };
    const rb = footprintRadius(b);
    const clear = site.buildings.every((o) => Math.hypot(o.x - b.x, o.z - b.z) > rb + footprintRadius(o) + 2);
    if (clear && buildingFits(ground, b)) site.buildings.push(b);
  }
  return site;
}

/**
 * Ruined settlements across the world: one guaranteed in view of the spawn,
 * the rest on a jittered grid wherever the ground suits.
 */
export function planRuins(ground: Ground, seed: number, spawn: { x: number; z: number; yaw: number }): RuinSite[] {
  const rng = new Rng(seed);
  const sites: RuinSite[] = [];
  const first = firstSite(ground, spawn);
  const add = (site: RuinSite): void => {
    if (site.buildings.length) sites.push(site);
  };
  if (first) add(layoutSite(rng.fork('first'), ground, first.x, first.z));
  const cells = Math.floor((2 * WORLD_HALF) / SITE_CELL);
  for (let cz = 0; cz < cells; cz++) {
    for (let cx = 0; cx < cells; cx++) {
      const cell = rng.fork(`${cx},${cz}`);
      if (!cell.chance(SITE_CHANCE)) continue;
      // most of the map is steep, high or wet: look around the cell a little
      for (let k = 0; k < SITE_TRIES; k++) {
        const x = (cx + cell.range(0.15, 0.85)) * SITE_CELL - WORLD_HALF;
        const z = (cz + cell.range(0.15, 0.85)) * SITE_CELL - WORLD_HALF;
        // keep clear of the spawn and of the guaranteed site
        if (Math.hypot(x - spawn.x, z - spawn.z) < SITE_RADIUS + 20) continue;
        if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < SITE_RADIUS * 3)) continue;
        if (!siteFits(ground, x, z)) continue;
        add(layoutSite(cell, ground, x, z));
        break;
      }
    }
  }
  return sites;
}

interface Opening {
  j0: number;
  /** exclusive */
  j1: number;
  /** above the floor (m) */
  bottom: number;
  top: number;
}

/** how high each column of a wall still stands (m above the floor) */
function damageProfile(rng: Rng, n: number, full: number): number[] {
  const fate = rng.float();
  const low = rng.range(0.3, 1.4);
  const k0 = rng.range(0.1, 0.5);
  const k1 = k0 + rng.range(0.2, 0.5);
  const flip = rng.chance(0.5);
  const tops: number[] = [];
  for (let j = 0; j < n; j++) {
    const u = n === 1 ? 0.5 : j / (n - 1);
    let t: number;
    if (fate < 0.35) {
      t = full - 2 * COURSE;
    } else if (fate < 0.75) {
      const s = Math.min(1, Math.max(0, ((flip ? 1 - u : u) - k0) / (k1 - k0)));
      t = full + (low - full) * s * s * (3 - 2 * s);
    } else {
      t = low;
    }
    tops.push(t);
  }
  // corners outlast the wall between them
  if (rng.chance(0.6)) tops[0] = Math.max(tops[0] as number, full * rng.range(0.7, 1));
  if (rng.chance(0.6)) tops[n - 1] = Math.max(tops[n - 1] as number, full * rng.range(0.7, 1));
  // masonry breaks along courses in ragged steps; the wander is correlated
  // so neighbours step together rather than alternating like battlements
  let wander = 0;
  return tops.map((t) => {
    wander = wander * 0.85 + rng.range(-0.7, 0.7);
    return Math.min(full, Math.max(COURSE, Math.round(t / COURSE + wander) * COURSE));
  });
}

/** the solid spans of one column once its openings are cut out */
function columnSpans(bottom: number, top: number, cuts: { bottom: number; top: number }[]): [number, number][] {
  let spans: [number, number][] = [[bottom, top]];
  for (const c of cuts) {
    const next: [number, number][] = [];
    for (const [a, b] of spans) {
      if (c.top <= a || c.bottom >= b) {
        next.push([a, b]);
        continue;
      }
      if (c.bottom > a) next.push([a, c.bottom]);
      if (c.top < b) next.push([c.top, b]);
    }
    spans = next;
  }
  // slivers above a window read as floating, not as masonry
  return spans.filter(([a, b]) => b - a >= COURSE * 0.9);
}

/** the walls (solid) and fallen rubble (loose) of one building */
export function buildingBlocks(b: Building, ground: Ground): Block[] {
  const rng = new Rng(b.seed);
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  const q: Block['q'] = [0, Math.sin(b.yaw / 2), 0, Math.cos(b.yaw / 2)];
  const world = (lx: number, lz: number): { x: number; z: number } => ({
    x: b.x + lx * c + lz * s,
    z: b.z - lx * s + lz * c,
  });
  const hw = b.width / 2;
  const hd = b.depth / 2;
  const floor = Math.max(
    ...[
      [-hw, -hd],
      [hw, -hd],
      [-hw, hd],
      [hw, hd],
    ].map(([lx, lz]) => {
      const p = world(lx as number, lz as number);
      return ground.height(p.x, p.z);
    }),
  );
  const full = b.storeys * STOREY + COURSE;

  // front and back span the full width; the sides fit between them
  const walls = [
    { ox: -hw, oz: -hd + WALL / 2, alongX: true, length: b.width },
    { ox: -hw, oz: hd - WALL / 2, alongX: true, length: b.width },
    { ox: -hw + WALL / 2, oz: -hd + WALL, alongX: false, length: b.depth - 2 * WALL },
    { ox: hw - WALL / 2, oz: -hd + WALL, alongX: false, length: b.depth - 2 * WALL },
  ];
  const at = (w: (typeof walls)[number], u: number): { x: number; z: number } =>
    w.alongX ? world(w.ox + u, w.oz) : world(w.ox, w.oz + u);
  // the door goes in the wall on the highest ground, so it opens at grade
  const mid = walls.map((w) => {
    const p = at(w, w.length / 2);
    return ground.height(p.x, p.z);
  });
  const doorWall = mid.indexOf(Math.max(...mid));

  const blocks: Block[] = [];
  walls.forEach((w, wi) => {
    const n = Math.max(1, Math.round(w.length / COLUMN));
    const cw = w.length / n;
    let lowest = Infinity;
    for (let j = 0; j <= n; j++) {
      const p = at(w, j * cw);
      lowest = Math.min(lowest, ground.height(p.x, p.z));
    }
    const bottom = lowest - FOOTING;
    const tops = damageProfile(rng, n, full);

    const openings: Opening[] = [];
    if (wi === doorWall && n >= 5) {
      const j0 = 1 + rng.int(n - 4);
      openings.push({ j0, j1: j0 + 2, bottom: 0, top: 2.1 });
    }
    for (let storey = 0; storey < b.storeys; storey++) {
      for (let j = 2 + rng.int(2); j + 2 < n; j += 3 + rng.int(3)) {
        const j1 = j + (rng.chance(0.5) ? 1 : 2);
        if (j1 > n - 1) break;
        const sill = storey * STOREY + 0.9;
        const clash = openings.some((o) => j < o.j1 + 1 && j1 > o.j0 - 1 && o.bottom < sill + 1.1 && o.top > sill);
        if (clash) continue;
        openings.push({ j0: j, j1, bottom: sill, top: sill + 1.1 });
      }
    }

    const spans = tops.map((top, j) =>
      columnSpans(
        bottom,
        floor + top,
        openings.filter((o) => j >= o.j0 && j < o.j1).map((o) => ({ bottom: floor + o.bottom, top: floor + o.top })),
      ),
    );
    // neighbouring columns with matching spans merge into one block
    let j0 = 0;
    for (let j = 1; j <= n; j++) {
      if (j < n && sameSpans(spans[j] as [number, number][], spans[j0] as [number, number][])) continue;
      const u = ((j0 + j) / 2) * cw;
      const p = at(w, u);
      const half = ((j - j0) * cw) / 2;
      for (const [y0, y1] of spans[j0] as [number, number][]) {
        blocks.push({
          x: p.x,
          y: (y0 + y1) / 2,
          z: p.z,
          hx: w.alongX ? half : WALL / 2,
          hy: (y1 - y0) / 2,
          hz: w.alongX ? WALL / 2 : half,
          q,
          solid: true,
        });
      }
      j0 = j;
    }

    // what fell lies at the foot of the wall, either side
    for (let j = 0; j < n; j++) {
      const fallen = Math.floor((full - (tops[j] as number)) * rng.range(0, 2));
      for (let k = 0; k < fallen; k++) {
        const side = (rng.chance(0.5) ? 1 : -1) * (WALL / 2 + rng.range(0.1, 1.6));
        const u = (j + rng.float()) * cw;
        const p = w.alongX ? world(w.ox + u, w.oz + side) : world(w.ox + side, w.oz + u);
        blocks.push(rubble(rng, p.x, p.z, ground));
      }
    }
  });
  return blocks;
}

function sameSpans(a: [number, number][], b: [number, number][]): boolean {
  return a.length === b.length && a.every(([y0, y1], k) => {
    const o = b[k] as [number, number];
    return Math.abs(o[0] - y0) < 1e-6 && Math.abs(o[1] - y1) < 1e-6;
  });
}

/** a fallen stone: random size, tipped over, half sunk */
function rubble(rng: Rng, x: number, z: number, ground: Ground): Block {
  const hx = rng.range(0.12, 0.38);
  const hy = rng.range(0.1, 0.24);
  const hz = rng.range(0.12, 0.38);
  // yaw, then a tip about a horizontal axis
  const yaw = rng.float() * Math.PI * 2;
  const tip = rng.range(0, 0.45);
  const ta = rng.float() * Math.PI * 2;
  const qy: Block['q'] = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const st = Math.sin(tip / 2);
  const qt: Block['q'] = [Math.cos(ta) * st, 0, Math.sin(ta) * st, Math.cos(tip / 2)];
  return { x, y: ground.height(x, z) + hy * 0.4, z, hx, hy, hz, q: mulQuat(qt, qy), solid: false };
}

function mulQuat(a: Block['q'], b: Block['q']): Block['q'] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** clear-ground levels in the scatter mask */
export const CLEAR_TREES = 128;
export const CLEAR_ALL = 255;
/** trees keep this far back from a building's footprint (m): settlements stand in clearings, and can be seen into */
const TREE_MARGIN = 8;

/**
 * World-spanning mask (row-major by z, like the heightfield) of where the
 * scatter must leave the ground clear: everything under a building, and
 * trees and big debris around it.
 */
export function clearingMask(sites: RuinSite[], res: number, worldSize: number): Uint8Array {
  const mask = new Uint8Array(res * res);
  const texel = worldSize / res;
  for (const site of sites) {
    for (const b of site.buildings) {
      const inner = footprintRadius(b) + 0.5;
      const outer = inner + TREE_MARGIN;
      const i0 = Math.max(0, Math.floor((b.x - outer) / texel + res / 2));
      const i1 = Math.min(res - 1, Math.ceil((b.x + outer) / texel + res / 2));
      const k0 = Math.max(0, Math.floor((b.z - outer) / texel + res / 2));
      const k1 = Math.min(res - 1, Math.ceil((b.z + outer) / texel + res / 2));
      for (let k = k0; k <= k1; k++) {
        for (let i = i0; i <= i1; i++) {
          const d = Math.hypot((i + 0.5 - res / 2) * texel - b.x, (k + 0.5 - res / 2) * texel - b.z);
          const v = d <= inner ? CLEAR_ALL : d <= outer ? CLEAR_TREES : 0;
          if (v > (mask[k * res + i] as number)) mask[k * res + i] = v;
        }
      }
    }
  }
  return mask;
}
