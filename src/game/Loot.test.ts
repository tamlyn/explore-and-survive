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

/** what `use` was handed and took, as plain hauls */
function reach(loot: Loot, at: { x: number; y: number; z: number }, take = (_: LootKind): boolean => true) {
  const got: { kind: LootKind; amount: number }[] = [];
  loot.reach(at, (h) => {
    if (!take(h.kind)) return false;
    got.push({ kind: h.kind, amount: h.amount });
    return true;
  });
  return got;
}

describe('Loot', () => {
  it('empties a crate the player walks up to, once', () => {
    const { loot, taken } = setup([crate(0), crate(10)]);
    expect(reach(loot, { x: 1.2, y: 0, z: 0 })).toEqual([{ kind: 'ammo', amount: 24 }]);
    expect(taken).toEqual([0]);
    expect(reach(loot, { x: 1.2, y: 0, z: 0 })).toEqual([]);
    expect(reach(loot, { x: 3, y: 0, z: 0 })).toEqual([]);
  });

  it('leaves what the player cannot use', () => {
    const { loot, taken } = setup([crate(0, 'medkit')]);
    expect(reach(loot, { x: 0.5, y: 0, z: 0 }, (k) => k === 'ammo')).toEqual([]);
    expect(taken).toEqual([]);
    expect(reach(loot, { x: 0.5, y: 0, z: 0 })).toHaveLength(1);
  });

  it('offers each in turn, so one can fill the player before the next', () => {
    const { loot, taken } = setup([crate(0), crate(0.5)]);
    let room = 1;
    expect(reach(loot, { x: 1, y: 0, z: 0 }, () => room-- > 0)).toHaveLength(1);
    expect(taken).toHaveLength(1);
  });

  it('drops rounds where a robot falls, and sometimes a medkit', () => {
    const lucky = setup([], () => 0.1);
    lucky.loot.drop(5, 0, 5);
    expect([...lucky.shown.values()]).toEqual(['ammo', 'medkit']);
    const plain = setup([], () => 0.9);
    plain.loot.drop(5, 0, 5);
    expect([...plain.shown.values()]).toEqual(['ammo']);
    const got = reach(plain.loot, { x: 5.5, y: 0, z: 5 });
    expect(got).toHaveLength(1);
    expect(got[0]!.amount).toBeGreaterThanOrEqual(6);
    expect(plain.shown.size).toBe(0);
  });

  it('clears the oldest drop to make room', () => {
    const { loot, shown } = setup([], () => 0.9);
    for (let i = 0; i <= MAX_DROPS; i++) loot.drop(i * 10, 0, 0);
    expect(shown.size).toBe(MAX_DROPS);
    expect(shown.has(0)).toBe(false);
    expect(reach(loot, { x: 0, y: 0, z: 0 })).toEqual([]);
  });
});
