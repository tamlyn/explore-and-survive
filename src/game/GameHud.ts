/**
 * GameHud — crosshair (which flashes on a hit), the tools to pick from,
 * the rounds in the pistol's magazine or the piece to build, health bar,
 * wood and metal carried, a
 * red flash and an arc pointing at the attacker when hurt and the death
 * notice, shown while playing; and brief toasts, shown whenever.
 */

import { type Tool, TOOLS } from './Arsenal';
import { type PieceKind, PIECES } from './Blueprint';
import { PIECE_COST } from './Builder';
import type { Material } from './Loot';
import type { Weapon } from './Weapon';

/** how long the hit marker, hurt flash and toasts last (s) */
const HIT_TIME = 0.15;
const HURT_TIME = 0.6;
const TOAST_TIME = 1.5;
const POINTER_TIME = 1.2;
const BRASS = 'rgba(232,196,110,0.95)';
const SPENT = 'rgba(255,255,255,0.3)';
const LIT = 'rgba(255,255,255,0.95)';
const UNLIT = 'rgba(255,255,255,0.45)';
const MATERIAL_COLOR: Record<Material, string> = { wood: 'rgb(176,124,74)', metal: 'rgb(170,180,190)' };

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
  /** turned to face the attacker; its arc sits at the top of a ring */
  private readonly pointer = div(['position:absolute', 'left:50%', 'top:50%', 'width:0', 'height:0', 'opacity:0'], this.root);
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
    ['position:absolute', 'right:28px', 'bottom:24px', 'display:flex', 'align-items:flex-end', 'gap:14px', 'filter:drop-shadow(0 1px 2px rgba(0,0,0,0.7))'],
    this.root,
  );
  private readonly rounds = div(['display:flex', 'align-items:flex-end', 'gap:3px'], this.ammo);
  private readonly slots = div(
    [
      'position:absolute', 'right:28px', 'bottom:56px', 'display:flex', 'gap:14px', 'font-size:14px',
      'text-shadow:0 1px 3px rgba(0,0,0,0.7)',
    ],
    this.root,
  );
  private readonly slotLabels = TOOLS.map((tool, i) => {
    const d = div([], this.slots);
    d.textContent = `${i + 1} ${tool[0]!.toUpperCase()}${tool.slice(1)}`;
    return d;
  });
  private readonly pieces = div(
    [
      'position:absolute', 'right:28px', 'bottom:24px', 'display:none', 'gap:14px', 'font-size:14px',
      'text-shadow:0 1px 3px rgba(0,0,0,0.7)',
    ],
    this.root,
  );
  private readonly pieceLabels = PIECES.map((kind) => {
    const d = div([], this.pieces);
    d.textContent = `${kind[0]!.toUpperCase()}${kind.slice(1)}`;
    return d;
  });
  private holding: Tool = TOOLS[0]!;
  private readonly bar = div(
    ['position:absolute', 'left:28px', 'bottom:28px', 'width:200px', 'height:8px', 'background:rgba(0,0,0,0.4)', 'box-shadow:0 1px 3px rgba(0,0,0,0.5)'],
    this.root,
  );
  private readonly fill = div(['height:100%', 'background:rgba(235,235,225,0.85)'], this.bar);
  private readonly stores = div(
    [
      'position:absolute', 'left:28px', 'bottom:46px', 'display:flex', 'gap:16px', 'color:rgba(255,255,255,0.85)',
      'font-size:15px', 'text-shadow:0 1px 3px rgba(0,0,0,0.7)',
    ],
    this.root,
  );
  private readonly counts = Object.fromEntries(
    (Object.keys(MATERIAL_COLOR) as Material[]).map((m) => {
      const item = div(['display:flex', 'align-items:center', 'gap:6px'], this.stores);
      div(['width:10px', 'height:10px', 'border-radius:2px', `background:${MATERIAL_COLOR[m]}`, 'box-shadow:0 0 0 1px rgba(0,0,0,0.5)'], item);
      const n = div([], item);
      n.textContent = `0 ${m}`;
      return [m, n];
    }),
  ) as Record<Material, HTMLDivElement>;
  private readonly notice = div(
    [
      'position:absolute', 'left:0', 'right:0', 'top:38%', 'text-align:center', 'display:none',
      'color:rgba(255,255,255,0.9)', 'font-size:34px', 'letter-spacing:0.1em', 'text-shadow:0 2px 6px rgba(0,0,0,0.8)',
    ],
    this.root,
  );
  /** outside the root: settings change while flying too */
  private readonly toastBox = div([
    'position:fixed', 'left:0', 'right:0', 'top:20%', 'text-align:center', 'opacity:0', 'z-index:900',
    'pointer-events:none', 'color:rgba(255,255,255,0.9)', 'font-size:18px', 'text-shadow:0 1px 4px rgba(0,0,0,0.8)',
  ]);
  private shown = '';
  private roundPips: HTMLDivElement[] = [];
  private toastLeft = 0;
  private shownHp = -1;
  private hitLeft = 0;
  private hurtLeft = 0;
  private pointerLeft = 0;

  constructor() {
    div(
      [
        'position:absolute', 'left:-110px', 'top:-110px', 'width:220px', 'height:220px', 'border-radius:50%',
        'box-sizing:border-box', 'border:6px solid transparent', 'border-top-color:rgba(220,40,30,0.9)',
      ],
      this.pointer,
    );
    this.notice.textContent = 'You died';
    div(['color:rgba(255,255,255,0.6)'], this.pieces).textContent = `R next · ${PIECE_COST} wood`;
    document.body.append(this.root, this.toastBox);
  }

  set visible(on: boolean) {
    this.root.style.display = on ? 'block' : 'none';
  }

  set dead(on: boolean) {
    this.notice.style.display = on ? 'block' : 'none';
    this.dot.style.display = on ? 'none' : 'block';
    this.ammo.style.display = on || this.holding !== 'pistol' ? 'none' : 'flex';
    this.pieces.style.display = on || this.holding !== 'build' ? 'none' : 'flex';
  }

  /** the tool in hand: lit among the slots, with the ammo for the pistol
   *  or the pieces for building */
  tool(tool: Tool): void {
    this.holding = tool;
    this.slotLabels.forEach((d, i) => {
      d.style.color = TOOLS[i] === tool ? LIT : UNLIT;
    });
    this.ammo.style.display = tool === 'pistol' ? 'flex' : 'none';
    this.pieces.style.display = tool === 'build' ? 'flex' : 'none';
  }

  /** the piece to build next */
  piece(kind: PieceKind): void {
    this.pieceLabels.forEach((d, i) => {
      d.style.color = PIECES[i] === kind ? LIT : UNLIT;
    });
  }

  update(weapon: Weapon): void {
    const { ammo, spec } = weapon;
    // a reload fills the magazine round by round as it goes
    const shown = weapon.reloading ? ammo + Math.floor((spec.magazine - ammo) * weapon.reloadProgress) : ammo;
    const key = String(shown);
    if (key === this.shown) return;
    this.shown = key;
    if (this.roundPips.length !== spec.magazine) {
      this.roundPips = Array.from({ length: spec.magazine }, () =>
        div(['width:6px', 'height:20px', 'box-sizing:border-box', 'border:1px solid', 'border-radius:3px 3px 1px 1px'], this.rounds),
      );
    }
    this.roundPips.forEach((pip, i) => {
      pip.style.background = i < shown ? BRASS : 'transparent';
      pip.style.borderColor = i < shown ? BRASS : SPENT;
    });
  }

  /** the wood and metal carried */
  carry(carried: Readonly<Record<Material, number>>): void {
    for (const m of Object.keys(carried) as Material[]) this.counts[m].textContent = `${carried[m]} ${m}`;
  }

  /** a round struck something that can be hurt */
  hit(): void {
    this.hitLeft = HIT_TIME;
  }

  /** `bearing` is where the blow came from: radians clockwise from
   *  straight ahead */
  hurt(bearing: number): void {
    this.hurtLeft = HURT_TIME;
    this.pointerLeft = POINTER_TIME;
    this.pointer.style.transform = `rotate(${bearing}rad)`;
  }

  /** a brief message, e.g. a setting changed */
  toast(text: string): void {
    this.toastBox.textContent = text;
    this.toastLeft = TOAST_TIME;
  }

  /** once per frame, playing or not */
  updateToast(dt: number): void {
    if (this.toastLeft === 0) return;
    this.toastLeft = Math.max(0, this.toastLeft - dt);
    this.toastBox.style.opacity = String(Math.min(1, this.toastLeft / 0.3));
  }

  /** once per frame while playing: health and the fading flashes */
  updateVitals(dt: number, hp: number, max: number): void {
    const pct = Math.round((hp / max) * 100);
    if (pct !== this.shownHp) {
      this.shownHp = pct;
      this.fill.style.width = `${pct}%`;
      this.fill.style.background = pct < 30 ? 'rgba(220,60,40,0.9)' : 'rgba(235,235,225,0.85)';
    }
    this.hitLeft = Math.max(0, this.hitLeft - dt);
    this.hurtLeft = Math.max(0, this.hurtLeft - dt);
    this.pointerLeft = Math.max(0, this.pointerLeft - dt);
    this.pointer.style.opacity = String(Math.min(1, this.pointerLeft / 0.4));
    this.marker.style.opacity = String(this.hitLeft > 0 ? 1 : 0);
    this.hurtFlash.style.opacity = String(Math.max(this.hurtLeft / HURT_TIME, hp <= 0 ? 1 : 0));
  }
}
