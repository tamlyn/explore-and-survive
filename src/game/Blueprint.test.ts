import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { aim, CELL, facing, type Piece, pieceBox, pieceKey, type Plot, type Stance, STOREY, THICKNESS } from './Blueprint';

const flat = (y = 0, pieces: Piece[] = []): Plot => ({ groundAt: () => y, near: () => pieces });
/** in cell (0, 0), a quarter in from its −x and −z sides */
const stance = (o: Partial<Stance> = {}): Stance => ({ feet: { x: 1, y: 0, z: 1 }, yaw: 0, pitch: 0, on: null, ...o });

/** a point in a box's own frame, in the world */
function corner(p: Piece, local: [number, number, number]): Vector3 {
  const b = pieceBox(p);
  const q = new Quaternion(...b.q);
  return new Vector3(local[0] * b.hx, local[1] * b.hy, local[2] * b.hz).applyQuaternion(q).add(new Vector3(b.x, b.y, b.z));
}

describe('facing', () => {
  it('rounds the yaw to the nearest quarter turn', () => {
    expect([0, 0.7, Math.PI / 2, Math.PI, -Math.PI / 2, -0.7, 2 * Math.PI].map(facing)).toEqual([0, 0, 1, 2, 3, 0, 0]);
  });
});

describe('aim', () => {
  it('puts a wall on the edge of the cell faced', () => {
    expect(aim('wall', stance(), flat())).toMatchObject({ i: 0, j: 0, dir: 0 }); // −z edge
    expect(aim('wall', stance({ yaw: Math.PI }), flat())).toMatchObject({ i: 0, j: 1, dir: 0 }); // +z
    expect(aim('wall', stance({ yaw: Math.PI / 2 }), flat())).toMatchObject({ i: 0, j: 0, dir: 1 }); // −x
    expect(aim('wall', stance({ yaw: -Math.PI / 2 }), flat())).toMatchObject({ i: 1, j: 0, dir: 1 }); // +x
  });

  it('puts a floor or ramp in the cell ahead, or underfoot looking down', () => {
    expect(aim('floor', stance(), flat())).toMatchObject({ i: 0, j: -1 });
    expect(aim('floor', stance({ pitch: -1.2 }), flat())).toMatchObject({ i: 0, j: 0 });
    expect(aim('ramp', stance({ yaw: -Math.PI / 2 }), flat())).toMatchObject({ i: 1, j: 0, dir: 3 });
  });

  it('rests a piece built alone on the ground', () => {
    // rising to +x
    const slope: Plot = { groundAt: (x) => x * 0.25, near: () => [] };
    expect(aim('wall', stance(), slope).y).toBeCloseTo(0); // lowest end, at x = 0
    expect(aim('floor', stance({ pitch: -1.2 }), slope).y).toBeCloseTo(1); // highest side
    expect(aim('ramp', stance({ yaw: -Math.PI / 2 }), slope).y).toBeCloseTo(1); // its foot, at x = 4
  });

  it('lines up with the storeys of pieces nearby', () => {
    const floor: Piece = { kind: 'floor', i: 0, j: 0, y: 10.3, dir: 0 };
    const on = stance({ feet: { x: 1, y: 10.3, z: 1 }, on: floor });
    expect(aim('wall', on, flat(0, [floor])).y).toBeCloseTo(10.3);
    expect(aim('wall', { ...on, pitch: 1 }, flat(0, [floor])).y).toBeCloseTo(10.3 + STOREY);
    // a storey's pieces line up even from the ground below, a little off
    expect(aim('wall', stance({ feet: { x: 1, y: 6.9, z: 1 } }), flat(6.9, [floor])).y).toBeCloseTo(10.3 - STOREY);
  });

  it('lines up only with pieces it touches', () => {
    // a wall on the far side of the player's cell, and a floor ahead of it
    const wall: Piece = { kind: 'wall', i: 0, j: 0, y: 0.8, dir: 0 };
    const facingAway = stance({ yaw: Math.PI });
    expect(aim('floor', facingAway, flat(0, [wall])).y).toBeCloseTo(0);
    expect(aim('wall', facingAway, flat(0, [wall])).y).toBeCloseTo(0);
    // a wall at its corner does count, but a floor's corner doesn't
    expect(aim('wall', stance({ yaw: Math.PI / 2 }), flat(0, [wall])).y).toBeCloseTo(0.8);
    const floor: Piece = { kind: 'floor', i: -1, j: 0, y: 0.8, dir: 0 };
    expect(aim('ramp', facingAway, flat(0, [floor])).y).toBeCloseTo(0);
  });

  it('keeps climbing from the top of a ramp', () => {
    const ramp: Piece = { kind: 'ramp', i: 0, j: 0, y: 0, dir: 0 };
    const midway = stance({ feet: { x: 1, y: 1.4, z: 2 }, on: ramp });
    expect(aim('ramp', midway, flat(0, [ramp]))).toMatchObject({ i: 0, j: -1, y: STOREY });
    expect(aim('ramp', { ...midway, yaw: Math.PI }, flat(0, [ramp])).y).toBeCloseTo(0);
  });
});

describe('pieceBox', () => {
  it('lays a floor with its top at its height', () => {
    const p: Piece = { kind: 'floor', i: 1, j: -1, y: 2, dir: 0 };
    expect(corner(p, [-1, 1, -1]).distanceTo(new Vector3(CELL, 2, -CELL))).toBeCloseTo(0);
    expect(corner(p, [1, -1, 1]).distanceTo(new Vector3(2 * CELL, 2 - THICKNESS, 0))).toBeCloseTo(0);
  });

  it('stands a wall on the edge it names', () => {
    const along = pieceBox({ kind: 'wall', i: 0, j: 1, y: 0, dir: 0 });
    expect([along.x, along.y, along.z]).toEqual([CELL / 2, STOREY / 2, CELL]);
    const across: Piece = { kind: 'wall', i: 1, j: 0, y: 0, dir: 1 };
    const end = corner(across, [1, 1, 0]);
    expect([end.x, end.y]).toEqual([CELL, STOREY]);
    expect(Math.abs(end.z - CELL / 2)).toBeCloseTo(CELL / 2);
  });

  it('runs a ramp from its foot up to the far edge', () => {
    for (const dir of [0, 1, 2, 3] as const) {
      const p: Piece = { kind: 'ramp', i: 0, j: 0, y: 5, dir };
      const top = corner(p, [0, 1, -1]); // the top face's −z end, which climbs
      const foot = corner(p, [0, 1, 1]);
      const ahead = { 0: [2, 0], 1: [0, 2], 2: [2, 4], 3: [4, 2] }[dir];
      const behind = { 0: [2, 4], 1: [4, 2], 2: [2, 0], 3: [0, 2] }[dir];
      expect([top.x, top.y, top.z].map((v) => +v.toFixed(6) + 0)).toEqual([ahead[0], 5 + STOREY, ahead[1]]);
      expect([foot.x, foot.y, foot.z].map((v) => +v.toFixed(6) + 0)).toEqual([behind[0], 5, behind[1]]);
    }
  });
});

describe('pieceKey', () => {
  it('tells a ramp by its place, whichever way it climbs', () => {
    const ramp: Piece = { kind: 'ramp', i: 0, j: 0, y: 3, dir: 0 };
    expect(pieceKey(ramp)).toBe(pieceKey({ ...ramp, dir: 2, y: 3.0000001 }));
    expect(pieceKey(ramp)).not.toBe(pieceKey({ ...ramp, kind: 'floor' }));
  });
});
