/**
 * Melee — the axe: a swing on each click that strikes partway through,
 * along the player's aim at arm's length. It hurts robots and chops trees,
 * which fall after enough blows and leave logs (see Game). Quiet: robots
 * don't hear it as they hear the pistol.
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import { aimDirection } from '../core/CameraAim';
import type { GameHud } from './GameHud';
import type { Impacts } from './Impacts';
import type { Physics } from './Physics';
import type { Player, PlayerInput } from './Player';
import type { Sfx } from './Sfx';

export interface MeleeSpec {
  /** a whole swing, wind-up to recovery (s) */
  swingTime: number;
  /** when in the swing the blade lands (s) */
  strikeAt: number;
  /** m from the eye */
  reach: number;
  /** hit points per blow to a robot */
  damage: number;
}

export const AXE: MeleeSpec = { swingTime: 0.6, strikeAt: 0.22, reach: 2.2, damage: 40 };

/** a click this close before a swing ends still swings again */
const TRIGGER_BUFFER = 0.15;

/** the swing as a state machine: 'swing' when one starts, 'strike' when
 *  its blade lands */
export class Swing {
  private t = -1;
  private pending = 0;

  constructor(readonly spec: MeleeSpec) {}

  /** 0 → 1 through a swing, 0 otherwise */
  get progress(): number {
    return this.t < 0 ? 0 : this.t / this.spec.swingTime;
  }

  update(dt: number, trigger: boolean): 'swing' | 'strike' | null {
    this.pending = trigger ? TRIGGER_BUFFER : Math.max(0, this.pending - dt);
    if (this.t >= 0) {
      const before = this.t;
      this.t += dt;
      if (before < this.spec.strikeAt && this.t >= this.spec.strikeAt) return 'strike';
      if (this.t < this.spec.swingTime) return null;
      this.t = -1;
    }
    if (this.pending > 0) {
      this.pending = 0;
      this.t = 0;
      return 'swing';
    }
    return null;
  }

  /** stop mid-swing, as when putting the axe away */
  reset(): void {
    this.t = -1;
    this.pending = 0;
  }
}

/** how the axe finds and fells trees; ids are ObstacleField's */
export interface Forestry {
  /** the tree a collider belongs to, if it is one */
  treeOf(collider: RAPIER.Collider): number | null;
  /** a blow to tree `id` from `from` */
  chop(id: number, from: { x: number; z: number }): void;
}

export interface MeleeParts {
  swing: Swing;
  impacts: Impacts;
  sfx: Sfx;
  hud: GameHud;
}

export class Melee {
  constructor(
    private readonly parts: MeleeParts,
    private readonly physics: Physics,
    private readonly forestry: Forestry | null,
    /** the player's capsule, which a blow from the eye starts inside */
    private readonly wielder: RAPIER.Collider,
  ) {}

  update(dt: number, input: PlayerInput, player: Player): void {
    const event = this.parts.swing.update(dt, input.takePress('Mouse0'));
    if (event === 'swing') this.parts.sfx.whoosh();
    else if (event === 'strike') this.strike(player);
  }

  private strike(player: Player): void {
    const { spec } = this.parts.swing;
    const hit = this.physics.castRay(player.eye, aimDirection(player.yaw, player.pitch), spec.reach, this.wielder);
    if (!hit) return;
    const surface = hit.surface ?? 'stone';
    this.parts.impacts.spawn({ x: hit.x, y: hit.y, z: hit.z, normal: hit.normal, surface, target: hit.target });
    this.parts.sfx.chop(surface);
    if (hit.target) {
      hit.target.hurt(spec.damage, player.eye);
      this.parts.hud.hit();
      return;
    }
    const tree = this.forestry?.treeOf(hit.collider) ?? null;
    if (tree !== null) this.forestry!.chop(tree, player.eye);
  }
}
