import { describe, expect, it } from 'vitest';
import { formatCamString, parseCamString, parseParams } from './Params';

describe('parseParams', () => {
  it('defaults to the playable world with profiling off', () => {
    const p = parseParams('');
    expect(p.scene).toBe('world');
    expect(p.preset).toBe('high');
    expect(p.prof).toBe(false);
    expect(p.hud).toBe(false);
  });

  it('enables GPU profiling only for prof=1', () => {
    expect(parseParams('?prof=1').prof).toBe(true);
    expect(parseParams('?prof=0').prof).toBe(false);
    expect(parseParams('?prof=true').prof).toBe(false);
  });

  it('clamps time of day and ignores out-of-range bookmarks', () => {
    expect(parseParams('?T=30').timeOfDay).toBe(24);
    expect(parseParams('?shot=12').shot).toBeNull();
    expect(parseParams('?shot=7').shot).toBe(7);
  });
});

describe('parseCamString', () => {
  it('parses a pose with optional fov', () => {
    expect(parseCamString('1,2,3,0.5,-0.1')).toEqual({ p: [1, 2, 3], yaw: 0.5, pitch: -0.1 });
    expect(parseCamString('1,2,3,0.5,-0.1,60')?.fov).toBe(60);
  });

  it('round-trips through formatCamString', () => {
    const pose = { p: [1.5, -2.25, 300] as [number, number, number], yaw: 0.7854, pitch: -0.1, fov: 55 };
    expect(parseCamString(formatCamString(pose))).toEqual(pose);
  });

  it('rejects malformed input', () => {
    expect(parseCamString('1,2,3')).toBeNull();
    expect(parseCamString('1,2,x,0,0')).toBeNull();
  });
});
