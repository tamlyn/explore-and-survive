/**
 * Composed bookmarks + flythrough (Phase 7, spec §8: "9 bookmarks,
 * 90 s flythrough"). Showcase viewpoints are COMPOSED, not found
 * (Pillar E) — each pairs a verified framing with its best time of day.
 *
 * Keys 1–9 jump to a bookmark (pose + ToD); ?shot=N boots into one.
 * ?fly=1 (or key F) runs a looping ~90 s Catmull-Rom flythrough through
 * a subset of the bookmarks at a fixed golden-hour ToD. The curve between
 * waypoints knows nothing of the hills, so it is lifted where it would cut
 * through them, easing up beforehand and down after.
 */

import type { PerspectiveCamera } from 'three';
import { CatmullRomCurve3, Vector3 } from 'three';
import type { Engine } from '../core/Engine';
import type { LaasHooks } from '../core/Hooks';
import type { LaasParams } from '../core/Params';
import type { Heightfield } from '../world/Heightfield';

export interface Bookmark {
  name: string;
  x: number;
  z: number;
  /** meters above ground (water-guarded at apply time) */
  alt: number;
  yaw: number;
  pitch: number;
  tod: number;
}

/** nine composed viewpoints — verified framings from the phase shots */
export const BOOKMARKS: Bookmark[] = [
  { name: 'Gorge stream (scene1)', x: 620, z: 650, alt: 1.3, yaw: 0.5, pitch: -0.12, tod: 12.5 },
  { name: 'Dawn lake mist', x: 11, z: 1338, alt: 9, yaw: 1.2, pitch: -0.06, tod: 7.5 },
  { name: 'Golden vista (Witcher)', x: 1500, z: 1900, alt: 250, yaw: 0.65, pitch: -0.18, tod: 19 },
  { name: 'Morning meadow shafts', x: -870, z: 862, alt: 1.8, yaw: -1.45, pitch: 0.02, tod: 8.2 },
  { name: 'Alpine tarn', x: 805, z: -1464, alt: 2.2, yaw: 1.57, pitch: -0.4, tod: 15.5 },
  { name: 'Karst ravine mouth', x: 650, z: 700, alt: 5, yaw: 0.6, pitch: -0.06, tod: 15 },
  { name: 'Forest interior dapple', x: -850, z: 850, alt: 4, yaw: -0.785, pitch: -0.05, tod: 12.5 },
  { name: 'Lakeshore golden', x: -1400, z: 1250, alt: 2.5, yaw: 3.14, pitch: -0.12, tod: 18.5 },
  { name: 'Valley network aerial', x: -600, z: 700, alt: 260, yaw: -0.6, pitch: -0.5, tod: 17.5 },
];

/** how far the flythrough keeps above the ground (m) */
const CLEARANCE = 4;
/** how far ahead it starts climbing over a rise, and after it comes down (m) */
const LIFT_EASE = 400;
/** the curve's lift is sampled this often (m) */
const LIFT_STEP = 2;

/**
 * How much to raise each of a path's evenly spaced points so all of them
 * clear `floor`, eased in and out over `ease` points either side.
 */
export function pathLift(points: { x: number; y: number; z: number }[], floor: (x: number, z: number) => number, ease: number): Float32Array {
  const need = points.map((p) => Math.max(0, floor(p.x, p.z) - p.y));
  const lift = new Float32Array(points.length);
  need.forEach((n, j) => {
    if (n === 0) return;
    for (let i = Math.max(0, j - ease); i <= Math.min(points.length - 1, j + ease); i++) {
      const t = 1 - Math.abs(i - j) / (ease + 1);
      lift[i] = Math.max(lift[i] as number, n * t * t * (3 - 2 * t));
    }
  });
  return lift;
}

function poseY(hf: Heightfield, b: Bookmark): number {
  const ground = hf.heightAtCpu(b.x, b.z) + b.alt;
  const water = hf.waterYAtCpu(b.x, b.z) + 0.6;
  return Math.max(ground, water);
}

export function installBookmarks(
  engine: Engine,
  hf: Heightfield,
  hooks: LaasHooks,
  params: LaasParams,
): void {
  const apply = (i: number): void => {
    const b = BOOKMARKS[i];
    if (!b) return;
    hooks.setPose?.({ p: [b.x, poseY(hf, b), b.z], yaw: b.yaw, pitch: b.pitch });
    hooks.setTimeOfDay?.(b.tod);
  };

  window.addEventListener('keydown', (e) => {
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m && !hooks.playing?.()) apply(Number(m[1]) - 1);
    if (e.code === 'KeyF') fly.toggle();
  });

  // ---- flythrough -------------------------------------------------------------
  const FLY_SECONDS = 92;
  // a tour that reads as one continuous shot: vista → descend the valley →
  // lake → meadow forest edge → gorge mouth → aerial pull-out
  const TOUR: { x: number; z: number; alt: number; yaw: number; pitch: number }[] = [
    { x: 1500, z: 1900, alt: 250, yaw: 0.65, pitch: -0.18 },
    { x: 900, z: 1500, alt: 120, yaw: 1.0, pitch: -0.12 },
    { x: 300, z: 1400, alt: 40, yaw: 1.35, pitch: -0.08 },
    { x: 11, z: 1338, alt: 12, yaw: 1.2, pitch: -0.05 },
    { x: -500, z: 1100, alt: 25, yaw: 2.0, pitch: -0.06 },
    { x: -870, z: 880, alt: 8, yaw: 2.6, pitch: -0.03 },
    { x: -600, z: 720, alt: 60, yaw: 3.5, pitch: -0.15 },
    { x: 100, z: 680, alt: 35, yaw: 4.3, pitch: -0.08 },
    { x: 620, z: 660, alt: 6, yaw: 4.9, pitch: -0.05 },
    { x: 900, z: 900, alt: 180, yaw: 5.6, pitch: -0.3 },
    { x: 1500, z: 1900, alt: 250, yaw: 0.65 + Math.PI * 2, pitch: -0.18 },
  ];

  class Flythrough {
    private active = false;
    private t = 0;
    private curve: CatmullRomCurve3 | null = null;
    private lift: Float32Array = new Float32Array(1);

    toggle(): void {
      this.active = !this.active;
      hooks.flyCamEnabled?.(!this.active);
      if (this.active && !this.curve) {
        this.curve = new CatmullRomCurve3(
          TOUR.map((w) => new Vector3(w.x, poseY(hf, { ...w, tod: 0, name: '' } as Bookmark), w.z)),
          false,
          'centripetal',
          0.5,
        );
        const n = Math.ceil(this.curve.getLength() / LIFT_STEP);
        const floor = (x: number, z: number): number =>
          Math.max(hf.heightAtCpu(x, z) + CLEARANCE, hf.waterYAtCpu(x, z) + 0.6);
        this.lift = pathLift(this.curve.getSpacedPoints(n), floor, Math.round(LIFT_EASE / LIFT_STEP));
      }
      if (!this.active) this.t = 0;
    }

    update(dt: number, cam: PerspectiveCamera): void {
      if (!this.active || !this.curve) return;
      this.t = (this.t + dt / FLY_SECONDS) % 1;
      const u = this.t;
      const p = this.curve.getPointAt(u);
      const k = u * (this.lift.length - 1);
      const k0 = Math.floor(k);
      const l0 = this.lift[k0] as number;
      p.y += l0 + ((this.lift[Math.min(k0 + 1, this.lift.length - 1)] as number) - l0) * (k - k0);
      cam.position.copy(p);
      // yaw/pitch: linear over the waypoint list (yaws authored unwrapped)
      const seg = u * (TOUR.length - 1);
      const i0 = Math.min(Math.floor(seg), TOUR.length - 2);
      const f = seg - i0;
      const w0 = TOUR[i0];
      const w1 = TOUR[i0 + 1];
      if (!w0 || !w1) return;
      const yaw = w0.yaw + (w1.yaw - w0.yaw) * f;
      const pitch = w0.pitch + (w1.pitch - w0.pitch) * f;
      hooks.setPose?.({ p: [p.x, p.y, p.z], yaw, pitch });
    }
  }
  const fly = new Flythrough();
  engine.onUpdate((dt) => fly.update(dt, engine.camera));
  if (new URLSearchParams(window.location.search).get('fly') === '1') {
    fly.toggle();
  }

  // boot directly into a bookmark (?shot=N) — pose via initialPose (the
  // fly rig applies it after this scene finishes building)
  if (params.shot !== null && params.cam === null) {
    const b = BOOKMARKS[params.shot - 1];
    if (b) {
      hooks.initialPose = { p: [b.x, poseY(hf, b), b.z], yaw: b.yaw, pitch: b.pitch };
      // bookmarks are composed camera framings, not walk spawns
      hooks.initialPoseMode = 'fly';
    }
  }
}
