/**
 * Viewmodel — the first-person gun. It lives in its own small scene with its
 * own camera, which the post stack lays over the world (see Overlay): the
 * gun can't clip into trunks, keeps a steady FOV through the sprint kick and
 * isn't smeared by the world's TRAA. The world's sun, ambient and
 * environment are mirrored onto it each frame so it sits in the same light,
 * minus shadows.
 *
 * All motion here is presentation: kick, look sway, walk bob, the sprint
 * carry pose and a reload dip (the model has no animation rig).
 */

import type { HemisphereLight, Object3D, PerspectiveCamera as MainCamera } from 'three';
import {
  Box3,
  CustomBlending,
  DirectionalLight,
  Group,
  HemisphereLight as Hemi,
  Mesh,
  OneFactor,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  ZeroFactor,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { atan, cos, float, length, uv, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import pistolUrl from '../../assets/models/pistol.glb?url';
import { runiform } from '../gpu/RenderUniform';
import type { NF } from '../gpu/TSLTypes';
import { WALK_SPEED } from './Player';

const GUN_LENGTH = 0.2; // m, muzzle to hammer
/** grip position in the viewmodel camera's space */
const REST = new Vector3(0.12, -0.115, -0.4);
/** muzzle turned in a little, so the gun's left side shows */
const REST_YAW = 0.22;
const FOV = 50;
const FLASH_TIME = 0.05;
const FLASH_HDR = 60;
const KICK_K = 260; // recoil spring stiffness
const KICK_C = 26; // recoil spring damping
/** how much of the sun and the sky light deep canopy takes away */
const CANOPY_SUN = 0.85;
const CANOPY_SKY = 0.5;
/** the world's materials take their sky light from GI probes, which see the
 *  terrain and canopy; the raw sky environment alone is far brighter */
const SKY_ENV = 0.3;

export interface WorldLights {
  sun: DirectionalLight;
  ambient: HemisphereLight;
}

export interface ViewmodelSubject {
  readonly yaw: number;
  readonly pitch: number;
  readonly speed: number;
  readonly grounded: boolean;
  readonly sprinting: boolean;
}

export class Viewmodel {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.01, 5);
  lights: WorldLights | null = null;
  /** 0 in the open … 1 under full canopy. The viewmodel has no shadows of
   *  its own, so without this it glows sunlit in the forest. */
  canopy = 0;

  private readonly sun = new DirectionalLight();
  private readonly ambient = new Hemi();
  private readonly holder = new Group(); // posed each frame
  private readonly flash: Mesh;
  private readonly flashIntensity = runiform(0);
  private flashLeft = 0;
  private kick = 0;
  private kickV = 0;
  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private bobK = 0;
  private sprintK = 0;
  private lastYaw: number | null = null;
  private lastPitch = 0;
  private canopyK = 0;

  constructor(
    private readonly main: MainCamera,
    private readonly mainScene: Scene,
  ) {
    this.scene.add(this.camera, this.sun, this.sun.target, this.ambient);
    this.camera.add(this.holder);
    this.flash = muzzleFlash(this.flashIntensity);
    this.flash.visible = false;
  }

  async load(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(pistolUrl);
    const model = gltf.scene;
    // the source model is ~1.8 m long with the barrel along +x; scale it to
    // size and put the grip at the origin (a third of the way up from the butt)
    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const s = GUN_LENGTH / size.x;
    model.scale.setScalar(s);
    model.position.set(-center.x * s, -(box.min.y + size.y * 0.35) * s, -center.z * s);
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      o.castShadow = false;
    });
    this.flash.position.copy(muzzlePoint(model));
    const gun = new Group();
    gun.rotation.y = Math.PI / 2; // +x → −z (forward)
    gun.add(model, this.flash);
    this.holder.add(gun);
  }

  /** settle all motion — on (re-)entering play, when the aim may have jumped */
  reset(): void {
    this.lastYaw = null;
    this.kick = 0;
    this.kickV = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.flashLeft = 0;
  }

  fire(): void {
    this.kickV += 9;
    this.flashLeft = FLASH_TIME;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.4);
  }

  /** `reload` runs 0 → 1 through a reload, 0 otherwise */
  update(dt: number, p: ViewmodelSubject, reload: number): void {
    this.canopyK += (this.canopy - this.canopyK) * (1 - Math.exp(-dt * 3));
    this.syncWorld();

    // look sway: the gun lags the aim a little, then catches up
    if (this.lastYaw === null) {
      this.lastYaw = p.yaw;
      this.lastPitch = p.pitch;
    }
    const dYaw = p.yaw - this.lastYaw;
    const dPitch = p.pitch - this.lastPitch;
    this.lastYaw = p.yaw;
    this.lastPitch = p.pitch;
    const settle = 1 - Math.exp(-dt * 10);
    this.swayX = clamp(this.swayX + dYaw * 0.35, 0.04) * (1 - settle);
    this.swayY = clamp(this.swayY + dPitch * 0.35, 0.04) * (1 - settle);

    const moving = p.grounded ? Math.min(p.speed / WALK_SPEED, 1.5) : 0;
    this.bobK += (moving - this.bobK) * (1 - Math.exp(-dt * 8));
    this.bobPhase += dt * (5 + 4 * Math.min(p.speed / WALK_SPEED, 2));
    const sprintT = p.sprinting && p.grounded && p.speed > WALK_SPEED * 1.15 ? 1 : 0;
    this.sprintK += (sprintT - this.sprintK) * (1 - Math.exp(-dt * 7));

    this.kickV += (-KICK_K * this.kick - KICK_C * this.kickV) * dt;
    this.kick += this.kickV * dt;

    const dip = Math.sin(Math.PI * reload);
    const h = this.holder;
    h.position.set(
      REST.x + Math.sin(this.bobPhase) * 0.006 * this.bobK + this.swayX * 0.4 - this.sprintK * 0.03,
      REST.y - Math.abs(Math.cos(this.bobPhase)) * 0.006 * this.bobK - this.swayY * 0.4 - this.sprintK * 0.04 - dip * 0.07,
      REST.z + this.kick * 0.012,
    );
    h.rotation.set(
      this.kick * 0.06 - this.sprintK * 0.5 - dip * 0.6,
      REST_YAW + this.swayX + this.sprintK * 0.5,
      dip * 0.5,
    );

    this.flashLeft = Math.max(0, this.flashLeft - dt);
    this.flash.visible = this.flashLeft > 0;
    this.flashIntensity.value = (this.flashLeft / FLASH_TIME) * FLASH_HDR;
  }

  private syncWorld(): void {
    const cam = this.camera;
    cam.quaternion.copy(this.main.quaternion);
    if (cam.aspect !== this.main.aspect) {
      cam.aspect = this.main.aspect;
      cam.updateProjectionMatrix();
    }
    const sky = 1 - CANOPY_SKY * this.canopyK;
    this.scene.environment = this.mainScene.environment;
    this.scene.environmentIntensity = this.mainScene.environmentIntensity * SKY_ENV * sky;
    const l = this.lights;
    if (!l) return;
    // the viewmodel camera sits at the origin, so the sun's direction carries over
    this.sun.position.copy(l.sun.position).sub(l.sun.target.position).normalize();
    this.sun.color.copy(l.sun.color);
    this.sun.intensity = l.sun.intensity * (1 - CANOPY_SUN * this.canopyK);
    this.ambient.color.copy(l.ambient.color);
    this.ambient.groundColor.copy(l.ambient.groundColor);
    this.ambient.intensity = l.ambient.intensity * sky;
  }
}

function clamp(v: number, max: number): number {
  return Math.max(-max, Math.min(max, v));
}

/** just ahead of the gun's front face, at its average height; `model` must
 *  be unparented so its world space is the gun's space */
function muzzlePoint(model: Object3D): Vector3 {
  const box = new Box3().setFromObject(model);
  const front = box.max.x - (box.max.x - box.min.x) * 0.03;
  const sum = new Vector3();
  let n = 0;
  const v = new Vector3();
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (v.x >= front) {
        sum.add(v);
        n++;
      }
    }
  });
  return new Vector3(box.max.x + 0.005, n ? sum.y / n : 0, n ? sum.z / n : 0);
}

/** a soft star facing back down the barrel; brightness is HDR so it reads
 *  hot against any exposure */
function muzzleFlash(intensity: NF): Mesh {
  const c = uv().sub(0.5);
  const r = length(c).mul(2);
  const spikes = cos(atan(c.y, c.x).mul(5)).mul(0.35).add(0.65);
  const core = float(1).sub(r.div(spikes)).max(0).pow(2);
  const glow = float(1).sub(r).max(0).pow(4).mul(0.3);
  // seen from behind, the gun itself would hide the flash; adds light but
  // leaves alpha alone, so it stays see-through in the premultiplied overlay
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
  mat.colorNode = vec3(1, 0.62, 0.28).mul(core.add(glow)).mul(intensity);
  const mesh = new Mesh(new PlaneGeometry(0.1, 0.1), mat);
  mesh.rotation.y = -Math.PI / 2; // face back down the barrel (−x), at the shooter
  mesh.renderOrder = 1;
  return mesh;
}
