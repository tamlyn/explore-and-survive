/** Health — hit points, with optional regeneration after a quiet spell. */

export interface Regen {
  /** seconds unhurt before healing starts */
  delay: number;
  /** hit points per second */
  rate: number;
  /** healing stops here; the rest takes a medkit (default: full) */
  upTo?: number;
}

export class Health {
  hp: number;
  private quiet = 0;

  constructor(
    readonly max: number,
    private readonly regen: Regen | null = null,
  ) {
    this.hp = max;
  }

  get dead(): boolean {
    return this.hp <= 0;
  }

  /** true when this blow is the one that kills */
  hurt(damage: number): boolean {
    if (this.dead) return false;
    this.hp = Math.max(0, this.hp - damage);
    this.quiet = 0;
    return this.dead;
  }

  update(dt: number): void {
    if (!this.regen || this.dead) return;
    this.quiet += dt;
    const cap = this.regen.upTo ?? this.max;
    if (this.quiet > this.regen.delay && this.hp < cap) this.hp = Math.min(cap, this.hp + this.regen.rate * dt);
  }

  /** restore up to `n` hit points; how many it took */
  heal(n: number): number {
    if (this.dead) return 0;
    const gained = Math.min(n, this.max - this.hp);
    this.hp += gained;
    return gained;
  }

  reset(): void {
    this.hp = this.max;
    this.quiet = 0;
  }
}
