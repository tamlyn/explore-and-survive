/**
 * Vehicle specs — what each vehicle is like to buy and drive. Positions are
 * in the vehicle's own frame, as its model is laid out (see
 * tools/blender/vehicles.py): x right, y up, the front at −z, the ground
 * under the wheels at y = 0 and the wheelbase centred on the origin.
 */

import type { Vec3 } from './PlayerMotor';

export type VehicleKind = 'buggy' | 'rover';

export interface WheelSpec {
  /** the hub at rest */
  at: Vec3;
  radius: number;
  steers: boolean;
  drives: boolean;
}

export interface VehicleSpec {
  name: string;
  /** metal */
  price: number;
  hp: number;
  /** kg */
  mass: number;
  /** the collider: a box about `centre` */
  hull: { centre: Vec3; half: Vec3 };
  /** the centre of mass, kept low so it doesn't roll over at every bend */
  balance: Vec3;
  /** front left, front right, rear left, rear right */
  wheels: WheelSpec[];
  /** how far the springs stretch beyond the wheels' rest (m), and how stiff
   *  and damped they are (per unit of mass, as Rapier wants) */
  suspension: { travel: number; stiffness: number; compression: number; relaxation: number };
  /** driving force on each driven wheel (N) */
  engine: number;
  /** braking impulse on each wheel */
  brake: number;
  /** grip before a tyre slides */
  grip: number;
  /** m/s, forwards; reverse goes at a third of it */
  topSpeed: number;
  /** most the front wheels turn (rad), at a crawl */
  steer: number;
  /** the driver's eye */
  seat: Vec3;
  /** where the driver steps out, beside their door */
  exit: Vec3;
  /** how far behind the third-person camera follows, and how high above
   *  the car's base it looks (m) */
  chase: { distance: number; height: number };
}

const wheels = (front: Vec3, rear: Vec3, frontR: number, rearR: number, fourByFour: boolean): WheelSpec[] => [
  { at: { ...front, x: -front.x }, radius: frontR, steers: true, drives: fourByFour },
  { at: front, radius: frontR, steers: true, drives: fourByFour },
  { at: { ...rear, x: -rear.x }, radius: rearR, steers: false, drives: true },
  { at: rear, radius: rearR, steers: false, drives: true },
];

export const VEHICLES: Record<VehicleKind, VehicleSpec> = {
  buggy: {
    name: 'buggy',
    price: 15,
    hp: 250,
    mass: 600,
    hull: { centre: { x: 0, y: 0.85, z: 0.15 }, half: { x: 0.9, y: 0.5, z: 1.45 } },
    balance: { x: 0, y: 0.3, z: 0.1 },
    wheels: wheels({ x: 0.55, y: 0.255, z: -1.03 }, { x: 0.76, y: 0.37, z: 1.03 }, 0.253, 0.31, false),
    suspension: { travel: 0.3, stiffness: 30, compression: 2.4, relaxation: 3 },
    engine: 2800,
    brake: 25,
    grip: 2.6,
    topSpeed: 24,
    steer: 0.6,
    seat: { x: -0.3, y: 1.02, z: 0.3 },
    exit: { x: -1.5, y: 0, z: 0.1 },
    chase: { distance: 6, height: 1.4 },
  },
  rover: {
    name: 'Range Rover',
    price: 30,
    hp: 500,
    mass: 1800,
    hull: { centre: { x: 0, y: 1.1, z: 0.25 }, half: { x: 0.88, y: 0.75, z: 2.15 } },
    balance: { x: 0, y: 0.45, z: 0.1 },
    wheels: wheels({ x: 0.708, y: 0.37, z: -1.229 }, { x: 0.708, y: 0.37, z: 1.229 }, 0.37, 0.37, true),
    suspension: { travel: 0.25, stiffness: 28, compression: 2.4, relaxation: 3 },
    engine: 3400,
    brake: 60,
    grip: 2.2,
    topSpeed: 20,
    steer: 0.5,
    seat: { x: -0.4, y: 1.38, z: 0.35 },
    exit: { x: -1.6, y: 0, z: 0 },
    chase: { distance: 7.5, height: 1.8 },
  },
};

export const KINDS = Object.keys(VEHICLES) as VehicleKind[];
