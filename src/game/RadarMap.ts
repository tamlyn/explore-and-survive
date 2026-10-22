/**
 * Radar map — the whole world painted once as a small shaded-relief map for
 * the radar to scroll: water blue, land tinted by height from lowland green
 * through bare rock to snow, lit from the north-west as maps are.
 */

import { sampleGrid } from '../world/GridSample';
import { SNOWLINE_BASE, TREELINE } from '../world/WorldConst';
import type { TerrainGrid } from './Physics';

/** map pixels a side: 4 m each over the 4 km world */
export const MAP_RES = 1024;

type Rgb = [number, number, number];

const WATER: Rgb = [38, 66, 92];
const LOW: Rgb = [86, 98, 62];
const HIGH: Rgb = [112, 104, 82];
const ROCK: Rgb = [124, 119, 110];
const SNOW: Rgb = [222, 226, 232];
/** where the lowland tint starts (m) */
const LOWLAND = 150;
/** snow comes in over this much height above the snowline (m) */
const SNOW_FADE = 60;
/** relief is exaggerated so gentle hills still read at this scale */
const RELIEF = 2.5;
const LIGHT = ((v: Rgb): Rgb => {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})([-1, 1.4, -1]);

function mixInto(out: Rgb, a: Rgb, b: Rgb, t: number): void {
  const u = Math.min(1, Math.max(0, t));
  for (let i = 0; i < 3; i++) out[i] = a[i]! + (b[i]! - a[i]!) * u;
}

function landColor(out: Rgb, h: number): void {
  if (h < TREELINE) mixInto(out, LOW, HIGH, (h - LOWLAND) / (TREELINE - LOWLAND));
  else if (h < SNOWLINE_BASE) mixInto(out, HIGH, ROCK, (h - TREELINE) / (SNOWLINE_BASE - TREELINE));
  else mixInto(out, ROCK, SNOW, (h - SNOWLINE_BASE) / SNOW_FADE);
}

/** RGBA, row-major with north (−z) at the top */
export function paintMap(terrain: TerrainGrid, waterAt: (x: number, z: number) => number, res = MAP_RES): Uint8ClampedArray<ArrayBuffer> {
  const { heights, worldSize } = terrain;
  const step = worldSize / res;
  const at = (i: number): number => ((i + 0.5) / res - 0.5) * worldSize;
  const hs = new Float32Array(res * res);
  for (let k = 0; k < res; k++) {
    for (let i = 0; i < res; i++) hs[k * res + i] = sampleGrid(heights, terrain.res, worldSize, at(i), at(k));
  }
  const h = (i: number, k: number): number =>
    hs[Math.min(res - 1, Math.max(0, k)) * res + Math.min(res - 1, Math.max(0, i))]!;
  const px = new Uint8ClampedArray(res * res * 4);
  const rgb: Rgb = [0, 0, 0];
  for (let k = 0; k < res; k++) {
    for (let i = 0; i < res; i++) {
      const y = h(i, k);
      let shade = 1;
      if (waterAt(at(i), at(k)) > y + 0.05) {
        rgb[0] = WATER[0];
        rgb[1] = WATER[1];
        rgb[2] = WATER[2];
      } else {
        const dx = ((h(i + 1, k) - h(i - 1, k)) / (2 * step)) * RELIEF;
        const dz = ((h(i, k + 1) - h(i, k - 1)) / (2 * step)) * RELIEF;
        const lit = (-dx * LIGHT[0] + LIGHT[1] - dz * LIGHT[2]) / Math.hypot(dx, 1, dz);
        shade = 0.45 + 0.65 * Math.max(0, lit);
        landColor(rgb, y);
      }
      const o = (k * res + i) * 4;
      px[o] = rgb[0] * shade;
      px[o + 1] = rgb[1] * shade;
      px[o + 2] = rgb[2] * shade;
      px[o + 3] = 255;
    }
  }
  return px;
}
