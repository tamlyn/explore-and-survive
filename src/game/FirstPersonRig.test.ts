import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { FirstPersonRig, type RigSubject } from './FirstPersonRig';
import { SPRINT_MULT, WALK_SPEED } from './Player';

function subject(over: Partial<RigSubject> = {}): RigSubject {
  return {
    eye: { x: 1, y: 2, z: 3 },
    yaw: 0,
    pitch: 0,
    speed: 0,
    grounded: true,
    sprinting: false,
    landingSpeed: 0,
    ...over,
  };
}

describe('FirstPersonRig', () => {
  it('sits exactly at the eye when standing still', () => {
    const cam = new PerspectiveCamera(60);
    const rig = new FirstPersonRig(cam);
    for (let i = 0; i < 30; i++) rig.update(1 / 60, subject());
    expect(cam.position.toArray()).toEqual([1, 2, 3]);
  });

  it('dips on a hard landing and springs back', () => {
    const cam = new PerspectiveCamera(60);
    const rig = new FirstPersonRig(cam);
    rig.update(1 / 60, subject({ landingSpeed: 10 }));
    let lowest = cam.position.y;
    for (let i = 0; i < 20; i++) {
      rig.update(1 / 60, subject());
      lowest = Math.min(lowest, cam.position.y);
    }
    expect(lowest).toBeLessThan(2 - 0.03);
    for (let i = 0; i < 120; i++) rig.update(1 / 60, subject());
    expect(cam.position.y).toBeCloseTo(2, 3);
  });

  it('ignores gentle landings', () => {
    const cam = new PerspectiveCamera(60);
    const rig = new FirstPersonRig(cam);
    rig.update(1 / 60, subject({ landingSpeed: 2 }));
    expect(cam.position.y).toBe(2);
  });

  it('widens the FOV while sprinting on the ground', () => {
    const cam = new PerspectiveCamera(60);
    const rig = new FirstPersonRig(cam);
    const sprint = subject({ sprinting: true, speed: WALK_SPEED * SPRINT_MULT });
    for (let i = 0; i < 60; i++) rig.update(1 / 60, sprint);
    expect(cam.fov).toBeGreaterThan(64);
    for (let i = 0; i < 120; i++) rig.update(1 / 60, subject());
    expect(cam.fov).toBeCloseTo(60, 1);
  });

  it('looks along the player aim', () => {
    const cam = new PerspectiveCamera(60);
    const rig = new FirstPersonRig(cam);
    rig.update(1 / 60, subject({ yaw: Math.PI / 2, pitch: 0 }));
    const dir = cam.getWorldDirection(cam.position.clone());
    // yaw +90° turns the −z gaze toward −x
    expect(dir.x).toBeCloseTo(-1, 5);
  });
});
