import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Gunplay, type GunplayParts } from './Gunplay';
import { loadRapier, Physics, type Rapier } from './Physics';
import { Player, type PlayerInput } from './Player';
import { PlayerMotor } from './PlayerMotor';
import type { Impact } from './Shot';
import { Weapon, type WeaponSpec } from './Weapon';

let rapier: Rapier;
let physics: Physics | null = null;
beforeAll(async () => {
  rapier = await loadRapier();
});
afterEach(() => {
  physics?.dispose();
  physics = null;
});

const SPEC: WeaponSpec = { fireInterval: 0.1, magazine: 2, reloadTime: 1, range: 50, spread: 0, recoil: 0.02 };

class Clicks implements PlayerInput {
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
}

function setup(): { gunplay: Gunplay; player: Player; impacts: Impact[]; parts: GunplayParts; input: Clicks } {
  const res = 129;
  physics = new Physics(rapier, { heights: new Float32Array(res * res), res, worldSize: res });
  const p = physics;
  // a tree 10 m ahead (yaw 0 looks −z)
  p.addCollider(rapier.ColliderDesc.cylinder(5, 0.5).setTranslation(0, 5, -10), 'wood');
  const motor = new PlayerMotor(rapier, p.world);
  const player = new Player(motor, () => p.step());
  player.spawn(0, 0.02, 0, 0, 0);
  p.step();
  const impacts: Impact[] = [];
  const parts = {
    weapon: new Weapon(SPEC),
    viewmodel: { fire: vi.fn(), update: vi.fn(), scene: { visible: false } },
    impacts: { spawn: (hit: Impact) => impacts.push(hit), update: vi.fn() },
    sfx: { shot: vi.fn(), click: vi.fn() },
    hud: { update: vi.fn(), visible: false },
  } as unknown as GunplayParts;
  const gunplay = new Gunplay(parts, p, null, motor.collider);
  return { gunplay, player, impacts, parts, input: new Clicks() };
}

describe('Gunplay', () => {
  it('shoots along the aim from the eye, with kick, flash and sound', () => {
    const { gunplay, player, impacts, parts, input } = setup();
    input.presses.add('Mouse0');
    gunplay.update(1 / 60, input, player);
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.surface).toBe('wood');
    expect(impacts[0]?.z).toBeCloseTo(-9.5, 2);
    expect(impacts[0]?.y).toBeCloseTo(player.eye.y, 2);
    expect(player.pitch).toBeGreaterThan(0);
    expect(parts.viewmodel.fire).toHaveBeenCalledOnce();
    expect(parts.sfx.shot).toHaveBeenCalledOnce();
  });

  it('clicks instead of firing when empty', () => {
    const { gunplay, player, impacts, parts, input } = setup();
    for (let i = 0; i < 3; i++) {
      input.presses.add('Mouse0');
      gunplay.update(0.2, input, player);
    }
    expect(impacts).toHaveLength(2);
    expect(parts.sfx.shot).toHaveBeenCalledTimes(2);
    expect(parts.sfx.click).toHaveBeenCalledOnce();
    expect(parts.weapon.reloading).toBe(true);
  });
});
