/**
 * Building rendering — the player's walls, floors and ramps as wooden
 * planks in a darker frame, darkening as they wear, one instanced mesh per
 * kind; and the ghost of the piece the build tool is aimed at, blue where it
 * can go and red where it can't.
 */

import { BoxGeometry, Color, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { attribute, float, instanceIndex, max, min, mix, positionGeometry, smoothstep, uniform, vec2, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, type StorageTexture } from 'three/webgpu';
import type { ProbeGI } from '../gpu/passes/ProbeGI';
import { fbm3, hash12 } from '../gpu/noise/NoiseTSL';
import type { NF, NV3 } from '../gpu/TSLTypes';
import { lightWithProbes } from '../render/ProbeLighting';
import { type Piece, type PieceKind, PIECES, pieceBox } from './Blueprint';
import type { GhostView } from './Builder';
import { MAX_PIECES, type PieceView } from './Building';

/** width of a plank (m) */
const PLANK = 0.3;
/** the frame takes this much of each half-width */
const FRAME = 0.06;
const GHOST_OK = new Color(0.3, 0.65, 1.3);
const GHOST_NO = new Color(1.3, 0.25, 0.2);

const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const M = new Matrix4();
const P = new Vector3();
const Q = new Quaternion();
const ONE = new Vector3(1, 1, 1);

/** a piece of each kind, for its size; planks run across `rows` */
const SHAPES: Record<PieceKind, { sample: Piece; rows: 'y' | 'z' }> = {
  wall: { sample: { kind: 'wall', i: 0, j: 0, y: 0, dir: 0 }, rows: 'y' },
  floor: { sample: { kind: 'floor', i: 0, j: 0, y: 0, dir: 0 }, rows: 'z' },
  ramp: { sample: { kind: 'ramp', i: 0, j: 0, y: 0, dir: 0 }, rows: 'z' },
};

function geometry(kind: PieceKind): BoxGeometry {
  const b = pieceBox(SHAPES[kind].sample);
  return new BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2);
}

interface KindPool {
  mesh: InstancedMesh;
  wear: InstancedBufferAttribute;
  used: boolean[];
}

export class BuildingView implements PieceView, GhostView {
  readonly meshes: Mesh[];
  private readonly pools: Record<PieceKind, KindPool>;
  private readonly ghostMesh: Mesh;
  private readonly ghostShapes: Record<PieceKind, BoxGeometry>;
  private readonly ghostColor = uniform(new Color());
  private readonly ghostHalf = uniform(new Vector3(1, 1, 1));

  constructor(gi: ProbeGI | null, canopyTex: StorageTexture | null) {
    const pool = (kind: PieceKind): KindPool => {
      const geo = geometry(kind);
      const wear = new InstancedBufferAttribute(new Float32Array(MAX_PIECES), 1);
      geo.setAttribute('pieceWear', wear);
      const mat = new MeshStandardNodeMaterial();
      const b = pieceBox(SHAPES[kind].sample);
      planks(mat, SHAPES[kind].rows, b.hx, SHAPES[kind].rows === 'y' ? b.hy : b.hz);
      if (gi) lightWithProbes(mat, gi, canopyTex);
      const mesh = new InstancedMesh(geo, mat, MAX_PIECES);
      mesh.name = `building:${kind}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      for (let i = 0; i < MAX_PIECES; i++) mesh.setMatrixAt(i, HIDDEN);
      mesh.count = 0;
      return { mesh, wear, used: new Array<boolean>(MAX_PIECES).fill(false) };
    };
    this.pools = { wall: pool('wall'), floor: pool('floor'), ramp: pool('ramp') };

    this.ghostShapes = { wall: geometry('wall'), floor: geometry('floor'), ramp: geometry('ramp') };
    const ghostMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    // a faint fill ruled in metres, with bright edges, so its shape reads
    // against anything without hiding what's behind it
    const p = positionGeometry as unknown as NV3;
    const gap = (this.ghostHalf as unknown as NV3).sub(p.abs());
    // on a face one gap is nil; the next smallest is how near an edge
    const nearest = gap.x.add(gap.y).add(gap.z).sub(min(gap.x, min(gap.y, gap.z))).sub(max(gap.x, max(gap.y, gap.z)));
    const edge = float(1).sub(smoothstep(0.03, 0.08, nearest));
    const toLine = (v: NF): NF => v.add(0.5).fract().sub(0.5).abs();
    const rule = float(1).sub(smoothstep(0.012, 0.03, min(toLine(p.x), min(toLine(p.y), toLine(p.z)))));
    ghostMat.colorNode = this.ghostColor;
    ghostMat.opacityNode = max(float(0.08).add(rule.mul(0.3)), edge.mul(0.75));
    this.ghostMesh = new Mesh(this.ghostShapes.wall, ghostMat);
    this.ghostMesh.name = 'building:ghost';
    this.ghostMesh.visible = false;
    this.ghostMesh.frustumCulled = false;
    this.meshes = [...PIECES.map((k) => this.pools[k].mesh), this.ghostMesh];
  }

  add(p: Piece): number {
    const { mesh, wear, used } = this.pools[p.kind];
    const slot = used.indexOf(false);
    if (slot < 0) throw new Error(`more than ${MAX_PIECES} ${p.kind}s`);
    used[slot] = true;
    const b = pieceBox(p);
    mesh.setMatrixAt(slot, M.compose(P.set(b.x, b.y, b.z), Q.set(...b.q), ONE));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = Math.max(mesh.count, slot + 1);
    wear.setX(slot, 0);
    wear.needsUpdate = true;
    return PIECES.indexOf(p.kind) * MAX_PIECES + slot;
  }

  remove(id: number): void {
    const { mesh, used } = this.pool(id);
    const slot = id % MAX_PIECES;
    used[slot] = false;
    mesh.setMatrixAt(slot, HIDDEN);
    mesh.instanceMatrix.needsUpdate = true;
    // draw only up to the last slot in use
    while (mesh.count > 0 && !used[mesh.count - 1]) mesh.count--;
  }

  wear(id: number, worn: number): void {
    const { wear } = this.pool(id);
    wear.setX(id % MAX_PIECES, worn);
    wear.needsUpdate = true;
  }

  ghost(p: Piece | null, ok: boolean): void {
    this.ghostMesh.visible = p !== null;
    if (!p) return;
    const b = pieceBox(p);
    this.ghostMesh.geometry = this.ghostShapes[p.kind];
    this.ghostMesh.position.set(b.x, b.y, b.z);
    this.ghostMesh.quaternion.set(...b.q);
    this.ghostHalf.value.set(b.hx, b.hy, b.hz);
    this.ghostColor.value.copy(ok ? GHOST_OK : GHOST_NO);
  }

  private pool(id: number): KindPool {
    return this.pools[PIECES[Math.floor(id / MAX_PIECES)]!];
  }
}

/**
 * Planks across `rows` (local y or z, half-length `halfRows`), running along
 * local x (half-length `halfAlong`), in a darker frame round the edge.
 */
function planks(mat: MeshStandardNodeMaterial, rows: 'y' | 'z', halfAlong: number, halfRows: number): void {
  const p = positionGeometry as unknown as NV3;
  const along = p.x;
  const across = rows === 'y' ? p.y : p.z;
  const k = across.div(PLANK);
  const row = k.floor();
  const f = k.fract();
  const seam = smoothstep(0, 0.07, f).mul(smoothstep(1, 0.93, f));
  const tone = hash12(vec2(row, float(instanceIndex))).mul(0.45).add(0.75);
  const grain = (fbm3(vec3(along.mul(1.2), row.mul(3.1), across.mul(14)), 3) as NF).mul(0.35).add(0.82);
  const plank = vec3(0.3, 0.17, 0.075).mul(tone).mul(grain).mul(mix(float(0.35), float(1), seam));
  const edge = max(along.abs().div(halfAlong), across.abs().div(halfRows));
  const frame = smoothstep(1 - FRAME * 1.2, 1 - FRAME, edge);
  const wood = mix(plank, vec3(0.12, 0.068, 0.032).mul(grain), frame);
  const worn = attribute('pieceWear', 'float') as unknown as NF;
  mat.colorNode = wood.mul(float(1).sub(worn.mul(0.6)));
  mat.roughnessNode = float(0.85);
  mat.metalnessNode = float(0);
}
