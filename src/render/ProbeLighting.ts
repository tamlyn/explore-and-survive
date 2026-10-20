/**
 * Probe ambient for placed objects (ruins, props): the same irradiance field
 * the terrain and vegetation read, darkened under canopy. Without it a
 * standard material keeps the dimmed hemisphere light and glows like open
 * sky inside a forest.
 */

import { normalWorld, positionWorld } from 'three/tsl';
import { IrradianceNode, type MeshStandardNodeMaterial, type StorageTexture } from 'three/webgpu';
import type { ProbeGI } from '../gpu/passes/ProbeGI';
import { canopyAt } from '../gpu/passes/Scatter';
import type { NV3 } from '../gpu/TSLTypes';

export function lightWithProbes(mat: MeshStandardNodeMaterial, gi: ProbeGI, canopyTex: StorageTexture | null): void {
  const wp = positionWorld as unknown as NV3;
  let irr = gi.irradiance(wp, normalWorld as unknown as NV3);
  // the probe field already knows the canopy at 16 m; this is the 4 m residual
  if (canopyTex) irr = irr.mul(canopyAt(canopyTex, wp.xz).mul(0.12).oneMinus()) as typeof irr;
  (mat as unknown as { setupLightMap: () => unknown }).setupLightMap = () =>
    new IrradianceNode(irr as unknown as ConstructorParameters<typeof IrradianceNode>[0]);
}
