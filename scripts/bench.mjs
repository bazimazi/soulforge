#!/usr/bin/env node
/**
 * Rendering/simulation benchmark in a real (GPU-accelerated) Chrome.
 *
 *   npm run build && node scripts/bench.mjs [dist-dir] [--enemies 1500] [--frames 600] [--renderer canvas2d]
 *
 * Serves the build, starts a run, warms the horde up to ~20 minutes, injects extra enemies, then times
 * the simulation step and the render (including GPU completion via a 1px read-back) per frame.
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const root = resolve(args[0] && !args[0].startsWith('--') ? args[0] : 'dist');
const extra = +opt('enemies', 1500),
  frames = +opt('frames', 600),
  rendererPref = opt('renderer', 'auto');
const legacy = args.includes('--legacy'); // the pre-modernization build (global SF namespace)
// --sync waits for the GPU each frame (1px read-back). Off by default: on an accelerated 2D canvas a
// read-back can force a slow software path, which would make legacy comparisons unfair.
const syncGpu = args.includes('--sync');

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};
const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = join(root, url === '/' ? 'index.html' : url);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(0);

const browser = await chromium.launch({
  channel: process.env.BENCH_CHANNEL ?? 'chrome',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${server.address().port}/?renderer=${rendererPref}`);
await page.waitForTimeout(800);

const result = await page.evaluate(
  async ({ extra, frames, legacy, syncGpu }) => {
    const h = legacy ? { game: window.SF.game, renderer: window.SF.renderer } : window.__SF;
    const G = h.game,
      R = h.renderer;
    if (!legacy) h.loop.stop();
    const meta = { stats: {}, flags: {}, weaponMastery: {} };
    if (legacy) {
      G.start('kael', 'ashen', {});
      window.SF.UI.showLevelUp = () => {};
      window.SF.UI.showChest = () => {};
      window.SF.UI.notice = () => {};
    } else G.start({ charId: 'kael', stageId: 'ashen', meta, seed: 12345 });
    document.getElementById('screens').innerHTML = '';
    const p = G.player;
    for (const id of ['arcane_missile', 'cyclone_axe', 'holy_font']) G.addWeapon(id);
    p.weapons.forEach((w) => (w.level = 8));
    G.recalc();
    G.time = 20 * 60;
    const keep = () => {
      p.invulnT = 999;
      p.hp = p.stats.maxHp;
      G.levelQueue = 0;
      G.chestQueue.length = 0;
      G.state = 'play';
    };
    for (let i = 0; i < 1200; i++) {
      keep();
      G.update(1 / 60);
    }
    const types = ['bat', 'ghoul', 'skeleton', 'spider'];
    let s = 1;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < extra; i++) {
      const a = rnd() * 6.283,
        d = 150 + rnd() * 900;
      G.spawnEnemy(types[i % 4], p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
    }
    const canvas = document.getElementById('game');
    const gl = canvas.getContext('webgl2');
    const c2d = gl ? null : canvas.getContext('2d');
    const px = new Uint8Array(4);
    const sync = () => (gl ? gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px) : c2d.getImageData(0, 0, 1, 1));
    // warm-up: shader compilation, atlas uploads, JIT
    for (let i = 0; i < 30; i++) {
      keep();
      G.update(1 / 60);
      if (legacy) R.render(G, 1 / 60);
      else R.render(G, 1, 1 / 60);
      sync();
    }
    let sim = 0,
      ren = 0,
      worst = 0;
    const N = frames;
    for (let i = 0; i < N; i++) {
      keep();
      let t = performance.now();
      G.update(1 / 60);
      sim += performance.now() - t;
      t = performance.now();
      if (legacy) R.render(G, 1 / 60);
      else R.render(G, 1, 1 / 60);
      if (syncGpu) sync();
      const d = performance.now() - t;
      ren += d;
      worst = Math.max(worst, d);
    }
    return {
      backend: legacy ? 'canvas2d (legacy)' : R.backend.kind,
      gpuSync: syncGpu,
      simMs: +(sim / N).toFixed(3),
      renderMs: +(ren / N).toFixed(3),
      worstRenderMs: +worst.toFixed(2),
      enemies: G.enemies.length,
      projectiles: G.projs.length,
      particles: legacy ? R.fx.parts.length : R.fx.parts.count,
      drawCalls: legacy ? undefined : R.backend.stats.drawCalls,
      quads: legacy ? undefined : R.backend.stats.instances,
    };
  },
  { extra, frames, legacy, syncGpu },
);

console.log(JSON.stringify({ ...result, errors }, null, 2));
await browser.close();
server.close();
