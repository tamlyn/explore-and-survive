/** Health — hit points, with optional regeneration after a quiet spell. */

export interface Regen {
  /** seconds unhurt before healing starts */
  delay: number;
  /** hit points per second */
  rate: number;
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
    if (this.quiet > this.regen.delay) this.hp = Math.min(this.max, this.hp + this.regen.rate * dt);
  }

  reset(): void {
    this.hp = this.max;
    this.quiet = 0;
  }
}
