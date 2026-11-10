'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const profile = path.resolve(root, '..', 'start-page-' + Date.now(), 'profile');

async function run() {
  const app = await electron.launch({
    args: [root],
    env: { ...process.env, ORBIT_TEST_MODE: '1', ORBIT_PROFILE: profile },
  });
  try {
    const ui = await app.firstWindow();
    const errors = [];
    ui.on('pageerror', error => errors.push(error.message));
    const prefs = payload => ui.evaluate(payload => window.browser.action('appearance', payload), payload);
    const start = ui.locator('.seoul-start');
    await start.waitFor();
    const clock = start.locator('.start-clock');
    await clock.waitFor();
    assert.match(await clock.getAttribute('aria-label'), /^서울 시각 \d{2}:\d{2}$/);
    assert.ok(await clock.evaluate(time => [...time.querySelectorAll('mask path')].length === 4
      && [...time.querySelectorAll('mask path')].every(path => path.getAttribute('d')?.length > 0)));
    const clockPixels = await clock.evaluate(async time => {
      const previous = time.dataset.time;
      time.setDigits('12:06');
      const svg = time.firstElementChild.cloneNode(true);
      time.setDigits(previous);
      svg.setAttribute('width', '278');
      svg.setAttribute('height', '100');
      const vector = new XMLSerializer().serializeToString(svg);
      const image = new Image();
      image.src = 'data:image/svg+xml,' + encodeURIComponent(vector);
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 278;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, 278, 100);
      return [[...ctx.getImageData(35, 50, 1, 1).data], [...ctx.getImageData(248, 88, 1, 1).data]];
    });
    const [[leftRed, leftGreen, , leftAlpha], [rightRed, rightGreen, , rightAlpha]] = clockPixels;
    assert.ok(leftAlpha > 200 && rightAlpha > 200 && leftRed > leftGreen && rightGreen > rightRed, JSON.stringify(clockPixels));
    assert.ok(await start.locator('.start-search').evaluate(button => getComputedStyle(button).backdropFilter.includes('blur(')));
    await ui.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await clock.evaluate(time => getComputedStyle(time).animationName), 'none');
    await ui.waitForFunction(() => ['day', 'night'].includes(document.querySelector('.seoul-start')?.dataset.scene));
    const offline = await ui.evaluate(() => window.browser.getSeoulWeather());
    assert.equal(offline.live, false);
    assert.ok(['day', 'night'].includes(offline.scene));
    await ui.waitForFunction(() => !startWeatherRequest);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('orbit:seoul-weather');
      ipcMain.handle('orbit:seoul-weather', () => ({
        scene: globalThis.fixtureSeoulScene,
        condition: globalThis.fixtureSeoulScene === 'rain' ? '비' : '눈',
        temperature: 1,
        live: true,
      }));
    });
    for (const scene of ['rain', 'snow']) {
      await app.evaluate((_electron, scene) => { globalThis.fixtureSeoulScene = scene; }, scene);
      await ui.evaluate(() => { startWeatherRefreshAt = 0; syncStartEnvironment(); });
      await ui.locator(`.seoul-start[data-scene="${scene}"]`).waitFor();
      assert.match(await ui.locator('.start-weather').textContent(), /1 °C/);
      await ui.waitForFunction(() => !startWeatherRequest);
    }
    await prefs({ showWeather: false });
    await ui.waitForFunction(() => ['day', 'night'].includes(document.querySelector('.seoul-start')?.dataset.scene));
    await ui.locator('.start-weather').waitFor({ state: 'hidden' });
    console.log('PASS automatic Seoul background follows rain and snow and falls back to time');

    for (const scene of ['day', 'night', 'rain', 'snow']) {
      await prefs({ background: scene });
      await ui.locator(`.seoul-start[data-scene="${scene}"]`).waitFor();
      await ui.waitForFunction(scene => getComputedStyle(document.querySelector('.start-photo')).backgroundImage.includes(`seoul-${scene}.jpg`), scene);
      const sceneResult = await start.evaluate(async (page, scene) => {
        const style = getComputedStyle(page.querySelector('.start-photo')).backgroundImage;
        if (!style.includes(`seoul-${scene}.jpg`)) return { style, scene, actual:page.dataset.scene };
        const image = new Image();
        image.src = new URL(`wallpapers/seoul-${scene}.jpg`, location.href);
        await image.decode();
        return { style, width: image.naturalWidth, height: image.naturalHeight };
      }, scene);
      assert.ok(sceneResult.width >= 1600 && sceneResult.width / sceneResult.height > 1.7, JSON.stringify(sceneResult));
    }
    console.log('PASS four bundled photographs decode and apply to the start page');

    await prefs({ background: 'solid', backgroundColor: '#283a62', showClock: false, showPresets: false, dialSize: 'large' });
    await ui.locator('.seoul-start[data-scene="solid"]').waitFor();
    await ui.locator('.start-clock').waitFor({ state: 'hidden' });
    assert.equal(await ui.locator('.start-photo').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(40, 58, 98)');
    await ui.getByRole('button', { name: '사이트 추가', exact: true }).click();
    const form = ui.getByRole('dialog', { name: '스피드 다이얼 추가' });
    await form.getByLabel('웹 주소').fill('discord.com');
    await form.getByLabel('이름 (선택)').fill('나의 Discord');
    await form.getByRole('button', { name: '추가', exact: true }).click();
    await form.waitFor({ state: 'detached' });
    const tile = start.getByRole('button', { name: '나의 Discord', exact: true });
    await tile.waitFor();
    await tile.locator('img').evaluate(image => image.decode());
    const discord = (await ui.evaluate(() => window.browser.getState())).favorites[0];
    assert.equal(discord.url, 'https://discord.com/');
    await ui.evaluate(id => openDialEditor(id), discord.id);
    const editor = ui.getByRole('dialog', { name: '바로가기 편집' });
    await editor.getByLabel('이름 (선택)').fill('Discord 커뮤니티');
    await editor.getByRole('button', { name: '저장', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await start.getByRole('button', { name: 'Discord 커뮤니티', exact: true }).waitFor();
    await ui.evaluate(async id => {
      await send('addFavorite', { title: '새 바로가기', url: 'https://example.org/' });
      await send('moveFavorite', { id, direction: 'later' });
    }, discord.id);
    assert.deepEqual(await start.locator('.start-tiles .start-tile-name').allTextContents(), ['새 바로가기', 'Discord 커뮤니티']);
    assert.equal(await start.locator('.start-shortcuts').getAttribute('data-size'), 'large');
    await prefs({ showShortcuts: false });
    await start.locator('.start-shortcuts').waitFor({ state: 'hidden' });
    await ui.locator('#topNewTab').click();
    await ui.waitForFunction(async () => (await window.browser.getState()).tabs.length === 2);
    assert.equal(await ui.locator('#paletteInput').count(), 0);
    await prefs({ focusNewTab: true });
    await ui.locator('#topNewTab').click();
    await ui.locator('#paletteInput').waitFor();
    await ui.keyboard.press('Escape');
    await ui.locator('#paletteInput').waitFor({ state: 'detached' });
    await prefs({ focusNewTab: false });
    await ui.keyboard.press('Control+t');
    await ui.locator('#paletteInput').waitFor();
    await ui.keyboard.press('Escape');
    await ui.locator('#paletteInput').waitFor({ state: 'detached' });
    const current = await ui.evaluate(() => window.browser.getState());
    await ui.locator('#topGroupButton').click();
    await ui.getByLabel('탭 그룹 이름').fill('서울 여행');
    await ui.getByRole('button', { name: '탭 그룹 저장' }).click();
    await ui.locator('#stackStrip').waitFor();
    assert.equal(await ui.locator('#stackName').textContent(), '서울 여행');
    const action = (name, payload) => ui.evaluate(({ name, payload }) => window.browser.action(name, payload), { name, payload });
    const group = (await ui.evaluate(() => window.browser.getState())).folders[0];
    const sibling = current.tabs.find(tab => tab.id !== current.activeTabId).id;
    await action('moveTab', { id: sibling, folderId: group.id });
    assert.equal(await ui.locator('#stackTabs .top-tab').count(), 2);
    await ui.locator(`#stackTabs [data-top-tab-id="${sibling}"] .top-tab-select`).click();
    await ui.waitForFunction(id => state.activeTabId === id, sibling);
    await action('deleteFolder', { id: group.id });
    await ui.locator('#stackStrip').waitFor({ state: 'hidden' });
    assert.equal((await ui.evaluate(() => window.browser.getState())).tabs.length, current.tabs.length);
    console.log('PASS two-level tab groups create, switch, and dissolve without closing tabs');
    assert.deepEqual(errors, []);
    console.log('PASS custom settings, Discord dial, and optional address focus');
  } finally {
    const child = app.process();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      const fallback = setTimeout(() => child.kill(), 5000);
      try {
        await app.evaluate(({ app }) => setImmediate(() => app.exit(0))).catch(() => {});
        await exited;
      } finally {
        clearTimeout(fallback);
      }
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
