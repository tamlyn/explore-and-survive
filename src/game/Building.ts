/**
 * Building — the walls, floors and ramps the player has put up: solid in
 * the physics world, worn down by shots and blows from anyone, and gone
 * when worn through. Nothing holds a piece up but itself, so one stays put
 * when what it was built from is gone.
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import { type Piece, pieceBox, pieceKey, type Plot } from './Blueprint';
import { boxColliderDesc, type Hittable, type Physics } from './Physics';
import type { Vec3 } from './PlayerMotor';

export const PIECE_HP = 150;
/** no more than this stand at once */
export const MAX_PIECES = 400;
/** the box a piece can't be built into someone shrinks by this (m), so a
 *  floor at the player's feet doesn't count */
const CLEARANCE = 0.05;

/** how pieces are drawn; ids are the view's own */
export interface PieceView {
  add(p: Piece): number;
  remove(id: number): void;
  /** 0 as built … 1 about to break */
  wear(id: number, worn: number): void;
}

export interface BuildingFx {
  broke(at: Vec3): void;
}

/** why a piece can't go where it's aimed */
export type Misfit = 'taken' | 'occupied' | 'full';

class Built implements Hittable {
  hp = PIECE_HP;

  constructor(
    readonly piece: Piece,
    readonly collider: RAPIER.Collider,
    readonly viewId: number,
    private readonly onHurt: (b: Built, damage: number) => void,
  ) {}

  hurt(damage: number): void {
    this.onHurt(this, damage);
  }
}

const DOWN = { x: 0, y: -1, z: 0 };

export class Building implements Pick<Plot, 'near'> {
  private readonly built = new Map<string, Built>();

  constructor(
    private readonly physics: Physics,
    private readonly view: PieceView,
    private readonly fx: BuildingFx,
  ) {}

  get count(): number {
    return this.built.size;
  }

  near(i: number, j: number): Piece[] {
    const out: Piece[] = [];
    for (const { piece: p } of this.built.values()) {
      if (Math.abs(p.i - i) <= 1 && Math.abs(p.j - j) <= 1) out.push(p);
    }
    return out;
  }

  /** null when `p` can be built */
  misfit(p: Piece): Misfit | null {
    if (this.built.has(pieceKey(p))) return 'taken';
    if (this.built.size >= MAX_PIECES) return 'full';
    const b = pieceBox(p);
    const inner = { ...b, hx: b.hx - CLEARANCE, hy: b.hy - CLEARANCE, hz: b.hz - CLEARANCE };
    const someone = this.physics.targetsIn(inner).some((t) => !(t instanceof Built));
    return someone ? 'occupied' : null;
  }

  place(p: Piece): void {
    const collider = this.physics.addCollider(boxColliderDesc(this.physics.rapier, pieceBox(p)), 'wood');
    const built = new Built(p, collider, this.view.add(p), (b, damage) => this.hurt(b, damage));
    this.physics.tag(collider, null, built);
    this.built.set(pieceKey(p), built);
  }

  /** the piece just under `feet`, if any */
  under(feet: Vec3, self: RAPIER.Collider): Piece | null {
    const hit = this.physics.castRay({ x: feet.x, y: feet.y + 0.2, z: feet.z }, DOWN, 0.5, self);
    return hit?.target instanceof Built ? hit.target.piece : null;
  }

  /** what a shot into `target` would wear down, e.g. "wall 120/150" — or
   *  null if it isn't a piece */
  describe(target: Hittable): string | null {
    return target instanceof Built ? `${target.piece.kind} ${Math.ceil(target.hp)}/${PIECE_HP}` : null;
  }

  private hurt(b: Built, damage: number): void {
    if (b.hp <= 0) return;
    b.hp -= damage;
    if (b.hp > 0) {
      this.view.wear(b.viewId, 1 - b.hp / PIECE_HP);
      return;
    }
    this.physics.removeCollider(b.collider);
    this.view.remove(b.viewId);
    this.built.delete(pieceKey(b.piece));
    const box = pieceBox(b.piece);
    this.fx.broke({ x: box.x, y: box.y, z: box.z });
  }
}
