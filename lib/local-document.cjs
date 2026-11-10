'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const pdfViewerOrigin = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/';

const fileTypes = new Map([
  ['.htm', 'text/html'],
  ['.html', 'text/html'],
  ['.shtml', 'text/html'],
  ['.xht', 'application/xhtml+xml'],
  ['.xhtml', 'application/xhtml+xml'],
  ['.pdf', 'application/pdf'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.xml', 'application/xml'],
]);

function localPath(value) {
  if (typeof value !== 'string' || value.includes('\0')) return false;
  return process.platform === 'win32' ? /^[a-z]:[\\/]/i.test(value) : path.isAbsolute(value);
}

function launchDocumentPath(args) {
  const index = args.indexOf('--open-file');
  const filename = index < 0 ? null : args[index + 1];
  return localPath(filename) && fileTypes.has(path.extname(filename).toLowerCase()) ? filename : null;
}

async function openLocalDocument(electron, filename, icon) {
  const { BrowserWindow, session } = electron;
  if (!localPath(filename) || !fileTypes.has(path.extname(filename).toLowerCase())) return;
  const resolved = await fs.promises.realpath(filename);
  if (!localPath(resolved) || !(await fs.promises.stat(resolved)).isFile()) return;

  const type = fileTypes.get(path.extname(filename).toLowerCase());
  const id = randomUUID();
  const origin = 'https://orbit-local.invalid';
  const url = origin + '/' + encodeURIComponent(path.basename(filename));
  // The dedicated in-memory partition can read this one file via an intercepted
  // URL. The document never shares authenticated website storage or receives IPC.
  const ses = session.fromPartition('orbit-local-' + id, { cache: false });
  ses.setPermissionCheckHandler(() => false);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.on('will-download', event => event.preventDefault());
  ses.webRequest.onBeforeRequest((details, callback) => {
    const internal = type === 'application/pdf' && [pdfViewerOrigin, 'chrome://resources/', 'chrome-untrusted://resources/'].some(prefix => details.url.startsWith(prefix));
    const allowed = details.url === url || internal || /^(?:data:|blob:)/.test(details.url);
    callback({ cancel: !allowed });
  });
  ses.protocol.handle('https', request => {
    if (request.method !== 'GET' || request.url !== url) return new Response(null, { status: 404 });
    const headers = {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (type !== 'application/pdf') {
      headers['Content-Security-Policy'] = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";
    }
    return new Response(Readable.toWeb(fs.createReadStream(resolved)), { headers });
  });
  const viewer = new BrowserWindow({
    width: 1024, height: 760, show: false, title: path.basename(filename) + ' · Orbit', icon,
    webPreferences: {
      session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, plugins: type === 'application/pdf',
    },
  });
  viewer.removeMenu();
  viewer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  viewer.webContents.on('will-navigate', event => event.preventDefault());
  viewer.webContents.on('will-frame-navigate', event => {
    if (!event.isMainFrame && type !== 'application/pdf') event.preventDefault();
  });
  viewer.on('page-title-updated', event => event.preventDefault());
  viewer.once('closed', () => ses.protocol.unhandle('https'));
  try {
    await viewer.loadURL(url);
    if (!viewer.isDestroyed()) viewer.show();
    return viewer;
  } catch (error) {
    if (!viewer.isDestroyed()) viewer.destroy();
    throw error;
  }
}

module.exports = { fileTypes, launchDocumentPath, openLocalDocument };
