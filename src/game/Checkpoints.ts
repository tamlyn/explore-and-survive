/**
 * Checkpoints — the settlements' beacons as goals. Walking up to one claims
 * it: its lamp turns from blinking amber to steady green and it counts
 * towards the tally. The player comes back after dying at whichever beacon
 * they last stood by.
 */

import type { Checkpoint } from '../world/CheckpointPlan';

/** a beacon is claimed from this close (m) */
export const CLAIM_RADIUS = 3;

export interface CheckpointView {
  claim(index: number): void;
}

export class Checkpoints {
  private readonly claimed = new Set<number>();
  private lastV: Checkpoint | null = null;

  constructor(
    readonly spots: readonly Checkpoint[],
    private readonly view: CheckpointView,
  ) {}

  get count(): number {
    return this.claimed.size;
  }

  get total(): number {
    return this.spots.length;
  }

  /** the last one stood by, where the player respawns */
  get last(): Checkpoint | null {
    return this.lastV;
  }

  isClaimed(index: number): boolean {
    return this.claimed.has(index);
  }

  /** the player stands at (x, z): the checkpoint they've just claimed, if any */
  reach(x: number, z: number): Checkpoint | null {
    for (const [i, c] of this.spots.entries()) {
      if (Math.hypot(c.x - x, c.z - z) > CLAIM_RADIUS) continue;
      this.lastV = c;
      if (this.claimed.has(i)) return null;
      this.claimed.add(i);
      this.view.claim(i);
      return c;
    }
    return null;
  }
}
