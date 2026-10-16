import { expect, test, type Page } from '@playwright/test';
import { defaults } from '../src/meta/save';
import { WEAPONS } from '../src/data/weapons';
import { CHARACTERS } from '../src/data/characters';
import { SOUL_ARTS } from '../src/data/soularts';
import { EVENTS } from '../src/data/enemies';
import { STAGES } from '../src/data/passives';
import { writeFile } from 'node:fs/promises';

async function start(page: Page, url: string) {
  const save = defaults();
  save.story.prologue = true;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text());
  });
  await page.addInitScript((data) => localStorage.setItem('soulforge_save_v1', JSON.stringify(data)), save);
  await page.goto(url);
  await page.click('#playBtn');
  await page.click('#toSetup');
  await page.click('#beginBtn');
  await page.evaluate(() => window.__SF!.loop.stop());
  await page.addStyleTag({ content: '#stagecard, #bossbanner, #narrator, #notices { display: none !important; }' });
  return errors;
}

test('all weapon forms, champion abilities and Soul Arts visibly respond to the slider', async ({ page, baseURL }, info) => {
  test.setTimeout(180000);
  const errors = await start(page, baseURL!);
  const cases = [
    ...[0, 1, 2].flatMap((form) => Object.keys(WEAPONS).map((id) => ({ kind: 'weapon', id, form }))),
    ...CHARACTERS.map((c) => ({ kind: 'ability', id: c.id, form: 0 })),
    ...SOUL_ARTS.map((a) => ({ kind: 'art', id: a.id, form: 0 })),
  ];
  // Read back rendered pixels, rather than inferring visibility from alpha arguments. The effect
  // layer is isolated over black so terrain, champion markers and postprocessing cannot mask a
  // spell that ignores the slider. Contact sheets make the entire roster visually reviewable.
  for (let offset = 0; offset < cases.length; offset += 18) {
    const result = await page.evaluate(
      ({ cases, eventCount }) => {
        const { game: g, renderer: r } = window.__SF!;
        const b = r.backend,
          renderer = r as any;
        const source = document.querySelector('#game') as HTMLCanvasElement;
        const gl = b.kind === 'webgl2' ? source.getContext('webgl2') : null;
        const sheet = document.createElement('canvas');
        sheet.width = 1152;
        sheet.height = Math.ceil(cases.length / 3) * 164;
        const sx = sheet.getContext('2d')!;
        const thumb = document.createElement('canvas');
        thumb.width = 124;
        thumb.height = 124;
        const ctx = thumb.getContext('2d', { willReadFrequently: true })!;
        const rows: { label: string; energy: number[] }[] = [];
        r.postEnabled = false;
        for (let index = 0; index < cases.length; index++) {
          const c = cases[index]!;
          g.start({
            charId: c.kind === 'ability' ? c.id : 'lyra',
            stageId: 'ashen',
            seed: 51,
            meta: { stats: { area: 0.3, amount: 1 }, flags: {}, weaponMastery: {} },
            art: c.kind === 'art' ? { id: c.id, level: 5 } : null,
          });
          g.time = 0;
          (g as any).eventIdx = eventCount;
          (g.rifts as any).nextAt = Infinity;
          g.player.level = 70;
          g.player.xpNext = 1e12;
          g.player.weapons = [];
          g.player.invulnT = 9999;
          if (c.kind === 'weapon') {
            const w = g.addWeapon(c.id);
            w.level = c.form ? w.def.max + (c.form === 2 ? 3 : 0) : 4;
            w.evolved = c.form > 0;
            w.apex = c.form === 2;
          }
          g.recalc();
          for (let i = 0; i < 18; i++) {
            const angle = (i * Math.PI) / 9;
            const e = g.spawnEnemy('brute', Math.cos(angle) * 210, Math.sin(angle) * 160);
            e.hp = e.maxHp *= 20;
            e.speed = 0;
          }
          g.update(1 / 60); // populate the spatial hash for targeted casts
          for (const w of g.player.weapons) w.timer = 0;
          if (c.kind === 'ability') g.useActive();
          if (c.kind === 'art') g.useArt();
          r.fx.intensity = 1;
          let frame = 0;
          let energy = [0, 0, 0];
          const strip = document.createElement('canvas');
          strip.width = 384;
          strip.height = 124;
          const stripCtx = strip.getContext('2d')!;
          // Catch fast lightning, the travelling spell, and delayed impacts separately. A single
          // arbitrary frozen frame can miss an entire short-lived spell and conceal coverage gaps.
          for (const phase of [3, 12, 36]) {
            for (; frame < phase; frame++) {
              g.state = 'play';
              g.update(1 / 60);
              r.fx.update(1 / 60);
            }
            g.state = 'paused';
            r.fx.zoom = r.fx.shakeAmt = 0;
            r.snapCamera();
            const sample: number[] = [];
            for (const intensity of [0.1, 0.5, 1]) {
              r.fx.intensity = intensity;
              r.render(g, 1, 0); // compute the same visibility/crowding policy used by actual gameplay
              renderer.glints.length = renderer.streaks.length = 0; // loot glints belong to the world layer
              b.begin('#000');
              b.setView(0.5, 0, 0, 0.5, r.W / 2, r.H / 2);
              renderer.drawProjectiles(g, 1);
              renderer.drawZoneEdges(g);
              renderer.drawAdditive(g, 1, g.player.x, g.player.y);
              renderer.drawTelegraphs();
              for (const ally of g.allies) renderer.drawAlly(g, ally, 1);
              b.end();
              gl?.finish();
              ctx.clearRect(0, 0, 124, 124);
              ctx.drawImage(source, (source.width - source.height) / 2, 0, source.height, source.height, 0, 0, 124, 124);
              const pixels = ctx.getImageData(0, 0, 124, 124).data;
              let sum = 0;
              for (let k = 0; k < pixels.length; k += 4) sum += pixels[k]! + pixels[k + 1]! + pixels[k + 2]!;
              sample.push(sum);
              const variant = intensity === 0.1 ? 0 : intensity === 0.5 ? 1 : 2;
              stripCtx.drawImage(thumb, variant * 128, 0);
            }
            if (sample[2]! > energy[2]!) {
              energy = sample;
              sx.drawImage(strip, (index % 3) * 384, Math.floor(index / 3) * 164 + 28);
            }
          }
          const label = `${c.kind}: ${c.id}${c.kind === 'weapon' ? [' Lv4', ' evolved', ' apex'][c.form] : ''}`;
          sx.fillStyle = '#fff';
          sx.font = '12px sans-serif';
          sx.fillText(label, (index % 3) * 384 + 4, Math.floor(index / 3) * 164 + 14);
          sx.fillStyle = '#94a3b8';
          sx.font = '10px sans-serif';
          sx.fillText(
            '10%                         50%                         100%',
            (index % 3) * 384 + 4,
            Math.floor(index / 3) * 164 + 26,
          );
          rows.push({ label, energy });
        }
        return { rows, png: sheet.toDataURL('image/png') };
      },
      { cases: cases.slice(offset, offset + 18), eventCount: EVENTS.filter((e) => e.at! <= 1200).length },
    );
    await writeFile(info.outputPath(`roster-${offset}.png`), Buffer.from(result.png.split(',')[1]!, 'base64'));
    await writeFile(info.outputPath(`roster-${offset}.json`), JSON.stringify(result.rows, null, 2));
    for (const row of result.rows) {
      expect(row.energy[2], `${row.label} must produce a visible spell`).toBeGreaterThan(100);
      expect(row.energy[2], `${row.label} 100% > 50%`).toBeGreaterThan(row.energy[1]! * 1.08);
      expect(row.energy[1], `${row.label} 50% > 10%`).toBeGreaterThan(row.energy[0]! * 1.2);
    }
  }
  expect(errors).toEqual([]);
});

test('level-up ignores Space on cards and native controls, including held dash presses', async ({ page, baseURL }) => {
  const errors = await start(page, baseURL!);
  const openChoices = async () =>
    page.evaluate(() => {
      const g = window.__SF!.game;
      g.state = 'play';
      g.player.rerolls = g.player.skips = g.player.banishes = 3;
      g.gainXp(g.player.xpNext - g.player.xp);
      g.update(1 / 60);
      return JSON.stringify({
        weapons: g.player.weapons.map((w) => [w.id, w.level]),
        rerolls: g.player.rerolls,
        skips: g.player.skips,
        banishes: g.player.banishes,
      });
    });
  const before = await openChoices();
  for (const selector of ['#modal .card', '#rerollBtn', '#skipBtn', '#banishBtn']) {
    await page.locator(selector).first().focus();
    await page.keyboard.press('Space');
    expect(await page.evaluate(() => window.__SF!.game.state)).toBe('levelup');
  }
  expect(
    await page.evaluate(() => {
      const g = window.__SF!.game;
      return JSON.stringify({
        weapons: g.player.weapons.map((w) => [w.id, w.level]),
        rerolls: g.player.rerolls,
        skips: g.player.skips,
        banishes: g.player.banishes,
      });
    }),
  ).toBe(before);
  await page.keyboard.down('Space');
  await page.keyboard.down('Space'); // repeat must remain inert
  await page.keyboard.press('1');
  await page.keyboard.up('Space');
  expect(await page.evaluate(() => window.__SF!.game.state)).toBe('play');
  // A fresh dash still works after a numeric selection; the held press does not leak through.
  expect(await page.evaluate(() => window.__SF!.game.input.consumeDash())).toBe(false);
  await page.keyboard.press('Space');
  expect(await page.evaluate(() => window.__SF!.game.input.consumeDash())).toBe(true);
  // Dash starts before XP crosses the threshold, and releases over a freshly focused choice.
  await page.keyboard.down('Space');
  await openChoices();
  await page.keyboard.up('Space');
  expect(await page.evaluate(() => window.__SF!.game.state)).toBe('levelup');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.__SF!.game.state)).toBe('play');
  expect(errors).toEqual([]);
});

test('atlas overflow keeps queued textures valid and oversized spell sprites drawable', async ({ page, baseURL }) => {
  test.skip(baseURL!.includes('canvas2d'), 'WebGL texture lifecycle regression');
  const errors = await start(page, baseURL!);
  const result = await page.evaluate(() => {
    const b = window.__SF!.renderer.backend as any;
    const atlas = b.atlas;
    atlas.reset();
    atlas.size = 64; // one 60px sprite per page, forcing overflow in a single recorded frame
    const sprites = Array.from({ length: 12 }, (_, i) => {
      const c = document.createElement('canvas');
      c.width = c.height = i === 11 ? 256 : 60;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = i % 2 ? '#00ff00' : '#ff0000';
      ctx.fillRect(0, 0, c.width, c.height);
      return c;
    });
    const gl = (document.querySelector('#game') as HTMLCanvasElement).getContext('webgl2')!;
    const frames: number[][] = [];
    const draw = () => {
      b.begin('#000');
      for (let i = 0; i < sprites.length; i++) b.image(sprites[i], 30 + i * 70, 50, { w: 40, h: 40 });
      b.end();
      gl.finish();
      const pixels: number[] = [];
      for (let i = 0; i < sprites.length; i++) {
        const px = new Uint8Array(4);
        gl.readPixels(30 + i * 70, gl.drawingBufferHeight - 50, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        pixels.push(...px.slice(0, 3));
      }
      frames.push(pixels);
    };
    draw();
    draw(); // the hot working set can exceed the cache target without re-uploading each frame
    const hotPages = atlas.pageCount;
    b.begin('#000');
    b.end();
    b.begin('#000');
    b.end(); // cold excess pages can now be evicted safely
    const coldPages = atlas.pageCount;
    draw(); // evicted regions must be re-uploaded rather than sampling deleted textures
    atlas.reset();
    atlas.size = 2048;
    return { frames, hotPages, coldPages, error: gl.getError() };
  });
  for (const frame of result.frames)
    for (let i = 0; i < 12; i++) expect(frame.slice(i * 3, i * 3 + 3)).toEqual(i % 2 ? [0, 255, 0] : [255, 0, 0]);
  expect(result.hotPages).toBe(12);
  expect(result.coldPages).toBeLessThanOrEqual(8);
  expect(result.error).toBe(0);
  expect(errors).toEqual([]);
});

test('level 80 and Eclipse arsenals: every weapon at three intensities through sustained combat', async ({ page, baseURL }, info) => {
  test.setTimeout(180000);
  const errors = await start(page, baseURL!);
  const weapons = Object.keys(WEAPONS);
  const report: unknown[] = [];
  for (let group = 0; group < weapons.length; group += 6) {
    const ids = weapons.slice(group, group + 6);
    const metrics = await page.evaluate(
      ({ ids, group, eventCount, stage }) => {
        const { game: g, renderer: r } = window.__SF!;
        g.start({
          charId: 'lyra',
          stageId: stage,
          seed: 87,
          torment: 8,
          meta: { stats: { area: 0.6, amount: 2, cooldown: 0.25 }, flags: {}, weaponMastery: {} },
        });
        g.time = group >= 18 ? 1810 : 1200;
        (g as any).eventIdx = eventCount; // elapsed scripted encounters were already cleared in this run
        (g as any).lateEventT = 60;
        g.player.level = 80;
        g.player.xpNext = 1e12;
        g.player.weapons = [];
        g.player.invulnT = 9999;
        for (const id of ids) {
          const w = g.addWeapon(id);
          w.level = w.def.max + 3;
          w.evolved = true;
          w.apex = true;
        }
        g.recalc();
        for (let i = 0; i < 48; i++) {
          const angle = (i * Math.PI) / 24;
          const e = g.spawnEnemy(
            i % 3 ? 'brute' : 'wraith',
            Math.cos(angle) * (220 + (i % 4) * 35),
            Math.sin(angle) * (170 + (i % 4) * 30),
          );
          e.hp = e.maxHp *= 12;
          e.speed = 12;
        }
        let peakProjectiles = 0,
          peakZones = 0;
        r.fx.intensity = 1;
        for (let i = 0; i < 720; i++) {
          if (g.state !== 'play') g.state = 'play';
          g.update(1 / 60);
          r.fx.update(1 / 60);
          if (i % 12 === 0) r.render(g, 1, 0);
          peakProjectiles = Math.max(peakProjectiles, g.projs.length);
          peakZones = Math.max(peakZones, g.zones.length);
        }
        g.state = 'paused';
        r.fx.shakeAmt = r.fx.zoom = 0;
        r.snapCamera();
        // Put a hostile core in front of the champion to judge readability through dense friendly VFX.
        g.spawnEnemyProj(70, 50, 0, 0, 1, '#ff0755');
        return { ids, time: g.time, level: g.player.level, peakProjectiles, peakZones };
      },
      {
        ids,
        group,
        eventCount: EVENTS.filter((e) => e.at! <= (group >= 18 ? 1810 : 1200)).length,
        stage: STAGES[Math.floor(group / 6) % STAGES.length]!.id,
      },
    );
    report.push(metrics);
    await page.evaluate(async () => {
      const { loop } = window.__SF!;
      loop.start();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      loop.stop();
    });
    for (const intensity of [0.1, 0.5, 1]) {
      const glError = await page.evaluate((value) => {
        const { game: g, renderer: r } = window.__SF!;
        r.fx.intensity = value;
        r.render(g, 1, 0);
        const gl = (document.querySelector('#game') as HTMLCanvasElement).getContext('webgl2');
        gl?.finish();
        return gl?.getError() ?? 0;
      }, intensity);
      expect(glError).toBe(0);
      await page.screenshot({ path: info.outputPath(`arsenal-${group}-${intensity}.png`) });
    }
  }
  await info.attach('late-game-builds', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});
