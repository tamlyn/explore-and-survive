/**
 * Blueprint — the building grid, and where a piece goes for where the
 * player stands and looks. Cells are CELL square on a grid fixed to the
 * world; a wall stands on a cell's edge, a floor or ramp fills a cell, and
 * each is a STOREY tall. Walls go on the edge of the player's own cell they
 * face, floors and ramps in the cell ahead (or underfoot, looking down), and
 * looking up builds a storey higher.
 *
 * The grid's heights aren't fixed to the world, as the ground isn't flat: a
 * piece built against others shares their storeys, so a structure lines up
 * with itself; one built alone rests on the ground.
 */

import type { Box } from '../world/Box';
import type { Vec3 } from './PlayerMotor';

export type PieceKind = 'wall' | 'floor' | 'ramp';
export const PIECES: readonly PieceKind[] = ['wall', 'floor', 'ramp'];

export const CELL = 4;
export const STOREY = 3;
/** of a wall, floor or ramp (m) */
export const THICKNESS = 0.2;

/** a quarter turn: 0 faces −z (yaw 0), 1 −x, 2 +z, 3 +x */
export type Dir = 0 | 1 | 2 | 3;

/**
 * Cell (i, j) spans x from i·CELL and z from j·CELL. A floor's top is at y,
 * a wall or ramp starts at y. A wall stands on its cell's −z edge (dir 0) or
 * −x edge (dir 1); a ramp climbs towards dir.
 */
export interface Piece {
  kind: PieceKind;
  i: number;
  j: number;
  y: number;
  dir: Dir;
}

/** a cell's step in each direction */
const STEP: Record<Dir, [number, number]> = { 0: [0, -1], 1: [-1, 0], 2: [0, 1], 3: [1, 0] };
/** pitch beyond which the player builds above, or underfoot (rad) */
const LOOK_UP = 0.6;
const LOOK_DOWN = -0.9;
/** pieces this far above or below don't set the storeys (m) */
const LATTICE_REACH = STOREY * 1.5;

/** a ramp's foot, the edge it climbs away from, as fractions of its cell */
const RAMP_FOOT: Record<Dir, [number, number][]> = {
  0: [[0, 1], [0.5, 1], [1, 1]],
  1: [[1, 0], [1, 0.5], [1, 1]],
  2: [[0, 0], [0.5, 0], [1, 0]],
  3: [[0, 0], [0, 0.5], [0, 1]],
};
const RAMP_LENGTH = Math.hypot(CELL, STOREY);
const RAMP_PITCH = Math.atan2(STOREY, CELL);

export function facing(yaw: number): Dir {
  return ((((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4) as Dir);
}

/** what tells two pieces apart: one of each kind per spot */
export function pieceKey(p: Piece): string {
  return `${p.kind}:${p.i}:${p.j}:${p.kind === 'wall' ? p.dir : 0}:${Math.round(p.y * 100)}`;
}

/** the solid a piece is */
export function pieceBox(p: Piece): Box {
  const x0 = p.i * CELL;
  const z0 = p.j * CELL;
  if (p.kind === 'floor') {
    return { x: x0 + CELL / 2, y: p.y - THICKNESS / 2, z: z0 + CELL / 2, hx: CELL / 2, hy: THICKNESS / 2, hz: CELL / 2, q: [0, 0, 0, 1] };
  }
  if (p.kind === 'wall') {
    const along = p.dir === 0;
    const q = yawPitch(along ? 0 : Math.PI / 2, 0);
    return { x: along ? x0 + CELL / 2 : x0, y: p.y + STOREY / 2, z: along ? z0 : z0 + CELL / 2, hx: CELL / 2, hy: STOREY / 2, hz: THICKNESS / 2, q };
  }
  // the slab's top face runs corner to corner of the climb; its centre sits
  // half the thickness below that, along the slab's normal
  const yaw = (p.dir * Math.PI) / 2;
  const back = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const nx = back.x * Math.sin(RAMP_PITCH);
  const nz = back.z * Math.sin(RAMP_PITCH);
  const ny = Math.cos(RAMP_PITCH);
  return {
    x: x0 + CELL / 2 - (nx * THICKNESS) / 2,
    y: p.y + STOREY / 2 - (ny * THICKNESS) / 2,
    z: z0 + CELL / 2 - (nz * THICKNESS) / 2,
    hx: CELL / 2,
    hy: THICKNESS / 2,
    hz: RAMP_LENGTH / 2,
    q: yawPitch(yaw, RAMP_PITCH),
  };
}

/** turned by `yaw` about y after tipping its −z end up by `pitch` */
function yawPitch(yaw: number, pitch: number): Box['q'] {
  const sy = Math.sin(yaw / 2);
  const cy = Math.cos(yaw / 2);
  const sx = Math.sin(pitch / 2);
  const cx = Math.cos(pitch / 2);
  return [cy * sx, cx * sy, -sy * sx, cy * cx];
}

export interface Plot {
  groundAt(x: number, z: number): number;
  /** built pieces in cells next to (i, j), or in it */
  near(i: number, j: number): readonly Piece[];
}

export interface Stance {
  feet: Vec3;
  yaw: number;
  pitch: number;
  /** the piece underfoot, if any */
  on: Piece | null;
}

/** where a `kind` goes for the player's stance */
export function aim(kind: PieceKind, s: Stance, plot: Plot): Piece {
  const d = facing(s.yaw);
  const [di, dj] = STEP[d];
  let i = Math.floor(s.feet.x / CELL);
  let j = Math.floor(s.feet.z / CELL);
  let dir: Dir = d;
  if (kind === 'wall') {
    // on the shared edge, named from the cell on its +z or +x side
    if (d === 2) j += 1;
    else if (d === 3) i += 1;
    dir = (d % 2) as Dir;
  } else if (s.pitch > LOOK_DOWN) {
    i += di;
    j += dj;
  }
  const want = standingLevel(kind, s, d) + (s.pitch > LOOK_UP ? STOREY : 0);
  const at = footprint({ kind, i, j, dir });
  const against = plot.near(i, j).filter((p) => touching(at, footprint(p), kind === 'wall' && p.kind === 'wall'));
  const y = latticeY(against, want) ?? restingY(kind, i, j, dir, plot);
  return { kind, i, j, y, dir };
}

/** what a piece covers on the ground: [x0, z0, x1, z1] */
function footprint(p: Pick<Piece, 'kind' | 'i' | 'j' | 'dir'>): [number, number, number, number] {
  const x0 = p.i * CELL;
  const z0 = p.j * CELL;
  if (p.kind !== 'wall') return [x0, z0, x0 + CELL, z0 + CELL];
  return p.dir === 0 ? [x0, z0, x0 + CELL, z0] : [x0, z0, x0, z0 + CELL];
}

/** sharing some of an edge, or a corner if `corners` (walls meeting at one) */
function touching(a: number[], b: number[], corners: boolean): boolean {
  const x = Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!);
  const z = Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!);
  return x >= 0 && z >= 0 && (corners || x > 0 || z > 0);
}

/** the storey line the player stands on: on a ramp, its own for a wall
 *  round it, but its top for what's built ahead going up */
function standingLevel(kind: PieceKind, s: Stance, d: Dir): number {
  const on = s.on;
  if (!on) return s.feet.y;
  if (on.kind === 'floor') return on.y;
  if (on.kind === 'wall') return on.y + STOREY;
  if (kind === 'wall') return on.y;
  if (on.dir === d) return on.y + STOREY;
  if (on.dir === (d + 2) % 4) return on.y;
  return s.feet.y - on.y < STOREY / 2 ? on.y : on.y + STOREY;
}

/** the storey of the pieces nearby closest to `want`, if any are near */
function latticeY(near: readonly Piece[], want: number): number | null {
  let best: number | null = null;
  for (const p of near) {
    if (Math.abs(p.y - want) > LATTICE_REACH) continue;
    const y = p.y + Math.round((want - p.y) / STOREY) * STOREY;
    if (best === null || Math.abs(y - want) < Math.abs(best - want)) best = y;
  }
  return best;
}

/** with nothing to line up with, on the ground: a wall from its lowest
 *  point, a ramp from its foot, a floor over the highest point under it */
function restingY(kind: PieceKind, i: number, j: number, d: Dir, plot: Plot): number {
  const x0 = i * CELL;
  const z0 = j * CELL;
  const g = (fx: number, fz: number): number => plot.groundAt(x0 + fx * CELL, z0 + fz * CELL);
  if (kind === 'floor') return Math.max(g(0, 0), g(1, 0), g(0, 1), g(1, 1), g(0.5, 0.5));
  if (kind === 'wall') {
    return d === 0 ? Math.min(g(0, 0), g(0.5, 0), g(1, 0)) : Math.min(g(0, 0), g(0, 0.5), g(0, 1));
  }
  const [a, b, c] = RAMP_FOOT[d];
  return Math.min(g(...a), g(...b), g(...c));
}
