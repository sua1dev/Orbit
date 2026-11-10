'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { createDefaultState } = require('../lib/model.cjs');

const requests = [];
const root = path.resolve(__dirname, '..');
const server = http.createServer((request, response) => {
  requests.push(request.url);
  if (request.url === '/site.svg') {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="rebeccapurple"/><image href="http://${request.headers.host}/unexpected-resource" width="32" height="32"/><script>window.faviconExecuted=true</script></svg>`);
  } else if (request.url === '/brand') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>Fixture brand</title><link rel="icon" type="image/svg+xml" href="/site.svg">');
  } else {
    response.writeHead(404).end();
  }
});

async function run() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-site-icons-'));
  let app;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const fixture = createDefaultState();
    fixture.favorites.push({ id: 'discord-fixture', title: 'Discord', url: 'https://discord.com/channels/@me', faviconURL: `${base}/legacy-icon` });
    fixture.history.push({ kind: 'visit', spaceId: fixture.activeSpaceId, value: 'https://example.net/', title: 'Example legacy visit', at: Date.now() });
    await fs.writeFile(path.join(profile, 'orbit-state.json'), JSON.stringify(fixture));

    app = await electron.launch({ args: [root], env: { ...process.env, ORBIT_TEST_MODE: '1', ORBIT_PROFILE: profile } });
    const ui = await app.firstWindow();
    const action = (name, payload = {}) => ui.evaluate(args => window.browser.action(...args), [name, payload]);
    await ui.waitForFunction(() => window.browser);
    await ui.locator('#favoritesGrid img[src="sites/discord.png"]').waitFor();
    await ui.waitForFunction(() => document.querySelector('#favoritesGrid img')?.naturalWidth > 0);
    assert.ok(!requests.includes('/legacy-icon'), 'Opening a list must not fetch the old remote icon');

    await action('navigate', { input: `${base}/brand` });
    const loaded = await ui.waitForFunction(url => {
      const tab = state.tabs.find(entry => entry.id === state.activeTabId);
      return tab?.url === url && tab.faviconURL?.startsWith('data:image/png;base64,') &&
        state.history.some(entry => entry.value === url && entry.faviconURL === tab.faviconURL) ? tab : false;
    }, `${base}/brand`);
    const tab = await loaded.jsonValue();
    const scriptResult = await app.evaluate(({ webContents }, url) => {
      const guest = webContents.getAllWebContents().find(contents => contents.getURL() === url);
      return guest.executeJavaScript('typeof window.faviconExecuted');
    }, `${base}/brand`);
    assert.equal(scriptResult, 'undefined');
    assert.ok(!requests.includes('/unexpected-resource'), 'SVG image mode must prevent external loads');
    await action('favoriteTab', { id: tab.id });
    await action('archiveTab', { id: tab.id });
    const closed = await ui.waitForFunction(url => state.archivedTabs.find(entry => entry.url === url) || false,
      `${base}/brand`, { timeout: 5000 });
    assert.equal((await closed.jsonValue()).faviconURL, tab.faviconURL);

    await action('navigate', { input: 'orbit://history' });
    await ui.locator('.library-open').filter({ hasText: 'Fixture brand' }).locator('img[src^="data:image/png;base64,"]').waitFor();
    await ui.locator('.library-open').filter({ hasText: 'Example legacy visit' }).locator('.site-monogram').waitFor();
    await action('navigate', { input: 'orbit://archives' });
    await ui.locator('.library-row').filter({ hasText: 'Fixture brand' }).locator('img[src^="data:image/png;base64,"]').waitFor();
    await action('navigate', { input: 'orbit://bookmarks' });
    await ui.locator('.library-row').filter({ hasText: 'Fixture brand' }).locator('img[src^="data:image/png;base64,"]').waitFor();
    await ui.evaluate(() => openPalette());
    await ui.locator('#paletteInput').fill('Fixture brand');
    await ui.locator('.palette-result').filter({ hasText: 'Fixture brand' }).locator('img[src^="data:image/png;base64,"]').waitFor();
    await ui.evaluate(() => closeOverlay());

    await app.close(); app = null;
    const stored = JSON.parse(await fs.readFile(path.join(profile, 'orbit-state.json'), 'utf8'));
    assert.equal(stored.history.find(entry => entry.value === `${base}/brand`).faviconURL, tab.faviconURL);
    assert.equal(stored.archivedTabs.find(entry => entry.url === `${base}/brand`).faviconURL, tab.faviconURL);
    console.log('PASS Discord fallback, safe SVG rasterization, and persisted site icons in history, archives, favorites and address search.');
  } finally {
    if (app) await app.close().catch(() => app.process().kill());
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 6 });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
