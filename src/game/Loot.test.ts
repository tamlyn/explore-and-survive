import { describe, expect, it } from 'vitest';
import { type Cache, Loot, type LootKind, MAX_DROPS } from './Loot';

const crate = (x: number, kind: LootKind = 'ammo'): Cache => ({
  kind,
  amount: 24,
  box: { x, y: 0.4, z: 0, hx: 0.4, hy: 0.4, hz: 0.4, q: [0, 0, 0, 1], surface: 'wood' },
});

function setup(caches: Cache[], random = (): number => 0.5) {
  const taken: number[] = [];
  const shown = new Map<number, LootKind>();
  let next = 0;
  const loot = new Loot(
    caches,
    { take: (i) => taken.push(i) },
    {
      add: (kind) => {
        shown.set(next, kind);
        return next++;
      },
      remove: (id) => shown.delete(id),
    },
    random,
  );
  return { loot, taken, shown };
}

const all = (): boolean => true;

describe('Loot', () => {
  it('empties a crate the player walks up to, once', () => {
    const { loot, taken } = setup([crate(0), crate(10)]);
    expect(loot.reach({ x: 1.2, y: 0, z: 0 }, all)).toEqual([{ kind: 'ammo', amount: 24 }]);
    expect(taken).toEqual([0]);
    expect(loot.reach({ x: 1.2, y: 0, z: 0 }, all)).toEqual([]);
    expect(loot.reach({ x: 3, y: 0, z: 0 }, all)).toEqual([]);
  });

  it('leaves what the player cannot use', () => {
    const { loot, taken } = setup([crate(0, 'medkit')]);
    expect(loot.reach({ x: 0.5, y: 0, z: 0 }, (k) => k === 'ammo')).toEqual([]);
    expect(taken).toEqual([]);
    expect(loot.reach({ x: 0.5, y: 0, z: 0 }, all)).toHaveLength(1);
  });

  it('drops rounds where a robot falls, and sometimes a medkit', () => {
    const lucky = setup([], () => 0.1);
    lucky.loot.drop(5, 0, 5);
    expect([...lucky.shown.values()]).toEqual(['ammo', 'medkit']);
    const plain = setup([], () => 0.9);
    plain.loot.drop(5, 0, 5);
    expect([...plain.shown.values()]).toEqual(['ammo']);
    const got = plain.loot.reach({ x: 5.5, y: 0, z: 5 }, all);
    expect(got).toHaveLength(1);
    expect(got[0]!.amount).toBeGreaterThanOrEqual(6);
    expect(plain.shown.size).toBe(0);
  });

  it('clears the oldest drop to make room', () => {
    const { loot, shown } = setup([], () => 0.9);
    for (let i = 0; i <= MAX_DROPS; i++) loot.drop(i * 10, 0, 0);
    expect(shown.size).toBe(MAX_DROPS);
    expect(shown.has(0)).toBe(false);
    expect(loot.reach({ x: 0, y: 0, z: 0 }, all)).toEqual([]);
  });
});
