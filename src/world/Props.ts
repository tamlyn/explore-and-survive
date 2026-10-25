/**
 * Props rendering — one instanced mesh per model part, holding only the
 * props near the camera: past their draw distance they cover a pixel or
 * two, so the far field costs nothing in the main pass or the shadow
 * cascades. Each prop collides as its model's bounding box. A prop can be
 * taken away (a crate emptied), and is drawn no more.
 */

import { Box3, Group, InstancedMesh, Matrix4, Mesh, type MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshStandardNodeMaterial, type StorageTexture } from 'three/webgpu';
import ammoCratesUrl from '../../assets/models/props/ammo_crates.glb?url';
import blueBarrelUrl from '../../assets/models/props/blue_barrel.glb?url';
import carUrl from '../../assets/models/props/car.glb?url';
import jerrycanUrl from '../../assets/models/props/jerrycan.glb?url';
import redBarrelUrl from '../../assets/models/props/red_barrel.glb?url';
import tyreUrl from '../../assets/models/props/tyre.glb?url';
import woodCrateUrl from '../../assets/models/props/wood_crate.glb?url';
import type { ProbeGI } from '../gpu/passes/ProbeGI';
import { lightWithProbes } from '../render/ProbeLighting';
import type { Box } from './Box';
import type { Prop, PropKind } from './PropPlan';

export type PropSurface = 'metal' | 'wood' | 'rubber';

export type PropBox = Box & { surface: PropSurface };

const MODELS: Record<PropKind, { url: string; surface: PropSurface; range: number }> = {
  car: { url: carUrl, surface: 'metal', range: 450 },
  redBarrel: { url: redBarrelUrl, surface: 'metal', range: 160 },
  blueBarrel: { url: blueBarrelUrl, surface: 'metal', range: 160 },
  jerrycan: { url: jerrycanUrl, surface: 'metal', range: 110 },
  ammoCrates: { url: ammoCratesUrl, surface: 'wood', range: 160 },
  woodCrate: { url: woodCrateUrl, surface: 'wood', range: 130 },
  tyre: { url: tyreUrl, surface: 'rubber', range: 130 },
};

/** the visible set is rebuilt after the camera moves this far (m) */
const REFRESH = 5;

interface KindDraw {
  kind: PropKind;
  placed: Prop[];
  meshes: InstancedMesh[];
  /** model bounds in its own frame */
  bounds: Box3;
  range: number;
}

const M = new Matrix4();
const P = new Vector3();
const Q = new Quaternion();
const ONE = new Vector3(1, 1, 1);

function nodeMaterial(src: MeshStandardMaterial, gi: ProbeGI | null, canopyTex: StorageTexture | null): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial({
    color: src.color,
    map: src.map,
    normalMap: src.normalMap,
    roughnessMap: src.roughnessMap,
    metalnessMap: src.metalnessMap,
    roughness: src.roughness,
    metalness: src.metalness,
    side: src.side,
  });
  if (gi) lightWithProbes(mat, gi, canopyTex);
  return mat;
}

export class Props {
  readonly group = new Group();
  private readonly last = new Vector3(Infinity, 0, 0);
  private readonly byKind: Map<PropKind, KindDraw>;
  private readonly taken = new Set<Prop>();

  private constructor(private readonly kinds: KindDraw[]) {
    this.group.name = 'props';
    for (const k of kinds) this.group.add(...k.meshes);
    this.byKind = new Map(kinds.map((k) => [k.kind, k]));
  }

  static async load(props: Prop[], gi: ProbeGI | null, canopyTex: StorageTexture | null): Promise<Props> {
    const loader = new GLTFLoader();
    const used = [...new Set(props.map((p) => p.kind))];
    const kinds = await Promise.all(
      used.map(async (kind): Promise<KindDraw> => {
        const { url, range } = MODELS[kind];
        const placed = props.filter((p) => p.kind === kind);
        const gltf = await loader.loadAsync(url);
        gltf.scene.updateMatrixWorld(true);
        const meshes: InstancedMesh[] = [];
        gltf.scene.traverse((o) => {
          if (!(o instanceof Mesh)) return;
          const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
          const mesh = new InstancedMesh(geo, nodeMaterial(o.material as MeshStandardMaterial, gi, canopyTex), placed.length);
          mesh.count = 0;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          // instances span the world; the range cull below does the culling
          mesh.frustumCulled = false;
          meshes.push(mesh);
        });
        return { kind, placed, meshes, bounds: new Box3().setFromObject(gltf.scene), range };
      }),
    );
    return new Props(kinds);
  }

  /** the prop's box, from its model's bounds; `p` must be one of those loaded */
  collider(p: Prop): PropBox {
    const { bounds } = this.byKind.get(p.kind)!;
    const c = bounds.getCenter(new Vector3()).applyQuaternion(Q.set(...p.q));
    const half = bounds.getSize(new Vector3()).multiplyScalar(0.5);
    return { x: p.x + c.x, y: p.y + c.y, z: p.z + c.z, hx: half.x, hy: half.y, hz: half.z, q: p.q, surface: MODELS[p.kind].surface };
  }

  take(p: Prop): void {
    this.taken.add(p);
    this.last.set(Infinity, 0, 0);
  }

  /** draw only what's within each kind's range of the eye */
  update(eye: Vector3): void {
    if (eye.distanceTo(this.last) < REFRESH) return;
    this.last.copy(eye);
    for (const { placed, meshes, range } of this.kinds) {
      let n = 0;
      for (const p of placed) {
        if (this.taken.has(p) || Math.hypot(p.x - eye.x, p.z - eye.z) > range) continue;
        M.compose(P.set(p.x, p.y, p.z), Q.set(...p.q), ONE);
        for (const mesh of meshes) mesh.setMatrixAt(n, M);
        n++;
      }
      for (const mesh of meshes) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
