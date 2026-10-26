/**
 * Smoke test — boots the default game spawn and checks the player actually
 * plays: starts in play mode, the world has ruins and robots, walking moves
 * them, the eye stays at head height above the ground, the gun fires and
 * reloads, the axe can be picked, beacons can be claimed, scrap can be
 * picked up, and nothing throws.
 * Needs the dev server (LAAS_URL, default :5173).
 *
 *   npm run smoke
 */

import { laasUrl, launchWebGPU } from './launch';

const failures: string[] = [];
const check = (ok: boolean, msg: string): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failures.push(msg);
};

const { browser } = await launchWebGPU();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const logs: string[] = [];
page.on('console', (m) => logs.push(m.text()));

await page.goto(laasUrl({ scene: 'world', hud: false, freeze: false }), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__laas && (window.__laas.ready || window.__laas.error !== null), undefined, {
  timeout: 300_000,
  polling: 250,
});
check((await page.evaluate(() => window.__laas.error)) === null, 'boots without error');
check(logs.some((l) => l.includes('control: play')), 'starts in play mode');
const sites = (await page.evaluate('window.__laasDbg.ruinSites.length')) as number;
check(sites > 0, `ruins stand in the world (${sites} sites)`);
const robots = (await page.evaluate('window.__laasDbg.enemySpawns.length')) as number;
check(robots > sites, `robots guard the settlements and roam (${robots} planned)`);
await page.waitForTimeout(1000);

// a string, not a closure: tsx's keepNames wraps named functions in a
// __name() helper that doesn't exist inside the page
const SAMPLE = `(async () => {
  const L = window.__laas;
  const out = [];
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 120));
    const p = L.getPose();
    const g = L.groundProbe(p.p[0], p.p[2]);
    out.push({ x: p.p[0], z: p.p[2], above: p.p[1] - Math.max(g.ground, g.water) });
  }
  return out;
})()`;
await page.keyboard.down('KeyW');
const walk = (await page.evaluate(SAMPLE)) as { x: number; z: number; above: number }[];
await page.keyboard.up('KeyW');

const first = walk[0];
const last = walk[walk.length - 1];
const moved = first && last ? Math.hypot(last.x - first.x, last.z - first.z) : 0;
check(moved > 5, `walking moves the player (${moved.toFixed(1)} m in 3 s)`);
const heights = walk.map((s) => s.above);
check(
  heights.every((h) => h > 1.5 && h < 1.95),
  `eye stays at head height (${Math.min(...heights).toFixed(2)}–${Math.max(...heights).toFixed(2)} m)`,
);
// headless Chromium refuses pointer lock, so fake it: Input only cares
// about pointerLockElement and the change event
await page.evaluate(`(() => {
  const canvas = document.querySelector('#app canvas');
  Object.defineProperty(document, 'pointerLockElement', { get: () => canvas, configurable: true });
  document.dispatchEvent(new Event('pointerlockchange'));
})()`);
const AMMO = `(() => { const w = window.__laasDbg.game.weapon; return w.reloading ? 'reloading' : String(w.ammo); })()`;
const ammo = (): Promise<string> => page.evaluate(AMMO) as Promise<string>;
const before = await ammo();
await page.mouse.click(640, 400);
await page.waitForTimeout(300);
const after = await ammo();
check(before === '12' && after === '11', `firing spends a round (${before} → ${after})`);
await page.keyboard.press('KeyR');
await page.waitForTimeout(300);
const reloading = await ammo();
await page.waitForTimeout(1500);
const reloaded = await ammo();
check(reloading === 'reloading' && reloaded === '12', `R reloads (${reloading} → ${reloaded})`);

await page.keyboard.press('Digit2');
await page.waitForTimeout(600);
const held = (await page.evaluate('window.__laasDbg.game.attached.arms.arsenal.current')) as string;
await page.keyboard.press('Digit1');
await page.waitForTimeout(600);
const back = (await page.evaluate('window.__laasDbg.game.attached.arms.arsenal.current')) as string;
check(held === 'axe' && back === 'pistol', `2 and 1 pick the axe and the pistol (${held} → ${back})`);

// mouse down looks down, or up once Y inverts it
const pitchAfterDrag = async (): Promise<number> => {
  await page.mouse.move(640, 400);
  await page.waitForTimeout(150);
  const before = (await page.evaluate('window.__laas.getPose().pitch')) as number;
  await page.mouse.move(640, 460, { steps: 4 });
  await page.waitForTimeout(150);
  return ((await page.evaluate('window.__laas.getPose().pitch')) as number) - before;
};
const normal = await pitchAfterDrag();
await page.keyboard.press('KeyY');
const inverted = await pitchAfterDrag();
await page.keyboard.press('KeyY');
check(normal < 0 && inverted > 0, `Y inverts mouse look (${normal.toFixed(3)} → ${inverted.toFixed(3)} rad)`);

await page.keyboard.press('KeyP');
await page.waitForTimeout(200);
const where = logs.find((l) => l.startsWith('[where]')) ?? '';
check(/cam=\S+ · near S1 \d+ m .+ · looking at .+, \d+ m/.test(where), `P reports the location (${where})`);

// beside the first beacon, then back to play: standing there claims it
const beacon = (await page.evaluate('window.__laasDbg.checkpoints[0]')) as { x: number; y: number; z: number } | undefined;
if (beacon) {
  await page.evaluate(`window.__laas.setPose({ p: [${beacon.x + 1.5}, ${beacon.y + 1.7}, ${beacon.z}], yaw: 0, pitch: 0 })`);
  await page.evaluate('window.__laasDbg.game.play()');
  await page.waitForTimeout(500);
  const claimed = (await page.evaluate('window.__laasDbg.game.checkpoints.count')) as number;
  check(claimed === 1, `walking up to a beacon claims it (${claimed} claimed)`);
} else {
  check(false, 'every world has a checkpoint');
}

// a wreck's scrap at the player's feet is picked up
await page.evaluate(`(() => { const a = window.__laasDbg.game.attached; const f = a.motor.feet; a.loot.wreck(f.x, f.y, f.z); })()`);
await page.waitForTimeout(500);
const metal = ((await page.evaluate('window.__laasDbg.game.carried')) as { metal: number }).metal;
check(metal >= 2, `walking over a wreck's scrap picks it up (${metal} metal)`);

// from the middle of a cell, so the wall ahead can't cut through the player
await page.evaluate(`(() => {
  const a = window.__laasDbg.game.attached; const f = a.motor.feet;
  a.player.spawn((Math.floor(f.x / 4) + 0.5) * 4, f.y + 0.5, (Math.floor(f.z / 4) + 0.5) * 4, 0, 0);
})()`);
await page.keyboard.press('Digit3');
await page.waitForTimeout(800);
await page.mouse.click(640, 400);
await page.waitForTimeout(200);
const built = (await page.evaluate(`(() => { const a = window.__laasDbg.game.attached; return [a.building.count, a.carried.wood]; })()`)) as number[];
check(built[0] === 1 && built[1] === 9, `3 then a click builds a wall for wood (${built[0]} built, ${built[1]} wood left)`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);

await browser.close();
if (failures.length > 0) process.exit(1);
