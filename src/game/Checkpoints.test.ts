import { describe, expect, it } from 'vitest';
import type { Checkpoint } from '../world/CheckpointPlan';
import { CLAIM_RADIUS, Checkpoints } from './Checkpoints';

const spots: Checkpoint[] = [
  { site: 0, x: 0, y: 0, z: 0 },
  { site: 2, x: 100, y: 5, z: 0 },
];

function setup(): { cps: Checkpoints; shown: number[] } {
  const shown: number[] = [];
  return { cps: new Checkpoints(spots, { claim: (i) => shown.push(i) }), shown };
}

describe('Checkpoints', () => {
  it('claims a beacon once, from close by', () => {
    const { cps, shown } = setup();
    expect(cps.reach(CLAIM_RADIUS + 0.1, 0)).toBeNull();
    expect(cps.reach(CLAIM_RADIUS - 0.1, 0)).toBe(spots[0]);
    expect(cps.reach(0, 0)).toBeNull();
    expect(shown).toEqual([0]);
    expect(cps.isClaimed(0)).toBe(true);
    expect(cps.isClaimed(1)).toBe(false);
    expect(cps.count).toBe(1);
    expect(cps.total).toBe(2);
  });

  it('respawns at the last one stood by, claimed before or not', () => {
    const { cps } = setup();
    expect(cps.last).toBeNull();
    cps.reach(100, 1);
    cps.reach(0, 0);
    expect(cps.last).toBe(spots[0]);
    expect(cps.reach(100, 0)).toBeNull();
    expect(cps.last).toBe(spots[1]);
    cps.reach(50, 0);
    expect(cps.last).toBe(spots[1]);
  });
});
