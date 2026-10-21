/**
 * Game — owns input and decides who drives the camera: the player (normal
 * play, armed — see Gunplay) or the free-fly camera (debug/tooling). `V`
 * toggles between them, `Y` inverts mouse look, `H` shows the controls.
 * `P` copies a playtest report of where the camera is (as a `?cam=` string,
 * which boots back to it) and what it's looking at, in the names Places and
 * Enemies give things; the F3 panel shows the same live.
 *
 * The player's fixed physics tick advances the whole world, robots
 * included, so in fly mode the robots hold still. The player has health;
 * dying costs a few seconds and puts them back at the spawn.
 *
 * Programmatic poses (bookmarks, ?cam=, probes) always switch to fly so the
 * tooling keeps free-placement semantics. The world (terrain, physics, the
 * player) attaches after the scene is built; until then only fly exists.
 */

import type { PerspectiveCamera, Scene } from 'three';
import { aimDirection, bearing } from '../core/CameraAim';
import { FlyCamera } from '../core/FlyCamera';
import type { CamPose } from '../core/Hooks';
import { formatCamString } from '../core/Params';
import { Input } from '../core/Input';
import type { EnemySpawn } from '../world/EnemyPlan';
import { sampleGrid } from '../world/GridSample';
import { compass, heading, type Places } from '../world/Places';
import { ControlsCard } from './ControlsCard';
import { Enemies, type EnemyTarget, type RobotViews, SLEEP_RADIUS } from './Enemies';
import { FirstPersonRig } from './FirstPersonRig';
import { GameHud } from './GameHud';
import { Gunplay } from './Gunplay';
import { Health } from './Health';
import { Impacts } from './Impacts';
import { ObstacleStreamer, type ObstacleField } from './Obstacles';
import type { Box } from '../world/Box';
import { boxColliderDesc, loadRapier, Physics, type Surface, type TerrainGrid } from './Physics';
import { FIXED_DT, Player, type PlayerInput } from './Player';
import { PlayerMotor, type Vec3 } from './PlayerMotor';
import { Sfx } from './Sfx';
import { type ImpactSurface, traceShot } from './Shot';
import { Tracers } from './Tracers';
import { Viewmodel, type WorldLights } from './Viewmodel';
import { PISTOL, Weapon } from './Weapon';

/** what a world scene hands the game layer */
export interface GameWorld {
  terrain: TerrainGrid;
  waterAt: (x: number, z: number) => number;
  /** trunks, rocks, logs… — absent in scenes without vegetation */
  obstacles?: ObstacleField;
  /** man-made solids (ruined walls, props), few enough to stay in physics for good */
  structures?: (Box & { surface: Surface })[];
  /** the sun and ambient, mirrored onto the viewmodel */
  lights?: WorldLights;
  /** where the player comes back after dying; yaw 0 looks −z */
  spawn: { x: number; z: number; yaw: number };
  /** the robots and how to draw them — absent in scenes without them */
  enemies?: { spawns: EnemySpawn[]; views: RobotViews };
  /** names for the settlements and what stands in them */
  places?: Places;
}

export type ControlMode = 'play' | 'fly';

/** trunks within CANOPY_R that make full canopy */
const CANOPY_TRUNKS = 6;
const CANOPY_R = 7;
const PLAYER_HP = 100;
const PLAYER_REGEN = { delay: 5, rate: 8 };
/** dead this long before coming back (s) */
const RESPAWN_DELAY = 4;
/** robots aim this far above the player's feet (m) */
const CHEST = 1.3;
/** how far "looking at" looks (m) */
const LOOK_RANGE = 1000;

/** what a ray stopped on, when nothing more specific stands there */
const SURFACE_NAMES: Record<ImpactSurface, string> = {
  ground: 'ground',
  wood: 'tree or log',
  stone: 'rock',
  metal: 'metal',
  rubber: 'rubber',
  water: 'water',
};

/** what the player does while dead: nothing */
const STILL: PlayerInput = {
  held: () => false,
  takePress: () => false,
  takeLook: () => ({ yaw: 0, pitch: 0 }),
};

interface Attached {
  world: GameWorld;
  physics: Physics;
  motor: PlayerMotor;
  player: Player;
  rig: FirstPersonRig;
  obstacles: ObstacleStreamer | null;
  gunplay: Gunplay;
  impacts: Impacts;
  tracers: Tracers;
  health: Health;
  hud: GameHud;
  sfx: Sfx;
  enemies: Enemies | null;
  /** seconds since dying, while dead */
  deadFor: number;
}

export class Game {
  readonly input: Input;
  readonly fly: FlyCamera;
  /** drawn over the world by the post stack */
  readonly viewmodel: Viewmodel;
  private modeV: ControlMode = 'fly';
  private attached: Attached | null = null;
  private readonly controls = new ControlsCard();

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
    for (const box of world.structures ?? []) physics.addCollider(boxColliderDesc(rapier, box), box.surface);
    const motor = new PlayerMotor(rapier, physics.world, world.waterAt);
    const health = new Health(PLAYER_HP, PLAYER_REGEN);
    const hud = new GameHud();
    const sfx = new Sfx();
    const impacts = new Impacts(this.scene);
    const tracers = new Tracers(this.scene);
    const aim: Vec3 = { x: 0, y: 0, z: 0 };
    let player: Player | null = null;
    const target: EnemyTarget = {
      get aim() {
        aim.x = motor.feet.x;
        aim.y = motor.feet.y + CHEST;
        aim.z = motor.feet.z;
        return aim;
      },
      get speed() {
        return player?.speed ?? 0;
      },
      get alive() {
        return !health.dead;
      },
      hurt: (damage, from) => {
        if (health.dead) return;
        health.hurt(damage);
        hud.hurt(bearing(from.x, from.z, motor.feet.x, motor.feet.z, player?.yaw ?? 0));
        sfx.hurt();
      },
    };
    physics.tag(motor.collider, null, target);
    const { heights, res, worldSize } = world.terrain;
    const groundAt = (x: number, z: number): number =>
      physics.terrainY(x, z) ?? sampleGrid(heights, res, worldSize, x, z);
    const enemies = world.enemies
      ? new Enemies(
          world.enemies.spawns,
          physics,
          {
            physics,
            obstacles: world.obstacles,
            waterAt: world.waterAt,
            groundAt,
          },
          world.enemies.views,
          target,
          {
            shot: (from, to, hit) => {
              tracers.spawn(from, to);
              if (hit && hit.target !== target) impacts.spawn(hit);
              sfx.zap(from);
            },
            destroyed: (at) => sfx.powerDown(at),
          },
        )
      : null;
    player = new Player(motor, () => {
      enemies?.tick(FIXED_DT);
      physics.step();
    });
    // robots walk among the trees as far out as they stay awake
    const obstacles = world.obstacles
      ? new ObstacleStreamer(physics, world.obstacles, enemies ? SLEEP_RADIUS + 6 : undefined)
      : null;
    // the gun is cosmetic: without its model, play still works
    await this.viewmodel.load().catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[laas] viewmodel failed to load', e);
    });
    this.viewmodel.lights = world.lights ?? null;
    const gunplay = new Gunplay(
      { weapon: new Weapon(PISTOL), viewmodel: this.viewmodel, impacts, sfx, hud },
      { physics, obstacles: world.obstacles, waterAt: world.waterAt },
      motor.collider,
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
      tracers,
      health,
      hud,
      sfx,
      enemies,
      deadFor: 0,
    };
  }

  get enemies(): Enemies | null {
    return this.attached?.enemies ?? null;
  }

  update(dt: number): void {
    const input = this.input;
    if (input.takePress('KeyP')) this.report();
    if (input.takePress('KeyH') || input.takePress('Slash')) this.controls.toggle();
    if (input.takePress('KeyY')) {
      input.invertY = !input.invertY;
      this.attached?.hud.toast(input.invertY ? 'Mouse look inverted' : 'Mouse look normal');
      // eslint-disable-next-line no-console
      console.log(`[laas] invert Y ${input.invertY ? 'on' : 'off'}`);
    }
    // tooling (flythrough) owns the camera while input is disabled
    if (!input.enabled) {
      input.endFrame();
      return;
    }
    const dead = this.attached?.health.dead ?? false;
    if (input.takePress('KeyV') && !dead) {
      if (this.modeV === 'play') this.setPose(this.getPose());
      else this.play();
    }

    const a = this.attached;
    if (this.modeV === 'play' && a) {
      const { player } = a;
      a.obstacles?.update(player.eye.x, player.eye.z);
      if (a.health.dead) {
        input.takeLook(); // no turning the corpse, nor a snap on respawn
        this.whileDead(dt, a);
      } else {
        player.update(dt, input);
        // robots act inside the physics tick, so this frame may have killed
        if (a.health.dead) this.die(a);
        else if (a.gunplay.update(dt, input, player)) a.enemies?.hear(player.eye);
      }
      a.rig.update(dt, player);
      const trunks = a.world.obstacles?.trunksNear(player.eye.x, player.eye.z, CANOPY_R) ?? 0;
      this.viewmodel.canopy = Math.min(1, trunks / CANOPY_TRUNKS);
      a.gunplay.updateView(dt, player);
      a.health.update(dt);
      a.hud.updateVitals(dt, a.health.hp, a.health.max);
      Object.assign(a.sfx.listener, { x: player.eye.x, z: player.eye.z, yaw: player.yaw });
    } else {
      this.fly.update(dt, input);
    }
    // the world goes on whoever has the camera: puffs and streaks finish
    // fading, and robots near the flying camera show
    a?.impacts.update(dt);
    a?.tracers.update(dt);
    a?.hud.updateToast(dt);
    a?.enemies?.update(dt, this.modeV === 'play' ? a.player.eye : this.camera.position);
    input.endFrame();
  }

  private die(a: Attached): void {
    a.deadFor = 0;
    a.gunplay.active = false;
    a.hud.visible = true;
    a.hud.dead = true;
  }

  /** the body lies still while the world carries on, then back to the spawn */
  private whileDead(dt: number, a: Attached): void {
    a.player.update(dt, STILL);
    a.deadFor += dt;
    if (a.deadFor < RESPAWN_DELAY) return;
    const { x, z, yaw } = a.world.spawn;
    const spot = this.spotNear(a, x, z);
    a.player.spawn(spot.x, spot.y, spot.z, yaw, 0);
    a.rig.reset();
    a.health.reset();
    a.enemies?.forget();
    a.hud.dead = false;
    a.gunplay.active = true;
  }

  private spotNear(a: Attached, x: number, z: number): Vec3 {
    a.obstacles?.update(x, z);
    a.physics.step(); // new colliders reach queries only after a step
    const { heights, res, worldSize } = a.world.terrain;
    return a.motor.clearSpotNear(
      x,
      z,
      (px, pz) => a.physics.terrainY(px, pz) ?? sampleGrid(heights, res, worldSize, px, pz),
    );
  }

  /** hand control to the player, standing on the ground under the fly camera */
  play(): void {
    const a = this.attached;
    if (!a) {
      // eslint-disable-next-line no-console
      console.warn('[laas] play mode unavailable — no world in this scene');
      return;
    }
    const spot = this.spotNear(a, this.camera.position.x, this.camera.position.z);
    a.player.spawn(spot.x, spot.y, spot.z, this.fly.yaw, this.fly.pitch);
    a.rig.baseFov = this.fly.baseFov;
    a.rig.reset();
    a.rig.update(0, a.player);
    if (a.health.dead) {
      a.health.reset();
      a.hud.dead = false;
      a.enemies?.forget();
    }
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

  /** where the camera is and what it's looking at, a line each */
  where(): string[] {
    const pose = this.getPose();
    const [x, y, z] = pose.p;
    const lines = [`at ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}  facing ${compass(heading(-Math.sin(pose.yaw), -Math.cos(pose.yaw)))}`];
    const a = this.attached;
    if (!a) return lines;
    const near = a.world.places?.nearest(x, z, 2) ?? [];
    if (near.length) {
      lines.push(`near ${near.map((s) => `${s.name} ${Math.round(s.distance)} m ${compass(s.heading)}`).join(', ')}`);
    }
    lines.push(`looking at ${this.lookingAt(a, pose)}`);
    return lines;
  }

  private lookingAt(a: Attached, pose: CamPose): string {
    const [x, y, z] = pose.p;
    // nothing steps the physics while flying, so robots woken since would
    // be invisible to the ray
    if (this.modeV === 'fly') a.physics.step();
    const hit = traceShot(
      { physics: a.physics, obstacles: a.world.obstacles, waterAt: a.world.waterAt },
      { x, y, z },
      aimDirection(pose.yaw, pose.pitch),
      LOOK_RANGE,
      a.motor.collider,
    );
    if (!hit) return 'sky';
    const built = hit.surface !== 'ground' && hit.surface !== 'water';
    const what =
      (hit.target && a.enemies?.describe(hit.target)) ??
      (built ? a.world.places?.at(hit.x, hit.z) : null) ??
      SURFACE_NAMES[hit.surface];
    return `${what}, ${Math.round(Math.hypot(hit.x - x, hit.y - y, hit.z - z))} m`;
  }

  /** logs the playtest report and copies it for pasting */
  private report(): void {
    const text = [`cam=${formatCamString(this.getPose())}`, ...this.where().slice(1)].join(' · ');
    // eslint-disable-next-line no-console
    console.log(`[where] ${text}`);
    const toast = (t: string): void => this.attached?.hud.toast(t);
    navigator.clipboard.writeText(text).then(
      () => toast('Location copied'),
      () => toast('Location logged to the console'),
    );
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
