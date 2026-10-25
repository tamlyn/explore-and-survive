/**
 * Highlight — the pulsing gold glow that marks what the player can pick up,
 * brightest at the rim, shown only near enough to walk to so a settlement
 * doesn't sparkle from across the valley. An emissive term to add to a
 * material's own.
 */

import { cameraPosition, float, normalWorld, positionWorld, sin, smoothstep, time, vec3 } from 'three/tsl';
import type { NF, NV3 } from '../gpu/TSLTypes';

/** HDR, enough to bloom at the rim */
const GLOW = 1;
/** a box's flat faces show little rim, so the whole surface glows a bit */
const FILL = 0.12;
/** fades out between these distances from the eye (m) */
const NEAR = 25;
const FAR = 45;

/** 0.3 … 1, three pulses every 2π s; shared by everything that glows to
 *  be picked up, so they beat together */
export function pickupPulse(): NF {
  return sin(time.mul(3)).mul(0.35).add(0.65) as unknown as NF;
}

export function highlight(): NV3 {
  const toEye = cameraPosition.sub(positionWorld);
  const facing = normalWorld.dot(toEye.normalize()).clamp(0, 1);
  const rim = float(1).sub(facing).pow(3).add(FILL);
  const pulse = pickupPulse();
  const near = smoothstep(FAR, NEAR, toEye.length());
  return vec3(1, 0.78, 0.38).mul(rim.mul(pulse).mul(near).mul(GLOW) as unknown as NF) as unknown as NV3;
}
