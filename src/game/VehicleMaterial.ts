/**
 * Vehicle material — the cars' flat colours (baked into vertex colours by
 * tools/blender/vehicles.py) left out in a ruined world for years, like the
 * robots (see RobotMaterial): paint faded, dust settled on everything that
 * faces up, rust blooming and running, chips of bare steel, mud thrown up
 * the sides by the wheels. Keyed to the model's own frame, in metres above
 * the ground, so it rides along with the car.
 *
 * `wear` (0 new … 1 wrecked) chars it as it's shot up: soot spreads and the
 * rust deepens, until a wreck is black and orange.
 */

import { dot, float, max, min, mix, normalLocal, positionLocal, smoothstep, uniform, vec3, vertexColor } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { fbm3, valueNoise3 } from '../gpu/noise/NoiseTSL';
import type { NF, NV3 } from '../gpu/TSLTypes';

/** metres: mud reaches about this high */
const MUD_LINE = 0.65;

const PAINT_FADE = vec3(0.88, 0.84, 0.76);
const DUST = vec3(0.26, 0.22, 0.16);
const GRIME = vec3(0.11, 0.095, 0.075);
const RUST = vec3(0.3, 0.12, 0.045);
const MUD = vec3(0.15, 0.11, 0.075);
const STEEL = vec3(0.45, 0.44, 0.42);
const SOOT = vec3(0.025, 0.022, 0.02);

const newWear = () => uniform(0);
type Wear = ReturnType<typeof newWear>;

export interface VehicleMaterial {
  material: MeshStandardNodeMaterial;
  /** 0 as bought … 1 wrecked */
  wear: Wear;
}

/** `lift` raises the model's origin to its height above the ground, for
 *  parts modelled about their own pivot (a wheel about its hub) */
export function vehicleMaterial(lift = 0, wear: Wear = newWear()): VehicleMaterial {
  const mat = new MeshStandardNodeMaterial();
  const p = positionLocal.add(vec3(0, lift, 0)) as unknown as NV3;
  const up = normalLocal.y as unknown as NF;
  const paint = vertexColor().rgb as unknown as NV3;
  const lum = dot(paint, vec3(0.299, 0.587, 0.114)) as NF;
  // tyres, trim and the dark interior hide the wear the paintwork shows
  const painted = smoothstep(0.06, 0.2, lum);

  let albedo = mix(vec3(lum), paint, 0.75).mul(PAINT_FADE) as NV3;

  // dust lies on whatever faces the sky
  const dust = smoothstep(0.6, 0.95, up).mul(smoothstep(0.35, 0.7, fbm3(p.mul(2.2), 3))).mul(0.45);
  albedo = mix(albedo, DUST, dust) as NV3;

  const blotch = smoothstep(0.4, 0.75, fbm3(p.mul(2.5), 3));
  const grime = min(blotch.mul(0.45).add(smoothstep(1.2, 0.2, p.y).mul(0.25)), 0.7);
  albedo = mix(albedo, GRIME, grime) as NV3;

  const w = wear as unknown as NF;
  const patch = smoothstep(w.mul(-0.2).add(0.62), w.mul(-0.2).add(0.8), fbm3(p.mul(3).add(11), 3));
  const streak = smoothstep(0.5, 0.85, valueNoise3(p.mul(vec3(16, 1.2, 16))));
  const rust = max(patch, streak.mul(0.5)).mul(painted).mul(0.85) as NF;
  albedo = mix(albedo, RUST, rust) as NV3;

  const chip = smoothstep(0.67, 0.71, fbm3(p.mul(12).add(5), 3)).mul(painted).mul(rust.oneMinus());
  albedo = mix(albedo, STEEL, chip) as NV3;

  const mud = smoothstep(MUD_LINE, 0.1, p.y.add(fbm3(p.mul(5), 2).sub(0.5).mul(0.45))).mul(0.85);
  albedo = mix(albedo, MUD, mud) as NV3;

  // fire spreads in from scorched blotches as it's shot up
  const char = smoothstep(0.15, 0.4, w.sub(fbm3(p.mul(1.8).add(23), 3).mul(0.6)).add(0.2)).mul(0.95) as NF;
  albedo = mix(albedo, SOOT, char) as NV3;

  mat.colorNode = albedo;
  const rough = mix(float(0.55), float(0.85), grime.add(dust).add(rust).add(mud)) as NF;
  mat.roughnessNode = mix(min(rough, 0.95), float(0.4), chip);
  mat.metalnessNode = mix(mix(float(0.5), float(0.1), dust.add(mud)).mul(painted).mul(rust.add(char).oneMinus()), float(0.85), chip);
  return { material: mat, wear };
}
