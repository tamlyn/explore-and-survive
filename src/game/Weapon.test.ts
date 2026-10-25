import { describe, expect, it } from 'vitest';
import { spreadDirection, Weapon, type WeaponSpec } from './Weapon';

const SPEC: WeaponSpec = {
  fireInterval: 0.1,
  magazine: 3,
  spare: 4,
  carry: 6,
  reloadTime: 1,
  range: 100,
  damage: 10,
  spread: 0.01,
  recoil: 0.01,
};

function run(w: Weapon, seconds: number, dt = 1 / 60): string[] {
  const events: string[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    const e = w.update(dt, false, false);
    if (e) events.push(e);
  }
  return events;
}

describe('Weapon', () => {
  it('fires once per press, no faster than the fire interval', () => {
    const w = new Weapon(SPEC);
    expect(w.update(1 / 60, true, false)).toBe('fire');
    expect(w.update(1 / 60, false, false)).toBeNull();
    run(w, 0.1);
    expect(w.update(1 / 60, true, false)).toBe('fire');
    expect(w.ammo).toBe(1);
  });

  it('holds a press made just before the gun is ready', () => {
    const w = new Weapon(SPEC);
    w.update(1 / 60, true, false);
    expect(w.update(0.05, true, false)).toBeNull();
    expect(run(w, 0.06)).toEqual(['fire']);
    expect(w.ammo).toBe(1);
    // but not forever
    w.update(0.01, true, false);
    expect(run(w, 0.3)).toEqual(['fire']);
    const late = new Weapon({ ...SPEC, fireInterval: 1 });
    late.update(1 / 60, true, false);
    late.update(0.1, true, false);
    expect(run(late, 1)).toEqual([]);
  });

  it('dry-fires on an empty magazine and reloads', () => {
    const w = new Weapon(SPEC);
    for (let i = 0; i < 3; i++) {
      expect(w.update(1, true, false)).toBe('fire');
    }
    expect(w.update(1, true, false)).toBe('dry');
    expect(w.reloading).toBe(true);
    // the trigger does nothing mid-reload
    expect(w.update(0.5, true, false)).toBeNull();
    expect(w.reloadProgress).toBeCloseTo(0.5, 5);
    expect(run(w, 0.6)).toEqual(['reloaded']);
    expect(w.ammo).toBe(3);
    expect(w.spare).toBe(1);
    expect(w.reloadProgress).toBe(0);
  });

  it('reloads only what the spares hold, and not at all without them', () => {
    const w = new Weapon({ ...SPEC, spare: 1 });
    for (let i = 0; i < 3; i++) w.update(1, true, false);
    w.update(1, true, false);
    run(w, 1.1);
    expect([w.ammo, w.spare]).toEqual([1, 0]);
    w.update(1, true, false);
    expect(w.update(1, true, false)).toBe('dry');
    expect(w.reloading).toBe(false);
    expect(w.update(1 / 60, false, true)).toBeNull();
  });

  it('carries only so many spares, and restocks to the starting number', () => {
    const w = new Weapon(SPEC);
    expect(w.addSpare(5)).toBe(2);
    expect(w.spare).toBe(6);
    w.spare = 0;
    w.ammo = 0;
    w.restock();
    expect([w.ammo, w.spare]).toEqual([3, 4]);
  });

  it('reloads on request only when the magazine is not full', () => {
    const w = new Weapon(SPEC);
    expect(w.update(1 / 60, false, true)).toBeNull();
    w.update(1 / 60, true, false);
    expect(w.update(1 / 60, false, true)).toBe('reload');
    expect(run(w, 1.1)).toEqual(['reloaded']);
    expect(w.ammo).toBe(3);
  });
});

describe('spreadDirection', () => {
  const dirs = [
    { x: 0, y: 0, z: -1 },
    { x: 0, y: 1, z: 0 },
    { x: 0.6, y: -0.48, z: 0.64 },
  ];

  it('stays within the cone and is unit length', () => {
    for (const d of dirs) {
      for (let i = 0; i < 50; i++) {
        const s = spreadDirection(d, 0.05, (i * 0.618) % 1, (i * 0.414) % 1);
        expect(Math.hypot(s.x, s.y, s.z)).toBeCloseTo(1, 6);
        const angle = Math.acos(Math.min(1, s.x * d.x + s.y * d.y + s.z * d.z));
        expect(angle).toBeLessThanOrEqual(0.05 + 1e-6);
      }
    }
  });

  it('reaches the edge of the cone', () => {
    const d = dirs[0] as { x: number; y: number; z: number };
    const s = spreadDirection(d, 0.05, 0.999999, 0.3);
    expect(Math.acos(-s.z)).toBeCloseTo(0.05, 4);
  });
});
