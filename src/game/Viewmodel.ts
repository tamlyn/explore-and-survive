/**
 * Viewmodel — the tool in the player's hand, pistol or axe (building is
 * done empty-handed). It lives in its
 * own small scene with its own camera, which the post stack lays over the
 * world (see Overlay): the tool can't clip into trunks, keeps a steady FOV
 * through the sprint kick and isn't smeared by the world's TRAA. The
 * world's sun, ambient and environment are mirrored onto it each frame so
 * it sits in the same light, minus shadows.
 *
 * All motion here is presentation: kick, look sway, walk bob, the sprint
 * carry pose, a reload dip, the axe's swing and the dip while changing
 * tools (the models have no animation rig).
 */

import type { HemisphereLight, Object3D, PerspectiveCamera as MainCamera } from 'three';
import {
  Box3,
  BoxGeometry,
  CustomBlending,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { atan, attribute, cos, float, length, mix, uv, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import pistolUrl from '../../assets/models/pistol.glb?url';
import { type Spring, stepSpring } from '../core/Spring';
import { runiform } from '../gpu/RenderUniform';
import type { NF } from '../gpu/TSLTypes';
import type { Tool } from './Arsenal';
import { AXE } from './Melee';
import { WALK_SPEED } from './Player';

const GUN_LENGTH = 0.2; // m, muzzle to hammer
/** grip position in the viewmodel camera's space */
const REST = new Vector3(0.12, -0.115, -0.4);
/** muzzle turned in a little, so the gun's left side shows */
const REST_YAW = 0.22;
const FOV = 50;
const FLASH_TIME = 0.05;
const FLASH_HDR = 60;
/** how far the flash's flame reaches past the muzzle (m) */
const TONGUE_LENGTH = 0.14;
/** the axe's grip, and its lean: head a little forward and inward */
const AXE_REST = new Vector3(0.2, -0.3, -0.42);
const AXE_TILT = { x: -0.55, z: 0.3 };
/** where in a swing (0 → 1) the blow lands, as the hit does, and the
 *  wind-up before it ends */
const AXE_LANDED = AXE.strikeAt / AXE.swingTime;
const AXE_WOUND = AXE_LANDED - 0.12;
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

/** what the hand is doing; the phases run 0 → 1, and are 0 when idle */
export interface ToolPose {
  tool: Tool;
  reload: number;
  swing: number;
  /** 0 in hand … 1 out of sight, while changing tools */
  lowered: number;
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
  /** building is done with empty hands */
  private readonly tools: Record<Tool, Group> = { pistol: new Group(), axe: axeModel(), build: new Group() };
  private readonly flash: Mesh;
  private readonly flashIntensity = runiform(0);
  private flashLeft = 0;
  private readonly kick: Spring = { x: 0, v: 0 };
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
    this.holder.add(this.tools.pistol, this.tools.axe);
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
    const gun = this.tools.pistol;
    gun.rotation.y = Math.PI / 2; // +x → −z (forward)
    gun.add(model, this.flash);
  }

  /** settle all motion — on (re-)entering play, when the aim may have jumped */
  reset(): void {
    this.lastYaw = null;
    this.kick.x = 0;
    this.kick.v = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.flashLeft = 0;
  }

  fire(): void {
    this.kick.v += 9;
    this.flashLeft = FLASH_TIME;
    this.flash.rotation.x = Math.random() * Math.PI;
    this.flash.scale.setScalar(0.8 + Math.random() * 0.4);
  }

  update(dt: number, p: ViewmodelSubject, pose: ToolPose): void {
    this.canopyK += (this.canopy - this.canopyK) * (1 - Math.exp(-dt * 3));
    this.syncWorld();

    // look sway: the tool lags the aim a little, then catches up
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

    stepSpring(this.kick, KICK_K, KICK_C, dt);

    for (const [tool, model] of Object.entries(this.tools)) model.visible = tool === pose.tool;
    const h = this.holder;
    // what every tool shares: bob, sway, the sprint carry and the change dip
    h.position.set(
      Math.sin(this.bobPhase) * 0.006 * this.bobK + this.swayX * 0.4 - this.sprintK * 0.03,
      -Math.abs(Math.cos(this.bobPhase)) * 0.006 * this.bobK - this.swayY * 0.4 - this.sprintK * 0.04 - pose.lowered * 0.3,
      0,
    );
    h.rotation.set(-this.sprintK * 0.5 - pose.lowered, this.swayX + this.sprintK * 0.5, 0);
    if (pose.tool === 'pistol') {
      const dip = Math.sin(Math.PI * pose.reload);
      h.position.add(REST);
      h.position.y -= dip * 0.07;
      h.position.z += this.kick.x * 0.012;
      h.rotation.x += this.kick.x * 0.06 - dip * 0.6;
      h.rotation.y += REST_YAW;
      h.rotation.z += dip * 0.5;
    } else if (pose.tool === 'axe') {
      const sw = axeSwing(pose.swing);
      h.position.add(AXE_REST).add(sw.at);
      h.rotation.x += AXE_TILT.x + sw.rx;
      h.rotation.z += AXE_TILT.z + sw.rz;
    }

    // aged after drawing, so a frame slower than the flash still shows it
    this.flash.visible = this.flashLeft > 0;
    this.flashIntensity.value = (this.flashLeft / FLASH_TIME) * FLASH_HDR;
    this.flashLeft = Math.max(0, this.flashLeft - dt);
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

function smooth(a: number, b: number, t: number): number {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/** the axe through a swing (0 → 1): raised and cocked back, brought down
 *  hard across to the left, then back to rest */
const SWING = { at: new Vector3(), rx: 0, rz: 0 };

function axeSwing(s: number): typeof SWING {
  if (s <= 0) {
    SWING.at.set(0, 0, 0);
    SWING.rx = SWING.rz = 0;
    return SWING;
  }
  const wind = smooth(0, AXE_WOUND, s);
  const blow = smooth(AXE_WOUND, AXE_LANDED, s);
  const back = smooth(AXE_LANDED + 0.1, 1, s);
  // wound up → struck, then fading back to rest
  const up = wind * (1 - blow);
  const down = blow * (1 - back);
  SWING.at.set(-0.09 * down, 0.07 * up - 0.1 * down, 0.04 * up - 0.06 * down);
  SWING.rx = 1.0 * up - 1.3 * down;
  SWING.rz = 0.25 * up + 0.35 * down;
  return SWING;
}

/** a hatchet with its grip at the origin: the handle up +y, the blade's
 *  edge forward (−z) */
function axeModel(): Group {
  const wood = new MeshStandardNodeMaterial({ color: 0x6e4a2a, roughness: 0.8 });
  const steel = new MeshStandardNodeMaterial({ color: 0x7d8288, roughness: 0.45, metalness: 0.85 });
  const edge = new MeshStandardNodeMaterial({ color: 0xc9cdd2, roughness: 0.25, metalness: 0.9 });
  const part = (geo: BoxGeometry | CylinderGeometry, mat: MeshStandardNodeMaterial, x: number, y: number, z: number): Mesh => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };
  const axe = new Group();
  axe.add(
    part(new CylinderGeometry(0.011, 0.014, 0.4, 8), wood, 0, 0.12, 0),
    part(new BoxGeometry(0.02, 0.06, 0.085), steel, 0, 0.29, -0.04),
    part(new BoxGeometry(0.014, 0.085, 0.02), edge, 0, 0.29, -0.09),
    part(new BoxGeometry(0.026, 0.04, 0.035), steel, 0, 0.29, 0.016),
  );
  return axe;
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

/** a soft star facing back down the barrel, and two crossed tongues of
 *  flame reaching forward from it, so the flash shows round the gun's
 *  silhouette from behind; brightness is HDR so it reads hot against any
 *  exposure. In the gun's space: the barrel runs along +x. */
function muzzleFlash(intensity: NF): Mesh {
  const star = new PlaneGeometry(0.1, 0.1).rotateY(-Math.PI / 2);
  const tongue = (): PlaneGeometry => new PlaneGeometry(TONGUE_LENGTH, 0.05).translate(TONGUE_LENGTH / 2, 0, 0);
  const parts = [star, tongue(), tongue().rotateX(Math.PI / 2)];
  parts.forEach((g, i) => g.setAttribute('_tongue', new Float32BufferAttribute(new Float32Array(g.getAttribute('position').count).fill(i ? 1 : 0), 1)));
  const geo = mergeGeometries(parts)!;

  const c = uv().sub(0.5);
  const r = length(c).mul(2);
  const spikes = cos(atan(c.y, c.x).mul(5)).mul(0.35).add(0.65);
  const starShape = float(1).sub(r.div(spikes)).max(0).pow(2).add(float(1).sub(r).max(0).pow(4).mul(0.3));
  // uv.x runs from the muzzle to the tongue's tip
  const reach = float(1).sub(uv().x);
  const across = c.y.abs().mul(2).div(reach.pow(0.6).max(1e-3));
  const tongueShape = float(1).sub(across).max(0).pow(2).mul(reach.pow(1.5));
  const shape = mix(starShape, tongueShape, attribute('_tongue', 'float'));
  // adds light but leaves alpha alone, so it stays see-through in the
  // premultiplied overlay
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
  mat.colorNode = vec3(1, 0.62, 0.28).mul(shape).mul(intensity);
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = 1;
  return mesh;
}
