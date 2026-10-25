import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Piece } from './Blueprint';
import { Builder, PIECE_COST } from './Builder';
import { Building } from './Building';
import { loadRapier, Physics, type Rapier } from './Physics';
import type { PlayerInput } from './Player';
import { PlayerMotor } from './PlayerMotor';

let rapier: Rapier;
let physics: Physics | null = null;
beforeAll(async () => {
  rapier = await loadRapier();
});
afterEach(() => {
  physics?.dispose();
  physics = null;
});

const press = (...codes: string[]): PlayerInput => ({
  held: () => false,
  takePress: (c) => codes.includes(c),
  takeLook: () => ({ yaw: 0, pitch: 0 }),
});

function setup(wood: number) {
  const res = 65;
  physics = new Physics(rapier, { heights: new Float32Array(res * res), res, worldSize: res });
  const motor = new PlayerMotor(rapier, physics.world);
  motor.teleport(2, 0, 2);
  physics.step();
  const view = { add: () => 0, remove: () => {}, wear: () => {} };
  const building = new Building(physics, view, { broke: () => {} });
  const s = {
    building,
    wallet: { wood, metal: 0 },
    ghost: null as { p: Piece | null; ok: boolean } | null,
    toasts: [] as string[],
    piece: '',
  };
  const builder = new Builder(
    {
      building,
      ghost: { ghost: (p, ok) => (s.ghost = { p, ok }) },
      sfx: { click: () => {}, chop: () => {} },
      hud: { toast: (t) => s.toasts.push(t), carry: () => {}, piece: (k) => (s.piece = k) },
    },
    s.wallet,
    motor,
    () => 0,
  );
  return { ...s, builder, s };
}

const ahead = { yaw: 0, pitch: 0 };

describe('Builder', () => {
  it('cycles through the pieces', () => {
    const { builder, s } = setup(0);
    expect(s.piece).toBe('wall');
    builder.update(press('KeyR'), ahead);
    builder.update(press('KeyR'), ahead);
    expect([builder.kind, s.piece]).toEqual(['ramp', 'ramp']);
    builder.update(press('KeyR'), ahead);
    expect(builder.kind).toBe('wall');
  });

  it('builds for wood, once to a spot', () => {
    const { builder, building, s } = setup(PIECE_COST * 1.5);
    builder.update(press(), ahead);
    expect(s.ghost).toMatchObject({ p: { kind: 'wall', i: 0, j: 0, dir: 0 }, ok: true });
    builder.update(press('Mouse0'), ahead);
    expect([building.count, s.wallet.wood]).toEqual([1, PIECE_COST / 2]);
    builder.update(press('Mouse0'), ahead);
    expect(building.count).toBe(1);
    expect(s.ghost?.ok).toBe(false);
  });

  it("won't build without the wood", () => {
    const { builder, building, s } = setup(PIECE_COST - 1);
    builder.update(press('Mouse0'), ahead);
    expect(building.count).toBe(0);
    expect(s.ghost?.ok).toBe(false);
    expect(s.toasts).toEqual([`A wall takes ${PIECE_COST} wood`]);
  });

  it('puts the ghost away', () => {
    const { builder, s } = setup(0);
    builder.update(press(), ahead);
    builder.hide();
    expect(s.ghost?.p).toBeNull();
  });
});
