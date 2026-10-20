/**
 * Ruins — where the abandoned settlements stand and what is left of them.
 * Pure layout, no rendering: sites are picked from the CPU heightfield (dry,
 * gentle ground below the treeline), each holds a few roofless stone
 * buildings, and every building comes out as oriented blocks (wall runs and
 * rubble) that the renderer and the physics both consume.
 */

import { Quaternion, Vector3 } from 'three';
import { hashCombine, hashString, Rng } from '../core/Seed';
import type { Box } from './Box';
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

export interface Block extends Box {
  /** stops the player and bullets; loose rubble doesn't */
  solid: boolean;
}

/** a named stream of `seed`, independent of how many others are drawn */
export function streamRng(seed: number, key: string): Rng {
  return new Rng(hashCombine(seed, hashString(key)));
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

/** wall thickness (m) */
export const WALL = 0.55;
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
  let lo = Infinity;
  let hi = -Infinity;
  // a 4×4 grid, so a stream can't slip between the corners
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 4; k++) {
      const p = toWorld(b, (i / 3 - 0.5) * b.width, (k / 3 - 0.5) * b.depth);
      const h = ground.height(p.x, p.z);
      if (ground.water(p.x, p.z) > h - 0.2) return false;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
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
  const sites: RuinSite[] = [];
  const first = firstSite(ground, spawn);
  const add = (site: RuinSite): void => {
    if (site.buildings.length) sites.push(site);
  };
  if (first) add(layoutSite(streamRng(seed, 'first'), ground, first.x, first.z));
  const cells = Math.floor((2 * WORLD_HALF) / SITE_CELL);
  for (let cz = 0; cz < cells; cz++) {
    for (let cx = 0; cx < cells; cx++) {
      const cell = streamRng(seed, `${cx},${cz}`);
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

/** one straight run of wall in the building's frame */
export interface WallRun {
  /** where the run starts, on its centre line */
  ox: number;
  oz: number;
  alongX: boolean;
  length: number;
  /** outward normal */
  nx: number;
  nz: number;
  /** the masonry columns it's built from */
  columns: number;
}

/** front and back span the full width; the sides fit between them */
export function wallRuns(b: Building): WallRun[] {
  const hw = b.width / 2;
  const hd = b.depth / 2;
  const run = (ox: number, oz: number, alongX: boolean, length: number, nx: number, nz: number): WallRun => ({
    ox,
    oz,
    alongX,
    length,
    nx,
    nz,
    columns: Math.max(1, Math.round(length / COLUMN)),
  });
  return [
    run(-hw, -hd + WALL / 2, true, b.width, 0, -1),
    run(-hw, hd - WALL / 2, true, b.width, 0, 1),
    run(-hw + WALL / 2, -hd + WALL, false, b.depth - 2 * WALL, -1, 0),
    run(hw - WALL / 2, -hd + WALL, false, b.depth - 2 * WALL, 1, 0),
  ];
}

/** building frame → world */
export function toWorld(b: Building, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
}

/** `u` along a run and `out` metres outward from its centre line, in the world */
export function alongWall(b: Building, w: WallRun, u: number, out = 0): { x: number; z: number } {
  return toWorld(b, w.ox + (w.alongX ? u : 0) + w.nx * out, w.oz + (w.alongX ? 0 : u) + w.nz * out);
}

export interface Doorway {
  wall: number;
  /** columns cut, end exclusive */
  j0: number;
  j1: number;
}

/** the door goes in the wall on the highest ground, so it opens at grade */
export function doorway(b: Building, ground: Ground): Doorway | null {
  const walls = wallRuns(b);
  const mid = walls.map((w) => {
    const p = alongWall(b, w, w.length / 2);
    return ground.height(p.x, p.z);
  });
  const wall = mid.indexOf(Math.max(...mid));
  const n = (walls[wall] as WallRun).columns;
  if (n < 5) return null;
  const j0 = 1 + new Rng(b.seed).fork('door').int(n - 4);
  return { wall, j0, j1: j0 + 2 };
}

/** the walls (solid) and fallen rubble (loose) of one building */
export function buildingBlocks(b: Building, ground: Ground): Block[] {
  const rng = new Rng(b.seed);
  const q: Block['q'] = [0, Math.sin(b.yaw / 2), 0, Math.cos(b.yaw / 2)];
  const hw = b.width / 2;
  const hd = b.depth / 2;
  const floor = Math.max(
    ...[
      [-hw, -hd],
      [hw, -hd],
      [-hw, hd],
      [hw, hd],
    ].map(([lx, lz]) => {
      const p = toWorld(b, lx as number, lz as number);
      return ground.height(p.x, p.z);
    }),
  );
  const full = b.storeys * STOREY + COURSE;
  const walls = wallRuns(b);
  const door = doorway(b, ground);

  const blocks: Block[] = [];
  walls.forEach((w, wi) => {
    const n = w.columns;
    const cw = w.length / n;
    let lowest = Infinity;
    for (let j = 0; j <= n; j++) {
      const p = alongWall(b, w, j * cw);
      lowest = Math.min(lowest, ground.height(p.x, p.z));
    }
    const bottom = lowest - FOOTING;
    const tops = damageProfile(rng, n, full);

    const openings: Opening[] = [];
    if (door?.wall === wi) {
      // on a slope the ground at the door can sit below the floor: cut down
      // to it, or the doorway keeps a sill too tall to step over
      const sill = Math.min(...[door.j0, door.j1].map((j) => {
        const p = alongWall(b, w, j * cw);
        return ground.height(p.x, p.z);
      }));
      openings.push({ j0: door.j0, j1: door.j1, bottom: Math.min(0, sill - floor), top: 2.1 });
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
      const p = alongWall(b, w, u);
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
        const p = alongWall(b, w, (j + rng.float()) * cw, side);
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
  const q = new Quaternion()
    .setFromAxisAngle(new Vector3(Math.cos(ta), 0, Math.sin(ta)), tip)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw));
  return { x, y: ground.height(x, z) + hy * 0.4, z, hx, hy, hz, q: [q.x, q.y, q.z, q.w], solid: false };
}
