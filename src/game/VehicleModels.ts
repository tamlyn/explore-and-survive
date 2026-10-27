/**
 * Vehicle models — the cars as tools/blender/vehicles.py left them: a body
 * and four wheels, each wheel pivoting about its hub. A car on the road has
 * its own materials (sharing the shaders), so each can be worn down on its
 * own as it's shot up.
 */

import { type BufferGeometry, Group, Mesh, type Object3D, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { StorageTexture } from 'three/webgpu';
import buggyUrl from '../../assets/models/vehicles/buggy.glb?url';
import roverUrl from '../../assets/models/vehicles/rover.glb?url';
import type { ProbeGI } from '../gpu/passes/ProbeGI';
import { lightWithProbes } from '../render/ProbeLighting';
import type { Pose, WheelState } from './Vehicle';
import { vehicleMaterial } from './VehicleMaterial';
import type { VehicleKind } from './VehicleSpec';

const URLS: Record<VehicleKind, string> = { buggy: buggyUrl, rover: roverUrl };
/** in the order VehicleSpec lists them */
const WHEELS = ['fl', 'fr', 'rl', 'rr'];
/** frames the warm-up cars stay drawn, so their pipelines compile at boot */
const WARM_FRAMES = 30;

export interface VehicleView {
  place(pose: Pose, wheels: readonly WheelState[]): void;
  /** 0 as bought … 1 wrecked */
  wear(worn: number): void;
  dispose(): void;
}

export interface VehicleViews {
  create(kind: VehicleKind): VehicleView;
}

interface Template {
  body: BufferGeometry;
  wheels: { geometry: BufferGeometry; hub: Vector3 }[];
}

function meshNamed(scene: Object3D, name: string): Mesh {
  const found = scene.getObjectByName(name);
  let mesh: Mesh | null = null;
  found?.traverse((o) => {
    if (!mesh && o instanceof Mesh) mesh = o;
  });
  if (!mesh) throw new Error(`vehicle model has no ${name}`);
  return mesh;
}

class Car implements VehicleView {
  readonly root = new Group();
  private readonly hubs: Group[];
  private readonly tyres: Mesh[];
  private readonly worn: { value: number }[];

  constructor(
    t: Template,
    private readonly parent: Object3D,
    light: (m: ReturnType<typeof vehicleMaterial>['material']) => void,
  ) {
    const body = vehicleMaterial();
    light(body.material);
    this.worn = [body.wear];
    const shell = new Mesh(t.body, body.material);
    this.root.add(shell);
    this.hubs = [];
    this.tyres = [];
    for (const w of t.wheels) {
      const hub = new Group();
      hub.position.copy(w.hub);
      // each wheel's mud line from its own hub height
      const tyre = vehicleMaterial(w.hub.y, body.wear);
      light(tyre.material);
      const mesh = new Mesh(w.geometry, tyre.material);
      hub.add(mesh);
      this.root.add(hub);
      this.hubs.push(hub);
      this.tyres.push(mesh);
    }
    this.root.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    parent.add(this.root);
  }

  place(pose: Pose, wheels: readonly WheelState[]): void {
    this.root.position.set(pose.p.x, pose.p.y, pose.p.z);
    this.root.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
    wheels.forEach((w, i) => {
      const hub = this.hubs[i]!;
      hub.position.y = w.hubY;
      hub.rotation.y = w.steer;
      // rolling forwards (towards −z) turns the top of the wheel forwards
      this.tyres[i]!.rotation.x = -w.spin;
    });
  }

  wear(worn: number): void {
    for (const u of this.worn) u.value = worn;
  }

  dispose(): void {
    this.parent.remove(this.root);
    for (const o of [this.root.children[0] as Mesh, ...this.tyres]) {
      (o.material as ReturnType<typeof vehicleMaterial>['material']).dispose();
    }
  }
}

export class VehicleModels implements VehicleViews {
  readonly group = new Group();
  private warm: Car[] = [];
  private frames = 0;

  private constructor(
    private readonly templates: Map<VehicleKind, Template>,
    private readonly light: (m: ReturnType<typeof vehicleMaterial>['material']) => void,
  ) {
    this.group.name = 'vehicles';
    // drawn out of sight for a few frames: the first car bought would
    // otherwise stall the frame compiling its shaders
    for (const kind of templates.keys()) {
      const car = this.make(kind);
      car.root.position.set(0, -1e4, 0);
      car.root.traverse((o) => (o.frustumCulled = false));
      this.warm.push(car);
    }
  }

  static async load(gi: ProbeGI | null, canopyTex: StorageTexture | null): Promise<VehicleModels> {
    const loader = new GLTFLoader();
    const templates = new Map<VehicleKind, Template>();
    await Promise.all(
      (Object.keys(URLS) as VehicleKind[]).map(async (kind) => {
        const { scene } = await loader.loadAsync(URLS[kind]);
        scene.updateMatrixWorld(true);
        templates.set(kind, {
          body: meshNamed(scene, 'body').geometry,
          wheels: WHEELS.map((w) => {
            const mesh = meshNamed(scene, `wheel_${w}`);
            return { geometry: mesh.geometry, hub: mesh.getWorldPosition(new Vector3()) };
          }),
        });
      }),
    );
    return new VehicleModels(templates, (m) => {
      if (gi) lightWithProbes(m, gi, canopyTex);
    });
  }

  create(kind: VehicleKind): VehicleView {
    return this.make(kind);
  }

  private make(kind: VehicleKind): Car {
    return new Car(this.templates.get(kind)!, this.group, this.light);
  }

  /** once per frame */
  update(): void {
    if (this.warm.length && ++this.frames > WARM_FRAMES) {
      for (const c of this.warm) c.dispose();
      this.warm = [];
    }
  }
}
