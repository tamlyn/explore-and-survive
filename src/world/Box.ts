/** an oriented box: centre, half extents and rotation quaternion (x, y, z, w) */
export interface Box {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  q: [number, number, number, number];
}
