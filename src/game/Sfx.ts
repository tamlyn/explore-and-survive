/**
 * Sfx — gun sounds synthesised with Web Audio (no sample files yet). The
 * context is created on first use: browsers only allow audio after a user
 * gesture, and the first shot is one.
 */

export class Sfx {
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
