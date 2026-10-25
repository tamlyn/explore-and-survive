import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Piece } from './Blueprint';
import { Building, PIECE_HP, type PieceView } from './Building';
import { loadRapier, Physics, type Rapier } from './Physics';
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

class StubView implements PieceView {
  readonly shown = new Map<number, number>();
  private next = 0;
  add(): number {
    this.shown.set(this.next, 0);
    return this.next++;
  }
  remove(id: number): void {
    this.shown.delete(id);
  }
  wear(id: number, worn: number): void {
    this.shown.set(id, worn);
  }
}

function setup(): { building: Building; view: StubView; broke: number[]; motor: PlayerMotor } {
  const res = 65;
  physics = new Physics(rapier, { heights: new Float32Array(res * res), res, worldSize: res });
  const view = new StubView();
  const broke: number[] = [];
  const building = new Building(physics, view, { broke: (at) => broke.push(at.y) });
  const motor = new PlayerMotor(rapier, physics.world);
  physics.tag(motor.collider, null, { hurt: () => {} });
  motor.teleport(2, 0, 2);
  physics.step();
  return { building, view, broke, motor };
}

const floor: Piece = { kind: 'floor', i: 0, j: -1, y: 1, dir: 0 };
const wall: Piece = { kind: 'wall', i: 0, j: 0, y: 0, dir: 0 };

describe('Building', () => {
  it('builds one of each kind to a spot, and not into someone', () => {
    const { building } = setup();
    expect(building.misfit(floor)).toBeNull();
    building.place(floor);
    expect(building.misfit(floor)).toBe('taken');
    expect(building.misfit({ ...floor, kind: 'ramp' })).toBeNull();
    // the player stands in cell (0, 0)
    expect(building.misfit({ kind: 'floor', i: 0, j: 0, y: 1, dir: 0 })).toBe('occupied');
    // …but a floor at their feet is fine, as is a wall beside them
    expect(building.misfit({ kind: 'floor', i: 0, j: 0, y: 0, dir: 0 })).toBeNull();
    expect(building.misfit(wall)).toBeNull();
  });

  it('wears a piece down, and takes it away when worn through', () => {
    const { building, view, broke, motor } = setup();
    building.place(wall);
    physics!.step();
    const cast = () => physics!.castRay({ x: 2, y: 1, z: 2 }, { x: 0, y: 0, z: -1 }, 5, motor.collider);
    const ray = (): string | null => {
      const hit = cast();
      return hit?.target ? building.describe(hit.target) : null;
    };
    const hit = cast()!;
    hit.target!.hurt(50, { x: 2, y: 1, z: 2 });
    expect(ray()).toBe(`wall ${PIECE_HP - 50}/${PIECE_HP}`);
    expect(view.shown.get(0)).toBeCloseTo(50 / PIECE_HP);
    hit.target!.hurt(PIECE_HP, { x: 2, y: 1, z: 2 });
    hit.target!.hurt(PIECE_HP, { x: 2, y: 1, z: 2 });
    physics!.step();
    expect(ray()).toBeNull();
    expect(view.shown.size).toBe(0);
    expect(broke).toEqual([1.5]);
    expect(building.misfit(wall)).toBeNull();
  });

  it('knows the piece underfoot', () => {
    const { building, motor } = setup();
    const under = { ...floor, j: 0 };
    building.place(under);
    motor.teleport(2, 1, 2);
    physics!.step();
    expect(building.under(motor.feet, motor.collider)).toEqual(under);
    motor.teleport(2, 1, 6);
    expect(building.under(motor.feet, motor.collider)).toBeNull();
  });
});
