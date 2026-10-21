import { describe, expect, it } from 'vitest';
import { planEnemies, SAFE_RADIUS } from './EnemyPlan';
import { type Ground, planRuins } from './RuinPlan';

const flat: Ground = { height: () => 200, water: () => 0 };
const spawn = { x: 0, z: 0, yaw: 0 };

describe('planEnemies', () => {
  const sites = planRuins(flat, 5, spawn);
  const enemies = planEnemies(sites, flat, 5, spawn);

  it('is deterministic', () => {
    expect(planEnemies(sites, flat, 5, spawn)).toEqual(enemies);
  });

  it('guards every settlement beyond the spawn', () => {
    // the one planned in view of the spawn may be left quiet
    for (const s of sites.filter((s) => Math.hypot(s.x - spawn.x, s.z - spawn.z) > SAFE_RADIUS + 20)) {
      expect(enemies.some((e) => Math.hypot(e.x - s.x, e.z - s.z) < 20)).toBe(true);
    }
  });

  it('leaves some to roam far from any settlement', () => {
    const strays = enemies.filter((e) => sites.every((s) => Math.hypot(e.x - s.x, e.z - s.z) > 60));
    expect(strays.length).toBeGreaterThan(10);
  });

  it('keeps clear of the spawn', () => {
    for (const e of enemies) expect(Math.hypot(e.x - spawn.x, e.z - spawn.z)).toBeGreaterThan(SAFE_RADIUS);
  });

  it('starts nobody in water', () => {
    // a lake over the west half of the map
    const lake: Ground = { height: () => 200, water: (x) => (x < 0 ? 205 : 0) };
    const wet = planEnemies(planRuins(flat, 5, spawn), lake, 5, spawn);
    expect(wet.length).toBeGreaterThan(0);
    expect(wet.every((e) => e.x >= 0)).toBe(true);
  });
});
