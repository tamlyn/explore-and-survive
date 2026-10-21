import { readFileSync } from 'node:fs';
import { AnimationMixer, Box3, MeshStandardMaterial, type Object3D, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import type { RobotKind } from '../world/EnemyPlan';
import { prepareRobot } from './RobotModels';

const KINDS: RobotKind[] = ['walker', 'walkerGun', 'brute', 'bruteGun', 'drone', 'droneGun'];

function load(kind: RobotKind): Promise<GLTF> {
  const buf = readFileSync(new URL(`../../assets/models/robots/${kind}.glb`, import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => new GLTFLoader().parse(ab, '', resolve, reject));
}

/** where the skinned vertices actually land, idling */
function posedBounds(scene: Object3D, gltf: GLTF): Box3 {
  const mixer = new AnimationMixer(scene);
  mixer.clipAction(gltf.animations.find((c) => c.name.endsWith('Idle'))!).play();
  mixer.update(0.3);
  scene.updateMatrixWorld(true);
  const box = new Box3();
  const v = new Vector3();
  scene.traverse((o) => {
    if (!(o instanceof SkinnedMesh)) return;
    for (let i = 0; i < o.geometry.getAttribute('position').count; i++) {
      box.expandByPoint(o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld));
    }
  });
  return box;
}

describe('prepareRobot', () => {
  for (const kind of KINDS) {
    it(`${kind}: one colour-baked mesh, no stray lights, standing on its origin`, async () => {
      const original = await load(kind);
      const want = posedBounds(original.scene, original);
      const gltf = await load(kind);
      const mat = new MeshStandardMaterial();
      prepareRobot(gltf.scene, gltf.animations, mat);
      const meshes: SkinnedMesh[] = [];
      let lights = 0;
      gltf.scene.traverse((o) => {
        if (o instanceof SkinnedMesh) meshes.push(o);
        if ((o as { isLight?: boolean }).isLight) lights++;
      });
      expect(lights).toBe(0);
      expect(meshes).toHaveLength(1);
      let glowing = 0;
      for (const m of meshes) {
        expect(m.material).toBe(mat);
        expect(m.geometry.groups).toEqual([]);
        expect(m.geometry.getAttribute('color')).toBeDefined();
        glowing += (m.geometry.getAttribute('_glow').array as Float32Array).filter((g) => g > 0).length;
      }
      expect(glowing).toBeGreaterThan(0);

      const box = posedBounds(gltf.scene, gltf);
      // merging must not move a vertex
      for (const k of ['x', 'y', 'z'] as const) {
        expect(box.min[k]).toBeCloseTo(want.min[k], 2);
        expect(box.max[k]).toBeCloseTo(want.max[k], 2);
      }
      const c = box.getCenter(new Vector3());
      // drones hover with their origin at the bottom of the body
      expect(box.min.y).toBeGreaterThan(-0.3);
      expect(box.min.y).toBeLessThan(0.3);
      expect(box.max.y).toBeLessThan(1.4);
      expect(Math.abs(c.x)).toBeLessThan(0.1);
      expect(Math.abs(c.z)).toBeLessThan(0.35);
      // culled by a sphere around where it is drawn
      const s = meshes[0]!.boundingSphere!.clone().applyMatrix4(meshes[0]!.matrixWorld);
      expect(s.containsPoint(box.min)).toBe(true);
      expect(s.containsPoint(box.max)).toBe(true);
    });
  }
});
