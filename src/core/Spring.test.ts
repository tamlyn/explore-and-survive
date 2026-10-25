import { describe, expect, it } from 'vitest';
import { stepSpring } from './Spring';

/** the recoil spring's numbers, kicked, then run for `t` seconds at `fps` */
function settle(fps: number, t: number): { x: number; peak: number } {
  const s = { x: 0, v: 9 };
  let peak = 0;
  for (let i = 0; i < t * fps; i++) {
    stepSpring(s, 260, 26, 1 / fps);
    peak = Math.max(peak, Math.abs(s.x));
  }
  return { x: s.x, peak };
}

describe('stepSpring', () => {
  it('settles at a slow frame rate', () => {
    for (const fps of [10, 15, 20]) {
      const { x, peak } = settle(fps, 2);
      expect(Math.abs(x)).toBeLessThan(1e-3);
      expect(peak).toBeLessThan(0.5);
    }
  });

  it('moves the same whatever the frame rate', () => {
    expect(settle(15, 0.2).x).toBeCloseTo(settle(150, 0.2).x, 2);
  });
});
