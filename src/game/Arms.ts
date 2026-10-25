/**
 * Arms — the player's hands: the tool picked in the Arsenal, used through
 * Gunplay (the pistol), Melee (the axe) or the Builder, and drawn by the
 * viewmodel.
 */

import { Arsenal, type ArsenalInput } from './Arsenal';
import type { Builder } from './Builder';
import type { GameHud } from './GameHud';
import type { Gunplay } from './Gunplay';
import type { Melee, Swing } from './Melee';
import type { Player } from './Player';
import type { Viewmodel } from './Viewmodel';
import type { Weapon } from './Weapon';

export interface ArmsParts {
  gunplay: Gunplay;
  weapon: Weapon;
  melee: Melee;
  swing: Swing;
  builder: Builder;
  viewmodel: Viewmodel;
  hud: GameHud;
}

export class Arms {
  readonly arsenal = new Arsenal();

  constructor(private readonly parts: ArmsParts) {
    parts.hud.tool(this.arsenal.current);
  }

  set active(on: boolean) {
    this.parts.viewmodel.scene.visible = on;
    this.parts.hud.visible = on;
    // a swing cut short by death or flying mustn't land when play resumes
    this.parts.swing.reset();
    this.arsenal.settle();
    if (!on) this.parts.builder.hide();
  }

  /** before the camera rig, so recoil shows in this frame's view; true
   *  when a round was fired */
  update(dt: number, input: ArsenalInput, player: Player): boolean {
    const { arsenal } = this;
    if (arsenal.update(dt, input)) {
      this.parts.swing.reset();
      this.parts.hud.tool(arsenal.current);
    }
    if (!arsenal.ready || arsenal.current !== 'build') this.parts.builder.hide();
    if (!arsenal.ready) return false;
    if (arsenal.current === 'pistol') return this.parts.gunplay.update(dt, input, player);
    if (arsenal.current === 'axe') this.parts.melee.update(dt, input, player);
    else this.parts.builder.update(input, player);
    return false;
  }

  /** after the camera rig: the viewmodel follows the posed camera */
  updateView(dt: number, player: Player): void {
    const { arsenal, parts } = this;
    parts.viewmodel.update(dt, player, {
      tool: arsenal.shown,
      reload: parts.weapon.reloadProgress,
      swing: parts.swing.progress,
      lowered: arsenal.lowered,
    });
  }
}
