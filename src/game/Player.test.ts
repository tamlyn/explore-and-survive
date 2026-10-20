import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadRapier, Physics, type Rapier } from './Physics';
import { FIXED_DT, Player, SPRINT_MULT, WALK_SPEED, type PlayerInput } from './Player';
import { EYE_HEIGHT, PlayerMotor } from './PlayerMotor';

let rapier: Rapier;
let physics: Physics | null = null;

beforeAll(async () => {
  rapier = await loadRapier();
});
afterEach(() => {
  physics?.dispose();
  physics = null;
});

class FakeInput implements PlayerInput {
  keys = new Set<string>();
  presses = new Set<string>();
  look = { yaw: 0, pitch: 0 };
  held(code: string): boolean {
    return this.keys.has(code);
  }
  takePress(code: string): boolean {
    return this.presses.delete(code);
  }
  takeLook(): { yaw: number; pitch: number } {
    const l = this.look;
    this.look = { yaw: 0, pitch: 0 };
    return l;
  }
}

function setup(): { player: Player; input: FakeInput } {
  const res = 129;
  physics = new Physics(rapier, { heights: new Float32Array(res * res), res, worldSize: res });
  const p = physics;
  const player = new Player(new PlayerMotor(rapier, p.world), () => p.step());
  player.spawn(0, 0.02, 0, 0, 0);
  return { player, input: new FakeInput() };
}

function play(player: Player, input: FakeInput, seconds: number, dt = 1 / 60): void {
  for (let t = 0; t < seconds - 1e-9; t += dt) player.update(dt, input);
}

describe('Player', () => {
  it('turns with the mouse and clamps pitch', () => {
    const { player, input } = setup();
    input.look = { yaw: 0.5, pitch: -3 };
    player.update(1 / 60, input);
    expect(player.yaw).toBeCloseTo(-0.5);
    expect(player.pitch).toBeCloseTo(1.55);
  });

  it('walks forward along −z at yaw 0, and sprints faster', () => {
    const { player, input } = setup();
    input.keys.add('KeyW');
    play(player, input, 1);
    expect(player.vel.z).toBeCloseTo(-WALK_SPEED, 1);
    expect(Math.abs(player.vel.x)).toBeLessThan(1e-6);
    input.keys.add('ShiftLeft');
    play(player, input, 1);
    expect(player.speed).toBeCloseTo(WALK_SPEED * SPRINT_MULT, 0);
    expect(player.sprinting).toBe(true);
  });

  it('strafes right along +x at yaw 0', () => {
    const { player, input } = setup();
    input.keys.add('KeyD');
    play(player, input, 1);
    expect(player.vel.x).toBeCloseTo(WALK_SPEED, 1);
  });

  it('covers the same ground at 20 fps and 144 fps', () => {
    const a = setup();
    a.input.keys.add('KeyW');
    play(a.player, a.input, 2, 1 / 20);
    const zSlow = a.player.eye.z;
    physics?.dispose();

    const b = setup();
    b.input.keys.add('KeyW');
    play(b.player, b.input, 2, 1 / 144);
    expect(b.player.eye.z).toBeCloseTo(zSlow, 1);
  });

  it('jumps from a brief tap even at a low frame rate', () => {
    const { player, input } = setup();
    play(player, input, 0.2);
    input.presses.add('Space');
    let peak = player.eye.y;
    for (let t = 0; t < 1; t += 0.1) {
      player.update(0.1, input);
      peak = Math.max(peak, player.eye.y);
    }
    expect(peak - EYE_HEIGHT).toBeGreaterThan(0.8);
  });

  it('interpolates the eye between physics ticks', () => {
    const { player, input } = setup();
    input.keys.add('KeyD');
    play(player, input, 1);
    const xs: number[] = [];
    for (let i = 0; i < 8; i++) {
      player.update(FIXED_DT / 4, input);
      xs.push(player.eye.x);
    }
    // every sub-tick frame moves the eye forward a little — no stair-steps
    for (let i = 1; i < xs.length; i++) expect((xs[i] as number) - (xs[i - 1] as number)).toBeGreaterThan(0);
  });
});
