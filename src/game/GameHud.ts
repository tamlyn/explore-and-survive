/** GameHud — crosshair and ammo count, shown while playing. */

import type { Weapon } from './Weapon';

export class GameHud {
  private readonly root = document.createElement('div');
  private readonly ammo = document.createElement('div');
  private shown = '';

  constructor() {
    this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:900;display:none';
    const dot = document.createElement('div');
    dot.style.cssText = [
      'position:absolute', 'left:50%', 'top:50%', 'width:4px', 'height:4px',
      'margin:-2px 0 0 -2px', 'border-radius:50%', 'background:rgba(255,255,255,0.85)',
      'box-shadow:0 0 0 1px rgba(0,0,0,0.5)',
    ].join(';');
    this.ammo.style.cssText = [
      'position:absolute', 'right:28px', 'bottom:22px', 'color:rgba(255,255,255,0.85)',
      'font-size:22px', 'text-shadow:0 1px 3px rgba(0,0,0,0.7)',
    ].join(';');
    this.root.append(dot, this.ammo);
    document.body.append(this.root);
  }

  set visible(on: boolean) {
    this.root.style.display = on ? 'block' : 'none';
  }

  update(weapon: Weapon): void {
    const text = weapon.reloading ? 'reloading' : `${weapon.ammo} / ${weapon.spec.magazine}`;
    if (text === this.shown) return;
    this.shown = text;
    this.ammo.textContent = text;
  }
}
