/**
 * Pickups rendering — loot dropped on the ground, turning slowly and
 * bobbing just above it: an olive ammo tin with a glowing band and a white
 * medkit with a glowing red cross, so they're found in the undergrowth and
 * at dusk. One instanced mesh per kind, with a slot per drop Loot allows.
 */

import { BoxGeometry, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { float, max, positionGeometry, sin, smoothstep, time, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial, type StorageTexture } from 'three/webgpu';
import type { ProbeGI } from '../gpu/passes/ProbeGI';
import type { NF, NV3 } from '../gpu/TSLTypes';
import { lightWithProbes } from '../render/ProbeLighting';
import { type DropView, type LootKind, MAX_DROPS } from './Loot';

/** HDR, enough to bloom a little */
const GLOW = 3;
const HOVER = 0.3;
const BOB = 0.05;
const SPIN = 1.2;

type Look = (p: NV3, pulse: NF, mat: MeshStandardNodeMaterial) => void;

const LOOKS: Record<LootKind, { size: [number, number, number]; look: Look }> = {
  ammo: {
    size: [0.3, 0.16, 0.18],
    look: (p, pulse, mat) => {
      const band = smoothstep(0.02, 0.012, p.y.abs());
      mat.colorNode = vec3(0.22, 0.24, 0.13).add(vec3(0.5, 0.36, 0.1).mul(band));
      mat.emissiveNode = vec3(1, 0.6, 0.15).mul(band.mul(pulse).mul(GLOW));
      mat.roughnessNode = float(0.6);
      mat.metalnessNode = float(0.5);
    },
  },
  medkit: {
    size: [0.28, 0.2, 0.1],
    look: (p, pulse, mat) => {
      // a cross on the broad faces
      const ax = p.x.abs();
      const ay = p.y.abs();
      const arm = (a: NF, b: NF): NF => smoothstep(0.03, 0.025, a).mul(smoothstep(0.075, 0.07, b));
      const cross = max(arm(ax, ay), arm(ay, ax)).mul(smoothstep(0.04, 0.045, p.z.abs()));
      mat.colorNode = vec3(0.82, 0.82, 0.78).mul(float(1).sub(cross)).add(vec3(0.7, 0.04, 0.03).mul(cross));
      mat.emissiveNode = vec3(1, 0.08, 0.05).mul(cross.mul(pulse).mul(GLOW));
      mat.roughnessNode = float(0.5);
      mat.metalnessNode = float(0);
    },
  },
};

const KINDS: LootKind[] = ['ammo', 'medkit'];
const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const M = new Matrix4();
const P = new Vector3();
const Q = new Quaternion();
const UP = new Vector3(0, 1, 0);
const ONE = new Vector3(1, 1, 1);

interface KindPool {
  mesh: InstancedMesh;
  /** where each slot's pickup rests, null when free */
  slots: (Vector3 | null)[];
}

export class Pickups implements DropView {
  readonly meshes: InstancedMesh[];
  private readonly pools: Record<LootKind, KindPool>;
  private t = 0;

  constructor(gi: ProbeGI | null, canopyTex: StorageTexture | null) {
    const pulse = sin(time.mul(3)).mul(0.35).add(0.65) as unknown as NF;
    const pool = (kind: LootKind): KindPool => {
      const { size, look } = LOOKS[kind];
      const mat = new MeshStandardNodeMaterial();
      look(positionGeometry as unknown as NV3, pulse, mat);
      if (gi) lightWithProbes(mat, gi, canopyTex);
      const mesh = new InstancedMesh(new BoxGeometry(...size), mat, MAX_DROPS);
      mesh.name = `pickups:${kind}`;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      for (let i = 0; i < MAX_DROPS; i++) mesh.setMatrixAt(i, HIDDEN);
      return { mesh, slots: new Array<Vector3 | null>(MAX_DROPS).fill(null) };
    };
    this.pools = { ammo: pool('ammo'), medkit: pool('medkit') };
    this.meshes = KINDS.map((k) => this.pools[k].mesh);
  }

  add(kind: LootKind, x: number, y: number, z: number): number {
    const { slots } = this.pools[kind];
    const slot = slots.indexOf(null);
    if (slot < 0) throw new Error(`more than ${MAX_DROPS} ${kind} pickups`);
    slots[slot] = new Vector3(x, y, z);
    return KINDS.indexOf(kind) * MAX_DROPS + slot;
  }

  remove(id: number): void {
    const { mesh, slots } = this.pools[KINDS[Math.floor(id / MAX_DROPS)]!];
    slots[id % MAX_DROPS] = null;
    mesh.setMatrixAt(id % MAX_DROPS, HIDDEN);
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    this.t += dt;
    for (const { mesh, slots } of Object.values(this.pools)) {
      let any = false;
      slots.forEach((at, i) => {
        if (!at) return;
        // each turns out of step with the others
        const phase = this.t + i * 1.7;
        Q.setFromAxisAngle(UP, phase * SPIN);
        P.set(at.x, at.y + HOVER + Math.sin(phase * 2) * BOB, at.z);
        mesh.setMatrixAt(i, M.compose(P, Q, ONE));
        any = true;
      });
      if (any) mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
