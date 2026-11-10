'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><title>Fixture ${request.url}</title><a href="/next">Next</a>`);
});

async function eventually(read, verify, description) {
  let value;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    value = await read();
    if (verify(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 70));
  }
  throw new Error(description + ': ' + JSON.stringify(value));
}

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const profile = await fs.mkdtemp(path.resolve(root, '..', 'work-area-'));
  const app = await electron.launch({ args: [root], env: { ...process.env, ORBIT_TEST_MODE: '1', ORBIT_PROFILE: profile } });
  try {
    const ui = await app.firstWindow();
    const errors = [];
    ui.on('pageerror', error => errors.push(error.message));
    ui.setDefaultTimeout(7000);
    await ui.locator('#workspaceSurface .pane-content').waitFor();
    const action = (name, payload = {}) => ui.evaluate(({ name, payload }) => window.browser.action(name, payload), { name, payload });
    const state = () => ui.evaluate(() => window.browser.getState());
    const readGuest = () => app.evaluate(({ BrowserWindow }, base) => BrowserWindow.getAllWindows()[0].contentView.children
      .filter(view => view.getVisible() && view.webContents?.getURL().startsWith(base))
      .map(view => ({ path: new URL(view.webContents.getURL()).pathname, ...view.getBounds() })).sort((a, b) => a.x - b.x), base);
    const readShell = () => ui.evaluate(() => [...document.querySelectorAll('.pane-content')]
      .filter(element => element.offsetWidth > 0)
      .map(element => {
        const { left, top, right, bottom } = element.getBoundingClientRect();
        return { x: Math.round(left), y: Math.round(top), width: Math.round(right) - Math.round(left), height: Math.round(bottom) - Math.round(top) };
      }).sort((a, b) => a.x - b.x));
    const verifyBounds = () => eventually(async () => {
      const guest = (await readGuest()).map(({ path, ...rect }) => rect);
      return { guest, shell: await readShell() };
    }, ({ guest, shell }) => guest.length > 0 && JSON.stringify(guest) === JSON.stringify(shell), 'Native views match shell content geometry');

    const first = await action('navigate', { input: base + '/first' });
    const second = await action('newTab', { url: base + '/second' });
    const third = await action('newTab', { url: base + '/third' });
    await action('split', { id: first.activeTabId });
    await verifyBounds();
    assert.equal(await ui.locator('.pane-header:visible').count(), 2);
    assert.deepEqual((await state()).splitTabIds, [third.activeTabId, first.activeTabId]);
    await ui.locator('#moreButton').click();
    await ui.getByRole('menuitem', { name: '페이지에서 찾기', exact: true }).click();
    const find = ui.locator('#findToolbar');
    await find.waitFor();
    const findBounds = await find.boundingBox();
    assert.ok(findBounds.y + findBounds.height <= Math.min(...(await readGuest()).map(view => view.y)));
    await find.locator('#findInput').fill('Next');
    await eventually(state, value => value.findResult?.matches === 1, 'Find works above the split pages');
    await find.locator('#findClose').click();
    await find.waitFor({ state: 'hidden' });
    const divider = ui.getByRole('separator', { name: '분할 화면 너비' });
    await divider.focus();
    await divider.press('ArrowRight');
    await eventually(state, value => value.splitRatio === 53, 'Keyboard split resize');
    const handle = await divider.boundingBox();
    await ui.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await ui.mouse.down();
    await ui.mouse.move(handle.x + handle.width / 2 + 100, handle.y + handle.height / 2, { steps: 12 });
    await ui.mouse.up();
    await eventually(state, value => value.splitRatio > 53, 'Pointer split resize');
    await verifyBounds();

    await ui.getByRole('button', { name: '이 패널의 탭 선택' }).first().click();
    await ui.getByRole('dialog', { name: '분할 화면 탭 선택' }).getByRole('button', { name: 'Fixture /second', exact: true }).click();
    await eventually(state, value => value.splitTabIds[0] === second.activeTabId, 'Pane replacement');
    await verifyBounds();
    await ui.getByRole('button', { name: '이 패널 분할 해제' }).first().click();
    await eventually(state, value => !value.splitTabIds.length && value.activeTabId === first.activeTabId, 'Pane dismissal');
    assert.equal((await state()).tabs.length, 3);

    await app.evaluate(async ({ BrowserWindow }, base) => {
      const first = BrowserWindow.getAllWindows()[0].contentView.children.find(view => view.webContents?.getURL() === base + '/first');
      await first.webContents.executeJavaScript("localStorage.setItem('panel-fixture', 'current-space')");
    }, base);
    await ui.getByRole('button', { name: '웹 패널', exact: true }).click();
    await ui.getByRole('textbox', { name: '웹 패널 주소 또는 검색어' }).fill(base + '/panel');
    await ui.getByRole('button', { name: '열기', exact: true }).click();
    await verifyBounds();
    const panelStorage = await app.evaluate(async ({ BrowserWindow }, base) => {
      const panel = BrowserWindow.getAllWindows()[0].contentView.children.find(view => view.webContents?.getURL() === base + '/panel');
      return panel.webContents.executeJavaScript("localStorage.getItem('panel-fixture')");
    }, base);
    assert.equal(panelStorage, 'current-space');
    await action('createSpace', { name: '패널 격리 검사' });
    await ui.locator('#webPanel').waitFor({ state: 'hidden' });
    assert.ok((await readGuest()).every(entry => entry.path !== '/panel'));
    await action('switchSpace', { id: first.activeSpaceId });
    await verifyBounds();
    await ui.getByRole('button', { name: '웹 패널 닫기', exact: true }).click();
    await ui.locator('#webPanel').waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    console.log('PASS split resize, tab selection, pane dismissal, and same-space sidebar web panel');
  } finally {
    const child = app.process();
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      const kill = setTimeout(() => child.kill(), 3500);
      await app.evaluate(({ app }) => setImmediate(() => app.exit(0))).catch(() => {});
      await exited;
      clearTimeout(kill);
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
