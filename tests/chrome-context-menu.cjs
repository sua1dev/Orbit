'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const work = path.resolve(root, '..', '..', 'work');
fs.mkdirSync(work, { recursive: true });
const profile = fs.mkdtempSync(path.join(work, 'chrome-menu-'));
const env = { ...process.env, ORBIT_PROFILE: profile, ORBIT_TEST_MODE: '1' };
delete env.ELECTRON_RUN_AS_NODE;

async function until(read, predicate, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<title>Context menu fixture</title><p>Web contents remain visible.</p>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/`;
  let app;

  try {
    app = await electron.launch({ args: [root], env });
    const ui = await app.firstWindow();
    await ui.evaluate(() => window.browser.action('appearance', { tabPosition: 'side' }));
    await ui.locator('.tab-row').first().waitFor();
    await app.evaluate(({ Menu, clipboard }) => {
      globalThis.menuLog = [];
      globalThis.testClipboard = '';
      // Record native menus at the popup boundary, while leaving production
      // renderers and action handlers untouched. Avoid using the OS clipboard.
      Menu.prototype.popup = function (options) {
        globalThis.menuLog.push({ menu: this, x: options.x, y: options.y });
      };
      clipboard.readText = () => globalThis.testClipboard;
      clipboard.writeText = text => { globalThis.testClipboard = text; };
    });

    const action = (name, payload = {}) => ui.evaluate(({ name, payload }) => window.browser.action(name, payload), { name, payload });
    const state = () => ui.evaluate(() => window.browser.getState());
    const clipboard = () => app.evaluate(() => globalThis.testClipboard);
    const visibleWebViews = () => app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return win.contentView.children.filter(view => view.webContents && view.webContents !== win.webContents && view.getVisible()).length;
    });
    const menu = async (open, expectedItem) => {
      await app.evaluate(() => { globalThis.menuLog.length = 0; });
      await open();
      return until(() => app.evaluate(() => globalThis.menuLog.map(({ menu, x, y }) => ({
        ids: menu.items.map(item => item.id), x, y,
      }))), menus => menus.some(entry => entry.ids.includes(expectedItem)), expectedItem);
    };
    const select = id => app.evaluate((_electron, id) => {
      const menu = globalThis.menuLog.at(-1).menu;
      const item = menu.getMenuItemById(id);
      if (!item?.enabled) throw new Error(`Unavailable menu item ${id}`);
      item.click();
    }, id);

    const active = await action('navigate', { input: url });
    const tabId = active.activeTabId;
    await until(visibleWebViews, count => count === 1, 'web pane');
    const tab = ui.locator(`.tab-row[data-tab-id="${tabId}"]`);
    const tabMenu = await menu(() => tab.click({ button: 'right' }), 'pinTab');
    assert.equal(tabMenu.length, 1);
    assert.equal(await visibleWebViews(), 1);
    await select('pinTab');
    const pinned = ui.locator(`.pinned-tab[data-tab-id="${tabId}"]`);
    await pinned.waitFor();
    await menu(() => pinned.press('Shift+F10'), 'pinTab');
    await select('pinTab');
    await tab.waitFor();
    console.log('PASS tab and pinned tab menus work without hiding the web page');

    const withFolder = await action('createFolder', { name: 'Research & Notes' });
    const folderId = withFolder.folders.find(folder => folder.name === 'Research & Notes').id;
    await menu(() => tab.click({ button: 'right' }), 'pinTab');
    await select(`moveTo-${folderId}`);
    await until(state, snapshot => snapshot.tabs.find(entry => entry.id === tabId).folderId === folderId, 'tab moved into folder');
    const folder = ui.getByRole('button', { name: 'Research & Notes 폴더', exact: true });
    await menu(() => folder.click({ button: 'right' }), 'renameFolder');
    await select('renameFolder');
    const folderName = ui.locator('#folderNameInput');
    await folderName.waitFor();
    assert.equal(await folderName.inputValue(), 'Research & Notes');
    await ui.keyboard.press('Escape');
    await ui.locator('#overlay').waitFor({ state: 'hidden' });
    console.log('PASS folder menu opens the editor for the selected folder');

    await action('favoriteTab', { id: tabId });
    const favorite = ui.locator('.favorite-tile').first();
    await menu(() => favorite.click({ button: 'right' }), 'openFavorite');
    await select('copyURL');
    assert.equal(await clipboard(), url);
    console.log('PASS favorite menu copies the selected favorite address');

    const address = ui.locator('#addressButton');
    const addressMenu = await menu(() => address.press('Shift+F10'), 'editAddress');
    assert.equal(addressMenu.length, 1);
    assert.ok(addressMenu[0].x > 0 && addressMenu[0].y > 0);
    assert.equal(await visibleWebViews(), 1);
    await select('editAddress');
    const input = ui.locator('#paletteInput');
    await input.waitFor();
    await input.fill('Orbit text');
    await menu(() => input.click({ button: 'right' }), 'selectAll');
    await select('selectAll');
    await until(() => input.evaluate(node => [node.selectionStart, node.selectionEnd]),
      ([start, end]) => start === 0 && end === 'Orbit text'.length, 'address selection');
    await ui.keyboard.press('Escape');
    await ui.locator('#overlay').waitFor({ state: 'hidden' });
    await app.evaluate((_electron, input) => { globalThis.testClipboard = input; }, `${url}destination`);
    await menu(() => address.click({ button: 'right' }), 'pasteAndGo');
    await select('pasteAndGo');
    await until(state, snapshot => snapshot.tabs.find(entry => entry.id === tabId).url === `${url}destination`, 'paste and go navigation');
    console.log('PASS address and text editing menus act on the intended tab and input');
  } finally {
    if (app && app.process().exitCode === null) {
      const child = app.process();
      const exited = once(child, 'exit');
      const fallback = setTimeout(() => child.kill(), 5000);
      try {
        await Promise.race([exited, app.evaluate(({ app }) => setImmediate(() => app.exit(0))).catch(() => {})]);
        await exited;
      } finally { clearTimeout(fallback); }
    }
    server.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
