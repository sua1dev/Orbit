'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><title>' + request.url.slice(1) + '</title>');
});

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-audio-'));
  let app;
  try {
    app = await electron.launch({ args: [root], env: { ...process.env, ORBIT_TEST_MODE: '1', ORBIT_PROFILE: profile } });
    const ui = await app.firstWindow();
    const action = (name, payload) => ui.evaluate(([name, payload]) => window.browser.action(name, payload), [name, payload]);
    await ui.waitForFunction(() => typeof window.browser?.action === 'function');
    const first = await action('navigate', { input: origin + '/first' });
    const second = await action('newTab', { url: origin + '/second' });

    const muted = await action('muteTab', { id: second.activeTabId });
    assert.equal(muted.tabs.find(tab => tab.id === second.activeTabId).muted, true);

    await app.evaluate(async ({ BrowserWindow }, origin) => {
      let first, second;
      const deadline = Date.now() + 5000;
      do {
        const views = BrowserWindow.getAllWindows().flatMap(window => window.contentView.children);
        first = views.find(view => view.webContents?.getURL() === origin + '/first');
        second = views.find(view => view.webContents?.getURL() === origin + '/second');
        if (first && second) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      if (!first || !second) throw new Error('Expected both test views to be attached');
      const descriptor = Object.getOwnPropertyDescriptor(second, 'webContents');
      const contents = second.webContents;

      // Electron can clear the view's WebContents before sending its destroyed event.
      Object.defineProperty(second, 'webContents', { configurable: true, value: undefined });
      try {
        first.webContents.emit('audio-state-changed');
        contents.emit('audio-state-changed');
      } finally {
        if (descriptor) Object.defineProperty(second, 'webContents', descriptor);
        else delete second.webContents;
      }
    }, origin);

    const closed = await action('closeTab', { id: second.activeTabId });
    assert.equal(closed.activeTabId, first.activeTabId);
    assert.equal(closed.tabs.some(tab => tab.id === second.activeTabId), false);
    console.log('PASS audio-state events are safe during tab teardown');
  } finally {
    try { await app?.close(); }
    finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
