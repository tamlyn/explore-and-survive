/**
 * Robot models — the Quaternius robots as published. At load each robot's
 * parts are merged into one skinned mesh with their flat material colours
 * baked into vertex colours, so a robot is a single draw call with a shared
 * material, and eyes and status lights glow from a baked mask.
 * Every awake robot gets its own skeleton and animation mixer.
 */

import {
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  Box3,
  BufferAttribute,
  BufferGeometry,
  type Color,
  Group,
  type Light,
  LoopOnce,
  type Material,
  Matrix4,
  type MeshStandardMaterial,
  Object3D,
  type Skeleton,
  SkinnedMesh,
  Sphere,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { attribute, vertexColor } from 'three/tsl';
import { MeshStandardNodeMaterial, type StorageTexture } from 'three/webgpu';
import brute from '../../assets/models/robots/brute.glb?url';
import bruteGun from '../../assets/models/robots/bruteGun.glb?url';
import drone from '../../assets/models/robots/drone.glb?url';
import droneGun from '../../assets/models/robots/droneGun.glb?url';
import walker from '../../assets/models/robots/walker.glb?url';
import walkerGun from '../../assets/models/robots/walkerGun.glb?url';
import type { ProbeGI } from '../gpu/passes/ProbeGI';
import { lightWithProbes } from '../render/ProbeLighting';
import type { RobotKind } from '../world/EnemyPlan';
import type { Pose } from './EnemyBrain';
import type { RobotView, RobotViews } from './Enemies';
import { ROBOTS } from './RobotSpec';

const URLS: Record<RobotKind, string> = { walker, walkerGun, brute, bruteGun, drone, droneGun };

/** HDR glow of eyes and lights, enough to bloom */
const GLOW = 6;
/** pose blend time (s) */
const FADE = 0.2;
const SPHERE_SLACK = 1.5;
/** frames the warm-up robots stay drawn, so their pipelines compile at boot */
const WARM_FRAMES = 30;

interface Template {
  scene: Object3D;
  clips: AnimationClip[];
}

/** the models' only saturated colours are their eyes and status lights */
function glows(c: Color): boolean {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) > 0.75;
}

/** what the merged mesh keeps of each part */
const ATTRIBUTES = ['position', 'normal', 'skinIndex', 'skinWeight'];

/**
 * How a part's skin relates to the shared one. The models' separate meshes
 * were each bound in their own space, so every joint's inverse bind matrix
 * differs from the shared skin's by the same transform: baking it into the
 * part's vertices lets them all skin from one skeleton.
 */
function rebinding(part: Skeleton, shared: Skeleton): Matrix4 {
  const t = shared.boneInverses[0]!.clone().invert().multiply(part.boneInverses[0]!);
  part.bones.forEach((bone, i) => {
    const want = part.boneInverses[i]!.elements;
    const got = shared.boneInverses[i]!.clone().multiply(t).elements;
    const tol = 1e-4 * Math.max(1, ...want.map(Math.abs));
    if (bone !== shared.bones[i] || got.some((g, k) => Math.abs(g - want[k]!) > tol)) {
      throw new Error(`robot part skinned to ${bone.name} differently from the rest`);
    }
  });
  return t;
}

/**
 * One part (the loader makes a mesh per material) as plain geometry in the
 * shared skin's bind space, its material's colour baked in and glowing parts
 * marked.
 */
function bakedPart(mesh: SkinnedMesh, shared: Skeleton): BufferGeometry {
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  const geo = new BufferGeometry();
  for (const name of ATTRIBUTES) geo.setAttribute(name, src.getAttribute(name));
  geo.applyMatrix4(rebinding(mesh.skeleton, shared).multiply(mesh.bindMatrix));
  const n = geo.getAttribute('position').count;
  const c = (mesh.material as MeshStandardMaterial).color;
  const color = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new BufferAttribute(color, 3));
  geo.setAttribute('_glow', new BufferAttribute(new Float32Array(n).fill(glows(c) ? 1 : 0), 1));
  return geo;
}

/**
 * Readies a loaded robot for drawing with `material`: its parts merged into
 * one skinned mesh (one draw call) with their colours baked in, the lights
 * some of the files carry removed, and culling bounds measured.
 */
export function prepareRobot(scene: Object3D, clips: AnimationClip[], material: Material): void {
  scene.updateMatrixWorld(true);
  const parts: SkinnedMesh[] = [];
  const lights: Light[] = [];
  scene.traverse((o) => {
    if ((o as Light).isLight) lights.push(o as Light);
    if (o instanceof SkinnedMesh) parts.push(o);
  });
  for (const l of lights) l.removeFromParent();
  const { skeleton } = parts[0]!;
  // parts were baked into bind space, so the merged mesh binds with identity
  const body = new SkinnedMesh(mergeGeometries(parts.map((p) => bakedPart(p, skeleton)))!, material);
  body.bind(skeleton, new Matrix4());
  body.castShadow = true;
  body.receiveShadow = true;
  for (const p of parts) p.removeFromParent();
  scene.add(body);
  cullingBounds(scene, body, clips);
}

/**
 * Gives the body a bounding sphere around where its vertices land in a
 * posed robot, which clones then copy. Left to three, it would be taken
 * from whatever pose the bones hold at first draw.
 */
function cullingBounds(scene: Object3D, body: SkinnedMesh, clips: AnimationClip[]): void {
  const idle = clipFor(clips, 'Idle');
  const mixer = new AnimationMixer(scene);
  if (idle) mixer.clipAction(idle).play();
  mixer.update(0);
  scene.updateMatrixWorld(true);
  const box = new Box3();
  const v = new Vector3();
  for (let i = 0; i < body.geometry.getAttribute('position').count; i++) {
    box.expandByPoint(body.getVertexPosition(i, v).applyMatrix4(body.matrixWorld));
  }
  const sphere = box.getBoundingSphere(new Sphere());
  // room for limbs swinging through the other animations
  sphere.radius *= SPHERE_SLACK;
  body.boundingSphere = sphere.applyMatrix4(body.matrixWorld.clone().invert());
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
}

function clipFor(clips: AnimationClip[], ...names: string[]): AnimationClip | undefined {
  return clips.find((c) => names.includes(c.name.split('|').pop() ?? ''));
}

class Robot implements RobotView {
  readonly root: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly actions = new Map<Pose, AnimationAction>();
  private current: AnimationAction | null = null;
  private currentPose: Pose | null = null;

  constructor(
    t: Template,
    kind: RobotKind,
    private readonly parent: Object3D,
  ) {
    const spec = ROBOTS[kind];
    this.root = clone(t.scene);
    this.root.scale.setScalar(spec.scale);
    this.mixer = new AnimationMixer(this.root);
    const clips: Record<Pose, AnimationClip | undefined> = {
      idle: clipFor(t.clips, 'Idle'),
      walk: clipFor(t.clips, 'Walk'),
      run: clipFor(t.clips, 'Run'),
      attack: clipFor(t.clips, spec.attack.ranged ? 'Shoot' : 'Attack'),
      dead: clipFor(t.clips, 'Death', 'Dead'),
    };
    for (const [pose, clip] of Object.entries(clips) as [Pose, AnimationClip | undefined][]) {
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      if (pose === 'attack' || pose === 'dead') {
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(pose, action);
    }
    parent.add(this.root);
  }

  place(x: number, y: number, z: number, yaw: number): void {
    this.root.position.set(x, y, z);
    // the models face +z; yaw 0 looks −z
    this.root.rotation.y = yaw + Math.PI;
  }

  pose(p: Pose): void {
    if (p === this.currentPose) return;
    // let a strike or shot play out unless the robot dies
    const busy = this.currentPose === 'attack' && this.current?.isRunning();
    if (busy && p !== 'dead') return;
    const next = this.actions.get(p);
    if (!next) return;
    next.reset().play();
    if (this.current) next.crossFadeFrom(this.current, FADE, false);
    this.current = next;
    this.currentPose = p;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.parent.remove(this.root);
    this.root.traverse((o) => {
      if (o instanceof SkinnedMesh) o.skeleton.dispose();
    });
  }
}

export class RobotModels implements RobotViews {
  readonly group = new Group();
  private warm: Robot[] = [];
  private frames = 0;

  private constructor(private readonly templates: Map<RobotKind, Template>) {
    this.group.name = 'robots';
    // one of each, drawn out of sight for a few frames: the first robot of a
    // kind to wake would otherwise stall the frame compiling its shaders
    for (const kind of templates.keys()) {
      const r = this.create(kind);
      r.place(0, -1e4, 0, 0);
      r.root.traverse((o) => (o.frustumCulled = false));
      this.warm.push(r);
    }
  }

  static async load(kinds: Iterable<RobotKind>, gi: ProbeGI | null, canopyTex: StorageTexture | null): Promise<RobotModels> {
    const mat = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.4 });
    mat.emissiveNode = vertexColor().rgb.mul(attribute('_glow', 'float')).mul(GLOW);
    if (gi) lightWithProbes(mat, gi, canopyTex);
    const loader = new GLTFLoader();
    const templates = new Map<RobotKind, Template>();
    await Promise.all(
      [...new Set(kinds)].map(async (kind) => {
        const gltf = await loader.loadAsync(URLS[kind]);
        prepareRobot(gltf.scene, gltf.animations, mat);
        templates.set(kind, { scene: gltf.scene, clips: gltf.animations });
      }),
    );
    return new RobotModels(templates);
  }

  create(kind: RobotKind): Robot {
    return new Robot(this.templates.get(kind)!, kind, this.group);
  }

  /** once per frame */
  update(): void {
    if (this.warm.length && ++this.frames > WARM_FRAMES) {
      for (const r of this.warm) r.dispose();
      this.warm = [];
    }
  }
}
