import { describe, expect, it } from 'vitest';
import { Health } from './Health';

describe('Health', () => {
  it('dies once, on the killing blow', () => {
    const h = new Health(50);
    expect(h.hurt(30)).toBe(false);
    expect(h.hurt(30)).toBe(true);
    expect(h.hp).toBe(0);
    expect(h.hurt(10)).toBe(false);
    expect(h.dead).toBe(true);
  });

  it('heals only after a quiet spell, up to full', () => {
    const h = new Health(100, { delay: 2, rate: 10 });
    h.hurt(40);
    h.update(1.9);
    expect(h.hp).toBe(60);
    for (let i = 0; i < 100; i++) h.update(0.1);
    expect(h.hp).toBe(100);
  });

  it('a fresh hit restarts the wait', () => {
    const h = new Health(100, { delay: 2, rate: 10 });
    h.hurt(40);
    h.update(1.5);
    h.hurt(10);
    h.update(1.5);
    expect(h.hp).toBe(50);
  });

  it('the dead stay dead', () => {
    const h = new Health(10, { delay: 0, rate: 10 });
    h.hurt(10);
    h.update(5);
    expect(h.dead).toBe(true);
  });
});
