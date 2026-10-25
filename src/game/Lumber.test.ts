import type RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it } from 'vitest';
import { chopsToFell, Lumber, woodIn } from './Lumber';
import type { Trunk } from './Obstacles';

const TREE: Trunk = { slot: 7, x: 3, y: 0, z: 4, radius: 0.3, height: 15 };
const collider = (handle: number) => ({ handle }) as unknown as RAPIER.Collider;

function setup() {
  const removed: number[] = [];
  const felled: Trunk[] = [];
  const lumber = new Lumber(
    {
      idOf: (c) => (c.handle === 1 ? 10 : c.handle === 2 ? 11 : null),
      trunk: (id) => (id === 10 ? TREE : null),
      remove: (id) => removed.push(id),
    },
    (t) => felled.push(t),
  );
  return { lumber, removed, felled };
}

describe('Lumber', () => {
  it('knows trees from other obstacles', () => {
    const { lumber } = setup();
    expect(lumber.treeOf(collider(1))).toBe(10);
    expect(lumber.treeOf(collider(2))).toBeNull();
    expect(lumber.treeOf(collider(3))).toBeNull();
  });

  it('fells a tree on the last of its blows, once', () => {
    const { lumber, removed, felled } = setup();
    const n = chopsToFell(TREE);
    for (let i = 0; i < n - 1; i++) lumber.chop(10, { x: 0, z: 0 });
    expect(felled).toEqual([]);
    lumber.chop(10, { x: 0, z: 0 });
    expect(removed).toEqual([10]);
    expect(felled).toEqual([TREE]);
  });

  it('asks more of big trees, and gives more wood', () => {
    const big = { ...TREE, radius: 0.5, height: 24 };
    expect(chopsToFell(big)).toBeGreaterThan(chopsToFell(TREE));
    expect(woodIn(big)).toBeGreaterThan(woodIn(TREE));
  });
});
