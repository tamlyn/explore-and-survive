/**
 * Enemies — where the robots start: a few guarding every settlement, and
 * strays roaming the wilds between. Pure layout like PropPlan; how they
 * behave belongs to the game layer (see Enemies).
 */

import type { Rng } from '../core/Seed';
import { type Ground, type RuinSite, streamRng } from './RuinPlan';
import { TREELINE, WORLD_HALF } from './WorldConst';

export type RobotKind = 'walker' | 'walkerGun' | 'brute' | 'bruteGun' | 'drone' | 'droneGun';

export interface EnemySpawn {
  kind: RobotKind;
  x: number;
  z: number;
  /** patrols within this of where it starts (m) */
  roam: number;
}

const GUARDS: [RobotKind, number][] = [
  ['walkerGun', 3],
  ['walker', 2],
  ['droneGun', 1.5],
  ['drone', 1],
  ['bruteGun', 0.7],
  ['brute', 0.7],
];
const STRAYS: [RobotKind, number][] = [
  ['walker', 2],
  ['walkerGun', 1.5],
  ['drone', 1.5],
];
const MAX_GUARDS = 5;
/** guards start within this of the settlement's centre (m) */
const GUARD_SPREAD = 18;
const GUARD_ROAM = 14;
const STRAY_COUNT = 30;
const STRAY_ROAM = 40;
/** strays keep this far from settlements, which have their own guards (m) */
const STRAY_CLEAR = 80;
/** nothing starts this close to the player (m) */
export const SAFE_RADIUS = 50;

function pick(rng: Rng, table: [RobotKind, number][]): RobotKind {
  const total = table.reduce((t, [, w]) => t + w, 0);
  let r = rng.float() * total;
  for (const [kind, w] of table) {
    r -= w;
    if (r < 0) return kind;
  }
  return table[0]![0];
}

export function planEnemies(sites: RuinSite[], ground: Ground, seed: number, spawn: { x: number; z: number }): EnemySpawn[] {
  const dry = (x: number, z: number): boolean => ground.water(x, z) < ground.height(x, z) - 0.1;
  const safe = (x: number, z: number): boolean => Math.hypot(x - spawn.x, z - spawn.z) > SAFE_RADIUS;
  const enemies: EnemySpawn[] = [];

  for (const site of sites) {
    const rng = streamRng(seed, `${Math.round(site.x)},${Math.round(site.z)}`);
    const want = Math.min(MAX_GUARDS, 1 + site.buildings.length + rng.int(2));
    for (let tries = 0, n = 0; tries < want * 6 && n < want; tries++) {
      const a = rng.float() * Math.PI * 2;
      const d = rng.range(2, GUARD_SPREAD);
      const x = site.x + Math.cos(a) * d;
      const z = site.z + Math.sin(a) * d;
      if (!dry(x, z) || !safe(x, z)) continue;
      enemies.push({ kind: pick(rng, GUARDS), x, z, roam: GUARD_ROAM });
      n++;
    }
  }

  const rng = streamRng(seed, 'strays');
  for (let tries = 0, n = 0; tries < STRAY_COUNT * 20 && n < STRAY_COUNT; tries++) {
    const x = rng.range(-1, 1) * (WORLD_HALF - 100);
    const z = rng.range(-1, 1) * (WORLD_HALF - 100);
    if (!dry(x, z) || !safe(x, z) || ground.height(x, z) > TREELINE) continue;
    if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < STRAY_CLEAR)) continue;
    enemies.push({ kind: pick(rng, STRAYS), x, z, roam: STRAY_ROAM });
    n++;
  }
  return enemies;
}
