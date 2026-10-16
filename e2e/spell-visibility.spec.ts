import { expect, test } from '@playwright/test';
import { defaults } from '../src/meta/save';

test('spell silhouettes stay readable in a crowded arsenal while glows and warnings remain controlled', async ({ page, baseURL }, info) => {
  const save = defaults();
  save.story.prologue = true;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.addInitScript((data) => localStorage.setItem('soulforge_save_v1', JSON.stringify(data)), save);
  await page.goto(baseURL!);
  await page.click('#playBtn');
  await page.click('#toSetup');
  await page.click('#beginBtn');
  await page.addStyleTag({ content: '#stagecard, #narrator, #notices { display: none !important; }' });
  await page.evaluate(() => {
    const { game: g, renderer: r, loop } = window.__SF!;
    loop.stop();
    g.player.weapons = [];
    g.player.invulnT = 999;
    g.player.shield = 20;
    g.spawnProj({ x: -260, y: -120, r: 76, life: 10, dmg: 0, sprite: { kind: 'orb', color: '#22bbee', size: 56 } });
    r.fx.beam(-40, -170, 260, -170, '#ee44aa', 4, 1);
    r.fx.arc(-260, 120, -Math.PI / 2, 100, 1.3, '#ff8833');
    r.fx.nova({ x: 0, y: 110, r: 110, maxR: 220, dead: false }, '#aaccff');
    g.spawnZone({ x: 260, y: 130, r: 120, age: 1, dur: 10, color: '#35e7b8', kind: 'holy' });
    r.fx.telegraphCircle(330, -20, 70, 2, '#ff0755');
    r.fx.meteor(-200, -20, 2);
    r.fx.meteor(330, 10, 2, false);
    r.fx.shockwave(0, 0, 160, 12, 1);
    r.fx.shockwave(0, 0, 160, 30, 1);
    g.spawnEnemyProj(330, -20, 0, 0, 1, '#ff0755');
    g.state = 'paused';
    r.snapCamera();
  });

  const samples: Record<
    string,
    { cores: number[]; warnings: number[]; enemy: number[]; bloom: number; glow: number; friendly: number; shield: number; waves: number[] }
  > = {};
  for (const crowded of [false, true]) {
    if (crowded)
      await page.evaluate(() => {
        const { game: g, renderer: r } = window.__SF!;
        for (let i = 0; i < 120; i++)
          g.spawnProj({ x: 10000 + i, y: 10000, r: 180, life: 10, sprite: { kind: 'orb', color: '#aa99ff', size: 80 } });
        for (let i = 0; i < 45; i++) {
          r.fx.beam(10000, 10000, 10200, 10000, '#aa99ff', 4, 1);
          r.fx.arc(10000, 10000, 0, 300, 2, '#aa99ff');
          r.fx.explosion(10000, 10000, 300, '#aa99ff');
          g.spawnZone({ x: 10000, y: 10000, r: 300, age: 1, dur: 10, color: '#aa99ff', kind: 'fire' });
        }
      });
    for (const intensity of [0.1, 0.5, 1]) {
      samples[`${crowded}-${intensity}`] = await page.evaluate((value) => {
        const { game: g, renderer: r } = window.__SF!,
          b = r.backend;
        const original = { image: b.image, line: b.line, arc: b.arc, ring: b.ring, setBlend: b.setBlend, setPost: b.setPost, glow: b.glow };
        let blend = 'normal',
          bloom = 0,
          glow = 0;
        let friendly = 0;
        let shield = 0;
        let waves: number[] = [];
        const body: number[] = [],
          beam: number[] = [],
          arc: number[] = [],
          nova: number[] = [],
          pool: number[] = [],
          warnings: number[] = [],
          enemy: number[] = [];
        b.setBlend = (mode) => {
          blend = mode;
          original.setBlend.call(b, mode);
        };
        b.image = (img, x, y, options) => {
          if (x === -260 && y === -120) body.push(options?.alpha ?? 1);
          if (x === 330 && y === -20) enemy.push(options?.alpha ?? 1);
          original.image.call(b, img, x, y, options);
        };
        b.line = (...args) => {
          if (args[5] === '#ee44aa' && blend === 'normal') beam.push(args[6]);
          original.line.apply(b, args);
        };
        b.arc = (...args) => {
          if (args[6] === '#ff8833' && blend === 'normal') arc.push(args[7]);
          original.arc.apply(b, args);
        };
        b.ring = (...args) => {
          if (args[6] === '#ff0755') warnings.push(args[7]);
          if (args[6] === 'rgb(125,211,252)') shield = Math.max(shield, args[7]);
          if (args[0] === 330 && args[1] === 10 && args[6] === '#ff7043') warnings.push(args[7]);
          if (args[0] === -200 && args[1] === -20 && args[6] === '#ff7043') friendly = Math.max(friendly, args[7]);
          if (blend === 'normal' && args[6] === '#aaccff') nova.push(args[7]);
          if (blend === 'normal' && args[6] === '#35e7b8') pool.push(args[7]);
          original.ring.apply(b, args);
        };
        b.setPost = (post) => {
          bloom = post?.bloom ?? 0;
          waves = Array.from({ length: post?.waveCount ?? 0 }, (_, i) => post!.waves[i * 4 + 3]!);
          original.setPost.call(b, post);
        };
        b.glow = (...args) => {
          if (args[0] === -260 && args[1] === -120) glow = Math.max(glow, args[4]);
          original.glow.apply(b, args);
        };
        try {
          r.fx.intensity = value;
          r.render(g, 1, 0);
          return {
            cores: [body, beam, arc, nova, pool].map((values) => Math.max(0, ...values)),
            warnings,
            enemy,
            bloom,
            glow,
            friendly,
            shield,
            waves,
          };
        } finally {
          Object.assign(b, original);
        }
      }, intensity);
      await page.screenshot({ animations: 'disabled', path: info.outputPath(`${crowded ? 'crowded' : 'sparse'}-${intensity}.png`) });
    }
  }
  const high = samples['true-1']!,
    low = samples['true-0.1']!,
    middle = samples['true-0.5']!;
  for (let i = 0; i < high.cores.length; i++) {
    expect(high.cores[i]).toBeGreaterThan(i === 4 ? 0.4 : 0.5);
    expect(high.cores[i]!).toBeGreaterThan(middle.cores[i]!);
    expect(middle.cores[i]!).toBeGreaterThan(low.cores[i]!);
    expect(low.cores[i]).toBeLessThan(high.cores[i]! * 0.35);
    expect(high.cores[i]).toBeGreaterThan(samples['false-1']!.cores[i]! * 0.75);
  }
  for (const sample of Object.values(samples)) {
    expect(sample.warnings).toEqual(high.warnings);
    expect(sample.enemy).toEqual([1]);
    expect(sample.bloom).toBeLessThanOrEqual(0.5);
    expect(sample.glow).toBeLessThanOrEqual(0.31);
  }
  expect(high.glow).toBe(samples['false-1']!.glow);
  expect(high.cores).toEqual(samples['false-1']!.cores);
  expect(high.friendly).toBeGreaterThan(middle.friendly);
  expect(middle.friendly).toBeGreaterThan(low.friendly * 2);
  expect(high.shield).toBeGreaterThan(middle.shield);
  expect(middle.shield).toBeGreaterThan(low.shield * 2);
  expect(low.waves[0]).toBeCloseTo(high.waves[0]! * 0.1);
  expect(low.waves[1]).toBe(high.waves[1]);
  const stackedPoolEdge = await page.evaluate(() => {
    const { game: g, renderer: r } = window.__SF!,
      b = r.backend,
      original = b.ring;
    for (let i = 0; i < 15; i++) g.spawnZone({ x: 250 + i, y: 120, r: 120, age: 1, dur: 10, color: '#aa99ff', kind: 'holy' });
    let edge = 0;
    b.ring = (...args) => {
      if (args[6] === '#35e7b8') edge = Math.max(edge, args[7]);
      original.apply(b, args);
    };
    try {
      r.render(g, 1, 0);
      return edge;
    } finally {
      b.ring = original;
    }
  });
  expect(stackedPoolEdge).toBeGreaterThan(0.1);
  expect(stackedPoolEdge).toBeLessThan(high.cores[4]! * 0.65);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('stacked-pools-1.png') });
  expect(errors).toEqual([]);
});
