import type { Camera } from 'three';

/** the one aim convention: yaw about world Y (0 looks −z), then pitch, then roll */
export function aimCamera(camera: Camera, yaw: number, pitch: number, roll = 0): void {
  camera.rotation.set(0, 0, 0);
  camera.rotateY(yaw);
  camera.rotateX(pitch);
  if (roll !== 0) camera.rotateZ(roll);
}
