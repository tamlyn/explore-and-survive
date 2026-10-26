/**
 * Garage — buying vehicles for metal at a beacon the player has claimed. B
 * opens the list there, a number buys, and the car is put down beside the
 * beacon, nose away from it. The list closes on walking off.
 */

import type { Checkpoint } from '../world/CheckpointPlan';
import type { Checkpoints } from './Checkpoints';
import type { GameHud } from './GameHud';
import type { Material } from './Loot';
import type { PlayerInput } from './Player';
import type { Vec3 } from './PlayerMotor';
import type { Sfx } from './Sfx';
import type { Vehicles } from './Vehicles';
import { KINDS, VEHICLES } from './VehicleSpec';

/** how near a claimed beacon the player shops (m) */
export const SHOP_REACH = 5;
/** a car bought is put down about this far from the beacon (m) */
const BESIDE = 4;

export interface GarageParts {
  vehicles: Pick<Vehicles, 'place'>;
  checkpoints: Pick<Checkpoints, 'claimedNear'>;
  hud: Pick<GameHud, 'toast' | 'carry' | 'shop'>;
  sfx: Pick<Sfx, 'click' | 'chime'>;
}

export class Garage {
  private openV = false;

  constructor(
    private readonly parts: GarageParts,
    private readonly wallet: Record<Material, number>,
  ) {}

  get open(): boolean {
    return this.openV;
  }

  /** the claimed beacon the player at `feet` can shop at, if any */
  at(feet: Vec3): Checkpoint | null {
    return this.parts.checkpoints.claimedNear(feet.x, feet.z, SHOP_REACH);
  }

  /** once per frame on foot, before the arsenal: while the list is open,
   *  the number keys buy rather than pick a tool */
  update(input: PlayerInput, feet: Vec3): void {
    const beacon = this.at(feet);
    if (!beacon) {
      this.close();
      return;
    }
    if (input.takePress('KeyB')) {
      if (this.openV) this.close();
      else this.show();
    }
    if (!this.openV) return;
    KINDS.forEach((kind, i) => {
      if (input.takePress(`Digit${i + 1}`)) this.buy(kind, beacon, feet);
    });
  }

  close(): void {
    if (!this.openV) return;
    this.openV = false;
    this.parts.hud.shop(null);
  }

  private show(): void {
    this.openV = true;
    const width = Math.max(...KINDS.map((k) => VEHICLES[k].name.length)) + 2;
    this.parts.hud.shop([
      'Vehicles',
      '',
      ...KINDS.map((k, i) => {
        const { name, price } = VEHICLES[k];
        const short = this.wallet.metal < price ? '   (not enough)' : '';
        return `${i + 1}  ${name[0]!.toUpperCase()}${name.slice(1).padEnd(width - 1)}${String(price).padStart(3)} metal${short}`;
      }),
      '',
      `You have ${this.wallet.metal} metal · B closes`,
    ]);
  }

  private buy(kind: (typeof KINDS)[number], beacon: Checkpoint, feet: Vec3): void {
    const { name, price } = VEHICLES[kind];
    const { hud, sfx, vehicles } = this.parts;
    if (this.wallet.metal < price) {
      hud.toast(`The ${name} takes ${price} metal`);
      sfx.click();
      return;
    }
    // beside the beacon, on the player's side of it, nose pointing away
    const dx = feet.x - beacon.x;
    const dz = feet.z - beacon.z;
    const d = Math.hypot(dx, dz) || 1;
    const yaw = Math.atan2(-dx, -dz);
    if (!vehicles.place(kind, beacon.x + (dx / d) * BESIDE, beacon.z + (dz / d) * BESIDE, yaw)) {
      hud.toast('No room to put it down here');
      sfx.click();
      return;
    }
    this.wallet.metal -= price;
    hud.carry(this.wallet);
    hud.toast(`Bought a ${name} · E to get in`);
    sfx.chime();
    this.close();
  }
}
