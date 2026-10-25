/**
 * Builder — the build tool: R picks a wall, floor or ramp, a ghost shows
 * where it would go (see Blueprint), and a click builds it for wood.
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import { aim, type Piece, type PieceKind, PIECES, type Plot } from './Blueprint';
import type { Building } from './Building';
import type { GameHud } from './GameHud';
import type { Material } from './Loot';
import type { Player, PlayerInput } from './Player';
import type { Vec3 } from './PlayerMotor';
import type { Sfx } from './Sfx';

/** wood per piece */
export const PIECE_COST = 5;

export interface GhostView {
  /** where `p` would go, or nothing; `ok` when it can be built there */
  ghost(p: Piece | null, ok: boolean): void;
}

export interface BuilderParts {
  building: Building;
  ghost: GhostView;
  sfx: Pick<Sfx, 'click' | 'chop'>;
  hud: Pick<GameHud, 'toast' | 'carry' | 'piece'>;
}

export class Builder {
  kind: PieceKind = PIECES[0]!;
  private readonly plot: Plot;

  constructor(
    private readonly parts: BuilderParts,
    private readonly wallet: Record<Material, number>,
    private readonly body: { feet: Vec3; collider: RAPIER.Collider },
    groundAt: (x: number, z: number) => number,
  ) {
    this.plot = { groundAt, near: (i, j) => parts.building.near(i, j) };
    parts.hud.piece(this.kind);
  }

  update(input: PlayerInput, player: Pick<Player, 'yaw' | 'pitch'>): void {
    const { building, ghost, sfx, hud } = this.parts;
    if (input.takePress('KeyR')) {
      this.kind = PIECES[(PIECES.indexOf(this.kind) + 1) % PIECES.length]!;
      hud.piece(this.kind);
    }
    const { feet, collider } = this.body;
    const piece = aim(this.kind, { feet, yaw: player.yaw, pitch: player.pitch, on: building.under(feet, collider) }, this.plot);
    const misfit = building.misfit(piece);
    const afford = this.wallet.wood >= PIECE_COST;
    ghost.ghost(piece, !misfit && afford);
    if (!input.takePress('Mouse0')) return;
    if (misfit || !afford) {
      if (!afford) hud.toast(`A ${this.kind} takes ${PIECE_COST} wood`);
      else if (misfit === 'full') hud.toast('No more can be built');
      sfx.click();
      return;
    }
    building.place(piece);
    this.wallet.wood -= PIECE_COST;
    hud.carry(this.wallet);
    sfx.chop('wood');
  }

  hide(): void {
    this.parts.ghost.ghost(null, false);
  }
}
