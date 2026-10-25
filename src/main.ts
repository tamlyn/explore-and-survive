/** LAAS entry point — boot sequence with fail-loud diagnostics. */

import { BootUI } from './core/BootUI';
import { browserGate } from './core/BrowserGate';
import {
  describeDiagnostics,
  failLoud,
  installGlobalErrorHooks,
  probeWebGPU,
} from './core/Diagnostics';
import { Engine } from './core/Engine';
import { initHooks } from './core/Hooks';
import { parseCamString, parseParams } from './core/Params';
import { WorldSeed } from './core/Seed';
import { Hud } from './debug/HUD';
import { buildGalleryScene } from './debug/GalleryScene';
import { buildSanityScene } from './debug/SanityScene';
import { buildShadowTestScene } from './debug/ShadowTestScene';
import { buildTerrainScene } from './debug/TerrainScene';
import { buildScene, registerScene, type WorldContext } from './debug/Scenes';
import { Game } from './game/Game';

async function boot(): Promise<void> {
  const hooks = initHooks();
  installGlobalErrorHooks();
  // environment gate BEFORE any loading: mobile / non-Chromium / missing
  // WebGPU each get a clear notice instead of a broken boot (?nogate=1 skips)
  if (!browserGate()) return;
  const params = parseParams();
  const bootUI = new BootUI(hooks);

  bootUI.set(0.02, 'probing WebGPU');
  const diag = await probeWebGPU();
  hooks.diag = diag;
  if (!diag.ok) {
    failLoud('WebGPU unavailable — LAAS has no fallback by design', [
      diag.reason ?? 'unknown reason',
      '',
      'Chrome exposes WebGPU here, but no usable GPU adapter came up. Check:',
      '  • chrome://gpu — WebGPU should read “Hardware accelerated”',
      '  • Settings → System → hardware acceleration ON, then relaunch',
      '  • update Chrome and the GPU driver',
    ]);
    return;
  }
  // eslint-disable-next-line no-console
  console.log('[laas] webgpu ok\n' + describeDiagnostics(diag).join('\n'));

  bootUI.set(0.08, 'creating renderer');
  const engine = await Engine.create(params, hooks);

  // the camera mover MUST register before any scene system: updateFns run
  // in registration order, and subsystems copy camera state in their own
  // updates — the mover has to run first or every copy is one frame stale
  // during interactive motion (clouds/aerial visibly lagged the camera).
  const game = new Game(engine.camera, engine.scene, engine.renderer.domElement);
  engine.onUpdate((dt) => game.update(dt));

  const seed = new WorldSeed(params.seed);
  registerScene('sanity', buildSanityScene);
  registerScene('terrain', buildTerrainScene);
  registerScene('gallery', buildGalleryScene);
  registerScene('shadowtest', buildShadowTestScene);
  // 'world' becomes the streamed open world once terrain tiles land.
  registerScene('world', buildTerrainScene);

  const ctx: WorldContext = {
    engine,
    params,
    seed,
    hooks,
    progress: (p, msg) => bootUI.set(0.1 + p * 0.85, msg),
    overlay: game.viewmodel,
  };
  await buildScene(params.scene, ctx);

  if (hooks.groundProbe) game.fly.groundProbe = hooks.groundProbe;
  if (ctx.gameWorld) {
    bootUI.set(0.96, 'physics: building colliders');
    const t0 = performance.now();
    await game.attachWorld(ctx.gameWorld);
    Object.assign((window as unknown as { __laasDbg?: object }).__laasDbg ?? {}, { game });
    // eslint-disable-next-line no-console
    console.log(`[laas] physics ready in ${(performance.now() - t0).toFixed(0)} ms`);
  }
  if (params.cam !== null) {
    const pose = parseCamString(params.cam);
    if (pose) game.setPose(pose); // explicit pose ⇒ fly semantics
  } else if (hooks.initialPose) {
    game.setPose(hooks.initialPose);
    // playing is the interactive default (V toggles fly); ?walk=0 keeps
    // tooling/legacy behavior
    const q = new URLSearchParams(window.location.search);
    if (hooks.initialPoseMode === 'walk' && q.get('walk') !== '0') game.play();
  }

  new Hud(engine, params).addProvider(() => game.where());

  hooks.setPose = (p) => game.setPose(p);
  hooks.getPose = () => game.getPose();
  hooks.playing = () => game.mode === 'play';
  hooks.settle = (frames?: number) => engine.settle(frames ?? 8);
  hooks.flyCamEnabled = (on) => {
    game.input.enabled = on;
  };

  engine.start();
  await engine.settle(6);
  bootUI.hide();
  hooks.ready = true;
  // eslint-disable-next-line no-console
  console.log('[laas] ready');
}

boot().catch((e: unknown) => {
  const msg = e instanceof Error ? `${e.message}\n\n${e.stack ?? ''}` : String(e);
  failLoud('Boot failed', [msg]);
});
