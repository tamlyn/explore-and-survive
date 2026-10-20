import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { aimCamera, aimDirection } from './CameraAim';

describe('aimDirection', () => {
  it('is the forward vector of a camera aimed the same way', () => {
    const cam = new PerspectiveCamera();
    for (const [yaw, pitch] of [
      [0, 0],
      [0.7, -0.3],
      [-2.5, 1.2],
    ] as const) {
      aimCamera(cam, yaw, pitch);
      const want = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const got = aimDirection(yaw, pitch);
      expect(got.x).toBeCloseTo(want.x, 6);
      expect(got.y).toBeCloseTo(want.y, 6);
      expect(got.z).toBeCloseTo(want.z, 6);
    }
  });
});
