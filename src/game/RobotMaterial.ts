/**
 * Robot material — the Quaternius robots' flat toy colours (baked into
 * vertex colours by RobotModels) worn down to fit a ruined world: paint
 * faded and grimed, rust blooming and running down the panels, chips of
 * bare steel, mud caked up the legs. Everything is keyed to the vertex's
 * rest position in model units (the `_rest` attribute), so the wear rides
 * the body as it animates rather than swimming through it.
 */

import { attribute, dot, float, max, min, mix, smoothstep, vec3, vertexColor } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { fbm3, valueNoise3 } from '../gpu/noise/NoiseTSL';
import type { NF, NV3 } from '../gpu/TSLTypes';

/** HDR glow of eyes and lights, enough to bloom */
const GLOW = 6;
/** model units: the robots stand 0.7–1.2 tall */
const MUD_LINE = 0.3;

const PAINT_FADE = vec3(0.86, 0.82, 0.74);
const GRIME = vec3(0.13, 0.11, 0.085);
const RUST = vec3(0.3, 0.12, 0.045);
const MUD = vec3(0.16, 0.12, 0.08);
const STEEL = vec3(0.45, 0.44, 0.42);

export function robotMaterial(): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial();
  const p = attribute('_rest', 'vec3') as unknown as NV3;
  const glow = attribute('_glow', 'float') as unknown as NF;
  const paint = vertexColor().rgb as unknown as NV3;
  const lum = dot(paint, vec3(0.299, 0.587, 0.114)) as NF;
  // the light panels show wear; dark joints and gun metal hide it
  const painted = smoothstep(0.2, 0.45, lum);

  // sun-bleached, a little desaturated and yellowed
  let albedo = mix(vec3(lum), paint, 0.6).mul(PAINT_FADE) as NV3;

  // dirt gathers low down, and in blotches everywhere
  const blotch = smoothstep(0.35, 0.7, fbm3(p.mul(5), 3));
  const grime = min(blotch.mul(0.6).add(smoothstep(0.6, 0.1, p.y).mul(0.3)), 0.8);
  albedo = mix(albedo, GRIME, grime) as NV3;

  // rust pools where water sits and streaks down from it
  const patch = smoothstep(0.58, 0.78, fbm3(p.mul(7).add(11), 3));
  const streak = smoothstep(0.45, 0.85, valueNoise3(p.mul(vec3(38, 2.5, 38))));
  const rust = max(patch, streak.mul(0.6).mul(painted)).mul(0.85) as NF;
  albedo = mix(albedo, RUST, rust) as NV3;

  const chip = smoothstep(0.66, 0.7, fbm3(p.mul(30).add(5), 3)).mul(painted).mul(rust.oneMinus());
  albedo = mix(albedo, STEEL, chip) as NV3;

  const mud = smoothstep(MUD_LINE, 0.05, p.y.add(fbm3(p.mul(9), 2).sub(0.5).mul(0.25))).mul(0.9);
  albedo = mix(albedo, MUD, mud) as NV3;

  // eyes and status lights stay clean so they still read
  mat.colorNode = mix(albedo, paint, glow);
  const rough = mix(float(0.5), float(0.8), grime.add(rust).add(mud)) as NF;
  mat.roughnessNode = mix(min(rough, 0.95), float(0.35), chip);
  mat.metalnessNode = mix(mix(float(0.55), float(0.15), painted).mul(rust.add(mud).oneMinus()), float(0.9), chip);
  mat.emissiveNode = paint.mul(glow).mul(GLOW);
  return mat;
}
