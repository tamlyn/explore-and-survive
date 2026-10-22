/**
 * Beacons rendering — every checkpoint's plinth, mast and lamp as one
 * instanced mesh: a single draw call for the lot. A per-instance flag
 * switches a lamp from blinking amber (unclaimed) to steady green.
 */

import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, float, mix, positionGeometry, sin, smoothstep, time, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial, type StorageTexture } from 'three/webgpu';
import { fbm3 } from '../gpu/noise/NoiseTSL';
import type { ProbeGI } from '../gpu/passes/ProbeGI';
import type { NF, NV3 } from '../gpu/TSLTypes';
import { lightWithProbes } from '../render/ProbeLighting';
import { BEACON, type Checkpoint } from './CheckpointPlan';

/** HDR lamp glow, enough to bloom */
const GLOW = 8;
const AMBER = vec3(1, 0.42, 0.05);
const GREEN = vec3(0.2, 1, 0.3);
/** unclaimed lamps blink at this rate (rad/s) */
const BLINK = 4;

const PLINTH = 0;
const MAST = 1;
const LAMP = 2;

function part(geo: BufferGeometry, id: number, y: number): BufferGeometry {
  const g = (geo.index ? geo.toNonIndexed() : geo).translate(0, y, 0);
  g.deleteAttribute('uv');
  g.setAttribute('_part', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(id), 1));
  return g;
}

function beaconGeometry(): BufferGeometry {
  const { plinth, mast, lamp } = BEACON;
  const top = plinth.height + mast.height;
  return mergeGeometries([
    part(new BoxGeometry(plinth.half * 2, plinth.height + plinth.sink, plinth.half * 2), PLINTH, (plinth.height - plinth.sink) / 2),
    part(new CylinderGeometry(mast.radius * 0.7, mast.radius, mast.height, 8), MAST, plinth.height + mast.height / 2),
    part(new SphereGeometry(lamp.radius, 12, 8), LAMP, top + lamp.radius * 0.6),
  ])!;
}

function beaconMaterial(gi: ProbeGI | null, canopyTex: StorageTexture | null): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial();
  const id = attribute('_part', 'float') as unknown as NF;
  const claimed = attribute('_claimed', 'float') as unknown as NF;
  const isMast = id.sub(MAST).abs().lessThan(0.5);
  const isLamp = id.sub(LAMP).abs().lessThan(0.5);
  const grime = fbm3((positionGeometry as unknown as NV3).mul(3), 3) as NF;
  const stone = vec3(0.42, 0.4, 0.36).mul(grime.mul(0.5).add(0.6));
  const rust = mix(vec3(0.32, 0.3, 0.28), vec3(0.3, 0.13, 0.05), smoothstep(0.4, 0.7, grime));
  mat.colorNode = isLamp.select(vec3(0.1), isMast.select(rust, stone));
  mat.roughnessNode = isLamp.select(float(0.3), isMast.select(float(0.6), float(0.9)));
  mat.metalnessNode = isMast.select(float(0.6), float(0));
  const blink = smoothstep(-0.2, 0.6, sin(time.mul(BLINK))).mul(0.85).add(0.15);
  const lamp = mix(AMBER.mul(blink), GREEN, claimed);
  mat.emissiveNode = isLamp.select(lamp.mul(GLOW), vec3(0));
  if (gi) lightWithProbes(mat, gi, canopyTex);
  return mat;
}

export class Beacons {
  readonly mesh: InstancedMesh;
  private readonly claimed: InstancedBufferAttribute;

  constructor(spots: readonly Checkpoint[], gi: ProbeGI | null, canopyTex: StorageTexture | null) {
    const geo = beaconGeometry();
    this.claimed = new InstancedBufferAttribute(new Float32Array(spots.length), 1);
    geo.setAttribute('_claimed', this.claimed);
    this.mesh = new InstancedMesh(geo, beaconMaterial(gi, canopyTex), spots.length);
    this.mesh.name = 'beacons';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    const m = new Matrix4();
    for (const [i, c] of spots.entries()) this.mesh.setMatrixAt(i, m.makeTranslation(c.x, c.y, c.z));
    this.mesh.computeBoundingSphere();
  }

  claim(index: number): void {
    this.claimed.setX(index, 1);
    this.claimed.needsUpdate = true;
  }
}
