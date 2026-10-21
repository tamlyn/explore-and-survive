import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { aimCamera, aimDirection, bearing } from './CameraAim';

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

describe('bearing', () => {
  it('reads clockwise from straight ahead', () => {
    // facing −z
    expect(bearing(0, -5, 0, 0, 0)).toBeCloseTo(0);
    expect(bearing(5, 0, 0, 0, 0)).toBeCloseTo(Math.PI / 2);
    expect(bearing(-5, 0, 0, 0, 0)).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(bearing(0, 5, 0, 0, 0))).toBeCloseTo(Math.PI);
  });

  it('agrees with where the aim points', () => {
    for (const yaw of [0.3, 2, -2.5]) {
      const d = aimDirection(yaw, 0);
      expect(bearing(10 + d.x, 20 + d.z, 10, 20, yaw) % (2 * Math.PI)).toBeCloseTo(0);
    }
  });
});
