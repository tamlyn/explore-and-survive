/** ControlsCard — every key, on a card that H (or ?) shows and hides. */

const CONTROLS: [string, string][] = [
  ['Click', 'capture the mouse'],
  ['WASD', 'move'],
  ['Shift', 'sprint'],
  ['Space', 'jump'],
  ['Left click', 'shoot'],
  ['R', 'reload'],
  ['V', 'walk / fly'],
  ['Wheel', 'fly speed'],
  ['E / Q', 'fly up / down'],
  ['Y', 'invert mouse look'],
  ['P', 'copy where you are and what you are looking at'],
  ['F3', 'debug panel, with where you are'],
  ['1–9', 'bookmarked views'],
  ['F', 'flythrough'],
  ['[ / ]', 'time of day'],
  ['H or ?', 'this card'],
];

export class ControlsCard {
  private readonly el = document.createElement('div');

  constructor() {
    this.el.style.cssText = [
      'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)', 'z-index:1100', 'display:none',
      'padding:16px 22px', 'border-radius:6px', 'background:rgba(8,12,10,0.8)', 'color:#d9e8e0',
      'font:13px/1.7 ui-monospace,Menlo,monospace', 'white-space:pre', 'pointer-events:none',
    ].join(';');
    const width = Math.max(...CONTROLS.map(([k]) => k.length)) + 3;
    this.el.textContent = ['Controls', '', ...CONTROLS.map(([k, what]) => k.padEnd(width) + what)].join('\n');
    document.body.append(this.el);
  }

  toggle(): void {
    this.el.style.display = this.el.style.display === 'none' ? 'block' : 'none';
  }
}
