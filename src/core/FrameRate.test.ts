import { describe, expect, it } from 'vitest';
import { FrameRate } from './FrameRate';

describe('FrameRate', () => {
  it('reads the frames shown when pacing is uneven', () => {
    const rate = new FrameRate();
    // three quick frames then one long: 4 frames every 0.25 s
    for (let i = 0; i < 200; i++) rate.update(i % 4 === 3 ? 0.235 : 0.005);
    expect(rate.fps).toBeGreaterThan(14);
    expect(rate.fps).toBeLessThan(18);
  });

  it('follows a steady rate', () => {
    const rate = new FrameRate();
    for (let i = 0; i < 100; i++) rate.update(1 / 60);
    expect(rate.fps).toBeCloseTo(60, 5);
  });

  it('ignores a frame with no time', () => {
    const rate = new FrameRate();
    rate.update(1 / 30);
    expect(rate.update(0)).toBeCloseTo(30, 5);
  });
});
