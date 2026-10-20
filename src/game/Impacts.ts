/**
 * Impacts — the puff where a shot lands: a few small lit, fading balls of
 * dust, splinters or spray, coloured by the surface. Lit by the world's own
 * lights (and shadowed), so they sit right in sun and shade alike. One
 * always-drawn instanced mesh: a single draw call, and compiled with the rest
 * of the scene rather than on the first shot. The oldest puff is recycled
 * when the pool runs out.
 */

import type { Scene } from 'three';
import { Color, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, Matrix4, Vector3 } from 'three';
import { attribute } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Impact, ImpactSurface } from './Shot';

const POOL = 24;
const PER_IMPACT = 3;
const LIFE = 0.7; // s

const LOOK: Record<ImpactSurface, { color: Color; size: number; rise: number }> = {
  ground: { color: new Color(0.3, 0.25, 0.18), size: 0.4, rise: 0.9 },
  wood: { color: new Color(0.36, 0.25, 0.15), size: 0.3, rise: 0.7 },
  stone: { color: new Color(0.5, 0.49, 0.46), size: 0.32, rise: 0.8 },
  water: { color: new Color(0.85, 0.9, 0.95), size: 0.45, rise: 2.4 },
};

interface Puff {
  pos: Vector3;
  vel: Vector3;
  age: number;
  size: number;
}

const M = new Matrix4();
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

export class Impacts {
  private readonly mesh: InstancedMesh;
  private readonly opacity: InstancedBufferAttribute;
  private readonly puffs: Puff[] = [];
  private next = 0;

  constructor(scene: Scene) {
    const geo = new IcosahedronGeometry(1, 1);
    this.opacity = new InstancedBufferAttribute(new Float32Array(POOL), 1);
    geo.setAttribute('puffOpacity', this.opacity);
    const mat = new MeshStandardNodeMaterial({ roughness: 1, transparent: true, depthWrite: false });
    mat.opacityNode = attribute('puffOpacity', 'float');
    this.mesh = new InstancedMesh(geo, mat, POOL);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < POOL; i++) {
      this.mesh.setMatrixAt(i, HIDDEN);
      this.mesh.setColorAt(i, LOOK.ground.color);
      this.puffs.push({ pos: new Vector3(), vel: new Vector3(), age: LIFE, size: 0 });
    }
    scene.add(this.mesh);
  }

  spawn(hit: Impact): void {
    const look = LOOK[hit.surface];
    const n = hit.normal;
    for (let k = 0; k < PER_IMPACT; k++) {
      const i = this.next;
      this.next = (this.next + 1) % POOL;
      const p = this.puffs[i] as Puff;
      p.age = 0;
      p.size = look.size * (0.7 + Math.random() * 0.6);
      p.pos.set(hit.x + n.x * 0.05, hit.y + n.y * 0.05, hit.z + n.z * 0.05);
      const speed = look.rise * (0.6 + Math.random() * 0.8);
      p.vel.set(
        n.x * speed + (Math.random() - 0.5) * 0.6,
        n.y * speed + (Math.random() - 0.5) * 0.6 + 0.3,
        n.z * speed + (Math.random() - 0.5) * 0.6,
      );
      this.mesh.setColorAt(i, look.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    const drag = Math.exp(-dt * 4);
    let changed = false;
    this.puffs.forEach((p, i) => {
      if (p.age >= LIFE) return;
      changed = true;
      p.age += dt;
      if (p.age >= LIFE) {
        this.mesh.setMatrixAt(i, HIDDEN);
        this.opacity.setX(i, 0);
        return;
      }
      const t = p.age / LIFE;
      p.vel.multiplyScalar(drag);
      p.pos.addScaledVector(p.vel, dt);
      const s = p.size * (0.3 + 0.7 * Math.sqrt(t));
      this.mesh.setMatrixAt(i, M.makeScale(s, s, s).setPosition(p.pos));
      this.opacity.setX(i, 0.85 * (1 - t) ** 1.5);
    });
    if (changed) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.opacity.needsUpdate = true;
    }
  }
}
