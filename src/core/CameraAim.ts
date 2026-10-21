import type { Camera } from 'three';

/** the one aim convention: yaw about world Y (0 looks −z), then pitch, then roll */
export function aimCamera(camera: Camera, yaw: number, pitch: number, roll = 0): void {
  camera.rotation.set(0, 0, 0);
  camera.rotateY(yaw);
  camera.rotateX(pitch);
  if (roll !== 0) camera.rotateZ(roll);
}

/** unit forward vector of the same convention */
export function aimDirection(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

/** where (x, z) lies seen from (fromX, fromZ) facing `yaw`: radians
 *  clockwise from straight ahead, as a screen-space pointer turns */
export function bearing(x: number, z: number, fromX: number, fromZ: number, yaw: number): number {
  // yaw grows anticlockwise (turning left)
  return yaw - Math.atan2(fromX - x, fromZ - z);
}
