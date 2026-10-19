/**
 * Walk benchmark — boots the world at a bookmark (default: shot 7, forest
 * interior, the heaviest everyday view), holds W in walk mode and reports the
 * presented frame rate (rAF ticks) plus frame-time percentiles and the
 * vegetation counters. Needs the dev server on :5173.
 *
 *   npm run bench
 *   npm run bench -- --shot 3 --dsf 2 --min-fps 60
 *   npm run bench -- --query "ablate=casters" --png shots/bench.png
 *
 * --min-fps turns it into a pass/fail perf gate (exit 1 when below).
 * --dsf 2 matches a retina laptop (the engine caps DPR at 1.5).
 */

import type { EngineStats, GpuDiagnostics } from '../src/core/Hooks';
import { launchWebGPU } from './launch';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const shot = arg('shot', '7');
const dsf = Number(arg('dsf', '1'));
const walkSec = Number(arg('sec', '20'));
const minFps = Number(arg('min-fps', '0'));
const query = arg('query', '');
const png = arg('png', '');

const { browser } = await launchWebGPU();
const page = await browser.newPage({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: dsf });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto(`http://localhost:5173/?scene=world&shot=${shot}&hud=0&${query}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForFunction(() => window.__laas && (window.__laas.ready || window.__laas.error !== null), undefined, {
  timeout: 300_000,
  polling: 250,
});
const bootError = await page.evaluate(() => window.__laas.error);
if (bootError) {
  console.error(`[bench] boot failed:\n${bootError}`);
  await browser.close();
  process.exit(1);
}
// let TRAA/exposure settle and the first culls stream in
await page.waitForTimeout(5000);

await page.keyboard.down('KeyW');
await page.waitForTimeout(2000);
// a string, not a closure: tsx's keepNames wraps named functions in a
// __name() helper that doesn't exist inside the page
const sample = (await page.evaluate(`(async () => {
  const frameMs = [];
  let last = performance.now();
  let running = true;
  requestAnimationFrame(function tick() {
    const now = performance.now();
    frameMs.push(now - last);
    last = now;
    if (running) requestAnimationFrame(tick);
  });
  await new Promise((r) => setTimeout(r, ${walkSec * 1000}));
  running = false;
  const L = window.__laas;
  return { frameMs, stats: L.stats, diag: L.diag };
})()`)) as { frameMs: number[]; stats: EngineStats | null; diag: GpuDiagnostics | null };

const sorted = sample.frameMs.slice(1).sort((a, b) => a - b);
const pct = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
const c = sample.stats?.counters ?? {};
const result = {
  fps: +(sorted.length / walkSec).toFixed(1),
  p50: +pct(0.5).toFixed(1),
  p95: +pct(0.95).toFixed(1),
  draws: sample.stats?.drawCalls ?? 0,
  trisM: +((sample.stats?.triangles ?? 0) / 1e6).toFixed(2),
  vegTrisM: +((c['veg.tris'] ?? 0) / 1e6).toFixed(2),
  vegCasters: c['veg.cast'] ?? 0,
  trees: c['veg.trees'] ?? 0,
  adapter: `${sample.diag?.vendor ?? '?'} / ${sample.diag?.architecture ?? '?'}`,
};
if (png) await page.screenshot({ path: png });
await page.keyboard.up('KeyW');
await browser.close();

console.log(JSON.stringify({ shot, dsf, query, ...result }, null, 2));
if (minFps > 0 && result.fps < minFps) {
  console.error(`[bench] FAIL: ${result.fps} fps < ${minFps}`);
  process.exit(1);
}
