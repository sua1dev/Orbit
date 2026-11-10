'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-context-'));
const server = http.createServer((req, res) => {
  if (req.url === '/image.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="teal"/></svg>');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>Orbit context fixture</title>
    <style>body{font:18px sans-serif;padding:20px}p{margin:15px 0}</style>
    <p id="page">Ordinary page</p>
    <p><a id="link" href="/destination">Open destination</a></p>
    <p><a id="unsafe" href="javascript:void(0)">Script link</a></p>
    <p><a id="next" href="/next">Same-tab destination</a></p>
    <p><input id="text" value="Orbit edit fixture"></p>
    <p><input id="password" type="password" value="fixture secret"></p>
    <p><span id="selection">Selected fixture text</span></p>
    <img id="image" src="/image.svg" alt="Fixture">`);
});

let app, ui, baseURL;
const state = () => ui.evaluate(() => window.browser.getState());
const action = (name, payload) => ui.evaluate(({ name, payload }) => window.browser.action(name, payload), { name, payload });

async function pageAt(pathname) {
  const url = baseURL + pathname;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const page = app.context().pages().find(candidate => candidate.url() === url);
    if (page) { await page.waitForLoadState('domcontentloaded'); return page; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Page did not open: ${url}`);
}

async function popup(trigger) {
  await app.evaluate(() => { globalThis.contextPopup = null; });
  await trigger();
  const captured = await app.evaluate(() => {
    const popup = globalThis.contextPopup;
    if (!popup) return null;
    return {
      sourceType: popup.sourceType,
      x: popup.x,
      items: Object.fromEntries(popup.menu.items.filter(item => item.id).map(item => [item.id, item.enabled])),
    };
  });
  assert.ok(captured, 'Right click should open a native menu');
  return captured;
}

async function closeMenu(actionId) {
  await app.evaluate((_electron, actionId) => {
    const popup = globalThis.contextPopup;
    if (!popup) return;
    globalThis.contextPopup = null;
    if (actionId) popup.menu.getMenuItemById(actionId).click();
  }, actionId);
}

async function closeApp() {
  const child = app.process();
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  const fallback = setTimeout(() => child.kill(), 5000);
  try {
    await Promise.race([exited, app.evaluate(({ app }) => setImmediate(() => app.exit(0))).catch(() => {})]);
    await exited;
  } finally {
    clearTimeout(fallback);
  }
}

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  const env = { ...process.env, ORBIT_PROFILE: profile, ORBIT_TEST_MODE: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [root], env });
  ui = await app.firstWindow();
  await ui.waitForFunction(() => window.browser);
  await app.evaluate(({ Menu }) => {
    // Inspect the Electron menu requested by the real Chromium context-menu
    // event. Avoid depending on focus from the shared Windows desktop.
    Menu.prototype.popup = function (options) {
      globalThis.contextPopup = { menu: this, ...options };
    };
  });

  await action('navigate', { input: baseURL + '/first' });
  const first = await pageAt('/first');
  const firstId = (await state()).activeTabId;
  const link = await popup(() => first.locator('#link').click({ button: 'right' }));
  assert.equal(link.sourceType, 'mouse');
  for (const id of ['page-openLink', 'page-copyLink', 'page-saveLink']) assert.equal(link.items[id], true);
  await closeMenu('page-openLink');
  await pageAt('/destination');
  assert.equal((await state()).activeTabId, firstId, 'Open link should preserve the foreground tab');

  const unsafe = await popup(() => first.locator('#unsafe').click({ button: 'right' }));
  assert.equal(unsafe.items['page-openLink'], undefined);
  assert.equal(unsafe.items['page-saveLink'], undefined);
  assert.equal(unsafe.items['page-reload'], true);
  await closeMenu();

  const image = await popup(() => first.locator('#image').click({ button: 'right' }));
  for (const id of ['page-openImage', 'page-copyImage', 'page-copyImageURL', 'page-saveImage']) assert.equal(image.items[id], true);
  await closeMenu();

  await first.locator('#selection').evaluate(element => window.getSelection().selectAllChildren(element));
  const selection = await popup(() => first.locator('#selection').click({ button: 'right' }));
  assert.equal(selection.items['page-copy'], true);
  assert.equal(selection.items['page-search'], true);
  await closeMenu();

  await first.locator('#text').focus();
  const keyboard = await popup(() => first.locator('#text').press('Shift+F10'));
  assert.equal(keyboard.sourceType, 'keyboard');
  assert.equal(keyboard.items['page-selectAll'], true);
  await closeMenu('page-selectAll');
  await first.waitForFunction(() => {
    const input = document.getElementById('text');
    return input.selectionEnd - input.selectionStart === input.value.length;
  });

  await first.locator('#password').focus();
  const password = await popup(() => first.locator('#password').press('Shift+F10'));
  assert.equal(password.items['page-copy'], false);
  assert.equal(password.items['page-cut'], false);
  assert.equal(password.items['page-search'], undefined);
  await closeMenu();

  await action('newTab', { url: baseURL + '/second' });
  const second = await pageAt('/second');
  const secondId = (await state()).activeTabId;
  await action('split');
  await action('activateTab', { id: firstId });
  await second.locator('#next').click();
  await second.waitForURL(baseURL + '/next');
  const secondMenu = await popup(() => second.locator('#page').click({ button: 'right' }));
  assert.equal(secondMenu.items['page-back'], true);
  assert.equal((await state()).activeTabId, secondId);
  await closeMenu('page-back');
  await second.waitForURL(baseURL + '/second');
  const firstMenu = await popup(() => first.locator('#page').click({ button: 'right' }));
  assert.equal(firstMenu.items['page-back'], false);
  assert.notEqual(firstMenu.x, secondMenu.x, 'Menu coordinates must follow the clicked split pane');
  assert.equal((await state()).activeTabId, firstId);
  await closeMenu();

  console.log('PASS Native page menus for links, images, text selection, keyboard editing, passwords and both split panes');
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (app) await closeApp();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 6 });
}).catch(error => { console.error(error); process.exitCode = 1; });
