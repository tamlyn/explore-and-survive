/**
 * Tracers — the glowing streak of a robot's round, from muzzle to wherever
 * it stopped, so the player can see who is shooting and from where. Like
 * Impacts, one always-drawn instanced mesh with a recycled pool.
 */

import type { Scene } from 'three';
import { BoxGeometry, Color, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { attribute } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { Vec3 } from './PlayerMotor';

const POOL = 16;
const LIFE = 0.12; // s
const WIDTH = 0.04; // m
/** HDR, so it blooms */
const COLOR = new Color(4, 1.2, 0.5);

const M = new Matrix4();
const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const P = new Vector3();
const D = new Vector3();
const S = new Vector3();
const Q = new Quaternion();
const Z = new Vector3(0, 0, 1);

export class Tracers {
  private readonly mesh: InstancedMesh;
  private readonly opacity: InstancedBufferAttribute;
  private readonly age = new Float32Array(POOL).fill(LIFE);
  private next = 0;

  constructor(scene: Scene) {
    // a unit streak along +z from the origin
    const geo = new BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    this.opacity = new InstancedBufferAttribute(new Float32Array(POOL), 1);
    geo.setAttribute('tracerOpacity', this.opacity);
    const mat = new MeshBasicNodeMaterial({ color: COLOR, transparent: true, depthWrite: false });
    mat.opacityNode = attribute('tracerOpacity', 'float');
    this.mesh = new InstancedMesh(geo, mat, POOL);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < POOL; i++) this.mesh.setMatrixAt(i, HIDDEN);
    scene.add(this.mesh);
  }

  spawn(from: Vec3, to: Vec3): void {
    const i = this.next;
    this.next = (this.next + 1) % POOL;
    D.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const len = D.length();
    Q.setFromUnitVectors(Z, D.divideScalar(len));
    M.compose(P.set(from.x, from.y, from.z), Q, S.set(WIDTH, WIDTH, len));
    this.mesh.setMatrixAt(i, M);
    this.age[i] = 0;
    this.opacity.setX(i, 1);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.opacity.needsUpdate = true;
  }

  update(dt: number): void {
    let changed = false;
    for (let i = 0; i < POOL; i++) {
      if (this.age[i]! >= LIFE) continue;
      changed = true;
      this.age[i]! += dt;
      if (this.age[i]! >= LIFE) this.mesh.setMatrixAt(i, HIDDEN);
      this.opacity.setX(i, Math.max(0, 1 - this.age[i]! / LIFE));
    }
    if (changed) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.opacity.needsUpdate = true;
    }
  }
}
