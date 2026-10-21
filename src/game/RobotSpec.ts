/**
 * Robot specs — what each kind is like to fight. Kinds carrying a gun shoot
 * from range; the rest close in and strike. Walkers are the rank and file,
 * brutes slow and tough, drones quick, fragile and airborne.
 */

import type { RobotKind } from '../world/EnemyPlan';

export interface Attack {
  ranged: boolean;
  /** attacks from within this distance (m) */
  range: number;
  damage: number;
  /** between attacks (s) */
  interval: number;
  /** from starting an attack to it landing (s) */
  windup: number;
  /** aim error, cone half-angle (rad), at a target standing still */
  spread: number;
}

export interface RobotSpec {
  hp: number;
  /** m/s */
  walk: number;
  run: number;
  /** rad/s */
  turn: number;
  /** model scale */
  scale: number;
  /** collision capsule (m) */
  radius: number;
  halfHeight: number;
  /** flies this far above the ground; 0 walks */
  hover: number;
  /** sensor height above the capsule's base (m) */
  eye: number;
  /** m */
  sight: number;
  attack: Attack;
}

const walker = { walk: 1.6, run: 5, turn: 4, scale: 1.6, radius: 0.6, halfHeight: 0.1, hover: 0, eye: 0.85, sight: 45 };
const brute = { walk: 1.2, run: 3.2, turn: 2.2, scale: 1.7, radius: 0.75, halfHeight: 0.3, hover: 0, eye: 1.1, sight: 45 };
const drone = { walk: 2, run: 6, turn: 5, scale: 1.4, radius: 0.5, halfHeight: 0.05, hover: 2.2, eye: 0.5, sight: 40 };

export const ROBOTS: Record<RobotKind, RobotSpec> = {
  walker: { ...walker, hp: 50, attack: { ranged: false, range: 1.7, damage: 15, interval: 1.2, windup: 0.45, spread: 0 } },
  walkerGun: { ...walker, hp: 60, attack: { ranged: true, range: 35, damage: 7, interval: 0.9, windup: 0.12, spread: 0.035 } },
  brute: { ...brute, hp: 160, attack: { ranged: false, range: 2.3, damage: 30, interval: 1.8, windup: 0.6, spread: 0 } },
  bruteGun: { ...brute, hp: 180, attack: { ranged: true, range: 45, damage: 14, interval: 1.6, windup: 0.12, spread: 0.03 } },
  drone: { ...drone, hp: 30, attack: { ranged: false, range: 1.6, damage: 8, interval: 0.9, windup: 0.35, spread: 0 } },
  droneGun: { ...drone, hp: 35, attack: { ranged: true, range: 30, damage: 5, interval: 0.6, windup: 0.12, spread: 0.05 } },
};
