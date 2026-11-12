'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><title>' + request.url.slice(1) + '</title>');
});

async function waitFor(read, accepts) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const value = await read();
    if (accepts(value)) return value;
    await delay(75);
  }
  throw new Error('Browser state did not update');
}

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const profile = await fs.mkdtemp(path.resolve(root, '..', 'tab-search-'));
  let app;
  try {
    app = await electron.launch({ args: [root], env: { ...process.env, ORBIT_TEST_MODE: '1', ORBIT_PROFILE: profile } });
    const ui = await app.firstWindow();
    const errors = [];
    ui.on('pageerror', error => errors.push(error.message));
    const action = (name, payload = {}) => ui.evaluate(({ name, payload }) => window.browser.action(name, payload), { name, payload });
    const read = () => ui.evaluate(() => window.browser.getState());
    const dialog = ui.getByRole('dialog', { name: '탭 검색' });
    const input = dialog.getByRole('combobox');
    const first = await action('navigate', { input: base + '/map' });
    const second = await action('newTab', { url: base + '/notes' });
    const office = await action('createSpace', { name: '업무 공간' });
    const officeTab = await action('navigate', { input: base + '/office' });
    await action('switchSpace', { id: first.activeSpaceId });
    await action('split', { id: second.activeTabId });
    await ui.locator('#tabSearchButton').click();
    await input.fill('업무 office');
    await dialog.getByRole('option', { name: /office/ }).waitFor();
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    assert.equal(await dialog.isVisible(), true);
    await input.press('Enter');
    await waitFor(read, value => value.activeTabId === officeTab.activeTabId);
    assert.deepEqual((await read()).splitTabIds, []);
    assert.equal((await read()).activeSpaceId, office.activeSpaceId);

    const grouped = await action('createFolder', { tabId: officeTab.activeTabId, name: '자료' });
    const original = grouped.tabs.find(tab => tab.id === officeTab.activeTabId);
    const duplicated = await action('duplicateTab', { id: original.id });
    const duplicate = duplicated.tabs.find(tab => tab.id === duplicated.activeTabId);
    assert.notEqual(duplicate.id, original.id);
    assert.equal(duplicate.folderId, original.folderId);
    assert.equal(duplicate.spaceId, original.spaceId);
    assert.equal(duplicate.url, original.url);
    assert.equal(duplicated.tabs.indexOf(duplicate), duplicated.tabs.findIndex(tab => tab.id === original.id) + 1);
    await action('closeTab', { id: duplicate.id });

    // Exercise the native shortcut while the site's WebContents has focus.
    await app.evaluate(async ({ BrowserWindow }, url) => {
      const guest = BrowserWindow.getAllWindows()[0].contentView.children.find(view =>
        view.getVisible() && view.webContents?.getURL() === url);
      guest.webContents.focus();
      guest.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control', 'shift'] });
      guest.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control', 'shift'] });
    }, base + '/office');
    await input.waitFor();
    assert.equal(await input.evaluate(element => element === document.activeElement), true);
    await input.fill('no-matching-tab');
    await dialog.getByRole('status').getByText('일치하는 탭이 없어요.').waitFor();
    await input.fill('office');
    const closed = dialog.getByRole('group', { name: '최근 닫은 탭' }).getByRole('option');
    await closed.waitFor();
    await input.press('ArrowDown');
    assert.equal(await closed.getAttribute('aria-selected'), 'true');
    await input.press('Enter');
    await waitFor(read, value => value.archivedTabs.length === 0);
    assert.equal((await read()).activeSpaceId, office.activeSpaceId);
    assert.deepEqual(errors, []);
    console.log('PASS tab search, IME, cross-space navigation, duplicate and restore');
  } finally {
    if (app) {
      const child = app.process();
      const timeout = setTimeout(() => child.kill(), 4500);
      try { await app.close(); } finally { clearTimeout(timeout); }
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
