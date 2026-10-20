/**
 * Game — owns input and decides who drives the camera: the player (normal
 * play) or the free-fly camera (debug/tooling). `V` toggles between them,
 * `P` logs the current pose as a `?cam=` string.
 *
 * Programmatic poses (bookmarks, ?cam=, probes) always switch to fly so the
 * tooling keeps free-placement semantics. The world (terrain, physics, the
 * player) attaches after the scene is built; until then only fly exists.
 */

import type { PerspectiveCamera } from 'three';
import { FlyCamera } from '../core/FlyCamera';
import type { CamPose } from '../core/Hooks';
import { formatCamString } from '../core/Params';
import { Input } from '../core/Input';
import { sampleGrid } from '../world/GridSample';
import { FirstPersonRig } from './FirstPersonRig';
import { ObstacleStreamer, type ObstacleField } from './Obstacles';
import { loadRapier, Physics, type TerrainGrid } from './Physics';
import { Player } from './Player';
import { PlayerMotor } from './PlayerMotor';

/** what a world scene hands the game layer */
export interface GameWorld {
  terrain: TerrainGrid;
  waterAt: (x: number, z: number) => number;
  /** trunks, rocks, logs… — absent in scenes without vegetation */
  obstacles?: ObstacleField;
}

export type ControlMode = 'play' | 'fly';

interface Attached {
  world: GameWorld;
  physics: Physics;
  motor: PlayerMotor;
  player: Player;
  rig: FirstPersonRig;
  obstacles: ObstacleStreamer | null;
}

export class Game {
  readonly input: Input;
  readonly fly: FlyCamera;
  private modeV: ControlMode = 'fly';
  private attached: Attached | null = null;

  constructor(private readonly camera: PerspectiveCamera, dom: HTMLElement) {
    this.input = new Input(dom);
    this.fly = new FlyCamera(camera);
  }

  get mode(): ControlMode {
    return this.modeV;
  }

  async attachWorld(world: GameWorld): Promise<void> {
    const rapier = await loadRapier();
    const physics = new Physics(rapier, world.terrain);
    const motor = new PlayerMotor(rapier, physics.world, world.waterAt);
    const player = new Player(motor, () => physics.step());
    const obstacles = world.obstacles
      ? new ObstacleStreamer(rapier, physics.world, world.obstacles)
      : null;
    this.attached = {
      world,
      physics,
      motor,
      player,
      rig: new FirstPersonRig(this.camera),
      obstacles,
    };
  }

  update(dt: number): void {
    const input = this.input;
    if (input.takePress('KeyP')) {
      // eslint-disable-next-line no-console
      console.log(`[pose] cam=${formatCamString(this.getPose())}`);
    }
    // tooling (flythrough) owns the camera while input is disabled
    if (!input.enabled) {
      input.endFrame();
      return;
    }
    if (input.takePress('KeyV')) {
      if (this.modeV === 'play') this.setPose(this.getPose());
      else this.play();
    }

    const a = this.attached;
    if (this.modeV === 'play' && a) {
      a.obstacles?.update(a.player.eye.x, a.player.eye.z);
      a.player.update(dt, input);
      a.rig.update(dt, a.player);
    } else {
      this.fly.update(dt, input);
    }
    input.endFrame();
  }

  /** hand control to the player, standing on the ground under the fly camera */
  play(): void {
    const a = this.attached;
    if (!a) {
      // eslint-disable-next-line no-console
      console.warn('[laas] play mode unavailable — no world in this scene');
      return;
    }
    const { x, z } = this.camera.position;
    a.obstacles?.update(x, z);
    a.physics.step(); // new colliders reach queries only after a step
    const { heights, res, worldSize } = a.world.terrain;
    const spot = a.motor.clearSpotNear(
      x,
      z,
      (px, pz) => a.physics.terrainY(px, pz) ?? sampleGrid(heights, res, worldSize, px, pz),
    );
    a.player.spawn(spot.x, spot.y, spot.z, this.fly.yaw, this.fly.pitch);
    a.rig.baseFov = this.fly.baseFov;
    a.rig.reset();
    a.rig.update(0, a.player);
    this.modeV = 'play';
    // eslint-disable-next-line no-console
    console.log('[laas] control: play (V toggles fly)');
  }

  /** place the free camera; programmatic poses always mean fly */
  setPose(pose: CamPose): void {
    if (this.modeV === 'play') {
      this.modeV = 'fly';
      // eslint-disable-next-line no-console
      console.log('[laas] control: fly (V toggles play)');
    }
    this.fly.setPose(pose);
  }

  getPose(): CamPose {
    const a = this.attached;
    if (this.modeV === 'play' && a) {
      const { eye, yaw, pitch } = a.player;
      return { p: [eye.x, eye.y, eye.z], yaw, pitch, fov: a.rig.baseFov };
    }
    return this.fly.getPose();
  }
}
