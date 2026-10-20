/**
 * Bilinear lookup into a square world-spanning grid (row-major by z). Sample
 * (i, j) sits at x = ((i + 0.5) / res − 0.5) · worldSize, likewise z; points
 * outside the sample centres clamp to the edge.
 */
export function sampleGrid(
  data: Float32Array,
  res: number,
  worldSize: number,
  x: number,
  z: number,
  fallback = 0,
): number {
  const gx = Math.min(Math.max((x / worldSize + 0.5) * res - 0.5, 0), res - 1.001);
  const gz = Math.min(Math.max((z / worldSize + 0.5) * res - 0.5, 0), res - 1.001);
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const fx = gx - x0;
  const fz = gz - z0;
  const at = (xx: number, zz: number): number =>
    data[Math.min(zz, res - 1) * res + Math.min(xx, res - 1)] ?? fallback;
  const a = at(x0, z0) * (1 - fx) + at(x0 + 1, z0) * fx;
  const b = at(x0, z0 + 1) * (1 - fx) + at(x0 + 1, z0 + 1) * fx;
  return a * (1 - fz) + b * fz;
}
