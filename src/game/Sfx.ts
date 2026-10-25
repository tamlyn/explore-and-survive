/**
 * Sfx — game sounds synthesised with Web Audio (no sample files yet). The
 * context is created on first use: browsers only allow audio after a user
 * gesture, and the first shot is one. Sounds from out in the world fade with
 * distance and pan by bearing from the listener.
 */

import type { Vec3 } from './PlayerMotor';

/** a world sound halves in loudness this far away (m) */
const HALF_DISTANCE = 15;

export class Sfx {
  /** where the player hears from; yaw 0 looks −z */
  readonly listener = { x: 0, z: 0, yaw: 0 };

  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  shot(): void {
    const ctx = this.context();
    const t = ctx.currentTime;
    // crack: a noise burst whose brightness falls away fast
    const crack = this.noiseSource(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(7000, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.25);
    const crackGain = envelope(ctx, t, 0.9, 0.35);
    crack.connect(lp).connect(crackGain).connect(this.output());
    crack.start(t, Math.random() * 0.5); // vary the grain shot to shot
    crack.stop(t + 0.4);
    // thump: a falling sine for body
    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(140, t);
    thump.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    thump.connect(envelope(ctx, t, 0.8, 0.18)).connect(this.output());
    thump.start(t);
    thump.stop(t + 0.2);
  }

  /** a short mechanical click — dry fire, magazine out/in */
  click(delay = 0): void {
    const ctx = this.context();
    const t = ctx.currentTime + delay;
    const src = this.noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = 3200;
    hp.Q.value = 2;
    src.connect(hp).connect(envelope(ctx, t, 0.5, 0.03)).connect(this.output());
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.05);
  }

  /** a robot's shot: a buzzing zap */
  zap(at: Vec3): void {
    const ctx = this.context();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.12);
    osc.connect(envelope(ctx, t, 0.35, 0.14)).connect(this.placed(at));
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /** a robot destroyed: a falling whine over a burst of static */
  powerDown(at: Vec3): void {
    const ctx = this.context();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.7);
    const out = this.placed(at);
    osc.connect(envelope(ctx, t, 0.25, 0.8)).connect(out);
    osc.start(t);
    osc.stop(t + 0.8);
    const fizz = this.noiseSource(ctx);
    fizz.connect(envelope(ctx, t, 0.5, 0.3)).connect(out);
    fizz.start(t, Math.random() * 0.5);
    fizz.stop(t + 0.35);
  }

  /** the player taking a hit: a dull thud */
  hurt(): void {
    const ctx = this.context();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.2);
    osc.connect(envelope(ctx, t, 0.9, 0.25)).connect(this.output());
    osc.start(t);
    osc.stop(t + 0.3);
  }

  /** a checkpoint claimed: two rising notes */
  chime(): void {
    const ctx = this.context();
    const t = ctx.currentTime;
    for (const [freq, delay] of [[660, 0], [990, 0.12]] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      osc.connect(envelope(ctx, t + delay, 0.35, 0.6)).connect(this.output());
      osc.start(t + delay);
      osc.stop(t + delay + 0.65);
    }
  }

  /** something picked up: a quick rising blip */
  pickup(): void {
    const ctx = this.context();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(1040, t + 0.08);
    osc.connect(envelope(ctx, t, 0.4, 0.18)).connect(this.output());
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** a gain and pan for a sound at `at`, relative to the listener */
  private placed(at: Vec3): AudioNode {
    const ctx = this.context();
    const { x, z, yaw } = this.listener;
    const dx = at.x - x;
    const dz = at.z - z;
    const d = Math.hypot(dx, dz);
    const gain = ctx.createGain();
    gain.gain.value = 1 / (1 + d / HALF_DISTANCE);
    const pan = ctx.createStereoPanner();
    // right of the listener is (cos yaw, −sin yaw)
    pan.pan.value = d > 0.1 ? (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d : 0;
    gain.connect(pan).connect(this.output());
    return gain;
  }

  /** crack and thump overlap at their peaks; headroom so they don't clip */
  private output(): GainNode {
    if (!this.out) {
      const ctx = this.context();
      this.out = ctx.createGain();
      this.out.gain.value = 0.55;
      this.out.connect(ctx.destination);
    }
    return this.out;
  }

  private context(): AudioContext {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private noiseSource(ctx: AudioContext): AudioBufferSourceNode {
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    return src;
  }
}

function envelope(ctx: AudioContext, t: number, peak: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + decay);
  return g;
}
