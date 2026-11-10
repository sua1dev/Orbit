'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const http = require('node:http');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const profile = path.resolve(root, '..', 'login-restart-' + Date.now(), 'profile');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const account = url.searchParams.get('set');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/session') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify((req.headers.cookie || '').split('; ').sort()));
    return;
  }
  if (account && /^(personal|work|private)$/.test(account)) {
    res.setHeader('Set-Cookie', [
      `login=${account}; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax`,
      `temporary=${account}; Path=/; HttpOnly; SameSite=Lax`,
    ]);
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><title>Orbit login persistence fixture</title>');
});

let app;
async function open() {
  app = await electron.launch({
    args: [root],
    env: { ...process.env, ORBIT_TEST_MODE: '1', ORBIT_PROFILE: profile },
  });
  const ui = await app.firstWindow();
  ui.setDefaultTimeout(7000);
  await ui.waitForFunction(() => window.browser);
  return ui;
}
const action = (ui, name, payload = {}) => ui.evaluate(({ name, payload }) => window.browser.action(name, payload), { name, payload });

async function guest(url, spaceId, privateWindow = false) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const id = await app.evaluate(({ webContents, session }, { url, spaceId, privateWindow }) => {
      const expected = privateWindow ? null : session.fromPartition('persist:orbit-' + spaceId);
      return webContents.getAllWebContents().find(wc => wc.getURL() === url && !wc.isLoadingMainFrame()
        && (privateWindow ? !wc.session.isPersistent() : wc.session === expected))?.id;
    }, { url, spaceId, privateWindow });
    if (id !== undefined) return id;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error('Guest did not load: ' + url);
}

function evalGuest(id, code) {
  return app.evaluate(({ webContents }, { id, code }) => webContents.fromId(id).executeJavaScript(code), { id, code });
}

async function closeWindow(ui) {
  const closed = ui.waitForEvent('close', { timeout: 8000 });
  const request = action(ui, 'closeWindow').catch(error => {
    if (!/closed|destroyed|context/i.test(error.message)) throw error;
  });
  await Promise.all([closed, request]);
}

async function quitNormally() {
  const child = app.process();
  const closed = once(child, 'exit');
  const timer = setTimeout(() => child.kill(), 8000);
  try {
    await app.evaluate(({ app }) => { setImmediate(() => app.quit()); }).catch(() => {});
    const [code] = await closed;
    assert.equal(code, 0, 'Browser should exit normally');
  } finally { clearTimeout(timer);app = null; }
}

async function recordLogin(ui, base, spaceId, account, isPrivate = false) {
  const url = `${base}/page?set=${account}`;
  await action(ui, 'navigate', { input: url });
  const id = await guest(url, spaceId, isPrivate);
  await evalGuest(id, `localStorage.setItem('fixture-login', ${JSON.stringify(account)});true`);
  assert.deepEqual(await evalGuest(id, "fetch('/session').then(r=>r.json())"), [`login=${account}`, `temporary=${account}`]);
  await action(ui, 'navigate', { input: base + '/landing' });
  await guest(base + '/landing', spaceId, isPrivate);
}

async function assertRestored(ui, base, spaceId, expected, isPrivate = false) {
  const url = base + '/read';
  await action(ui, 'navigate', { input: url });
  const id = await guest(url, spaceId, isPrivate);
  assert.equal(await evalGuest(id, "localStorage.getItem('fixture-login')"), expected);
  assert.deepEqual(await evalGuest(id, "fetch('/session').then(r=>r.json())"), expected ? [`login=${expected}`] : ['']);
}

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let ui = await open();
  const personal = (await action(ui, 'appearance', { showWeather: false })).activeSpaceId;
  await recordLogin(ui, base, personal, 'personal');
  const work = (await action(ui, 'createSpace', { name: '로그인 격리 검사' })).activeSpaceId;
  await assertRestored(ui, base, work, null);
  await recordLogin(ui, base, work, 'work');
  const privateOpening = app.waitForEvent('window');
  await action(ui, 'newIncognitoWindow');
  const privateUi = await privateOpening;
  await privateUi.waitForFunction(() => window.browser);
  await assertRestored(privateUi, base, null, null, true);
  await recordLogin(privateUi, base, null, 'private', true);
  await closeWindow(privateUi);
  await quitNormally();

  ui = await open();
  await assertRestored(ui, base, work, 'work');
  await action(ui, 'switchSpace', { id: personal });
  await assertRestored(ui, base, personal, 'personal');
  const newPrivateOpening = app.waitForEvent('window');
  await action(ui, 'newIncognitoWindow');
  const newPrivateUi = await newPrivateOpening;
  await newPrivateUi.waitForFunction(() => window.browser);
  await assertRestored(newPrivateUi, base, null, null, true);

  await action(ui, 'switchSpace', { id: work });
  await closeWindow(ui);
  const normalOpening = app.waitForEvent('window');
  await action(newPrivateUi, 'newWindow');
  ui = await normalOpening;
  await ui.waitForFunction(() => window.browser);
  assert.equal((await ui.evaluate(() => window.browser.getState())).activeSpaceId, work);
  await assertRestored(ui, base, work, 'work');
  await assertRestored(newPrivateUi, base, null, null, true);

  const external = base + '/external';
  await app.evaluate(({ app, BrowserWindow }, url) => {
    BrowserWindow.getAllWindows().find(window => window.getTitle().includes('시크릿'))?.focus();
    app.emit('second-instance', {}, [process.execPath, url]);
  }, external);
  const linked = await guest(external, work);
  assert.deepEqual(await evalGuest(linked, "fetch('/session').then(r=>r.json())"), ['login=work']);
  assert.ok(!(await newPrivateUi.evaluate(() => window.browser.getState())).tabs.some(tab => tab.url === external));

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 });
  });
  await action(ui, 'clearSiteData');
  await assertRestored(ui, base, work, null);
  await closeWindow(newPrivateUi);
  await quitNormally();

  ui = await open();
  await assertRestored(ui, base, work, null);
  await action(ui, 'switchSpace', { id: personal });
  await assertRestored(ui, base, personal, 'personal');
  await quitNormally();
  assert.ok(fs.existsSync(path.join(profile, 'orbit-state.json')));
  console.log('PASS persistent cookies and local storage survive restart; private, temporary and deleted data stay isolated');
}

run().catch(error => { console.error(error);process.exitCode = 1; }).finally(async () => {
  if (app) await quitNormally().catch(() => {});
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
