/**
 * Gunplay — the player's gun: turns the trigger and reload keys into weapon
 * events, traces each shot from the player's eye along their aim and plays
 * out the result (viewmodel kick, impact puff, sound, HUD). Shots come from
 * the player, not the camera, so a third-person rig can reuse all of this
 * with a different viewmodel.
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import { aimDirection } from '../core/CameraAim';
import type { GameHud } from './GameHud';
import type { Impacts } from './Impacts';
import type { Physics } from './Physics';
import { WALK_SPEED, type Player, type PlayerInput } from './Player';
import type { Sfx } from './Sfx';
import { traceShot } from './Shot';
import type { Viewmodel } from './Viewmodel';
import { spreadDirection, type Weapon } from './Weapon';

/** walking at full speed widens the spread by this factor */
const MOVING_SPREAD = 2.5;

export interface GunplayParts {
  weapon: Weapon;
  viewmodel: Viewmodel;
  impacts: Impacts;
  sfx: Sfx;
  hud: GameHud;
}

export class Gunplay {
  constructor(
    private readonly parts: GunplayParts,
    private readonly physics: Physics,
    private readonly waterAt: ((x: number, z: number) => number) | null,
    /** the shooter's own collider, which the ray starts inside */
    private readonly shooter: RAPIER.Collider,
  ) {}

  set active(on: boolean) {
    this.parts.viewmodel.scene.visible = on;
    this.parts.hud.visible = on;
  }

  update(dt: number, input: PlayerInput, player: Player): void {
    const { weapon, viewmodel, impacts, sfx, hud } = this.parts;
    const event = weapon.update(dt, input.takePress('Mouse0'), input.takePress('KeyR'));
    if (event === 'fire') {
      this.fire(player);
      viewmodel.fire();
      sfx.shot();
    } else if (event === 'dry' || event === 'reload') {
      sfx.click();
    } else if (event === 'reloaded') {
      sfx.click();
      sfx.click(0.08);
    }
    viewmodel.update(dt, player, weapon.reloadProgress);
    impacts.update(dt);
    hud.update(weapon);
  }

  private fire(player: Player): void {
    const { spec } = this.parts.weapon;
    const moving = Math.min(player.speed / WALK_SPEED, 1);
    const spread = spec.spread * (1 + (MOVING_SPREAD - 1) * moving);
    const dir = spreadDirection(aimDirection(player.yaw, player.pitch), spread, Math.random(), Math.random());
    const hit = traceShot(this.physics, player.eye, dir, spec.range, this.waterAt, this.shooter);
    if (hit) this.parts.impacts.spawn(hit);
    player.addAim(0, spec.recoil * (0.8 + Math.random() * 0.4));
  }
}
