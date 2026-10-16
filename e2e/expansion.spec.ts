import { expect, test, type Page } from '@playwright/test';
import { defaults } from '../src/meta/save';
import type { RiftKind } from '../src/data/rifts';
import { CHARACTERS } from '../src/data/characters';

async function boot(page: Page, url: string) {
  const d = defaults();
  d.story.prologue = true;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text());
  });
  await page.addInitScript((save) => localStorage.setItem('soulforge_save_v1', JSON.stringify(save)), d);
  await page.goto(url);
  await expect(page.locator('#playBtn')).toBeVisible();
  return errors;
}

test('sanctum, animated champion, and biome postcards', async ({ page, baseURL }, info) => {
  const errors = await boot(page, baseURL!);
  const overlap = await page.evaluate(() => {
    const logo = document.querySelector('.logo')!.getBoundingClientRect();
    const top = document.querySelector('.title-top')!.getBoundingClientRect();
    return logo.top < top.bottom;
  });
  expect(overlap).toBe(false);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('sanctum.png') });
  await page.click('#playBtn');
  const idle = await page.locator('#championPreview').evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  await page.click('[data-pose="run"]');
  await expect(page.locator('[data-pose="run"]')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(180);
  expect(await page.locator('#championPreview').evaluate((c) => (c as HTMLCanvasElement).toDataURL())).not.toBe(idle);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('champion-run.png') });
  await page.click('[data-pose="cast"]');
  await page.screenshot({ animations: 'disabled', path: info.outputPath('champion-cast.png') });
  await page.click('#toSetup');
  await expect(page.locator('.stage-preview')).toHaveCount(5);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('biomes.png') });
  expect(errors).toEqual([]);
});

for (const kind of ['ward', 'hunt', 'relay'] as RiftKind[]) {
  test(`rift ${kind}: commit, objective, relic, resume, pause and results`, async ({ page, baseURL }, info) => {
    const errors = await boot(page, baseURL!);
    await page.click('#playBtn');
    await page.click('#toSetup');
    await page.click('#beginBtn');
    // The debug fixture only places the encounter and champion; the live fixed-step loop commits it.
    await page.evaluate((type) => {
      const g = window.__SF!.game;
      g.player.invulnT = 9999;
      const r = g.rifts.spawn(type);
      g.player.x = g.player.px = r.x;
      g.player.y = g.player.py = r.y;
    }, kind);
    await expect.poll(() => page.evaluate(() => window.__SF!.game.rifts.current!.phase)).toBe('active');
    await expect(page.locator('#riftTracker')).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: info.outputPath('rift-' + kind + '.png') });
    await page.keyboard.press('KeyM');
    await expect(page.locator('#mapview')).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: info.outputPath('rift-map.png') });
    await page.keyboard.press('KeyM');
    await page.click('#pauseBtn');
    const remaining = await page.evaluate(() => window.__SF!.game.rifts.current!.remaining);
    await page.waitForTimeout(180);
    expect(await page.evaluate(() => window.__SF!.game.rifts.current!.remaining)).toBe(remaining);
    await page.click('#resumeBtn');
    if (kind === 'relay') {
      for (let i = 0; i < 3; i++) {
        await page.evaluate((index) => {
          const g = window.__SF!.game,
            b = g.rifts.current!.beacons[index]!;
          g.player.x = g.player.px = b.x;
          g.player.y = g.player.py = b.y;
        }, i);
        await expect
          .poll(
            async () => {
              const state = await page.evaluate(() => window.__SF!.game.state);
              // XP collected on the route legitimately pauses beacon channeling for an upgrade choice.
              if (state === 'levelup') await page.locator('#modal .card').first().click();
              else if (state === 'chest') await page.click('#chestOk');
              else if (state === 'boon') await page.locator('.boon-card').first().click();
              return page.evaluate((index) => window.__SF!.game.rifts.current!.beacons[index]!.lit, i);
            },
            { timeout: 10000 },
          )
          .toBe(true);
      }
    } else if (kind === 'hunt') {
      await page.evaluate(() => {
        const g = window.__SF!.game;
        for (const e of g.rifts.current!.targets) g.damageEnemy(e, 1e9, { noBlast: true });
      });
    } else {
      await page.evaluate(() => {
        window.__SF!.game.rifts.current!.progress = 17;
      });
    }
    // Ordinary XP from the hunted elites can interrupt the reward. Resolve those real level-up choices.
    await expect
      .poll(
        async () => {
          const state = await page.evaluate(() => window.__SF!.game.state);
          // Only resolve interruptions. A generic `.card` click can race the reward opening and
          // accidentally consume the very relic this test is waiting to inspect.
          if (state === 'levelup') await page.locator('#modal .card:not(.relic-card)').first().click();
          else if (state === 'chest') await page.click('#chestOk');
          else if (state === 'boon') await page.locator('.boon-card').first().click();
          return page.locator('.relic-card').count();
        },
        { timeout: 15000 },
      )
      .toBeGreaterThan(0);
    await expect(page.locator('.relic-card').first()).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: info.outputPath('relic-choice.png') });
    await page.keyboard.press('Digit1');
    await expect(page.locator('#modal')).toBeHidden();
    expect(await page.evaluate(() => window.__SF!.game.rifts.relics.length)).toBe(1);
    await expect(page.locator('#riftRelics > span')).toHaveCount(1);
    await page.click('#pauseBtn');
    await expect(page.locator('.run-relics')).toContainText('1 sealed');
    await page.screenshot({ animations: 'disabled', path: info.outputPath('relic-pause.png') });
    page.on('dialog', (dialog) => dialog.accept());
    await page.click('#quitBtn');
    await expect(page.locator('.run-relics')).toContainText('Rifts sealed · 1');
    expect(errors).toEqual([]);
  });
}

test('relic reward and objective fit a narrow phone', async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const errors = await boot(page, baseURL!);
  await page.click('#playBtn');
  await page.click('#toSetup');
  await page.click('#beginBtn');
  await page.evaluate(() => {
    const g = window.__SF!.game;
    g.player.invulnT = 9999;
    const r = g.rifts.spawn('ward');
    g.player.x = g.player.px = r.x;
    g.player.y = g.player.py = r.y;
  });
  await expect.poll(() => page.evaluate(() => window.__SF!.game.rifts.current!.phase)).toBe('active');
  await page.screenshot({ animations: 'disabled', path: info.outputPath('phone-objective.png') });
  await page.evaluate(() => {
    window.__SF!.game.rifts.current!.progress = 17.9;
  });
  await expect(page.locator('.relic-card').first()).toBeVisible();
  const overflow = await page.locator('.modal-box').evaluate((el) => el.scrollWidth > el.clientWidth + 2);
  expect(overflow).toBe(false);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('phone-relics.png') });
  await page.locator('.relic-card').first().click();
  await expect(page.locator('#modal')).toBeHidden();
  expect(errors).toEqual([]);
});

test('every champion renders every action and both facing views', async ({ page, baseURL }, info) => {
  const errors = await boot(page, baseURL!);
  await page.click('#playBtn');
  await page.click('#toSetup');
  await page.click('#beginBtn');
  const sheets = await page.evaluate(
    (champions) => {
      const { game: g, renderer: r, loop } = window.__SF!;
      loop.stop();
      const actions = ['idle', 'run', 'attack', 'cast', 'dash', 'hurt'] as const;
      const make = (back: boolean) => {
        const sheet = document.createElement('canvas');
        sheet.width = 960;
        sheet.height = 12 * 150 + 25;
        const x = sheet.getContext('2d')!;
        x.fillStyle = '#080a11';
        x.fillRect(0, 0, sheet.width, sheet.height);
        x.fillStyle = '#e7c368';
        x.font = '14px sans-serif';
        actions.forEach((a, i) => x.fillText(a.toUpperCase(), i * 160 + 15, 18));
        champions.forEach((charId, row) => {
          g.start({ charId, stageId: 'ashen', seed: 123, meta: { stats: {}, flags: {}, weaponMastery: {} } });
          g.time = 10;
          const p = g.player;
          actions.forEach((action, col) => {
            p.face.x = back ? 0 : 1;
            p.face.y = back ? -1 : 0;
            p.move.x = 0;
            p.move.y = 0;
            p.dashT = 0;
            p.hurtFlash = 0;
            p.invulnT = 0;
            p.attackAt = p.castAt = -10;
            if (action === 'run') {
              p.move.x = 1;
              p.walkT = 1.5;
            }
            if (action === 'attack') {
              p.attackAt = 9.8;
              p.move.x = 0.5;
              p.walkT = 1.5;
            }
            if (action === 'cast') p.castAt = 9.7;
            if (action === 'dash') {
              p.dashT = 0.1;
              p.dashDx = 1;
            }
            if (action === 'hurt') p.hurtFlash = 0.1;
            r.snapCamera();
            r.render(g, 1, 1 / 60);
            const source = document.querySelector<HTMLCanvasElement>('#game')!;
            // Finish submission and copying before reusing either drawing surface.
            source.getContext('webgl2')?.finish();
            x.drawImage(source, source.width / 2 - 68, source.height / 2 - 100, 136, 140, col * 160 + 12, row * 150 + 26, 136, 140);
            const tile = x.getImageData(col * 160 + 12, row * 150 + 26, 136, 140);
            x.putImageData(tile, col * 160 + 12, row * 150 + 26);
            x.fillStyle = '#e7c368';
            x.fillText(charId, col * 160 + 16, row * 150 + 165);
          });
        });
        return sheet.toDataURL();
      };
      return [make(false), make(true)];
    },
    CHARACTERS.map((c) => c.id),
  );
  for (let i = 0; i < sheets.length; i++) {
    await page.locator('#hud').evaluate((el) => el.classList.add('hidden'));
    await page.evaluate((url) => {
      document.getElementById('animationSheet')?.remove();
      const el = document.createElement('img');
      el.id = 'animationSheet';
      el.style.cssText = 'position:fixed;inset:0;width:960px;height:auto;z-index:100';
      el.src = url;
      document.body.appendChild(el);
    }, sheets[i]!);
    await page.setViewportSize({ width: 960, height: 1825 });
    await page.locator('#animationSheet').screenshot({ path: info.outputPath(i ? 'roster-back.png' : 'roster-front.png') });
  }
  expect(errors).toEqual([]);
});
