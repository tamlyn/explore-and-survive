/**
 * Ruins rendering — each site's blocks merged into one mesh with a
 * photoscanned masonry material, lit by the same probe ambient as the
 * terrain.
 */

import {
  DataTexture,
  Group,
  Mesh,
  NearestFilter,
  RedFormat,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  UnsignedByteType,
} from 'three';
import { IrradianceNode, MeshStandardNodeMaterial, type StorageTexture } from 'three/webgpu';
import { attribute, mix, normalMap, normalWorld, positionWorld, smoothstep, texture, uv, vec3 } from 'three/tsl';
import armUrl from '../../assets/textures/stone_wall_arm.jpg?url';
import diffUrl from '../../assets/textures/stone_wall_diff.jpg?url';
import norUrl from '../../assets/textures/stone_wall_nor_gl.jpg?url';
import { fbm3, valueNoise3 } from '../gpu/noise/NoiseTSL';
import { canopyAt } from '../gpu/passes/Scatter';
import type { ProbeGI } from '../gpu/passes/ProbeGI';
import type { NF, NV3, NV4 } from '../gpu/TSLTypes';
import { blockGeometry } from './RuinGeometry';
import { type Block, clearingMask, type Ground, type RuinSite } from './RuinPlan';
import { WORLD_SIZE } from './WorldConst';

/** 2 m texels: fine enough for a house footprint */
const CLEARING_RES = 2048;

/** the scatter's keep-clear mask (see clearingMask) as a GPU texture */
export function clearingTexture(sites: RuinSite[]): DataTexture {
  const tex = new DataTexture(clearingMask(sites, CLEARING_RES, WORLD_SIZE), CLEARING_RES, CLEARING_RES, RedFormat, UnsignedByteType);
  tex.magFilter = tex.minFilter = NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

async function loadTexture(url: string, srgb: boolean): Promise<Texture> {
  const tex = await new TextureLoader().loadAsync(url);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = SRGBColorSpace;
  return tex;
}

async function masonryMaterial(gi: ProbeGI | null, canopyTex: StorageTexture | null): Promise<MeshStandardNodeMaterial> {
  const [diff, nor, arm] = await Promise.all([
    loadTexture(diffUrl, true),
    loadTexture(norUrl, false),
    loadTexture(armUrl, false),
  ]);
  const mat = new MeshStandardNodeMaterial();
  const wp = positionWorld as unknown as NV3;
  const st = uv();
  const a = texture(arm, st) as unknown as NV4;
  // large-scale tone drift hides the repeat of a single scan
  const drift = (fbm3(wp.mul(0.12), 3) as NF).mul(0.3).add(0.85);
  let albedo = (texture(diff, st) as unknown as NV4).rgb.mul(drift) as NV3;
  // splash grime and damp at the foot of the wall
  const above = wp.y.sub(attribute('ground', 'float') as unknown as NF);
  albedo = mix(albedo, albedo.mul(vec3(0.5, 0.47, 0.4)), smoothstep(1.3, 0, above).mul(0.75)) as unknown as NV3;
  // moss on the broken tops and anything facing the sky
  const mossN = smoothstep(0.35, 0.7, valueNoise3(wp.mul(1.3)));
  const moss = smoothstep(0.6, 0.95, normalWorld.y).mul(mossN.mul(0.7).add(0.3));
  albedo = mix(albedo, vec3(0.05, 0.08, 0.03), moss.mul(0.8)) as unknown as NV3;
  mat.colorNode = albedo;
  mat.normalNode = normalMap(texture(nor, st) as never);
  mat.roughnessNode = a.g;
  mat.aoNode = a.r;
  mat.metalness = 0;
  if (gi) {
    // the same probe ambient as the terrain, or interiors glow like open sky
    let irr = gi.irradiance(wp, normalWorld as unknown as NV3);
    if (canopyTex) irr = irr.mul(canopyAt(canopyTex, wp.xz).mul(0.12).oneMinus()) as typeof irr;
    (mat as unknown as { setupLightMap: () => unknown }).setupLightMap = () =>
      new IrradianceNode(irr as unknown as ConstructorParameters<typeof IrradianceNode>[0]);
  }
  return mat;
}

/** one mesh per site, all sharing the masonry material */
export async function buildRuins(
  sites: Block[][],
  ground: Ground,
  gi: ProbeGI | null,
  canopyTex: StorageTexture | null,
): Promise<Group> {
  const group = new Group();
  group.name = 'ruins';
  const mat = await masonryMaterial(gi, canopyTex);
  for (const blocks of sites) {
    const mesh = new Mesh(blockGeometry(blocks, ground), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
