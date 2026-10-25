import { describe, expect, it } from 'vitest';
import { Swing } from './Melee';

const SPEC = { swingTime: 0.6, strikeAt: 0.2, reach: 2, damage: 10 };

describe('Swing', () => {
  it('strikes once partway through each swing', () => {
    const s = new Swing(SPEC);
    expect(s.update(0.016, true)).toBe('swing');
    const events: string[] = [];
    for (let t = 0; t < 0.7; t += 0.05) {
      const e = s.update(0.05, false);
      if (e) events.push(e);
    }
    expect(events).toEqual(['strike']);
    expect(s.progress).toBe(0);
  });

  it('swings again for a click made just before the swing ends', () => {
    const s = new Swing(SPEC);
    s.update(0.016, true);
    s.update(0.5, false);
    expect(s.update(0.05, true)).toBeNull();
    expect(s.update(0.1, false)).toBe('swing');
  });

  it('strikes even when a slow frame skips past the moment', () => {
    const s = new Swing(SPEC);
    s.update(0.016, true);
    expect(s.update(0.3, false)).toBe('strike');
  });
});
