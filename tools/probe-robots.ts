/**
 * Robot close-ups — boots the world, flies to the robots guarding the
 * first settlements and captures one of each kind, for judging their look.
 * Needs the dev server (LAAS_URL, default :5173).
 *
 *   npx tsx tools/probe-robots.ts --out shots/robots [--T 13] [--ablate veg,grass]
 */

import { mkdirSync } from 'node:fs';
import { laasUrl, launchWebGPU } from './launch';

const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? (argv[i + 1] ?? d) : d;
};
const out = arg('out', 'shots/robots');
mkdirSync(out, { recursive: true });

const { browser } = await launchWebGPU();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(laasUrl({ scene: 'world', hud: false, T: Number(arg('T', '13')), extra: { walk: '0', ablate: arg('ablate', '') } }), {
  waitUntil: 'domcontentloaded',
});
await page.waitForFunction(() => window.__laas && (window.__laas.ready || window.__laas.error !== null), undefined, {
  timeout: 300_000,
  polling: 250,
});
const err = await page.evaluate(() => window.__laas.error);
if (err) throw new Error(err);

type Spawn = { kind: string; x: number; z: number };
const spawns = (await page.evaluate('window.__laasDbg.enemySpawns')) as Spawn[];
const seen = new Set<string>();
for (const s of spawns) {
  if (seen.has(s.kind)) continue;
  // fly near so it wakes, then find where it actually stands
  await page.evaluate(`window.__laas.setPose({ p: [${s.x + 6}, 2000, ${s.z + 6}], yaw: 0, pitch: 0 })`);
  await page.evaluate(`window.__laas.settle(4)`);
  const r = (await page.evaluate(
    `window.__laasDbg.game.enemies.snapshot().filter((r) => r.kind === '${s.kind}').sort((a, b) => Math.hypot(a.x - ${s.x}, a.z - ${s.z}) - Math.hypot(b.x - ${s.x}, b.z - ${s.z}))[0]`,
  )) as { x: number; y: number; z: number } | undefined;
  if (!r) continue;
  seen.add(s.kind);
  const d = 4;
  const yaw = 0.6;
  const cx = r.x + Math.sin(yaw) * d;
  const cz = r.z + Math.cos(yaw) * d;
  const g = (await page.evaluate(`window.__laas.groundProbe(${cx}, ${cz})`)) as { ground: number; water: number };
  const cy = Math.max(g.ground, g.water) + 1.6;
  const pitch = Math.atan2(r.y + 1 - cy, d);
  await page.evaluate(`window.__laas.setPose({ p: [${cx}, ${cy}, ${cz}], yaw: ${yaw}, pitch: ${pitch}, fov: 45 })`);
  await page.evaluate(`window.__laas.settle(30)`);
  await page.screenshot({ path: `${out}/${s.kind}.png` });
  console.log(`${s.kind} at ${r.x.toFixed(0)}, ${r.z.toFixed(0)} → ${out}/${s.kind}.png`);
}
await browser.close();
