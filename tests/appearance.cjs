'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { createDefaultState } = require('../lib/model.cjs');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-appearance-'));
const fixture = path.join(profile, 'wallpaper.png');
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end('<!doctype html><title>Appearance fixture</title>');
});
let app, ui;

async function launch() {
  app = await electron.launch({ args: [root], env: { ...process.env, ORBIT_TEST_MODE: '1', ORBIT_PROFILE: profile } });
  ui = await app.firstWindow();
  ui.setDefaultTimeout(8000);
  ui.on('pageerror', error => console.error(error));
  await ui.waitForFunction(() => window.browser && document.querySelector('#workspaceSurface .pane'));
}

async function action(name, payload = {}) {
  return ui.evaluate(({ name, payload }) => window.browser.action(name, payload), { name, payload });
}

async function state() {
  return ui.evaluate(() => window.browser.getState());
}

async function close() {
  const child = app.process();
  await app.evaluate(({ app }) => { setImmediate(() => app.quit()); }).catch(() => {});
  if (child.exitCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill(); }, 5000);
      child.once('exit', () => { clearTimeout(timer);resolve(); });
    });
  }
  app = null;
}

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const old = createDefaultState();
  old.appearance = { theme: 'light', accent: '#3267cf', tabPosition: 'top', background: 'auto' };
  fs.writeFileSync(path.join(profile, 'orbit-state.json'), JSON.stringify(old));
  await launch();
  const migrated = (await state()).appearance;
  assert.equal(migrated.background, 'auto');
  assert.equal(migrated.accent, '#3267cf');
  assert.equal(migrated.sidebarWidth, 256);
  assert.equal(migrated.showPipTool, true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1040, 600));
  await ui.emulateMedia({ reducedMotion: 'reduce' });
  await ui.locator('.start-bar').getByRole('button', { name: '꾸미기', exact: true }).click();
  const appearanceDialog = ui.getByRole('dialog', { name: 'Orbit 꾸미기' });
  await appearanceDialog.waitFor();
  await appearanceDialog.evaluate(node => Promise.allSettled(node.getAnimations().map(animation => animation.finished)));
  const frame = await appearanceDialog.boundingBox();
  const categories = appearanceDialog.getByRole('navigation', { name: '꾸미기 카테고리' });
  await categories.getByRole('button', { name: '새 탭 페이지', exact: true }).click();
  const results = appearanceDialog.locator('.studio-results');
  assert.ok(await results.evaluate(node => node.scrollHeight > node.clientHeight));
  await results.evaluate(node => { node.scrollTop = node.scrollHeight; });
  assert.ok(await results.evaluate(node => node.scrollTop > 0));
  await categories.getByRole('button', { name: '도구 모음', exact: true }).click();
  assert.equal(await results.evaluate(node => node.scrollTop), 0);
  assert.deepEqual(await appearanceDialog.boundingBox(), frame);
  await ui.keyboard.press('Escape');
  await ui.getByRole('dialog', { name: 'Orbit 꾸미기' }).waitFor({ state: 'detached' });
  await action('navigate', { input: 'orbit://settings' });
  const settings=ui.locator('.settings-dialog');
  await settings.waitFor();
  assert.equal(await settings.locator('.settings-panel').count(),4);
  const rowPadding=await settings.locator('.settings-panel-row').first().evaluate(node=>getComputedStyle(node).paddingBlockStart);
  assert.ok(parseFloat(rowPadding)>=10);
  await ui.locator('.settings-appearance-link').click();
  await ui.getByText('오른쪽 세로 탭', { exact: true }).click();
  await ui.waitForFunction(() => document.querySelector('#app.sidebar-right'));
  assert.equal((await state()).appearance.tabPosition, 'side');
  await ui.getByLabel('탭 간격', { exact: true }).selectOption('compact');
  await ui.getByRole('switch', { name: '탭 닫기 버튼 표시' }).click();
  await ui.locator('#sidebar .tab-action[data-close-tab]').first().waitFor({ state: 'hidden' });
  const search = ui.getByRole('searchbox', { name: '꾸미기 설정 검색' });
  await search.fill('모서리');
  assert.equal(await ui.locator('.studio-section:visible').count(), 1);
  await ui.getByLabel('테마', { exact: true }).selectOption('dark');
  await ui.waitForFunction(() => document.querySelector('#app.dark-chrome'));
  await ui.getByLabel('모서리', { exact: true }).selectOption('square');
  await ui.getByRole('navigation', { name: '꾸미기 카테고리' }).getByRole('button', { name: '새 탭 페이지', exact: true }).click();
  await ui.getByText('비 오는 창가', { exact: true }).click();
  assert.equal((await state()).appearance.background, 'rain');
  await ui.getByRole('switch', { name: '서울 날씨 사용' }).click();
  assert.equal((await state()).appearance.showWeather, false);
  const png = await app.evaluate(({ dialog, nativeImage }, fixture) => {
    const bitmap = Buffer.alloc(16 * 16 * 4, 0xff);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] });
    return nativeImage.createFromBitmap(bitmap, { width: 16, height: 16 }).toPNG().toString('base64');
  }, fixture);
  fs.writeFileSync(fixture, Buffer.from(png, 'base64'));
  await ui.getByRole('button', { name: '내 사진 선택', exact: true }).click();
  await ui.waitForFunction(() => state.appearance.background === 'custom' && state.appearance.customImage?.startsWith('data:image/jpeg;base64,'));
  assert.ok((await state()).appearance.customImage.startsWith('data:image/jpeg;base64,'));
  const navigation = ui.getByRole('navigation', { name: '꾸미기 카테고리' });
  await navigation.getByRole('button', { name: '도구 모음', exact: true }).click();
  await ui.getByRole('switch', { name: '미니 플레이어' }).click();
  await ui.locator('#pipButton').waitFor({ state: 'hidden' });
  await navigation.getByRole('button', { name: '프리셋과 백업', exact: true }).click();
  const backup = path.join(profile, 'appearance.json');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, backup);
  const saved = (await state()).appearance;
  await ui.getByRole('button', { name: '파일로 저장', exact: true }).click();
  await ui.waitForFunction(() => state.notice?.includes('저장했습니다'));
  assert.deepEqual(JSON.parse(fs.readFileSync(backup, 'utf8')).appearance, saved);
  await ui.getByRole('button', { name: '미니멀 프리셋 적용' }).click();
  assert.equal((await state()).appearance.tabPosition, 'top');
  await ui.getByRole('button', { name: '파일 가져오기', exact: true }).click();
  await ui.waitForFunction(() => state.appearance.tabPosition === 'side');
  assert.deepEqual((await state()).appearance, saved);
  fs.writeFileSync(backup, JSON.stringify({ format: 'orbit-appearance', version: 9, appearance: {} }));
  await assert.rejects(action('importAppearance'), /Orbit 꾸미기 파일/);
  assert.deepEqual((await state()).appearance, saved);
  await ui.keyboard.press('Escape');
  await ui.getByRole('dialog', { name: 'Orbit 꾸미기' }).waitFor({ state: 'detached' });
  const resize = ui.getByRole('separator', { name: '세로 탭 너비 조절' });
  await resize.press('ArrowLeft');
  await ui.waitForFunction(() => state.appearance.sidebarWidth === 268);
  await ui.waitForFunction(() => document.querySelector('#sidebar').getBoundingClientRect().width === 268);
  const handle = await resize.boundingBox();
  await ui.mouse.move(handle.x + 4, handle.y + 90);
  await ui.mouse.down();
  await ui.mouse.move(handle.x - 22, handle.y + 90, { steps: 6 });
  await ui.mouse.up();
  await ui.waitForFunction(() => state.appearance.sidebarWidth > 280);
  const configured = (await state()).appearance;
  await action('appearance', { customImage: 'https://example.com/tracker', overlay: 200 });
  assert.equal((await state()).appearance.customImage, configured.customImage);
  assert.equal((await state()).appearance.overlay, 85);
  await action('navigate', { input: base + '/left' });
  await action('newTab', { url: base + '/right' });
  await action('split');
  await action('resizeSplit', { ratio: 62 });
  const guestBounds = () => app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win.contentView.children.filter(view => view.getVisible() && view.webContents?.getURL().startsWith('http:')).map(view => view.getBounds()).sort((a, b) => a.x - b.x);
  });
  let geometry = await guestBounds();
  for (let retry = 0; geometry.length !== 2 && retry < 80; retry++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    geometry = await guestBounds();
  }
  assert.equal(geometry.length, 2);
  const shellGeometry = await ui.locator('#workspaceSurface .pane-content').evaluateAll(nodes => nodes.map(node => {
    const { left, top, right, bottom } = node.getBoundingClientRect();
    return { x: Math.round(left), y: Math.round(top), width: Math.round(right) - Math.round(left), height: Math.round(bottom) - Math.round(top) };
  }));
  assert.deepEqual(geometry, shellGeometry);
  assert.ok(geometry[1].x > geometry[0].x + geometry[0].width, 'divider remains between native views');
  await action('motionPreference', { reduced: true });
  await action('toggleSidebar');
  await ui.waitForFunction(() => document.querySelector('#sidebar').getBoundingClientRect().width === 72);
  await close();
  await launch();
  assert.deepEqual((await state()).appearance, { ...configured, overlay: 85 });
  assert.equal((await state()).splitRatio, 62);
  await action('resetAppearance');
  assert.equal((await state()).appearance.customImage, null);
  assert.equal((await state()).appearance.sidebar, 'left');
  console.log('PASS searchable appearance studio, presets, backup, sidebar drag, split geometry, and restart persistence');

  await ui.locator('#moreButton').click();
  await ui.locator('.app-menu [data-action="card"]').click();
  const card = ui.getByRole('dialog', { name: '내 Orbit 카드' });
  const canvas = card.locator('#orbitCardCanvas');
  const color = () => canvas.evaluate(node => [...node.getContext('2d').getImageData(110, 135, 1, 1).data]);
  const initialColor = await color();
  await card.getByLabel('표시 이름').fill('서울의 궤도');
  await card.getByLabel('한 줄 소개').fill('서울 야경과 코딩을 좋아합니다.');
  await card.getByRole('button', { name: '카드 모양 바꾸기' }).click();
  await ui.waitForFunction(() => state.profile?.displayName === '서울의 궤도' && state.profile.cardSeed === 1);
  assert.notDeepEqual(await color(), initialColor);
  const exportPath = path.join(profile, 'orbit-card.png');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportPath);
  await card.getByRole('button', { name: '카드 PNG 저장' }).click();
  await ui.waitForFunction(() => state.notice?.includes('카드를 저장'));
  const pngCard = fs.readFileSync(exportPath);
  assert.equal(pngCard.readUInt32BE(16), 800);
  assert.equal(pngCard.readUInt32BE(20), 1180);
  console.log('PASS Orbit card style preview, profile edits, and PNG export');
}

run().catch(error => { console.error(error);process.exitCode = 1; }).finally(async () => {
  if (app) await close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 6 });
}).catch(error => { console.error(error);process.exitCode = 1; });
