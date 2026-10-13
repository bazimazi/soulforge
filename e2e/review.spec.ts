import { expect, test, type Page } from '@playwright/test';
import { CHARACTERS } from '../src/data/characters';
import { craftItem, metaRng, SLOTS } from '../src/data/forge';
import { STAGES } from '../src/data/passives';
import { SOUL_ARTS } from '../src/data/soularts';
import { WEAPONS } from '../src/data/weapons';
import { BOSSES } from '../src/data/enemies';
import { defaults } from '../src/meta/save';

function veteran() {
  metaRng.reseed(123);
  const d = defaults();
  d.story.prologue = true;
  d.gold = 100000;
  d.embers = 2000;
  d.mats = { iron: 800, dust: 500, crystal: 200, star: 100, eclipse: 50 };
  d.forge.level = 10;
  d.soul.level = 25;
  d.stats.runs = 30;
  d.stats.bossKills = 20;
  d.stages.unlocked = STAGES.map((s) => s.id);
  for (const s of STAGES) {
    d.stages.best[s.id] = 1800;
    d.torment.best[s.id] = 5;
  }
  for (const c of CHARACTERS)
    d.chars[c.id] = {
      unlocked: true,
      xp: 0,
      level: 30,
      talents: {},
      paragon: {},
      runs: 3,
      kills: 5000,
      bosses: 8,
      bestTime: 1800,
      bestLevel: 80,
      chapters: {},
      ascension: 1,
      bestTorment: 3,
    };
  for (const a of SOUL_ARTS) d.arts[a.id] = 2;
  d.art = 'sunfall';
  for (const slot of SLOTS) {
    const item = craftItem(slot.id, 10, { minRarity: 4 });
    d.items.push(item);
    d.equipped[slot.id] = item.uid;
  }
  return d;
}

async function seed(page: Page, url: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text());
  });
  await page.addInitScript((d) => localStorage.setItem('soulforge_save_v1', JSON.stringify(d)), veteran());
  await page.goto(url);
  await expect(page.locator('#playBtn')).toBeVisible();
  return errors;
}

async function overflow(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.screen-head, .screen-body, .modal-box')]
      .filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth + 2)
      .map((e) => `${e.className}: ${e.scrollWidth} > ${e.clientWidth}`),
  );
}

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 320, height: 568 },
]) {
  test(`progressed account: every screen and tab at ${viewport.width}x${viewport.height}`, async ({ page, baseURL }, info) => {
    test.setTimeout(120000);
    await page.setViewportSize(viewport);
    const errors = await seed(page, baseURL!);
    const layout: string[] = [];
    const capture = async (label: string) => {
      layout.push(...(await overflow(page)).map((x) => `${label}: ${x}`));
      await page.screenshot({ path: info.outputPath(label + '.png'), animations: 'disabled' });
    };
    const bottom = async (label: string) => {
      await page.locator('.screen-body, .modal-box').evaluateAll((els) =>
        els.forEach((el) => {
          el.scrollTop = el.scrollHeight;
        }),
      );
      await capture(label + '-bottom');
      await page.locator('.screen-body, .modal-box').evaluateAll((els) =>
        els.forEach((el) => {
          el.scrollTop = 0;
        }),
      );
    };
    await capture('title');
    // All title buttons must be reachable, including on short landscape screens.
    await page.locator('#settingsBtn').scrollIntoViewIfNeeded();
    await expect(page.locator('#settingsBtn')).toBeInViewport();
    for (const id of ['talentsBtn', 'ascendBtn', 'forgeBtn', 'codexBtn', 'settingsBtn']) {
      await page.click('#' + id);
      await capture(id);
      await bottom(id);
      const tabs = await page.locator('.tabs button').count();
      for (let i = 0; i < tabs; i++) {
        await page.locator('.tabs button').nth(i).click();
        await capture(id + '-tab-' + i);
        await bottom(id + '-tab-' + i);
        if (id === 'forgeBtn' && (await page.locator('.tabs button').nth(i).getAttribute('data-t')) === 'armory') {
          await page.locator('#inv .item').first().click();
          await page.locator('#itemDetail').scrollIntoViewIfNeeded();
          await capture('gear-detail');
          await bottom('gear-detail');
        }
      }
      await page.click('#backBtn');
    }
    await page.click('#playBtn');
    if (viewport.width <= 700) {
      expect(
        await page.evaluate(
          () =>
            document.getElementById('charGrid')!.getBoundingClientRect().bottom <=
            document.getElementById('charDetail')!.getBoundingClientRect().top,
        ),
      ).toBe(true);
    }
    for (const c of CHARACTERS) {
      await page.locator(`.char-card[data-id="${c.id}"]`).click();
      await page.locator('#charDetail').scrollIntoViewIfNeeded();
      await capture('champion-' + c.id);
      await bottom('champion-' + c.id);
    }
    await page.click('#toSetup');
    for (const stage of STAGES) {
      await page.locator(`.stage-card[data-id="${stage.id}"]`).click();
      await capture('stage-' + stage.id);
    }
    await page.click('#tUp');
    await page.locator('#omenList button[data-d="1"]').first().click();
    await bottom('difficulty');
    await page.click('#beginBtn');
    await expect(page.locator('#hud')).toBeVisible();
    await page.evaluate(() => {
      window.__SF!.game.player.invulnT = 9999;
    });
    await capture('gameplay');
    await page.keyboard.press('KeyM');
    await capture('map');
    await page.keyboard.press('KeyM');
    await page.click('#pauseBtn');
    await capture('pause');
    await page.click('#resumeBtn');
    await page.evaluate(() => {
      window.__SF!.game.gainXp(50);
    });
    await expect(page.locator('#modal .card')).not.toHaveCount(0);
    await capture('levelup');
    // Focus stays inside choices and Shift+Tab wraps to the final control.
    const first = page.locator('#modal [tabindex="0"], #modal button:not(:disabled)').first();
    await first.focus();
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.getElementById('modal')!.contains(document.activeElement))).toBe(true);
    await page.evaluate(() => {
      const g = window.__SF!.game;
      g.levelQueue = 0;
      g.pickOption({ type: 'gold', value: 0 });
      const w = g.player.weapons[0]!;
      w.level = w.def.max;
      g.addPassive(w.def.evo!.with);
      g.recalc();
      g.chestQueue.push({ boss: true });
    });
    await expect(page.locator('#chestOk')).toBeVisible();
    await capture('chest');
    await bottom('chest');
    await page.click('#chestOk');
    await expect(page.locator('.boon-card').first()).toBeVisible();
    await capture('boons');
    await page.locator('.boon-card').first().click();
    await page.evaluate(() => {
      const g = window.__SF!.game;
      g.player.revivals = 0;
      g.player.invulnT = 0;
      g.player.stats.dodge = 0;
      g.player.f.b_ward = false;
      g.player.f.res_holy = g.player.f.b_phoenix = false;
      g.hitPlayer(1e9);
    });
    await expect(page.locator('#goMenu')).toBeVisible();
    await capture('results');
    await bottom('results');
    expect(errors).toEqual([]);
    expect(layout).toEqual([]);
  });
}

test('settings import applies rendering preferences and keeps keyboard controls usable', async ({ page, baseURL }) => {
  const errors = await seed(page, baseURL!);
  await page.click('#settingsBtn');
  const d = veteran();
  Object.assign(d.settings, { reducedMotion: true, quality: 0.6, dmgMeter: false, sfx: 0, music: 0 });
  await page.locator('#saveTxt').fill(JSON.stringify(d));
  await page.click('#impBtn');
  expect(await page.evaluate(() => window.__SF!.renderer.quality)).toBe(0.6);
  await expect(page.locator('html')).toHaveClass(/reduced-motion/);
  await page.locator('#playBtn').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#toSetup')).toBeVisible();
  await page.click('#toSetup');
  await page.click('#beginBtn');
  await page.click('#pauseBtn');
  await page.locator('#resumeBtn').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#modal')).toBeHidden();
  expect(await page.evaluate(() => window.__SF!.game.player.dashCharges)).toBe(1);
  await expect(page.locator('#dmgmeter')).toHaveClass(/collapsed/);
  expect(errors).toEqual([]);
});

test('Forge and Soul Art transactions update the UI and persist across reload', async ({ page, baseURL }) => {
  const errors = await seed(page, baseURL!);
  await page.click('#forgeBtn');
  await page.locator('.tabs button[data-t="armory"]').click();
  const progress = await page.locator('#forgeProgress').innerText();
  await page.click('#craftBtn');
  await expect(page.locator('#inv .item')).toHaveCount(7);
  await expect(page.locator('#forgeProgress')).not.toHaveText(progress);
  await page.click('#eqBtn');
  await expect(page.locator('#eqBtn')).toHaveText('Unequip');
  await page.click('#upBtn');
  await expect(page.locator('#itemDetail')).toContainText('+1/');
  await page.click('#backBtn');
  await page.click('#ascendBtn');
  await page.locator('.tabs button[data-t="arts"]').click();
  await page.locator('[data-up="sunfall"]').click();
  await expect(page.locator('[data-up="sunfall"]')).toContainText('Level 4');
  // Wait for the coalesced save, then use a second page without the seeding script.
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('soulforge_save_v1')!).arts.sunfall)).toBe(3);
  const fresh = await page.context().newPage();
  await fresh.goto(baseURL!);
  await fresh.click('#forgeBtn');
  await fresh.locator('.tabs button[data-t="armory"]').click();
  await expect(fresh.locator('#inv .item')).toHaveCount(7);
  await fresh.close();
  expect(errors).toEqual([]);
});

test('every stage renders Eclipse combat and all Heralds without errors', async ({ page, baseURL }, info) => {
  test.setTimeout(90000);
  const errors = await seed(page, baseURL!);
  await page.click('#playBtn');
  await page.click('#toSetup');
  await page.click('#beginBtn');
  for (const stage of STAGES) {
    await page.evaluate(
      ({ stage, bosses }) => {
        const g = window.__SF!.game;
        g.start({
          charId: 'lyra',
          stageId: stage,
          torment: 20,
          seed: 53,
          meta: { stats: {}, flags: {}, weaponMastery: {} },
          art: { id: 'thunderhead', level: 5 },
        });
        g.player.invulnT = 9999;
        g.time = 1801;
        g.addWeapon('fireball');
        g.addWeapon('frost_lance');
        for (const id of bosses) {
          const b = g.spawnBoss(id, 3);
          b.x = b.px = g.player.x + 120;
          b.y = b.py = g.player.y + 120;
          b.hp = b.maxHp * 0.4;
        }
        g.useActive();
        g.useArt();
      },
      { stage: stage.id, bosses: Object.keys(BOSSES) },
    );
    await expect.poll(() => page.evaluate(() => window.__SF!.game.eclipse)).toBe(true);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: info.outputPath('eclipse-' + stage.id + '.png') });
  }
  expect(errors).toEqual([]);
});

test('installed assets boot offline', async ({ page, baseURL, context }) => {
  await seed(page, baseURL!);
  await page.evaluate(() => navigator.serviceWorker.ready);
  // A newly installed worker controls the next navigation; the first online page can be uncontrolled.
  await context.setOffline(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.locator('#playBtn')).toBeVisible();
  await page.click('#playBtn');
  await page.click('#toSetup');
  await page.click('#beginBtn');
  await expect.poll(() => page.evaluate(() => window.__SF!.game.time)).toBeGreaterThan(0);
});

test('WebGL recovers from context loss during a run', async ({ page, baseURL }) => {
  test.skip(baseURL!.includes('canvas2d'), 'WebGL-specific recovery');
  const errors = await seed(page, baseURL!);
  await page.click('#playBtn');
  await page.click('#toSetup');
  await page.click('#beginBtn');
  await page.evaluate(async () => {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_lose_context')!;
    const lost = new Promise<void>((resolve) => canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }));
    ext.loseContext();
    await lost;
    await new Promise((resolve) => setTimeout(resolve, 150));
    const restored = new Promise<void>((resolve) => canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true }));
    ext.restoreContext();
    await restored;
  });
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(() => {
      const h = window.__SF!;
      h.renderer.render(h.game, 1, 1 / 60);
      const gl = (document.getElementById('game') as HTMLCanvasElement).getContext('webgl2')!;
      const pixels = new Uint8Array(4 * 16 * 16);
      gl.readPixels(0, 0, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return !gl.isContextLost() && gl.getError() === gl.NO_ERROR && pixels.some((n, i) => i % 4 !== 3 && n > 0);
    }),
  ).toBe(true);
  expect(errors).toEqual([]);
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
]) {
  test(`in-run settings safely pause, apply and resume at ${viewport.width}x${viewport.height}`, async ({ page, baseURL }, info) => {
    await page.setViewportSize(viewport);
    const errors = await seed(page, baseURL!);
    await page.click('#contBtn');
    await page.evaluate(() => {
      window.__SF!.game.player.invulnT = 999;
    });
    await page.click('#hudSettingsBtn');
    const frozen = await page.evaluate(() => ({ time: window.__SF!.game.time, hp: window.__SF!.game.player.hp }));
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.locator('#fxR').fill('0.1');
    await page.locator('#fxR').dispatchEvent('input');
    await page.locator('#qualS').selectOption('0.6');
    await expect(page.locator('#fxValue')).toHaveText('10%');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => ({ time: window.__SF!.game.time, hp: window.__SF!.game.player.hp }))).toEqual(frozen);
    expect(await page.evaluate(() => ({ intensity: window.__SF!.renderer.fx.intensity, quality: window.__SF!.renderer.quality }))).toEqual({
      intensity: 0.1,
      quality: 0.6,
    });
    expect(await overflow(page)).toEqual([]);
    await page.screenshot({ path: info.outputPath('run-settings.png') });
    await page.click('#settingsPause');
    await expect(page.locator('#resumeBtn')).toBeVisible();
    await page.click('#pauseSettingsBtn');
    await page.click('#settingsResume');
    await expect.poll(() => page.evaluate(() => window.__SF!.game.time)).toBeGreaterThan(frozen.time);
    await page.keyboard.press('Space');
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.click('#hudSettingsBtn');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.click('#hudSettingsBtn');
    await page.keyboard.press('p');
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('soulforge_save_v1')!).settings.fxIntensity)).toBe(0.1);
    expect(errors).toEqual([]);
  });
}

test('crowded apotheosis arsenals remain drawable at both spell intensity limits', async ({ page, baseURL }, info) => {
  test.setTimeout(120000);
  const errors = await seed(page, baseURL!);
  await page.click('#contBtn');
  await page.evaluate(() => window.__SF!.loop.stop());
  const weapons = Object.keys(WEAPONS);
  for (let group = 0; group < weapons.length; group += 6) {
    await page.evaluate(
      (ids) => {
        const { game: g, renderer: r } = window.__SF!;
        g.start({ charId: 'lyra', stageId: 'ashen', seed: 87, meta: { stats: { area: 1, amount: 3 }, flags: {}, weaponMastery: {} } });
        g.player.weapons = [];
        g.player.invulnT = 999;
        for (const id of ids) {
          const w = g.addWeapon(id);
          w.level = w.def.max + 3;
          w.evolved = true;
          w.apex = true;
        }
        g.recalc();
        for (let i = 0; i < 24; i++) {
          const angle = (i * Math.PI) / 12;
          const e = g.spawnEnemy('brute', Math.cos(angle) * 150, Math.sin(angle) * 150);
          e.hp = e.maxHp = 1e8;
          e.speed = 0;
        }
        r.fx.intensity = 1;
        for (let i = 0; i < 240; i++) {
          g.update(1 / 60);
          r.fx.update(1 / 60);
        }
        r.fx.telegraphCircle(80, 0, 85, 2, '#f87171');
        g.state = 'paused';
        r.render(g, 1, 0);
      },
      weapons.slice(group, group + 6),
    );
    // Let stage-entry title cards and milestone notices finish before judging combat readability.
    if (group === 0) await page.waitForTimeout(7000);
    else await page.waitForTimeout(3500);
    await page.screenshot({ path: info.outputPath(`arsenal-${group}-high.png`) });
    await page.evaluate(() => {
      const h = window.__SF!;
      h.renderer.fx.intensity = 0.1;
      h.renderer.render(h.game, 1, 0);
    });
    await page.screenshot({ path: info.outputPath(`arsenal-${group}-low.png`) });
  }
  expect(errors).toEqual([]);
});

test('lowering spell effects dims existing effects without dimming attack warnings', async ({ page, baseURL }) => {
  const errors = await seed(page, baseURL!);
  await page.click('#contBtn');
  const draws = await page.evaluate(() => {
    const { game: g, renderer: r, loop } = window.__SF!;
    loop.stop();
    g.state = 'paused';
    r.fx.explosion(0, 0, 300, '#10eeaa');
    r.fx.telegraphCircle(60, 0, 85, 2, '#fe1234');
    const b = r.backend,
      ring = b.ring,
      glow = b.glow;
    let warning: number[] = [],
      spell: number[] = [];
    b.ring = (...args) => {
      if (args[6] === '#fe1234') warning.push(args[7]);
      ring.apply(b, args);
    };
    b.glow = (...args) => {
      if (args[3] === '#10eeaa') spell.push(args[4]);
      glow.apply(b, args);
    };
    try {
      r.fx.intensity = 1;
      r.render(g, 1, 0);
      const high = { warning, spell };
      warning = [];
      spell = [];
      r.fx.intensity = 0.1;
      r.render(g, 1, 0);
      return { high, low: { warning, spell } };
    } finally {
      b.ring = ring;
      b.glow = glow;
    }
  });
  expect(draws.high.warning.length).toBeGreaterThan(0);
  expect(draws.low.warning).toEqual(draws.high.warning);
  expect(draws.high.spell.length).toBeGreaterThan(0);
  expect(draws.low.spell.reduce((a, b) => a + b, 0)).toBeLessThan(draws.high.spell.reduce((a, b) => a + b, 0) * 0.2);
  expect(errors).toEqual([]);
});
