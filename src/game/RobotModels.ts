/**
 * Robot models — the Quaternius robots, each repacked as one skinned mesh
 * (tools/blender/pack-robots.py): flat colours ride in vertex colours, so a
 * robot is a single draw call, and eyes and status lights glow from a baked
 * mask. Every awake robot gets its own skeleton and animation mixer.
 */

import {
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  Group,
  LoopOnce,
  Object3D,
  SkinnedMesh,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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
import type { Vec3 } from './PlayerMotor';
import { ROBOTS } from './RobotSpec';

const URLS: Record<RobotKind, string> = { walker, walkerGun, brute, bruteGun, drone, droneGun };

/** HDR glow of eyes and lights, enough to bloom */
const GLOW = 6;
/** pose blend time (s) */
const FADE = 0.2;
/** the muzzle sits this far along the gun from its bone (model units) */
const BARREL = 0.35;
/** frames the warm-up robots stay drawn, so their pipelines compile at boot */
const WARM_FRAMES = 30;

interface Template {
  scene: Object3D;
  clips: AnimationClip[];
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
  private readonly gun: Object3D | undefined;

  constructor(
    t: Template,
    kind: RobotKind,
    private readonly parent: Object3D,
  ) {
    const spec = ROBOTS[kind];
    this.root = clone(t.scene);
    this.root.scale.setScalar(spec.scale);
    this.gun = this.root.getObjectByName('Gun');
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

  muzzle(out: Vec3): boolean {
    if (!this.gun) return false;
    const p = this.gun.localToWorld(V.set(0, BARREL, 0));
    out.x = p.x;
    out.y = p.y;
    out.z = p.z;
    return true;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.parent.remove(this.root);
    this.root.traverse((o) => {
      if (o instanceof SkinnedMesh) o.skeleton.dispose();
    });
  }
}

const V = new Vector3();

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
        gltf.scene.traverse((o) => {
          if (!(o instanceof SkinnedMesh)) return;
          o.material = mat;
          o.castShadow = true;
          o.receiveShadow = true;
        });
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
