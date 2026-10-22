/**
 * Radar — a round minimap in the corner, centred on the player and turned
 * so straight ahead is up. It scrolls the painted relief map (RadarMap),
 * draws the settlements' houses, and marks beacons: amber unclaimed, green
 * claimed. The nearest unclaimed beacons beyond its range sit on the rim,
 * pointing the way, and the caption gives the tally and how far the next
 * one is.
 */

import type { Building } from '../world/RuinPlan';
import type { Checkpoints } from './Checkpoints';

/** css px */
const RADIUS = 90;
/** metres from the centre to the rim */
const RANGE = 200;
/** unclaimed beacons beyond the range shown on the rim */
const RIM_TARGETS = 3;
const AMBER = 'rgb(255,150,40)';
const GREEN = 'rgb(80,230,110)';

/** where something (dx, dz) from the player sits on a radar facing `yaw`,
 *  in metres with x right and y down the screen; yaw 0 looks −z */
export function radarOffset(dx: number, dz: number, yaw: number): { x: number; y: number } {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: dx * c - dz * s, y: dx * s + dz * c };
}

export interface Spot {
  x: number;
  z: number;
}

/** the `n` nearest spots farther than `range`, nearest first */
export function rimTargets<T extends Spot>(spots: readonly T[], x: number, z: number, range: number, n: number): T[] {
  return spots
    .map((s) => ({ s, d: Math.hypot(s.x - x, s.z - z) }))
    .filter(({ d }) => d > range)
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map(({ s }) => s);
}

export class Radar {
  private readonly root = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly caption = document.createElement('div');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly map: HTMLCanvasElement;
  private shown = '';
  /** what the last frame drew from, to skip redrawing an unchanged view */
  private drawn = '';

  constructor(
    map: { pixels: Uint8ClampedArray<ArrayBuffer>; res: number },
    private readonly worldSize: number,
    private readonly buildings: readonly Building[],
    private readonly checkpoints: Checkpoints | null,
  ) {
    this.map = document.createElement('canvas');
    this.map.width = this.map.height = map.res;
    this.map.getContext('2d')!.putImageData(new ImageData(map.pixels, map.res, map.res), 0, 0);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.height = Math.round(RADIUS * 2 * dpr);
    this.canvas.style.cssText = `width:${RADIUS * 2}px;height:${RADIUS * 2}px;display:block`;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.root.style.cssText = [
      'position:fixed', 'right:24px', 'top:24px', 'z-index:900', 'pointer-events:none', 'display:none',
      'filter:drop-shadow(0 1px 3px rgba(0,0,0,0.6))',
    ].join(';');
    this.caption.style.cssText = [
      'margin-top:6px', 'text-align:center', 'color:rgba(255,255,255,0.85)', 'font-size:13px',
      'text-shadow:0 1px 3px rgba(0,0,0,0.8)',
    ].join(';');
    this.root.append(this.canvas, this.caption);
    document.body.append(this.root);
  }

  set visible(on: boolean) {
    const display = on ? 'block' : 'none';
    if (this.root.style.display !== display) this.root.style.display = display;
  }

  /** once per frame while playing */
  update(px: number, pz: number, yaw: number): void {
    const view = `${px.toFixed(1)},${pz.toFixed(1)},${yaw.toFixed(3)},${this.checkpoints?.count}`;
    if (view === this.drawn) return;
    this.drawn = view;
    const { ctx } = this;
    const scale = RADIUS / RANGE;
    ctx.clearRect(0, 0, RADIUS * 2, RADIUS * 2);
    ctx.save();
    ctx.beginPath();
    ctx.arc(RADIUS, RADIUS, RADIUS - 1, 0, Math.PI * 2);
    ctx.clip();

    // the world, turned and scaled about the player
    ctx.save();
    ctx.translate(RADIUS, RADIUS);
    ctx.rotate(yaw);
    ctx.scale(scale, scale);
    ctx.translate(-px, -pz);
    ctx.globalAlpha = 0.9;
    const w = this.worldSize;
    ctx.drawImage(this.map, -w / 2, -w / 2, w, w);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(28,22,18,0.95)';
    for (const b of this.buildings) {
      if (Math.abs(b.x - px) > RANGE * 1.5 || Math.abs(b.z - pz) > RANGE * 1.5) continue;
      ctx.save();
      ctx.translate(b.x, b.z);
      ctx.rotate(-b.yaw);
      ctx.fillRect(-b.width / 2, -b.depth / 2, b.width, b.depth);
      ctx.restore();
    }
    ctx.restore();

    const cps = this.checkpoints;
    if (cps) {
      for (const [i, c] of cps.spots.entries()) {
        const o = radarOffset(c.x - px, c.z - pz, yaw);
        if (Math.hypot(o.x, o.y) > RANGE) continue;
        this.dot(RADIUS + o.x * scale, RADIUS + o.y * scale, cps.isClaimed(i) ? GREEN : AMBER);
      }
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(RADIUS, RADIUS, RADIUS - 1, 0, Math.PI * 2);
    ctx.stroke();
    const north = radarOffset(0, -1, yaw);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', RADIUS + north.x * (RADIUS - 10), RADIUS + north.y * (RADIUS - 10));
    this.arrow(RADIUS, RADIUS, 0, 7, 'rgba(255,255,255,0.95)');

    if (cps) this.rim(cps, px, pz, yaw);
  }

  private rim(cps: Checkpoints, px: number, pz: number, yaw: number): void {
    const unclaimed = cps.spots.filter((_, i) => !cps.isClaimed(i));
    for (const c of rimTargets(unclaimed, px, pz, RANGE, RIM_TARGETS)) {
      const o = radarOffset(c.x - px, c.z - pz, yaw);
      const d = Math.hypot(o.x, o.y);
      const r = RADIUS - 8;
      this.arrow(RADIUS + (o.x / d) * r, RADIUS + (o.y / d) * r, Math.atan2(o.x, -o.y), 6, AMBER);
    }
    const next = rimTargets(unclaimed, px, pz, 0, 1)[0];
    const far = next ? ` · next ${Math.round(Math.hypot(next.x - px, next.z - pz) / 10) * 10} m` : '';
    const text = `Checkpoints ${cps.count} / ${cps.total}${far}`;
    if (text !== this.shown) {
      this.shown = text;
      this.caption.textContent = text;
    }
  }

  private dot(x: number, y: number, color: string): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /** a triangle at (x, y) pointing `angle` clockwise from up */
  private arrow(x: number, y: number, angle: number, size: number, color: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * 0.75, size * 0.7);
    ctx.lineTo(0, size * 0.35);
    ctx.lineTo(-size * 0.75, size * 0.7);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}
