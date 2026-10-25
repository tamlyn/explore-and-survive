import { describe, expect, it } from 'vitest';
import { Arsenal, type ArsenalInput } from './Arsenal';

function keys(press: string[] = [], wheel = 0): ArsenalInput {
  const pending = new Set(press);
  return {
    held: () => false,
    takePress: (code) => pending.delete(code),
    takeLook: () => ({ yaw: 0, pitch: 0 }),
    takeWheel: () => wheel,
  };
}

describe('Arsenal', () => {
  it('starts with the pistol in hand', () => {
    const a = new Arsenal();
    expect([a.current, a.ready, a.lowered]).toEqual(['pistol', true, 0]);
  });

  it('lowers the old tool and raises the new, unusable meanwhile', () => {
    const a = new Arsenal();
    expect(a.update(0, keys(['Digit2']))).toBe(true);
    expect(a.current).toBe('axe');
    expect(a.ready).toBe(false);
    a.update(0.15, keys());
    expect(a.shown).toBe('pistol');
    expect(a.lowered).toBeGreaterThan(0.5);
    a.update(0.1, keys());
    expect(a.shown).toBe('axe');
    a.update(0.2, keys());
    expect([a.ready, a.lowered]).toEqual([true, 0]);
  });

  it('steps through the tools with the wheel, and ignores picking what is in hand', () => {
    const a = new Arsenal();
    expect(a.update(0, keys(['Digit1']))).toBe(false);
    a.update(0, keys([], 1));
    expect(a.current).toBe('axe');
    a.update(1, keys([], 1));
    expect(a.current).toBe('pistol');
  });
});
