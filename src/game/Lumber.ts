/**
 * Lumber — felling trees with the axe: bigger trunks take more blows and
 * give more wood. Each blow is counted per tree; the last one takes the tree
 * out of the world and hands it to `onFell` for the logs and the noise.
 */

import type RAPIER from '@dimforge/rapier3d-compat';
import type { Forestry } from './Melee';
import type { Trunk } from './Obstacles';

/** blows to fell a trunk */
export function chopsToFell(t: Trunk): number {
  return Math.min(8, Math.max(3, Math.round(t.radius * 14)));
}

export function woodIn(t: Trunk): number {
  return Math.min(9, Math.max(2, Math.round(t.height / 3)));
}

export interface Woodland {
  idOf(collider: RAPIER.Collider): number | null;
  trunk(id: number): Trunk | null;
  remove(id: number): void;
}

export class Lumber implements Forestry {
  private readonly blows = new Map<number, number>();

  constructor(
    private readonly woods: Woodland,
    private readonly onFell: (t: Trunk, from: { x: number; z: number }) => void,
  ) {}

  treeOf(collider: RAPIER.Collider): number | null {
    const id = this.woods.idOf(collider);
    return id !== null && this.woods.trunk(id) ? id : null;
  }

  chop(id: number, from: { x: number; z: number }): void {
    const trunk = this.woods.trunk(id);
    if (!trunk) return;
    const n = (this.blows.get(id) ?? 0) + 1;
    if (n < chopsToFell(trunk)) {
      this.blows.set(id, n);
      return;
    }
    this.blows.delete(id);
    this.woods.remove(id);
    this.onFell(trunk, from);
  }
}
