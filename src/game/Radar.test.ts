import { describe, expect, it } from 'vitest';
import { formatDistance, radarOffset, rimTargets } from './Radar';
import { paintMap } from './RadarMap';

describe('radarOffset', () => {
  it('puts what is ahead at the top and what is to the right on the right', () => {
    for (const yaw of [0, 0.7, -2]) {
      const ahead = radarOffset(-Math.sin(yaw) * 10, -Math.cos(yaw) * 10, yaw);
      expect(ahead.x).toBeCloseTo(0);
      expect(ahead.y).toBeCloseTo(-10);
      const right = radarOffset(Math.cos(yaw) * 10, -Math.sin(yaw) * 10, yaw);
      expect(right.x).toBeCloseTo(10);
      expect(right.y).toBeCloseTo(0);
    }
  });
});

describe('rimTargets', () => {
  it('picks the nearest beyond the range, nearest first', () => {
    const spots = [
      { x: 0, z: 100 },
      { x: 500, z: 0 },
      { x: 0, z: -400 },
      { x: -900, z: 0 },
    ];
    expect(rimTargets(spots, 0, 0, 300, 2)).toEqual([spots[2], spots[1]]);
    expect(rimTargets(spots, 0, 0, 0, 1)).toEqual([spots[0]]);
  });
});

describe('formatDistance', () => {
  it('rounds to 10 m, then to tenths of a km', () => {
    expect(formatDistance(214)).toBe('210 m');
    expect(formatDistance(994)).toBe('990 m');
    expect(formatDistance(996)).toBe('1.0 km');
    expect(formatDistance(2360)).toBe('2.4 km');
  });
});

describe('paintMap', () => {
  const res = 8;
  const ramp = (up: 1 | -1): Float32Array => new Float32Array(res * res).map((_, i) => 400 + ((i % res) - 3.5) * 20 * up);
  const at = (px: Uint8ClampedArray, i: number, k: number): number[] => [...px.slice((k * res + i) * 4, (k * res + i) * 4 + 4)];

  it('paints water blue', () => {
    const px = paintMap({ heights: ramp(1), res, worldSize: 800 }, (x) => (x < -300 ? 1000 : 0), res);
    const [r, g, b, a] = at(px, 0, 4);
    expect(b).toBeGreaterThan(r!);
    expect(b).toBeGreaterThan(g!);
    expect(a).toBe(255);
  });

  it('lights slopes facing the north-west', () => {
    const dry = (): number => 0;
    // rising to the east, a slope faces west: towards the light
    const west = at(paintMap({ heights: ramp(1), res, worldSize: 800 }, dry, res), 4, 4);
    const east = at(paintMap({ heights: ramp(-1), res, worldSize: 800 }, dry, res), 4, 4);
    expect(west[1]).toBeGreaterThan(east[1]! * 1.3);
  });
});
