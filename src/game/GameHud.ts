/**
 * GameHud — crosshair (which flashes on a hit), ammo count, health bar, a
 * red flash when hurt, the death notice and brief toasts, shown while
 * playing.
 */

import type { Weapon } from './Weapon';

/** how long the hit marker, hurt flash and toasts last (s) */
const HIT_TIME = 0.15;
const HURT_TIME = 0.6;
const TOAST_TIME = 1.5;

function div(css: string[], parent?: HTMLElement): HTMLDivElement {
  const d = document.createElement('div');
  d.style.cssText = css.join(';');
  parent?.append(d);
  return d;
}

export class GameHud {
  private readonly root = div(['position:fixed', 'inset:0', 'pointer-events:none', 'z-index:900', 'display:none']);
  private readonly hurtFlash = div(
    ['position:absolute', 'inset:0', 'opacity:0', 'background:radial-gradient(ellipse at center, transparent 45%, rgba(170,0,0,0.75) 100%)'],
    this.root,
  );
  private readonly dot = div(
    [
      'position:absolute', 'left:50%', 'top:50%', 'width:4px', 'height:4px', 'margin:-2px 0 0 -2px',
      'border-radius:50%', 'background:rgba(255,255,255,0.85)', 'box-shadow:0 0 0 1px rgba(0,0,0,0.5)',
    ],
    this.root,
  );
  private readonly marker = div(
    [
      'position:absolute', 'left:50%', 'top:50%', 'width:18px', 'height:18px', 'margin:-9px 0 0 -9px',
      'opacity:0', 'transform:rotate(45deg)',
      'background:linear-gradient(white,white) center/2px 100% no-repeat, linear-gradient(white,white) center/100% 2px no-repeat',
      'mask:radial-gradient(circle, transparent 4px, black 5px)',
    ],
    this.root,
  );
  private readonly ammo = div(
    ['position:absolute', 'right:28px', 'bottom:22px', 'color:rgba(255,255,255,0.85)', 'font-size:22px', 'text-shadow:0 1px 3px rgba(0,0,0,0.7)'],
    this.root,
  );
  private readonly bar = div(
    ['position:absolute', 'left:28px', 'bottom:28px', 'width:200px', 'height:8px', 'background:rgba(0,0,0,0.4)', 'box-shadow:0 1px 3px rgba(0,0,0,0.5)'],
    this.root,
  );
  private readonly fill = div(['height:100%', 'background:rgba(235,235,225,0.85)'], this.bar);
  private readonly notice = div(
    [
      'position:absolute', 'left:0', 'right:0', 'top:38%', 'text-align:center', 'display:none',
      'color:rgba(255,255,255,0.9)', 'font-size:34px', 'letter-spacing:0.1em', 'text-shadow:0 2px 6px rgba(0,0,0,0.8)',
    ],
    this.root,
  );
  private readonly toastBox = div(
    [
      'position:absolute', 'left:0', 'right:0', 'top:20%', 'text-align:center', 'opacity:0',
      'color:rgba(255,255,255,0.9)', 'font-size:18px', 'text-shadow:0 1px 4px rgba(0,0,0,0.8)',
    ],
    this.root,
  );
  private shown = '';
  private toastLeft = 0;
  private shownHp = -1;
  private hitLeft = 0;
  private hurtLeft = 0;

  constructor() {
    this.notice.textContent = 'You died';
    document.body.append(this.root);
  }

  set visible(on: boolean) {
    this.root.style.display = on ? 'block' : 'none';
  }

  set dead(on: boolean) {
    this.notice.style.display = on ? 'block' : 'none';
    this.dot.style.display = on ? 'none' : 'block';
    this.ammo.style.display = on ? 'none' : 'block';
  }

  update(weapon: Weapon): void {
    const text = weapon.reloading ? 'reloading' : `${weapon.ammo} / ${weapon.spec.magazine}`;
    if (text === this.shown) return;
    this.shown = text;
    this.ammo.textContent = text;
  }

  /** a round struck something that can be hurt */
  hit(): void {
    this.hitLeft = HIT_TIME;
  }

  hurt(): void {
    this.hurtLeft = HURT_TIME;
  }

  /** a brief message, e.g. a setting changed */
  toast(text: string): void {
    this.toastBox.textContent = text;
    this.toastLeft = TOAST_TIME;
  }

  /** once per frame: health and the fading flashes */
  updateVitals(dt: number, hp: number, max: number): void {
    const pct = Math.round((hp / max) * 100);
    if (pct !== this.shownHp) {
      this.shownHp = pct;
      this.fill.style.width = `${pct}%`;
      this.fill.style.background = pct < 30 ? 'rgba(220,60,40,0.9)' : 'rgba(235,235,225,0.85)';
    }
    this.hitLeft = Math.max(0, this.hitLeft - dt);
    this.hurtLeft = Math.max(0, this.hurtLeft - dt);
    this.toastLeft = Math.max(0, this.toastLeft - dt);
    this.toastBox.style.opacity = String(Math.min(1, this.toastLeft / 0.3));
    this.marker.style.opacity = String(this.hitLeft > 0 ? 1 : 0);
    this.hurtFlash.style.opacity = String(Math.max(this.hurtLeft / HURT_TIME, hp <= 0 ? 1 : 0));
  }
}
