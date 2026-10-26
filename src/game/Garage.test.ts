import { describe, expect, it } from 'vitest';
import type { Checkpoint } from '../world/CheckpointPlan';
import { Garage, SHOP_REACH } from './Garage';
import type { PlayerInput } from './Player';
import type { Vec3 } from './PlayerMotor';
import { VEHICLES, type VehicleKind } from './VehicleSpec';

class Keys implements PlayerInput {
  presses = new Set<string>();
  held(): boolean {
    return false;
  }
  takePress(code: string): boolean {
    return this.presses.delete(code);
  }
  takeLook(): { yaw: number; pitch: number } {
    return { yaw: 0, pitch: 0 };
  }
  press(...codes: string[]): this {
    for (const c of codes) this.presses.add(c);
    return this;
  }
}

const BEACON: Checkpoint = { site: 0, x: 0, y: 0, z: 0 };

function setup(metal: number, room = true) {
  const placed: { kind: VehicleKind; x: number; z: number; yaw: number }[] = [];
  const toasts: string[] = [];
  let shown: string[] | null = null;
  const wallet = { wood: 0, metal };
  const garage = new Garage(
    {
      vehicles: {
        place: (kind, x, z, yaw) => {
          if (!room) return null;
          placed.push({ kind, x, z, yaw });
          return {} as never;
        },
      },
      checkpoints: { claimedNear: (x, z, r) => (Math.hypot(x, z) <= r ? BEACON : null) },
      hud: { toast: (t) => toasts.push(t), carry: () => {}, shop: (lines) => (shown = lines) },
      sfx: { click: () => {}, chime: () => {} },
    },
    wallet,
  );
  return { garage, placed, toasts, wallet, shown: () => shown };
}

const NEAR: Vec3 = { x: 2, y: 0, z: 0 };
const FAR: Vec3 = { x: SHOP_REACH + 1, y: 0, z: 0 };

describe('Garage', () => {
  it('opens at a claimed beacon and buys with the number keys', () => {
    const { garage, placed, wallet, shown } = setup(40);
    garage.update(new Keys().press('KeyB'), NEAR);
    expect(garage.open).toBe(true);
    expect(shown()?.some((l) => l.includes('Buggy') && l.includes(`${VEHICLES.buggy.price} metal`))).toBe(true);
    const keys = new Keys().press('Digit1');
    garage.update(keys, NEAR);
    // the press was the garage's, not the arsenal's
    expect(keys.presses.size).toBe(0);
    expect(placed.map((p) => p.kind)).toEqual(['buggy']);
    expect(wallet.metal).toBe(40 - VEHICLES.buggy.price);
    expect(garage.open).toBe(false);
  });

  it('puts the car on the player’s side of the beacon, nose away from it', () => {
    const { garage, placed } = setup(40);
    garage.update(new Keys().press('KeyB'), NEAR);
    garage.update(new Keys().press('Digit2'), NEAR);
    const p = placed[0]!;
    expect(p.kind).toBe('rover');
    expect(p.x).toBeGreaterThan(0);
    // facing +x: forward is (−sin yaw, −cos yaw)
    expect(-Math.sin(p.yaw)).toBeCloseTo(1);
  });

  it('leaves the number keys alone while closed', () => {
    const { garage, placed } = setup(40);
    const keys = new Keys().press('Digit1');
    garage.update(keys, NEAR);
    expect(placed).toEqual([]);
    expect(keys.presses.has('Digit1')).toBe(true);
  });

  it('won’t sell what the player can’t afford', () => {
    const { garage, placed, toasts, wallet } = setup(VEHICLES.rover.price - 1);
    garage.update(new Keys().press('KeyB'), NEAR);
    garage.update(new Keys().press('Digit2'), NEAR);
    expect(placed).toEqual([]);
    expect(wallet.metal).toBe(VEHICLES.rover.price - 1);
    expect(toasts.at(-1)).toContain(`${VEHICLES.rover.price} metal`);
  });

  it('keeps the metal when there’s no room for the car', () => {
    const { garage, wallet } = setup(40, false);
    garage.update(new Keys().press('KeyB'), NEAR);
    garage.update(new Keys().press('Digit1'), NEAR);
    expect(wallet.metal).toBe(40);
  });

  it('isn’t open away from a claimed beacon, and closes on walking off', () => {
    const { garage } = setup(40);
    garage.update(new Keys().press('KeyB'), FAR);
    expect(garage.open).toBe(false);
    garage.update(new Keys().press('KeyB'), NEAR);
    garage.update(new Keys(), FAR);
    expect(garage.open).toBe(false);
  });
});
