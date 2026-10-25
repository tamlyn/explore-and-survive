/**
 * Arsenal — which of the player's tools is in hand, and changing it: the
 * number keys pick one, the wheel steps through them. Changing lowers the
 * old tool and raises the new, and nothing can be used meanwhile.
 */

import type { PlayerInput } from './Player';

export type Tool = 'pistol' | 'axe';

/** in slot order: key 1 is the first */
export const TOOLS: readonly Tool[] = ['pistol', 'axe'];

/** lowering one and raising the next (s) */
const SWITCH_TIME = 0.4;

export interface ArsenalInput extends PlayerInput {
  takeWheel(): number;
}

export class Arsenal {
  /** what's in hand, or on its way up */
  current: Tool = TOOLS[0]!;
  /** what's going down, while changing */
  private leaving: Tool | null = null;
  private left = 0;

  /** in hand and usable */
  get ready(): boolean {
    return this.left === 0;
  }

  /** what to draw: the leaving tool while it goes down, then the new one */
  get shown(): Tool {
    return this.leaving && this.left > SWITCH_TIME / 2 ? this.leaving : this.current;
  }

  /** 0 in hand … 1 out of sight, through a change */
  get lowered(): number {
    if (this.left === 0) return 0;
    const t = 1 - this.left / SWITCH_TIME;
    return t < 0.5 ? t * 2 : (1 - t) * 2;
  }

  /** true when a change starts */
  update(dt: number, input: ArsenalInput): boolean {
    this.left = Math.max(0, this.left - dt);
    if (this.left === 0) this.leaving = null;
    let pick: Tool | null = null;
    TOOLS.forEach((tool, i) => {
      if (input.takePress(`Digit${i + 1}`)) pick = tool;
    });
    const wheel = input.takeWheel();
    if (wheel !== 0) {
      const at = TOOLS.indexOf(this.current);
      pick = TOOLS[(at + Math.sign(wheel) + TOOLS.length) % TOOLS.length]!;
    }
    if (!pick || pick === this.current) return false;
    this.leaving = this.ready ? this.current : this.shown;
    this.current = pick;
    this.left = SWITCH_TIME;
    return true;
  }
}
