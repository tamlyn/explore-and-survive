/**
 * Impacts — the puff where a shot lands: a few small lit, fading balls of
 * dust, splinters or spray, coloured by the surface. Lit by the world's own
 * lights (and shadowed), so they sit right in sun and shade alike. Pooled;
 * the oldest puff is recycled when the pool runs out.
 */

import type { Scene } from 'three';
import { Color, IcosahedronGeometry, Mesh, Vector3 } from 'three';
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
  mesh: Mesh;
  mat: MeshStandardNodeMaterial;
  vel: Vector3;
  age: number;
  size: number;
}

export class Impacts {
  private readonly puffs: Puff[] = [];
  private next = 0;

  constructor(scene: Scene) {
    const geo = new IcosahedronGeometry(1, 1);
    for (let i = 0; i < POOL; i++) {
      const mat = new MeshStandardNodeMaterial({ roughness: 1, transparent: true, depthWrite: false });
      const mesh = new Mesh(geo, mat);
      mesh.visible = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.puffs.push({ mesh, mat, vel: new Vector3(), age: LIFE, size: 0 });
    }
  }

  spawn(hit: Impact): void {
    const look = LOOK[hit.surface];
    const n = hit.normal;
    for (let k = 0; k < PER_IMPACT; k++) {
      const p = this.puffs[this.next] as Puff;
      this.next = (this.next + 1) % POOL;
      p.age = 0;
      p.size = look.size * (0.7 + Math.random() * 0.6);
      p.mat.color.copy(look.color);
      p.mesh.position.set(hit.x + n.x * 0.05, hit.y + n.y * 0.05, hit.z + n.z * 0.05);
      const speed = look.rise * (0.6 + Math.random() * 0.8);
      p.vel.set(
        n.x * speed + (Math.random() - 0.5) * 0.6,
        n.y * speed + (Math.random() - 0.5) * 0.6 + 0.3,
        n.z * speed + (Math.random() - 0.5) * 0.6,
      );
      p.mesh.visible = true;
    }
  }

  update(dt: number): void {
    const drag = Math.exp(-dt * 4);
    for (const p of this.puffs) {
      if (!p.mesh.visible) continue;
      p.age += dt;
      if (p.age >= LIFE) {
        p.mesh.visible = false;
        continue;
      }
      const t = p.age / LIFE;
      p.vel.multiplyScalar(drag);
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(p.size * (0.3 + 0.7 * Math.sqrt(t)));
      p.mat.opacity = 0.85 * (1 - t) ** 1.5;
    }
  }
}
