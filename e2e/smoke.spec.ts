import { expect, test, type Page } from '@playwright/test';

/** Collect uncaught errors and console errors for the whole test. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    // the Google Fonts request may fail offline/in CI sandboxes; that's not a game error
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text()) && !m.text().includes('Failed to load resource'))
      errors.push(m.text());
  });
  page.on('dialog', (d) => d.accept());
  return errors;
}

const state = (page: Page) => page.evaluate(() => window.__SF!.game.state);

/** Open the game; a fresh profile sees the Keeper's prologue first, which Escape skips. */
async function boot(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('#prologue')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#playBtn')).toBeVisible();
}

test('boots to the title screen with the selected renderer', async ({ page, baseURL }) => {
  const errors = trackErrors(page);
  await boot(page, baseURL!);
  const kind = await page.evaluate(() => window.__SF!.renderer.backend.kind);
  expect(kind).toBe(baseURL!.includes('canvas2d') ? 'canvas2d' : 'webgl2');
  expect(errors).toEqual([]);
});

test('meta screens open and close', async ({ page, baseURL }) => {
  const errors = trackErrors(page);
  await boot(page, baseURL!);
  for (const id of ['talentsBtn', 'forgeBtn', 'codexBtn', 'settingsBtn']) {
    await page.click('#' + id);
    await expect(page.locator('#backBtn')).toBeVisible();
    // visit every tab on tabbed screens
    for (const tab of await page.locator('.tabs button').all()) await tab.click();
    await page.click('#backBtn');
    await expect(page.locator('#playBtn')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('a full run: start, level up, pause, abandon, results', async ({ page, baseURL }) => {
  const errors = trackErrors(page);
  await boot(page, baseURL!);
  await page.click('#playBtn');
  await page.click('#toSetup');
  await page.click('#beginBtn');
  await expect.poll(() => state(page)).toBe('play');
  await expect(page.locator('#hud')).toBeVisible();

  // fast-forward progress: grant enough XP for a level-up and let the sim raise the modal
  await page.evaluate(() => window.__SF!.game.gainXp(50));
  await expect.poll(() => state(page)).toBe('levelup');
  // 50 XP is several levels' worth: pick a card for each until play resumes
  for (let i = 0; i < 10 && (await state(page)) === 'levelup'; i++) {
    await page.locator('#modal .card').first().click();
    await page.waitForTimeout(100);
  }
  await expect.poll(() => state(page)).toBe('play');
  expect(await page.evaluate(() => window.__SF!.game.player.level)).toBeGreaterThan(1);

  // a boss trove is followed by a choice of boons
  await page.evaluate(() => window.__SF!.game.chestQueue.push({ boss: true }));
  await expect.poll(() => state(page)).toBe('chest');
  await page.click('#chestOk');
  await expect.poll(() => state(page)).toBe('boon');
  await expect(page.locator('#modal .boon-card')).toHaveCount(3);
  await page.locator('#modal .boon-card').first().click();
  await expect.poll(() => state(page)).toBe('play');
  expect(await page.evaluate(() => window.__SF!.game.player.boons.length)).toBe(1);

  // play a few seconds with movement
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyD');
  const t = await page.evaluate(() => window.__SF!.game.time);
  expect(t).toBeGreaterThan(1.5);

  // the on-screen HUD buttons (the only controls on touch screens) are clickable; the ability button
  // pulses forever, so click its centre with the real mouse rather than waiting for it to be "stable"
  const ab = (await page.locator('#abBtn').boundingBox())!;
  await page.mouse.click(ab.x + ab.width / 2, ab.y + ab.height / 2);
  await expect.poll(() => page.evaluate(() => window.__SF!.game.player.activeCharges)).toBe(0);
  await page.click('#pauseBtn');
  await expect.poll(() => state(page)).toBe('paused');
  await page.click('#resumeBtn');
  await expect.poll(() => state(page)).toBe('play');

  // pause / resume / abandon
  await page.keyboard.press('Escape');
  await expect.poll(() => state(page)).toBe('paused');
  await page.click('#resumeBtn');
  await expect.poll(() => state(page)).toBe('play');
  await page.keyboard.press('Escape');
  await page.click('#quitBtn');
  await expect(page.locator('#goMenu')).toBeVisible();
  await page.click('#goMenu');
  await expect(page.locator('#playBtn')).toBeVisible();
  // with a run behind you, the title offers to continue with the same champion and stage
  await expect(page.locator('#contBtn')).toBeVisible();

  // the run was recorded in the save
  const runs = await page.evaluate(() => JSON.parse(localStorage.getItem('soulforge_save_v1') || '{}').stats?.runs ?? 0);
  expect(runs).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
});
