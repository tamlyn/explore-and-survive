/**
 * Game — owns input and decides who drives the camera: the player (normal
 * play, armed — see Gunplay) or the free-fly camera (debug/tooling). `V`
 * toggles between them, `P` logs the current pose as a `?cam=` string.
 *
 * Programmatic poses (bookmarks, ?cam=, probes) always switch to fly so the
 * tooling keeps free-placement semantics. The world (terrain, physics, the
 * player) attaches after the scene is built; until then only fly exists.
 */

import type { PerspectiveCamera, Scene } from 'three';
import { FlyCamera } from '../core/FlyCamera';
import type { CamPose } from '../core/Hooks';
import { formatCamString } from '../core/Params';
import { Input } from '../core/Input';
import { sampleGrid } from '../world/GridSample';
import { FirstPersonRig } from './FirstPersonRig';
import { GameHud } from './GameHud';
import { Gunplay } from './Gunplay';
import { Impacts } from './Impacts';
import { ObstacleStreamer, type ObstacleField } from './Obstacles';
import { loadRapier, Physics, type TerrainGrid } from './Physics';
import { Player } from './Player';
import { PlayerMotor } from './PlayerMotor';
import { Sfx } from './Sfx';
import { Viewmodel, type WorldLights } from './Viewmodel';
import { PISTOL, Weapon } from './Weapon';

/** what a world scene hands the game layer */
export interface GameWorld {
  terrain: TerrainGrid;
  waterAt: (x: number, z: number) => number;
  /** trunks, rocks, logs… — absent in scenes without vegetation */
  obstacles?: ObstacleField;
  /** the sun and ambient, mirrored onto the viewmodel */
  lights?: WorldLights;
}

export type ControlMode = 'play' | 'fly';

/** trunks within CANOPY_R that make full canopy */
const CANOPY_TRUNKS = 6;
const CANOPY_R = 7;

interface Attached {
  world: GameWorld;
  physics: Physics;
  motor: PlayerMotor;
  player: Player;
  rig: FirstPersonRig;
  obstacles: ObstacleStreamer | null;
  gunplay: Gunplay;
  impacts: Impacts;
}

export class Game {
  readonly input: Input;
  readonly fly: FlyCamera;
  /** drawn over the world by the post stack */
  readonly viewmodel: Viewmodel;
  private modeV: ControlMode = 'fly';
  private attached: Attached | null = null;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly scene: Scene,
    dom: HTMLElement,
  ) {
    this.input = new Input(dom);
    this.fly = new FlyCamera(camera);
    this.viewmodel = new Viewmodel(camera, scene);
    this.viewmodel.scene.visible = false;
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
      ? new ObstacleStreamer(physics, world.obstacles)
      : null;
    // the gun is cosmetic: without its model, play still works
    await this.viewmodel.load().catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[laas] viewmodel failed to load', e);
    });
    this.viewmodel.lights = world.lights ?? null;
    const impacts = new Impacts(this.scene);
    const gunplay = new Gunplay(
      { weapon: new Weapon(PISTOL), viewmodel: this.viewmodel, impacts, sfx: new Sfx(), hud: new GameHud() },
      { physics, obstacles: world.obstacles, waterAt: world.waterAt, shooter: motor.collider },
    );
    this.attached = {
      world,
      physics,
      motor,
      player,
      rig: new FirstPersonRig(this.camera),
      obstacles,
      gunplay,
      impacts,
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
      a.gunplay.update(dt, input, a.player);
      a.rig.update(dt, a.player);
      const trunks = a.world.obstacles?.trunksNear(a.player.eye.x, a.player.eye.z, CANOPY_R) ?? 0;
      this.viewmodel.canopy = Math.min(1, trunks / CANOPY_TRUNKS);
      a.gunplay.updateView(dt, a.player);
    } else {
      this.fly.update(dt, input);
    }
    // puffs are part of the world: they finish fading whoever has the camera
    a?.impacts.update(dt);
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
    this.viewmodel.reset();
    this.modeV = 'play';
    a.gunplay.active = true;
    // eslint-disable-next-line no-console
    console.log('[laas] control: play (V toggles fly)');
  }

  /** place the free camera; programmatic poses always mean fly */
  setPose(pose: CamPose): void {
    if (this.modeV === 'play') {
      this.modeV = 'fly';
      if (this.attached) this.attached.gunplay.active = false;
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
