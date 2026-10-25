/**
 * Pickups rendering — loot dropped on the ground, turning slowly and
 * bobbing just above it: a white medkit with a glowing red cross, a plate
 * of rusty scrap metal and a log. One instanced mesh per kind, with a slot
 * per drop Loot allows.
 */

import { BoxGeometry, type BufferGeometry, CylinderGeometry, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { float, max, mix, positionGeometry, sin, smoothstep, time, vec3 } from 'three/tsl';
import { fbm3 } from '../gpu/noise/NoiseTSL';
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

const LOOKS: Record<LootKind, { geometry: () => BufferGeometry; look: Look }> = {
  medkit: {
    geometry: () => new BoxGeometry(0.28, 0.2, 0.1),
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
  metal: {
    geometry: () => new BoxGeometry(0.3, 0.05, 0.22),
    look: (p, _pulse, mat) => {
      const rust = smoothstep(0.45, 0.65, fbm3(p.mul(18), 3) as NF);
      mat.colorNode = mix(vec3(0.55, 0.57, 0.6), vec3(0.32, 0.14, 0.06), rust);
      mat.roughnessNode = mix(float(0.35), float(0.9), rust);
      mat.metalnessNode = mix(float(0.9), float(0.2), rust);
    },
  },
  wood: {
    geometry: () => new CylinderGeometry(0.09, 0.1, 0.5, 10).rotateZ(Math.PI / 2),
    look: (p, _pulse, mat) => {
      // bark along the log, pale end grain at the cut ends
      const ends = smoothstep(0.23, 0.245, p.x.abs());
      const bark = vec3(0.24, 0.16, 0.1).mul((fbm3(p.mul(vec3(4, 30, 30)), 3) as NF).mul(0.6).add(0.6));
      mat.colorNode = mix(bark, vec3(0.62, 0.48, 0.3), ends);
      mat.roughnessNode = float(0.9);
      mat.metalnessNode = float(0);
    },
  },
};

const KINDS: LootKind[] = ['medkit', 'metal', 'wood'];
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
      const { geometry, look } = LOOKS[kind];
      const mat = new MeshStandardNodeMaterial();
      look(positionGeometry as unknown as NV3, pulse, mat);
      if (gi) lightWithProbes(mat, gi, canopyTex);
      const mesh = new InstancedMesh(geometry(), mat, MAX_DROPS);
      mesh.name = `pickups:${kind}`;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      for (let i = 0; i < MAX_DROPS; i++) mesh.setMatrixAt(i, HIDDEN);
      mesh.count = 0;
      return { mesh, slots: new Array<Vector3 | null>(MAX_DROPS).fill(null) };
    };
    this.pools = { medkit: pool('medkit'), metal: pool('metal'), wood: pool('wood') };
    this.meshes = KINDS.map((k) => this.pools[k].mesh);
  }

  add(kind: LootKind, x: number, y: number, z: number): number {
    const { slots } = this.pools[kind];
    const slot = slots.indexOf(null);
    if (slot < 0) throw new Error(`more than ${MAX_DROPS} ${kind} pickups`);
    slots[slot] = new Vector3(x, y, z);
    this.pools[kind].mesh.count = Math.max(this.pools[kind].mesh.count, slot + 1);
    return KINDS.indexOf(kind) * MAX_DROPS + slot;
  }

  remove(id: number): void {
    const { mesh, slots } = this.pools[KINDS[Math.floor(id / MAX_DROPS)]!];
    slots[id % MAX_DROPS] = null;
    mesh.setMatrixAt(id % MAX_DROPS, HIDDEN);
    mesh.instanceMatrix.needsUpdate = true;
    // draw only up to the last slot in use
    while (mesh.count > 0 && !slots[mesh.count - 1]) mesh.count--;
  }

  update(dt: number): void {
    this.t += dt;
    for (const { mesh, slots } of Object.values(this.pools)) {
      if (mesh.count === 0) continue;
      for (let i = 0; i < mesh.count; i++) {
        const at = slots[i];
        if (!at) continue;
        // each turns out of step with the others
        const phase = this.t + i * 1.7;
        Q.setFromAxisAngle(UP, phase * SPIN);
        P.set(at.x, at.y + HOVER + Math.sin(phase * 2) * BOB, at.z);
        mesh.setMatrixAt(i, M.compose(P, Q, ONE));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
