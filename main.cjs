const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, shell, session, clipboard, nativeImage, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID, createHash } = require('node:crypto');
const { normalizeInput, isWebURL, isYoutubeURL, createDefaultState, sanitizeState, publicTab, nextSpaceName } = require('./lib/model.cjs');
const { sanitizeAppearance, loadWallpaper, readAppearanceProfile } = require('./lib/appearance.cjs');
const { popupTarget, sameOriginBlob } = require('./lib/popup-policy.cjs');
const { maxIconBytes, safeRasterFaviconURL, decodeInlineFavicon, svgFavicon, faviconImageScript } = require('./lib/site-icons.cjs');
const { webContextMenu, editableItems } = require('./lib/web-context-menu.cjs');
const {addHistory,safeVisit,preferences}=require('./lib/history.cjs');
const {fetchSuggestions}=require('./lib/search-suggestions.cjs');
const { createSeoulWeatherService } = require('./lib/seoul-weather.cjs');
const { fileTypes, launchDocumentPath, openLocalDocument } = require('./lib/local-document.cjs');
const { chromeMenuItems, item: chromeMenuItem } = require('./lib/chrome-menu.cjs');

const { parseBookmarkHTML, parseChromiumBookmarks } = require('./lib/bookmarks.cjs');
const { resolveExtensionDirectory } = require('./lib/extension-path.cjs');
const { OrbitRpcBridge } = require('./lib/discord-rpc.cjs');
const { PasswordVault, loginOrigin } = require('./lib/passwords.cjs');
const { collectLoginScript, fillLoginScript } = require('./lib/login-page.cjs');
const {isInternal}=require('./lib/internal-pages.cjs');
const HOME = 'orbit://newtab';
const TEST = process.env.ORBIT_TEST_MODE === '1';
const getSeoulWeather = createSeoulWeatherService();
app.setName('Orbit');
if (process.platform === 'win32') app.setAppUserModelId('com.orbitbrowser.desktop');
app.setPath('userData', process.env.ORBIT_PROFILE ? path.resolve(process.env.ORBIT_PROFILE) : path.join(app.getPath('appData'), 'Orbit'));
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
const uiPath = path.join(__dirname, 'renderer', 'index.html');
const uiURL = pathToFileURL(uiPath).href;
const controllers = new Set();
const contentsOwners = new Map();
const sessions = new Map();
const permissionDecisions = new Map();
const rpcExtensions = new Map();
const rpcExtensionFile = path.join(app.getPath('userData'), 'orbit-rpc-extensions.json');
const passwordVault = new PasswordVault(path.join(app.getPath('userData'), 'orbit-passwords.bin'), safeStorage);
let rpcBridge;
let appQuitting = false;
let externalLaunches = [process.argv];
const securePreferences = { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, disableBlinkFeatures: 'FedCm' };
// Electron has no working FedCM account chooser here. Let identity providers use
// their standard OAuth popup flow; keep TLS, origin checks and sandboxing intact.

function isRpcExtension(manifest) {
  return manifest?.orbit_rpc_bridge?.version === 1 && manifest.orbit_rpc_bridge.endpoint === 'http://127.0.0.1:39231';
}
function readNormalProfile() {
  try {
    const file = path.join(app.getPath('userData'), 'orbit-state.json');
    return sanitizeState(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return createDefaultState();
  }
}
function openDocument(filename) {
  return openLocalDocument({ BrowserWindow, session }, filename, path.join(__dirname, 'renderer', 'orbit.ico'));
}
async function routeExternalLaunch(args, { focus = true } = {}) {
  const filename = launchDocumentPath(args);
  const urls = args.filter(isWebURL).slice(0, 20);
  if (urls.length || (focus && !filename)) {
    const normal = [...controllers].filter(owner => !owner.incognito && !owner.win?.isDestroyed());
    let owner = normal.find(candidate => candidate.win?.isFocused()) || normal.find(candidate => candidate.primary) || normal[0];
    if (!owner && !urls.length) owner = [...controllers].find(candidate => candidate.win && !candidate.win.isDestroyed());
    if (!owner) owner = createController({ initialState: readNormalProfile(), primary: true });
    await owner.ready;
    if (focus && owner.win && !owner.win.isDestroyed()) {
      if (owner.win.isMinimized()) owner.win.restore();
      owner.win.show();owner.win.focus();
    }
    for (const url of urls) await owner.handleAction('newTab', { url });
  }
  if (filename) await openDocument(filename);
}
function rpcExtensionRecord(spaceId, directory, manifest) {
  const id = createHash('sha256').update(directory.toLowerCase()).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
  return { id, spaceId, directory, name: String(manifest.name || 'Discord Custom RPC').slice(0, 100), version: String(manifest.version || '1').slice(0, 40), compatibility: 'orbit-rpc' };
}
function saveRpcExtensions() {
  fs.mkdirSync(path.dirname(rpcExtensionFile), { recursive: true });
  fs.writeFileSync(rpcExtensionFile + '.tmp', JSON.stringify([...rpcExtensions.values()], null, 2));
  fs.renameSync(rpcExtensionFile + '.tmp', rpcExtensionFile);
}
async function restoreRpcExtensions() {
  try {
    if (fs.statSync(rpcExtensionFile).size > 1024 * 1024) return;
    const entries = JSON.parse(fs.readFileSync(rpcExtensionFile, 'utf8'));
    if (!Array.isArray(entries)) return;
    for (const entry of entries.slice(0, 30)) {
      if (!entry || typeof entry.spaceId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(entry.spaceId) || typeof entry.directory !== 'string') continue;
      try {
        const { directory, manifest } = await resolveExtensionDirectory(entry.directory);
        if (isRpcExtension(manifest)) rpcExtensions.set(entry.spaceId, rpcExtensionRecord(entry.spaceId, directory, manifest));
      } catch {}
    }
  } catch {}
}

function boundedRaster(bytes) {
  const bounded = (width, height) => width > 0 && height > 0 && width <= 2048 && height <= 2048;
  if (bytes.length < 24) return false;
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return bytes.toString('ascii', 12, 16) === 'IHDR' && bounded(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  if (bytes.readUInt32LE(0) === 0x00010000) {
    const count = bytes.readUInt16LE(4);if (count < 1 || count > 64 || bytes.length < 6 + count * 16) return false;
    for (let index = 0; index < count; index++) {
      const entry = 6 + index * 16, length = bytes.readUInt32LE(entry + 8), offset = bytes.readUInt32LE(entry + 12);
      if (offset < 6 + count * 16 || length < 24 || offset + length > bytes.length) return false;
      const frame = bytes.subarray(offset, offset + length);
      if (frame.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') { if (!boundedRaster(frame)) return false; }
      else if (frame.length < 40 || frame.readUInt32LE(0) < 40 || !bounded(Math.abs(frame.readInt32LE(4)), Math.abs(frame.readInt32LE(8)) / 2)) return false;
    }
    return true;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) return false;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) return false;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > bytes.length) return false;
      const length = bytes.readUInt16BE(offset);if (length < 2 || offset + length > bytes.length) return false;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return length >= 7 && bounded(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
      offset += length;
    }
    return false;
  }
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const type = bytes.toString('ascii', 12, 16);
    if (type === 'VP8X' && bytes.length >= 30) return bounded(bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1);
    if (type === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) { const bits = bytes.readUInt32LE(21);return bounded((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1); }
    if (type === 'VP8 ' && bytes.length >= 30 && bytes.subarray(23, 26).toString('hex') === '9d012a') return bounded(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
  }
  return false;
}

function createController({ incognito = false, initialState, primary = false } = {}) {
const windowId = randomUUID();
let win, state = initialState || createDefaultState();
let stateFile = incognito ? null : path.join(app.getPath('userData'), primary ? 'orbit-state.json' : path.join('windows', windowId + '.json'));
let overlayOpen = false, saveTimer, publishTimer, quitting = false;
let pipPending = false, pipTabId = null, blurTimer;
let reducedMotion = false;
let guestLayout = null;
let webPanel = null;
const views = new Map();
const downloadItems = new Map();
const closeRequests = new Map();
const retainedTabs = new Set();
let closingWindow = false;
let downloads = [];
let notice = null, noticeTimer;
let findResult = null;
const findSessions = new Map();
const faviconRequests = new Map();
const faviconJobs = new Map();
const extensionWindows = new Set();
let actionQueue = Promise.resolve();
const controller = { get win() { return win; }, get incognito() { return incognito; }, get primary() { return primary; }, get state() { return state; }, snapshot, layout, applyGuestLayout, handleAction, publish, receiveDownload, saveNow, closeExtensionPopups, rpcCandidates, loginEvent, suggest, canWriteClipboard, openChromeMenu };
controllers.add(controller);
let suggestionRequest;
async function suggest(query){
  suggestionRequest?.abort();
  if(incognito||!state.searchPreferences.autocomplete||!state.searchPreferences.onlineSuggestions||!overlayOpen)return [];
  const request=new AbortController();suggestionRequest=request;
  const result=await fetchSuggestions(query,request.signal);
  return request.signal.aborted||incognito||!state.searchPreferences.autocomplete||!state.searchPreferences.onlineSuggestions?[]:result;
}
function remember(kind,value,title,spaceId=state.activeSpaceId,faviconURL=null){
  if(incognito||!state.searchPreferences.saveHistory||!value)return;
  const previous = kind === 'visit' ? state.history.find(entry => entry.kind === kind && entry.spaceId === spaceId && entry.value === value) : null;
  state.history=addHistory(state.history,{kind,value,title,spaceId,at:Date.now(),faviconURL:faviconURL||previous?.faviconURL},new Set(state.spaces.map(s=>s.id)));syncShared('history');persist();
}
let loginPromptOpen = false;
const loginPromptTimes = new Map();
async function fillSavedLogin(target, entry) {
  const contents = views.get(target?.id)?.webContents;
  if (incognito || !contents || contents.isDestroyed() || entry.spaceId !== target.spaceId || loginOrigin(contents.getURL()) !== entry.origin) return false;
  return await withDeadline(contents.executeJavaScriptInIsolatedWorld(1138, [{ code: fillLoginScript(entry) }]), 1500);
}
async function offerLogin(target, value, origin) {
  if (incognito || loginPromptOpen || !passwordVault.available() || !origin || !value || typeof value.username !== 'string' || typeof value.password !== 'string' || !value.password || value.password.length > 2048 || value.username.length > 320) return;
  const existing = passwordVault.matches(target.spaceId, origin).find(r => r.username === value.username);
  if (existing?.password === value.password) return;
  loginPromptOpen = true;
  try {
    const { response } = await dialog.showMessageBox(win, { type: 'question', title: 'Orbit 비밀번호 관리자', message: `${new URL(origin).host} 로그인 정보를 ${existing ? '업데이트' : '저장'}할까요?`, detail: `계정: ${value.username || '(아이디 없음)'}\n현재 스페이스에 Windows 암호화로 저장합니다. 같은 사이트에 계정이 하나면 다음 방문에 자동 입력하며 로그인 버튼은 직접 누릅니다.`, buttons: ['나중에', existing ? '업데이트' : '저장'], defaultId: 0, cancelId: 0 });
    if (response === 1) { passwordVault.save(target.spaceId, { origin, username: value.username, password: value.password });notify('로그인 정보를 저장했습니다.'); }
  } finally { loginPromptOpen = false; }
}
async function loginEvent(event, type, value) {
  if (incognito || !win?.isFocused() || event.senderFrame !== event.sender.mainFrame) return;
  const target = state.tabs.find(t => views.get(t.id)?.webContents === event.sender);
  if (!target || target.id !== state.activeTabId || target.spaceId !== state.activeSpaceId) return;
  const origin = loginOrigin(event.senderFrame.url);
  if (!origin || loginOrigin(event.sender.getURL()) !== origin || !passwordVault.available()) return;
  if (type === 'ready') {
    const entries = passwordVault.matches(target.spaceId, origin);
    if (entries.length === 1) await fillSavedLogin(target, entries[0]);
  } else {
    if (Date.now() - (loginPromptTimes.get(target.id) || 0) < 15000) return;
    loginPromptTimes.set(target.id, Date.now());await offerLogin(target, value, origin);
  }
}

function tabById(id) { return state.tabs.find(tab => tab.id === id); }
function currentTab() { return tabById(state.activeTabId); }
function rpcCandidates() {
  if (incognito || !win || win.isDestroyed() || !rpcExtensions.has(state.activeSpaceId)) return [];
  return state.tabs.filter(tab => tab.spaceId === state.activeSpaceId && isWebURL(tab.url)).flatMap(tab => {
    const webContents = views.get(tab.id)?.webContents;
    if (!webContents || webContents.isDestroyed() || (tab.id !== state.activeTabId && !webContents.isCurrentlyAudible())) return [];
    return [{ id: tab.id, windowId: win.id, active: tab.id === state.activeTabId, windowFocused: win.isFocused(), url: tab.url, title: tab.title, faviconURL: tab.faviconURL, webContents }];
  });
}
function snapshot() {
  const extensions = configureSession(state.activeSpaceId).extensions.getAllExtensions().map(extension => ({ id: extension.id, name: extension.name, version: extension.version }));
  const rpc = !incognito && rpcExtensions.get(state.activeSpaceId);
  if (rpc) extensions.push({ id: rpc.id, name: rpc.name, version: rpc.version, compatibility: rpc.compatibility, connection: rpcBridge?.getStatus() || { connected: false } });
  return { ...state, history: incognito ? [] : state.history, tabs: state.tabs.map(entry => ({ ...publicTab(entry), muted: views.get(entry.id)?.webContents.isAudioMuted() || false })), webPanel: webPanel?.spaceId === state.activeSpaceId ? { ...webPanel.details } : null, incognito, windowCount: controllers.size, findResult, zoomFactor: views.get(state.activeTabId)?.webContents.getZoomFactor() || 1, extensions, extensionSupport: 'partial', downloads: downloads.map(({ ...item }) => item), notice,
    isMaximized: win?.isMaximized() || false, reducedMotion, packaged: app.isPackaged, version: app.getVersion(), engine: { electron: process.versions.electron, chromium: process.versions.chrome } };
}
function persist() {
  clearTimeout(saveTimer);
  if (quitting || incognito) return;
  saveTimer = setTimeout(saveNow, 180);
}
function saveNow(destination = stateFile) {
  if (incognito || !destination || !state) return;
  try {
    const data = { ...state, tabs: state.tabs.map(tab => ({ id: tab.id, spaceId: tab.spaceId, title: tab.title, url: tab.url, pinned: tab.pinned, folderId: tab.folderId || null, faviconURL: tab.faviconURL || null })) };
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination + '.tmp', JSON.stringify(data, null, 2));
    fs.renameSync(destination + '.tmp', destination);
  } catch (error) { console.error('Could not save browser state:', error.message); }
}
function publish(save = true) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('orbit:state-changed', snapshot());
  if (save) persist();
}
function publishSoon() {
  if (!publishTimer) publishTimer = setTimeout(() => { publishTimer = null; publish(false); }, 120);
}
function notify(message) {
  notice = message;
  publish(false);
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice = null; publish(false); }, 4500);
}
function command(name, payload) {
  if (!win || win.isDestroyed()) return;
  if (name !== 'find') overlayOpen = true;
  layout();
  win.webContents.focus();
  win.webContents.send('orbit:command', name, payload);
}
function openChromeMenu(request) {
  if (!win || win.isDestroyed() || !request || !Number.isInteger(request.x) || !Number.isInteger(request.y)) return;
  const [width, height] = win.getContentSize();
  if (request.x < 0 || request.x >= width || request.y < 0 || request.y >= height) return;
  const items = chromeMenuItems(request, state, {
    run: (name, payload) => handleAction(name, payload).catch(() => {}),
    command: (name, payload) => {
      if (name !== 'folder-editor' || state.folders.some(folder => folder.id === payload.id)) command(name, payload);
    },
    contentsFor: id => {
      const contents = views.get(id)?.webContents;
      return contents && !contents.isDestroyed() ? contents : null;
    },
    copyAddress: url => { clipboard.writeText(url);notify('주소를 복사했습니다.'); },
    incognito
  });
  if (items.length) Menu.buildFromTemplate(items).popup({
    window: win, x: request.x, y: request.y, sourceType: request.keyboard === true ? 'keyboard' : undefined
  });
}
function visibleIds() { return state.splitTabIds.length === 2 ? state.splitTabIds : [state.activeTabId]; }
function applyGuestLayout(request) {
  if (!request || !Array.isArray(request.panes) || request.panes.length > 2) return;
  const rect = value => {
    if (!value || typeof value.id !== 'string') return null;
    const { id, x, y, width, height } = value;
    if (![x, y, width, height].every(number => Number.isSafeInteger(number) && number >= 0 && number <= 32768)) return null;
    return { id, x, y, width, height };
  };
  guestLayout = { panes: request.panes.map(rect).filter(Boolean), panel: rect(request.panel) };
  layout();
}
function layout() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  const ids = visibleIds();
  const place = (view, bounds) => {
    if (view.webContents.isDestroyed()) return;
    const size = bounds && { x: bounds.x, y: bounds.y,
      width: Math.min(bounds.width, width - bounds.x), height: Math.min(bounds.height, height - bounds.y) };
    const visible = Boolean(!overlayOpen && size && size.width > 0 && size.height > 0);
    if (visible) view.setBounds(size);
    view.setVisible(visible);
  };
  for (const [id, view] of views) {
    const tab = tabById(id);
    const show = ids.includes(id) && tab?.spaceId === state.activeSpaceId && !isInternal(tab.url) && !tab.error;
    place(view, show ? guestLayout?.panes.find(rect => rect.id === id) : null);
  }
  if (webPanel) {
    const show = webPanel.spaceId === state.activeSpaceId && !webPanel.details.error && guestLayout?.panel?.id === webPanel.details.id;
    place(webPanel.view, show ? guestLayout.panel : null);
  }
}

function withDeadline(promise, milliseconds = 1500) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Page did not respond in time')), milliseconds); })]).finally(() => clearTimeout(timer));
}
async function flushPersistentSiteData(contexts) {
  const writes = [...contexts].filter(ses => ses.isPersistent()).map(async ses => {
    ses.flushStorageData();
    await ses.cookies.flushStore();
  });
  if (writes.length) await withDeadline(Promise.allSettled(writes)).catch(() => {});
}
const PIP_SCRIPT = `(() => {
  if (Date.now() > __ORBIT_DEADLINE__) return Promise.resolve({ok:false});
  if (document.pictureInPictureElement) return Promise.resolve({ok:true,already:true});
  if (!document.pictureInPictureEnabled) return Promise.resolve({ok:false,message:'PiP is unavailable'});
  const video = Array.from(document.querySelectorAll('video')).find(v => !v.paused && !v.ended && v.readyState >= 2 && v.videoWidth > 0 && !v.disablePictureInPicture);
  if (!video) return Promise.resolve({ok:false,message:'재생 중인 영상을 찾을 수 없어요.'});
  return video.requestPictureInPicture().then(p => ({ok:true,width:p.width,height:p.height})).catch(e => ({ok:false,name:e.name,message:e.message}));
})()`;
async function enterPip(tab, manual = false) {
  if (pipPending || !tab || (!manual && !state.autoPip)) return { ok: false };
  if (!manual && !isYoutubeURL(tab.url) && !(TEST && isWebURL(tab.url) && new URL(tab.url).hostname === '127.0.0.1')) return { ok: false };
  const view = views.get(tab.id);
  if (!view || view.webContents.isDestroyed()) return { ok: false };
  if (view.webContents.isLoadingMainFrame()) return { ok: false };
  pipPending = true;
  try {
    const result = await withDeadline(view.webContents.executeJavaScript(PIP_SCRIPT.replace('__ORBIT_DEADLINE__', String(Date.now() + 1400)), true));
    if (result?.ok) { pipTabId = tab.id; if (manual) notify('영상이 다른 앱 위에 표시됩니다.'); }
    else if (manual) notify(result?.message || '이 페이지에서는 PIP를 사용할 수 없어요.');
    return result;
  } catch (error) { if (manual) notify('PIP를 열 수 없어요. 영상 재생 상태를 확인해 주세요.'); return { ok: false, message: error.message }; }
  finally { pipPending = false; }
}
async function restorePipIfVisible() {
  if (!pipTabId || !visibleIds().includes(pipTabId)) return;
  const view = views.get(pipTabId);
  pipTabId = null;
  if (view && !view.webContents.isDestroyed() && !view.webContents.isLoadingMainFrame()) await withDeadline(view.webContents.executeJavaScript('document.pictureInPictureElement ? document.exitPictureInPicture().then(() => true) : false')).catch(() => {});
}

// Chromium retains document-focus and frame policy enforcement.
function canWriteClipboard(wc){return !!(win&&!win.isDestroyed()&&!overlayOpen&&(visibleIds().some(id=>views.get(id)?.webContents===wc)||(webPanel?.view.webContents===wc&&webPanel.view.getVisible())));}
function secureClipboardOrigin(origin){if(!origin)return false;const u=new URL(origin);return u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname));}
function webOrigin(value) { return isWebURL(value) ? new URL(value).origin : null; }

function configureSession(spaceId) {
  const partition = incognito ? `orbit-private-${windowId}-${spaceId}` : `persist:orbit-${spaceId}`;
  if (sessions.has(partition)) return sessions.get(partition);
  const ses = session.fromPartition(partition);
  sessions.set(partition, ses);
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin,details={}) => {
    const origin = webOrigin(requestingOrigin);
    if(permission==='clipboard-sanitized-write')return !!(_wc&&!_wc.isDestroyed()&&contentsOwners.get(_wc.id)?.canWriteClipboard(_wc)&&secureClipboardOrigin(origin));
    if(['storage-access','top-level-storage-access'].includes(permission)){const embedding=webOrigin(_wc?.getURL()||'');return origin!==null&&embedding!==null&&permissionDecisions.get(partition+'|'+origin+'|'+permission+'|'+embedding)===true;}
    return origin !== null && (permission === 'fullscreen' || permissionDecisions.get(`${partition}|${origin}|${permission}`) === true);
  });
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    const requestURL = details.requestingUrl || wc.getURL();
    if(permission==='clipboard-sanitized-write')return callback(!!(!wc.isDestroyed()&&contentsOwners.get(wc.id)?.canWriteClipboard(wc)&&secureClipboardOrigin(webOrigin(requestURL))));
    if (permission === 'fullscreen') return callback(isWebURL(requestURL));
    if (!isWebURL(requestURL) || !['media', 'geolocation', 'notifications', 'clipboard-read','storage-access','top-level-storage-access'].includes(permission)) return callback(false);
    const origin = webOrigin(requestURL);
    const storage=['storage-access','top-level-storage-access'].includes(permission);
    const embedding=storage?webOrigin(wc.getURL()):null;if(storage&&!embedding)return callback(false);
    const key = `${partition}|${origin}|${permission}`+(storage?'|'+embedding:'');
    if (permissionDecisions.has(key)) return callback(permissionDecisions.get(key));
    const labels = { media: '카메라 / 마이크', geolocation: '위치', notifications: '알림', 'clipboard-read': '클립보드 읽기','storage-access':'삽입된 로그인 서비스의 쿠키 접근','top-level-storage-access':'연결된 로그인 서비스의 쿠키 접근' };
    try {
      const { response } = await dialog.showMessageBox(contentsOwners.get(wc.id)?.win, { type: 'question', title: '사이트 권한',
        message: storage?`${embedding}에서 ${origin} 사용`:`${origin}`, detail: `${labels[permission]} 권한을 허용할까요? 이 선택은 현재 실행 중에 유지됩니다.`, buttons: ['차단', '허용'], defaultId: 0, cancelId: 0 });
      const granted=response===1&&(!storage||(!wc.isDestroyed()&&webOrigin(wc.getURL())===embedding));permissionDecisions.set(key,granted);callback(granted);
    } catch { callback(false); }
  });
  ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  ses.on('will-download', (_event, item, source) => {
    const owner = contentsOwners.get(source?.id);
    if (!owner || owner.win?.isDestroyed()) { item.cancel(); return; }
    owner.receiveDownload(item);
  });
  return ses;
}

function updateDownloadProgress() {
  if (!win || win.isDestroyed()) return;
  const active = [...downloadItems.values()].filter(item => item.getState() === 'progressing');
  if (!active.length) { win.setProgressBar(-1);return; }
  const totals = active.map(item => item.getTotalBytes());
  if (totals.some(total => total <= 0)) { win.setProgressBar(2);return; }
  const total = totals.reduce((sum, bytes) => sum + bytes, 0);
  const received = active.reduce((sum, item) => sum + item.getReceivedBytes(), 0);
  win.setProgressBar(Math.min(1, received / total));
}

function receiveDownload(item) {
    const id = randomUUID();
    const record = { id, filename: item.getFilename(), receivedBytes: 0, totalBytes: item.getTotalBytes(), state: 'progressing', path: '' };
    downloads.unshift(record); downloads = downloads.slice(0, 50); downloadItems.set(id, item);
    if (TEST && process.env.ORBIT_DOWNLOAD_DIR) {
      fs.mkdirSync(process.env.ORBIT_DOWNLOAD_DIR, { recursive: true });
      item.setSavePath(path.join(process.env.ORBIT_DOWNLOAD_DIR, path.basename(item.getFilename())));
    } else item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
    item.on('updated', (_event, status) => {
      record.receivedBytes = item.getReceivedBytes(); record.totalBytes = item.getTotalBytes(); record.state = status;
      updateDownloadProgress(); publishSoon();
    });
    item.once('done', (_event, status) => {
      record.state = status; record.path = item.getSavePath(); record.receivedBytes = item.getReceivedBytes();
      downloadItems.delete(id); updateDownloadProgress(); publish(false);
      notify(status === 'completed' ? `${record.filename} 다운로드 완료` : `${record.filename} 다운로드 ${status === 'cancelled' ? '취소' : '중단'}`);
    });
    updateDownloadProgress(); publish(false);
}
function bindShortcuts(wc, panel = false) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    const key = input.key.toLowerCase();
    const consume = fn => { event.preventDefault(); Promise.resolve().then(fn).catch(error => notify(error.message)); };
    if (mod && key === 'n') return consume(() => handleAction(input.shift ? 'newIncognitoWindow' : 'newWindow'));
    if (mod && key === 't' && input.shift) return consume(() => handleAction('reopenTab'));
    if (mod && key === 'f') return consume(() => command('find'));
    if (mod && key === 'p') return consume(() => handleAction(input.shift ? 'savePDF' : 'print'));
    if (mod && key === 'd') return consume(() => handleAction(input.shift ? 'split' : 'favoriteTab', { id: state.activeTabId }));
    if (mod && ['+', '=', '-', '0'].includes(key)) return consume(() => handleAction('zoom', key === '0' ? { reset: true } : { delta: key === '-' ? -.1 : .1 }));
    if (key === 'f12' || (mod && input.shift && key === 'i')) return consume(() => handleAction('devTools'));
    if (mod && key === 'l') return consume(() => command('focus-address'));
    if (mod && key === 't') return consume(() => command('new-tab'));
    if (mod && key === 'w') return consume(() => panel ? handleAction('closeWebPanel') : handleAction('closeTab', { id: state.activeTabId }));
    if (mod && key === 'b') return consume(() => handleAction('toggleSidebar', {}));
    if (mod && key === 'j') return consume(() => command('downloads'));
    if (mod && key === ',') return consume(() => command('settings'));
    if (mod && key === '\\') return consume(() => handleAction('split', {}));
    if ((mod && key === 'r') || key === 'f5') return consume(() => panel ? handleAction('navigateWebPanel', { action: 'reload' }) : handleAction('reload'));
    if (input.alt && key === 'arrowleft') return consume(() => panel ? handleAction('navigateWebPanel', { action: 'back' }) : handleAction('back'));
    if (input.alt && key === 'arrowright') return consume(() => panel ? handleAction('navigateWebPanel', { action: 'forward' }) : handleAction('forward'));
    if (mod && key === 'tab') return consume(() => {
      const tabs = state.tabs.filter(t => t.spaceId === state.activeSpaceId), index = tabs.findIndex(t => t.id === state.activeTabId);
      const target = tabs[(index + (input.shift ? tabs.length - 1 : 1)) % tabs.length];
      if (target) handleAction('activateTab', { id: target.id });
    });
    if (key === 'f11') return consume(() => win.setFullScreen(!win.isFullScreen()));
  });
}
function bindWebContextMenu(tab, view, panel = false) {
  const wc = view.webContents;
  const isVisible = () => win && !win.isDestroyed() && !wc.isDestroyed() && view.getVisible() &&
    (panel ? webPanel?.view === view : views.get(tab.id) === view);
  wc.on('context-menu', (_event, params) => {
    if (!isVisible()) return;
    const pageURL = wc.getURL();
    const frame = params.frame;
    if (!wc.isFocused()) wc.focus();
    if (!panel && state.activeTabId !== tab.id) { state.activeTabId = tab.id;publish(); }
    const menu = Menu.buildFromTemplate(webContextMenu(wc, params, {
      openTab: (url, background) => handleAction('openContextTab', { id: panel ? state.activeTabId : tab.id, url, background }).catch(() => {}),
      copyText: text => clipboard.writeText(text),
      guard: callback => {
        if (isVisible() && wc.getURL() === pageURL && (!frame || params.frame === frame)) callback();
      },
    }));
    const bounds = view.getBounds();
    menu.popup({ window: win, frame, x: bounds.x + params.x, y: bounds.y + params.y, sourceType: params.menuSourceType });
  });
}

function closeWebPanel() {
  const panel = webPanel;
  if (!panel || panel.view.webContents.isDestroyed()) return Promise.resolve(true);
  if (panel.closing) return panel.closing.promise;
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  panel.closing = { promise, resolve };
  try { panel.view.webContents.close({ waitForBeforeUnload: true }); }
  catch { panel.closing = null; resolve(false); }
  return promise;
}

async function openWebPanel(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 4096) throw new Error('웹 패널에서 열 주소를 입력하세요.');
  const url = normalizeInput(input);
  if (!isWebURL(url)) throw new Error('웹 패널은 HTTP와 HTTPS 주소를 지원합니다.');
  if (webPanel && webPanel.spaceId !== state.activeSpaceId && !await closeWebPanel()) return;
  if (quitting || closingWindow || !win || win.isDestroyed()) return;
  if (!webPanel) {
    const view = new WebContentsView({ webPreferences: { ...securePreferences, session: configureSession(state.activeSpaceId) } });
    const details = { id: randomUUID(), url, title: '', loading: true, error: null, canGoBack: false, canGoForward: false };
    const panel = { view, details, spaceId: state.activeSpaceId, closing: null };
    webPanel = panel;
    const wc = view.webContents;
    win.contentView.addChildView(view);
    view.setVisible(false);
    contentsOwners.set(wc.id, controller);
    bindShortcuts(wc, true);
    bindWebContextMenu(details, view, true);
    const allowNavigation = (event, target) => {
      if (!isWebURL(typeof target === 'string' ? target : event.url)) event.preventDefault();
    };
    wc.on('will-navigate', allowNavigation);
    wc.on('will-redirect', allowNavigation);
    wc.setWindowOpenHandler(({ url }) => {
      if (view.getVisible() && isWebURL(url)) handleAction('newTab', { url }).catch(() => {});
      return { action: 'deny' };
    });
    const reportNavigation = () => {
      const currentURL = wc.getURL();
      if (isWebURL(currentURL)) details.url = currentURL;
      details.canGoBack = wc.navigationHistory.canGoBack();
      details.canGoForward = wc.navigationHistory.canGoForward();
      publish(false);
    };
    wc.on('did-navigate', reportNavigation);
    wc.on('did-navigate-in-page', reportNavigation);
    wc.on('page-title-updated', (_event, title) => { details.title = String(title).slice(0, 500); publish(false); });
    wc.on('did-start-loading', () => { details.loading = true; details.error = null; layout(); publish(false); });
    wc.on('did-stop-loading', () => { details.loading = false; reportNavigation(); });
    const fail = () => {
      details.error = '웹 패널의 페이지를 열 수 없습니다. 주소를 확인하거나 다시 불러오세요.';
      details.loading = false;
      layout(); publish(false);
    };
    wc.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) fail();
    });
    wc.on('render-process-gone', fail);
    wc.on('will-prevent-unload', event => {
      if (!win || win.isDestroyed()) { event.preventDefault(); return; }
      const response = dialog.showMessageBoxSync(win, { type: 'question', title: '웹 패널에서 나갈까요?',
        message: '저장하지 않은 내용이 사라질 수 있습니다.', buttons: ['계속 작성', '나가기'], defaultId: 0, cancelId: 0, noLink: true });
      if (response === 1) event.preventDefault();
      else { panel.closing?.resolve(false); panel.closing = null; }
    });
    wc.once('destroyed', () => {
      contentsOwners.delete(wc.id);
      if (webPanel === panel) webPanel = null;
      if (win && !win.isDestroyed()) win.contentView.removeChildView(view);
      panel.closing?.resolve(true);
      layout(); publish(false);
    });
  }
  const panel = webPanel;
  panel.details.url = url;
  panel.details.title = '';
  panel.details.error = null;
  panel.view.webContents.loadURL(url).catch(() => {});
}

function updateNavigation(tab, wc) {
  if (wc.isDestroyed()) return;
  const url = wc.getURL();
  if (isWebURL(url)||sameOriginBlob(url,tab.blobCreatorOrigin||tab.url)) { if (webOrigin(tab.url) !== webOrigin(url)) tab.faviconURL = null;tab.url = url; }
  tab.canGoBack = wc.navigationHistory.canGoBack(); tab.canGoForward = wc.navigationHistory.canGoForward();
  publish();
}
function ensureView(tab, shouldLoad = true, popupOptions = {}) {
  if (isInternal(tab.url)) return null;
  if (views.has(tab.id)) {
    if (!views.get(tab.id).webContents.isDestroyed()) return views.get(tab.id);
    views.delete(tab.id);
  }
  const view = new WebContentsView({ ...(popupOptions.webContents ? { webContents: popupOptions.webContents } : {}),
    webPreferences: { ...popupOptions.webPreferences, ...securePreferences, session: configureSession(tab.spaceId), preload: incognito ? undefined : path.join(__dirname, 'login-preload.cjs') } });
  views.set(tab.id, view); win.contentView.addChildView(view); view.setVisible(false);
  if (typeof view.setBorderRadius === 'function') view.setBorderRadius(12);
  const wc = view.webContents;
  contentsOwners.set(wc.id, controller);
  wc.once('destroyed', () => contentsOwners.delete(wc.id));
  bindShortcuts(wc);
  bindWebContextMenu(tab, view);
  wc.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(win, { type: 'question', title: '페이지에서 나갈까요?',
      message: '저장하지 않은 내용이 있을 수 있어요.', detail: '나가면 입력 중인 내용이 사라질 수 있습니다.',
      buttons: ['계속 작성', '나가기'], defaultId: 0, cancelId: 0, noLink: true });
    if (response === 1) event.preventDefault();
    else {
      retainedTabs.delete(tab.id);
      closeRequests.get(tab.id)?.resolve(false);closeRequests.delete(tab.id);
    }
  });
  wc.once('destroyed', () => {
    findSessions.delete(tab.id);
    const request = closeRequests.get(tab.id);closeRequests.delete(tab.id);
    if (views.get(tab.id) === view) {
      views.delete(tab.id);try { win?.contentView.removeChildView(view); } catch {}
      if (!quitting && !closingWindow && !retainedTabs.has(tab.id)) removeTab(tab.id, tab.openerId);
      retainedTabs.delete(tab.id);
      layout();publish();
    }
    request?.resolve(true);
  });
  wc.on('focus', () => {
    if (visibleIds().includes(tab.id) && state.activeTabId !== tab.id) { state.activeTabId = tab.id; publish(); }
  });
  const checkNavigation = (event, url) => {
    const target = typeof url === 'string' ? url : event.url;
    const creator=webOrigin(wc.getURL())||tab.blobCreatorOrigin||webOrigin(tab.url);
    if(sameOriginBlob(target,creator))tab.blobCreatorOrigin=creator;
    if (!isWebURL(target)&&!sameOriginBlob(target,creator)&&!(target==='about:blank'&&tab.url==='about:blank')) { event.preventDefault(); notify('이 브라우저는 웹 주소(http/https)만 열 수 있어요.'); }
  };
  wc.on('will-navigate', checkNavigation); wc.on('will-redirect', checkNavigation);
  wc.setWindowOpenHandler(({ url, disposition }) => {
    const creator=webOrigin(wc.getURL())||tab.blobCreatorOrigin;
    const target = popupTarget(url,creator);
    if (!target) return { action: 'deny' };
    if (state.tabs.length >= 200) { notify('탭이 200개에 도달했어요. 사용하지 않는 탭을 닫아 주세요.'); return { action: 'deny' }; }
    return { action: 'allow', outlivesOpener: true, overrideBrowserWindowOptions: { webPreferences: { ...securePreferences, session: configureSession(tab.spaceId), preload: incognito ? undefined : path.join(__dirname, 'login-preload.cjs') } },
      createWindow: options => {
        if (state.tabs.length >= 200) throw new Error('Tab limit reached');
        const popup = { id: randomUUID(), spaceId: tab.spaceId, title: target === 'about:blank' ? '로그인 창 연결 중…' : new URL(target).hostname, url: target, pinned: false, openerId: tab.id, blobCreatorOrigin: creator };
        state.tabs.push(popup);
        if (disposition !== 'background-tab') { enterPip(tab); state.activeSpaceId = tab.spaceId; state.activeTabId = popup.id; state.splitTabIds = []; }
        const popupView = ensureView(popup, !options.webContents, options); publish(); layout();
        return popupView.webContents;
      } };
  });
  wc.on('page-title-updated', (_event, title) => {
    tab.title = String(title || tab.url).slice(0, 500);
    if(!incognito&&state.searchPreferences.saveHistory){const url=safeVisit(wc.getURL());const entry=state.history.find(r=>r.kind==='visit'&&r.spaceId===tab.spaceId&&r.value===url);if(entry){entry.title=tab.title;syncShared('history');}}
    publish();
  });
  let iconAttempted = false, iconRevision = 0;
  const discoverFavicon = urls => {
    const pageURL = wc.getURL();
    if (!isWebURL(pageURL)) return;
    const revision = ++iconRevision, spaceId = tab.spaceId;
    iconAttempted = true;
    const isCurrent = () => !quitting && !wc.isDestroyed() && revision === iconRevision &&
      views.get(tab.id) === view && tab.spaceId === spaceId && wc.getURL() === pageURL && tab.url === pageURL;
    const candidates = urls.filter(url => typeof url === 'string' &&
      (url.startsWith('data:') ? url.length <= maxIconBytes : url.length <= 4096 && isWebURL(url))).slice(0, 4);
    candidates.push(new URL('/favicon.ico', pageURL).href);
    (async () => {
      for (const url of new Set(candidates)) {
        if (!isCurrent()) return;
        const icon = await fetchFavicon(wc, spaceId, pageURL, url, isCurrent);
        if (!icon || !isCurrent()) continue;
        applyFavicon(tab, icon);
        return;
      }
    })().catch(() => {});
  };
  wc.on('page-favicon-updated', (_event, urls) => discoverFavicon(Array.isArray(urls) ? urls : []));
  wc.on('found-in-page', (_event, result) => {
    if (state.activeTabId !== tab.id) return;
    findResult = { matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal };
    publish(false);
  });
  wc.on('audio-state-changed', () => { tab.muted = wc.isAudioMuted();publish(false); });
  wc.on('did-start-loading', () => { tab.loading = true; tab.error = null; publish(false); layout(); });
  wc.on('did-stop-loading', () => {
    tab.loading = false;
    updateNavigation(tab, wc);
    const url = isWebURL(wc.getURL()) ? new URL(wc.getURL()) : null;
    if (!tab.error && url) {
      if (url.hostname !== 'www.google.com' || url.pathname !== '/search') {
        remember('visit', safeVisit(url.href), tab.title, tab.spaceId, tab.faviconURL);
      }
      if (!iconAttempted && !tab.faviconURL) discoverFavicon([]);
    }
    layout();
  });
  wc.on('did-navigate', () => { iconAttempted = false; ++iconRevision; findSessions.delete(tab.id);updateNavigation(tab, wc); });
  wc.on('did-navigate-in-page', () => updateNavigation(tab, wc));
  wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) { tab.error = `${description} (${code})`; tab.loading = false; publish(false); layout(); }
  });
  wc.on('render-process-gone', () => { tab.error = '페이지가 응답을 멈췄어요. 새로고침해 주세요.'; tab.loading = false; publish(false); layout(); });
  wc.on('enter-html-full-screen', () => win?.setFullScreen(true));
  wc.on('leave-html-full-screen', () => win?.setFullScreen(false));
  if (shouldLoad) wc.loadURL(tab.url).catch(error => {
    if (error.code !== 'ERR_ABORTED' && tabById(tab.id) && !wc.isDestroyed()) { tab.error = error.message; tab.loading = false; publish(false); layout(); }
  });
  return view;
}
function closeView(id) {
  const view = views.get(id);
  if (!view) return;
  views.delete(id);
  try { win?.contentView.removeChildView(view); if (!view.webContents.isDestroyed()) view.webContents.close(); } catch {}
}
function requestCloseView(id, retain = false) {
  const view = views.get(id);
  if (!view || view.webContents.isDestroyed()) return Promise.resolve(true);
  if (closeRequests.has(id)) return closeRequests.get(id).promise;
  if (retain) retainedTabs.add(id);
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  closeRequests.set(id, { promise, resolve });
  try { view.webContents.close({ waitForBeforeUnload: true }); }
  catch { closeRequests.delete(id);retainedTabs.delete(id);resolve(false); }
  return promise;
}
function removeTab(id, preferredId) {
  const target = tabById(id);if (!target) return;
  if (!incognito && isWebURL(target.url)) {
    state.archivedTabs.unshift({ id: target.id, spaceId: target.spaceId, title: target.title, url: target.url,
      pinned: target.pinned === true, folderId: target.folderId || null, faviconURL: safeRasterFaviconURL(target.faviconURL), closedAt: Date.now() });
    state.archivedTabs = state.archivedTabs.slice(0, 100);
  }
  state.tabs = state.tabs.filter(t => t.id !== id);
  if (!state.tabs.some(t => t.spaceId === target.spaceId)) makeTab(HOME, target.spaceId);
  if (state.splitTabIds.includes(id)) state.splitTabIds = [];
  if (state.activeTabId === id) {
    const preferred = tabById(preferredId);
    state.activeTabId = preferred?.spaceId === state.activeSpaceId ? preferred.id : state.tabs.find(t => t.spaceId === state.activeSpaceId).id;
    ensureView(currentTab());
  }
}
function makeTab(url = HOME, spaceId = state.activeSpaceId) {
  if (state.tabs.length >= 200) throw new Error('탭은 최대 200개까지 열 수 있어요. 사용하지 않는 탭을 닫아 주세요.');
  const tab = { id: randomUUID(), spaceId, title: url === HOME ? '새 탭' : new URL(url).hostname, url, pinned: false, folderId: null, faviconURL: null };
  state.tabs.push(tab); return tab;
}
async function activateTab(tab) {
  const old = currentTab();
  if (old?.id !== tab.id && !state.splitTabIds.includes(tab.id)) await enterPip(old);
  tab = tabById(tab.id);if (!tab) return;
  if (state.splitTabIds.length && !state.splitTabIds.includes(tab.id)) {
    const index = state.splitTabIds.indexOf(state.activeTabId); state.splitTabIds[index < 0 ? 0 : index] = tab.id;
  }
  state.activeTabId = tab.id; state.activeSpaceId = tab.spaceId;
  ensureView(tab); layout(); publish();
  if (!overlayOpen) views.get(tab.id)?.webContents.focus();
}
async function fetchFavicon(wc, spaceId, pageURL, url, isCurrent) {
  const inline = decodeInlineFavicon(url);
  if (!inline && (!isWebURL(url) || (pageURL.startsWith('https:') && url.startsWith('http:')))) return null;
  const key = inline ? null : `${spaceId}|${url}`;
  const cached = key && faviconRequests.get(key);
  if (cached?.expiresAt > Date.now()) return cached.promise;
  while (faviconJobs.size >= 4) await Promise.race(faviconJobs.values());
  if (!isCurrent()) return null;
  const refreshed = key && faviconRequests.get(key);
  if (refreshed?.expiresAt > Date.now()) return refreshed.promise;
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 4000);
  const entry = { expiresAt: Infinity, promise: (async () => {
      try {
        let bytes = inline?.bytes, type = inline?.type;
        if (!inline) {
          let current = url, response;
          for (let redirects = 0; redirects <= 3; redirects++) {
            if (quitting) return null;
            response = await configureSession(spaceId).fetch(current, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'manual', signal: abort.signal });
            if (response.status < 300 || response.status >= 400) break;
            const location = response.headers.get('location');
            if (!location || redirects === 3) return null;
            current = new URL(location, current).href;
            if (!isWebURL(current) || (pageURL.startsWith('https:') && current.startsWith('http:'))) return null;
          }
          type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          if (!response.ok || !response.body || /html/i.test(type) || Number(response.headers.get('content-length')) > maxIconBytes) return null;
          const chunks = [];let length = 0;
          for await (const chunk of response.body) {
            length += chunk.length;
            if (length > maxIconBytes) return null;
            chunks.push(Buffer.from(chunk));
          }
          bytes = Buffer.concat(chunks);
        }
        const raster = boundedRaster(bytes);
        if (!raster && !svgFavicon(bytes, type)) return null;
        if (raster) {
          const icon = nativeImage.createFromBuffer(bytes);
          if (!icon.isEmpty()) return icon.resize({ width: 32, height: 32, quality: 'best' }).toDataURL();
        }
        if (!isCurrent() || abort.signal.aborted) return null;
        const data = await withDeadline(wc.executeJavaScriptInIsolatedWorld(1139,
          [{ code: faviconImageScript(bytes, raster ? 'image/x-icon' : 'image/svg+xml') }]), 1500);
        return data?.length <= 8192 && data.startsWith('data:image/png;base64,') ? safeRasterFaviconURL(data) : null;
      } catch { return null; }
    })().finally(() => { clearTimeout(timer);abort.abort();faviconJobs.delete(abort); }) };
  faviconJobs.set(abort, entry.promise);
  if (key) {
    faviconRequests.set(key, entry);
    if (faviconRequests.size > 200) faviconRequests.delete(faviconRequests.keys().next().value);
  }
  const data = await entry.promise;
  entry.expiresAt = Date.now() + (data ? 60 * 60 * 1000 : 60 * 1000);
  return data;
}
function applyFavicon(tab, data) {
  let changed = tab.faviconURL !== data;
  tab.faviconURL = data;
  if (!incognito) {
    const visited = safeVisit(tab.url);
    const entry = state.history.find(item => item.kind === 'visit' && item.spaceId === tab.spaceId && item.value === visited);
    if (entry && entry.faviconURL !== data) { entry.faviconURL = data;changed = true;syncShared('history'); }
    const favorite = state.favorites.find(item => item.url === tab.url);
    if (favorite && favorite.faviconURL !== data) { favorite.faviconURL = data;changed = true;syncShared('favorites'); }
  }
  if (changed) publish();
}
function blankWindowState(privateMode, source = state) {
  const next = JSON.parse(JSON.stringify(source));
  next.tabs = next.spaces.map(space => ({ id: randomUUID(), spaceId: space.id, title: '새 탭', url: HOME, pinned: false }));
  next.activeTabId = next.tabs.find(entry => entry.spaceId === next.activeSpaceId).id;
  next.splitTabIds = [];
  if (privateMode) { next.archivedTabs = [];next.history=[]; }
  return sanitizeState(next);
}
function syncShared(key) {
  for (const other of controllers) {
    if (other === controller || (key === 'history' && other.incognito)) continue;
    other.state[key] = JSON.parse(JSON.stringify(state[key]));
    if (key === 'appearance') other.layout();
    other.publish();
  }
}
async function importBookmarks() {
  if (incognito) throw new Error('북마크 가져오기는 일반 창에서 사용할 수 있어요.');
  const picked = await dialog.showOpenDialog(win, { title: '다른 브라우저의 북마크 가져오기', properties: ['openFile'],
    filters: [{ name: '북마크 HTML / JSON', extensions: ['html', 'htm', 'json'] }, { name: '모든 파일', extensions: ['*'] }] });
  if (picked.canceled || !picked.filePaths[0]) return;
  const filename = picked.filePaths[0], stat = await fs.promises.stat(filename);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('북마크 파일은 8MB 이하의 HTML 또는 JSON 파일이어야 해요.');
  const input = await fs.promises.readFile(filename, 'utf8');
  const parsed = /^\s*</.test(input) ? parseBookmarkHTML(input) : parseChromiumBookmarks(input);
  const room = 200 - state.tabs.length;
  if (!room) throw new Error('북마크를 가져오기 전에 사용하지 않는 탭을 닫아 주세요.');
  const folderIds = new Map();
  for (const folder of parsed.folders || []) {
    if (state.folders.length >= 100) break;
    const id = randomUUID();folderIds.set(folder.key, id);
    state.folders.push({ id, spaceId: state.activeSpaceId, name: String(folder.name || '가져온 북마크').slice(0, 80), collapsed: true });
  }
  let imported = 0;
  for (const bookmark of parsed.bookmarks || []) {
    if (imported >= room) break;
    if (!isWebURL(bookmark.url)) continue;
    const entry = makeTab(bookmark.url);entry.title = String(bookmark.title || new URL(bookmark.url).hostname).slice(0, 200);
    entry.pinned = true;entry.folderId = folderIds.get(bookmark.folderKey) || null;imported++;
  }
  notify(imported ? `${imported}개의 북마크를 고정 탭으로 가져왔습니다.${parsed.bookmarks.length > room ? ' 탭 한도로 일부 항목은 가져오지 못했어요.' : ''}` : '가져올 웹 북마크를 찾지 못했어요.');
}
async function loadExtension() {
  if (incognito) throw new Error('확장 프로그램은 일반 창에서만 불러올 수 있어요.');
  const picked = await dialog.showOpenDialog(win, { title: '압축 해제된 확장 프로그램 폴더 선택', properties: ['openDirectory'] });
  if (picked.canceled || !picked.filePaths[0]) return;
  const { directory, manifest } = await resolveExtensionDirectory(picked.filePaths[0]);
  const rpc = isRpcExtension(manifest);
  const contentMatches = (Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []).flatMap(script => Array.isArray(script?.matches) ? script.matches : []);
  const permissions = [...new Set([...(Array.isArray(manifest.permissions) ? manifest.permissions : []), ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []), ...contentMatches].map(String))].slice(0, 50).map(value => value.slice(0, 300)).join(', ');
  const approved = await dialog.showMessageBox(win, { type: 'warning', title: '확장 프로그램 불러오기',
    message: `“${String(manifest.name || '확장 프로그램').slice(0, 100)}”을(를) 현재 스페이스에서 실행할까요?`,
    detail: rpc ? '현재 스페이스의 일반 탭 제목·주소·재생 중인 미디어를 이 기기의 Discord Custom RPC 앱(127.0.0.1:39231)에 전달합니다. 시크릿 창과 입력 중인 글은 전달하지 않습니다. 이 연결은 재시작 후에도 유지되며 확장 목록에서 제거할 수 있습니다.' : `신뢰하는 확장 프로그램만 사용하세요. 웹페이지와 사이트 데이터에 접근할 수 있습니다.\n요청 권한: ${permissions || '명시된 권한 없음'}\nElectron에서 지원하는 일부 확장 API만 동작하며 Chrome 웹 스토어 설치는 지원하지 않습니다. 재시작 시 다시 불러와야 합니다.`,
    buttons: ['취소', '불러오기'], defaultId: 0, cancelId: 0 });
  if (approved.response !== 1) return;
  if (rpc) {
    rpcExtensions.set(state.activeSpaceId, rpcExtensionRecord(state.activeSpaceId, directory, manifest));
    saveRpcExtensions();
    rpcBridge?.start();
    rpcBridge?.tick();
    for (const owner of controllers) owner.publish(false);
    notify('Discord Custom RPC를 Orbit 호환 방식으로 연결했습니다. RPC 앱이 실행 중이면 활동이 전송됩니다.');return;
  }
  const extension = await configureSession(state.activeSpaceId).extensions.loadExtension(directory, { allowFileAccess: false });
  notify(`${extension.name}을(를) 현재 스페이스에 불러왔습니다.`);
}
async function showExtension(id) {
  const rpc = !incognito && rpcExtensions.get(state.activeSpaceId);
  if (rpc?.id === id) { await activateTab(makeTab('http://127.0.0.1:39231'));return; }
  const ses = configureSession(state.activeSpaceId), extension = ses.extensions.getExtension(id);
  if (!extension) return;
  const manifest = JSON.parse(await fs.promises.readFile(path.join(extension.path, 'manifest.json'), 'utf8'));
  const popup = manifest.action?.default_popup || manifest.browser_action?.default_popup;
  if (typeof popup !== 'string' || !popup || popup.length > 2000 || popup.includes('\\') || popup.includes(':') || popup.startsWith('/')) { notify('이 확장 프로그램에는 열 수 있는 팝업이 없어요.');return; }
  const resolved = path.resolve(extension.path, popup), relative = path.relative(extension.path, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('잘못된 확장 프로그램 팝업 경로입니다.');
  const popupWindow = new BrowserWindow({ width: 440, height: 600, parent: win, title: extension.name, autoHideMenuBar: true,
    webPreferences: { ...securePreferences, session: ses } });
  extensionWindows.add(popupWindow);
  popupWindow.orbitExtensionId = extension.id;
  const base = `chrome-extension://${extension.id}/`;
  popupWindow.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(base)) event.preventDefault(); });
  popupWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  popupWindow.once('closed', () => extensionWindows.delete(popupWindow));
  await popupWindow.loadURL(base + popup.split('/').map(encodeURIComponent).join('/'));
}
function closeExtensionPopups(id, ses) {
  for (const popup of extensionWindows) {
    if (!popup.isDestroyed() && popup.orbitExtensionId === id && popup.webContents.session === ses) popup.destroy();
  }
}
function cardImage(dataURL) {
  if (typeof dataURL !== 'string' || dataURL.length > 2 * 1024 * 1024 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataURL)) throw new Error('올바른 PNG 카드 이미지가 필요해요.');
  const bytes = Buffer.from(dataURL.slice('data:image/png;base64,'.length), 'base64');
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(20) < 1 || bytes.readUInt32BE(16) > 4096 || bytes.readUInt32BE(20) > 4096) throw new Error('카드 이미지는 4096픽셀 이하의 PNG여야 해요.');
  const image = nativeImage.createFromBuffer(bytes);if (image.isEmpty()) throw new Error('카드 이미지를 읽지 못했어요.');
  return image;
}
function handleAction(name, payload = {}) {
  const result = actionQueue.then(() => performAction(name, payload));
  actionQueue = result.catch(() => {});
  return result.catch(error => { notify(error.message);throw error; });
}
async function performAction(name, payload = {}) {
  if (quitting) return snapshot();
  if (typeof name !== 'string' || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid action');
  const tab = currentTab(), wc = views.get(tab?.id)?.webContents;
  switch (name) {
    case 'searchPreferences': {
      if(incognito)break;
      state.searchPreferences=preferences({...state.searchPreferences,...Object.fromEntries(Object.entries(payload).filter(([key])=>['autocomplete','saveHistory','onlineSuggestions'].includes(key)))});
      suggestionRequest?.abort();syncShared('searchPreferences');break;
    }
    case 'clearHistory': if(!incognito){state.history=state.history.filter(r=>r.spaceId!==state.activeSpaceId);syncShared('history');}break;
    case 'deleteHistory': if(!incognito){state.history=state.history.filter(r=>!(r.spaceId===state.activeSpaceId&&r.kind===payload.kind&&r.value===payload.value));syncShared('history');}break;
    case 'passwordList': { const available = !incognito && passwordVault.available();return { entries: available ? passwordVault.list(state.activeSpaceId) : [], available, origin: loginOrigin(wc?.getURL()) }; }
    case 'passwordSave': {
      if (incognito || !wc || !loginOrigin(wc.getURL())) throw new Error('일반 창의 HTTPS 로그인 페이지에서 사용해 주세요.');
      const origin = loginOrigin(wc.getURL());
      const value = await withDeadline(wc.executeJavaScriptInIsolatedWorld(1138, [{ code: collectLoginScript }]), 1500);
      if (origin !== loginOrigin(wc.getURL())) throw new Error('페이지가 변경되었습니다. 다시 시도해 주세요.');
      if (!value) throw new Error('입력한 아이디와 비밀번호가 있는 로그인 폼을 찾지 못했습니다.');
      await offerLogin(tab, value, origin);break;
    }
    case 'passwordFill': {
      if (incognito || !wc) throw new Error('일반 창에서 사용해 주세요.');
      const entry = passwordVault.matches(state.activeSpaceId, wc.getURL()).find(r => r.id === payload.id);
      if (!entry || !await fillSavedLogin(tab, entry)) throw new Error('같은 사이트의 비어 있는 로그인 폼에서 사용해 주세요.');
      notify('로그인 정보를 입력했습니다. 로그인 버튼을 눌러 주세요.');break;
    }
    case 'passwordDelete': {
      if (incognito) break;
      const entry = passwordVault.list(state.activeSpaceId).find(r => r.id === payload.id);
      if (!entry) break;
      const { response } = await dialog.showMessageBox(win, { type: 'question', title: '저장된 로그인 삭제', message: `${new URL(entry.origin).host}의 ${entry.username || '저장된 계정'}을 삭제할까요?`, buttons: ['취소', '삭제'], defaultId: 0, cancelId: 0 });
      if (response === 1) passwordVault.remove(state.activeSpaceId, entry.id);break;
    }
    case 'newWindow':
    case 'newIncognitoWindow': {
      const privateMode = name === 'newIncognitoWindow';
      const normal = incognito && !privateMode
        ? [...controllers].find(owner => !owner.incognito && owner.win && !owner.win.isDestroyed())
        : controller;
      const other = normal
        ? createController({ incognito: privateMode, initialState: blankWindowState(privateMode, normal.state) })
        : createController({ initialState: readNormalProfile(), primary: true });
      await other.ready;break;
    }
    case 'createFolder': {
      if (state.folders.length >= 100) throw new Error('폴더는 최대 100개까지 만들 수 있어요.');
      const name = String(payload.name || '').trim().slice(0, 80);if (!name) throw new Error('폴더 이름을 입력해 주세요.');
      const id = randomUUID();
      const tab = tabById(payload.tabId);
      const color = typeof payload.color === 'string' && /^#[0-9a-f]{6}$/i.test(payload.color) ? payload.color.toLowerCase() : null;
      state.folders.push({ id, spaceId: state.activeSpaceId, name, collapsed: false, ...(color ? { color } : {}) });
      if (tab?.spaceId === state.activeSpaceId) tab.folderId = id;
      break;
    }
    case 'renameFolder': {
      const folder = state.folders.find(entry => entry.id === payload.id);
      const name = String(payload.name || '').trim().slice(0, 80);if (folder && name) {
        folder.name = name;
        if (typeof payload.color === 'string' && /^#[0-9a-f]{6}$/i.test(payload.color)) folder.color = payload.color.toLowerCase();
      }
      break;
    }
    case 'toggleFolder': { const folder = state.folders.find(entry => entry.id === payload.id);if (folder) folder.collapsed = !folder.collapsed;break; }
    case 'deleteFolder': {
      const folder = state.folders.find(entry => entry.id === payload.id);if (!folder) break;
      state.folders = state.folders.filter(entry => entry.id !== folder.id);
      for (const entry of state.tabs) if (entry.folderId === folder.id) entry.folderId = null;break;
    }
    case 'moveTab': {
      const target = tabById(payload.id);if (!target) break;
      const spaceId = typeof payload.spaceId === 'string' ? payload.spaceId : target.spaceId;
      if (!state.spaces.some(entry => entry.id === spaceId)) break;
      const folder = payload.folderId ? state.folders.find(entry => entry.id === payload.folderId && entry.spaceId === spaceId) : null;
      if (payload.folderId && !folder) break;
      const oldSpace = target.spaceId;
      if (spaceId !== oldSpace) {
        // A view's storage session cannot change. Recreate it only after the page permits closing.
        if (!await requestCloseView(target.id, true)) break;
        target.spaceId = spaceId;target.faviconURL = null;
        if (!state.tabs.some(entry => entry.spaceId === oldSpace)) makeTab(HOME, oldSpace);
        if (state.splitTabIds.includes(target.id)) state.splitTabIds = [];
        if (state.activeTabId === target.id) state.activeTabId = state.tabs.find(entry => entry.spaceId === state.activeSpaceId).id;
      }
      target.folderId = folder?.id || null;
      if (target.id === state.activeTabId) ensureView(target);break;
    }
    case 'reorderTab': {
      const target = tabById(payload.id), before = tabById(payload.beforeId);
      if (!target || !before || target.id === before.id || target.spaceId !== before.spaceId) break;
      state.tabs = state.tabs.filter(entry => entry.id !== target.id);state.tabs.splice(state.tabs.indexOf(before), 0, target);break;
    }
    case 'favoriteTab': {
      if (incognito) throw new Error('즐겨찾기 변경은 일반 창에서 사용할 수 있어요.');
      const target = tabById(payload.id || state.activeTabId);if (!target || !isWebURL(target.url)) break;
      const existing = state.favorites.find(entry => entry.url === target.url);
      if (existing) state.favorites = state.favorites.filter(entry => entry.id !== existing.id);
      else {
        if (state.favorites.length >= 50) throw new Error('즐겨찾기는 최대 50개까지 저장할 수 있어요.');
        state.favorites.push({ id: randomUUID(), title: target.title, url: target.url, faviconURL: target.faviconURL || null });
      }
      syncShared('favorites');break;
    }
    case 'addFavorite':
    case 'editFavorite': {
      if (incognito) throw new Error('즐겨찾기 변경은 일반 창에서 사용할 수 있어요.');
      const url = typeof payload.url === 'string' && payload.url.length <= 4096 ? URL.parse(payload.url) : null;
      if (!url || !isWebURL(url.href) || url.username || url.password) throw new Error('올바른 웹 주소를 입력해 주세요.');
      const target = name === 'editFavorite' ? state.favorites.find(entry => entry.id === payload.id) : null;
      if (name === 'editFavorite' && !target) throw new Error('즐겨찾기가 더 이상 존재하지 않습니다.');
      if (state.favorites.some(entry => entry.id !== target?.id && entry.url === url.href)) throw new Error('이미 즐겨찾기에 추가한 주소입니다.');
      if (!target && state.favorites.length >= 50) throw new Error('즐겨찾기는 최대 50개까지 저장할 수 있어요.');
      const title = typeof payload.title === 'string' ? payload.title.trim().slice(0, 100) : '';
      if (target) {
        if (target.url !== url.href) target.faviconURL = null;
        target.url = url.href;
        target.title = title || url.hostname;
      } else state.favorites.push({ id: randomUUID(), title: title || url.hostname, url: url.href, faviconURL: null });
      syncShared('favorites');break;
    }
    case 'moveFavorite': {
      if (incognito) break;
      const index = state.favorites.findIndex(entry => entry.id === payload.id);
      const offset = payload.direction === 'earlier' ? -1 : payload.direction === 'later' ? 1 : 0;
      const next = index + offset;
      if (index < 0 || !offset || next < 0 || next >= state.favorites.length) break;
      const [favorite] = state.favorites.splice(index, 1);
      state.favorites.splice(next, 0, favorite);
      syncShared('favorites');
      break;
    }
    case 'removeFavorite': {
      if (incognito) throw new Error('즐겨찾기 변경은 일반 창에서 사용할 수 있어요.');
      state.favorites = state.favorites.filter(entry => entry.id !== payload.id);syncShared('favorites');break;
    }
    case 'openFavorite': {
      const favorite = state.favorites.find(entry => entry.id === payload.id);if (!favorite) break;
      const existing = state.tabs.find(entry => entry.spaceId === state.activeSpaceId && entry.url === favorite.url);
      const target = existing || makeTab(favorite.url);
      target.faviconURL ||= safeRasterFaviconURL(favorite.faviconURL);
      await activateTab(target);break;
    }
    case 'archiveTab': {
      const target = tabById(payload.id || state.activeTabId);if (target && await requestCloseView(target.id)) removeTab(target.id, target.openerId);break;
    }
    case 'archiveAll': {
      for (const target of [...state.tabs].filter(entry => entry.spaceId === state.activeSpaceId && !entry.pinned)) {
        if (await requestCloseView(target.id)) removeTab(target.id);
      }break;
    }
    case 'reopenTab': {
      if (incognito) break;
      const archived = payload.id ? state.archivedTabs.find(entry => entry.id === payload.id) : state.archivedTabs[0];
      if (!archived || !isWebURL(archived.url)) break;
      const spaceId = state.spaces.some(entry => entry.id === archived.spaceId) ? archived.spaceId : state.activeSpaceId;
      const restored = makeTab(archived.url, spaceId);restored.title = archived.title;restored.pinned = archived.pinned;
      restored.faviconURL = safeRasterFaviconURL(archived.faviconURL);
      restored.folderId = state.folders.some(folder => folder.id === archived.folderId && folder.spaceId === spaceId) ? archived.folderId : null;
      state.archivedTabs = state.archivedTabs.filter(entry => entry.id !== archived.id);state.splitTabIds = [];
      await activateTab(restored);break;
    }
    case 'clearArchive': state.archivedTabs = [];break;
    case 'profile': {
      const displayName = payload.displayName ?? payload.name, seed = payload.cardSeed ?? payload.seed;
      if (typeof displayName === 'string' && displayName.trim()) state.profile.displayName = displayName.trim().slice(0, 40);
      if (typeof payload.tagline === 'string') state.profile.tagline = payload.tagline.trim().slice(0, 80);
      if (Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff) state.profile.cardSeed = seed;
      if (!incognito) syncShared('profile');break;
    }
    case 'find': {
      if (!wc) { findResult = { matches: 0, activeMatchOrdinal: 0 };break; }
      const query = typeof payload.query === 'string' ? payload.query.slice(0, 1000) : '';
      if (!query) { wc.stopFindInPage('clearSelection');findSessions.delete(tab.id);findResult = null;break; }
      // Electron 44 names this option findNext, but true begins a session.
      // The renderer's findNext flag means advance within an existing search.
      const beginSession = payload.findNext !== true || findSessions.get(tab.id) !== query;
      wc.findInPage(query, { forward: payload.forward !== false, findNext: beginSession });
      findSessions.set(tab.id, query);
      break;
    }
    case 'stopFind': wc?.stopFindInPage('clearSelection');if (tab) findSessions.delete(tab.id);findResult = null;break;
    case 'zoom': if (wc) {
      const current = wc.getZoomFactor(), delta = Number(payload.delta);
      if (payload.reset === true) wc.setZoomFactor(1);
      else if (Number.isFinite(delta) && Math.abs(delta) <= 1) wc.setZoomFactor(Math.max(.5, Math.min(3, Math.round((current + delta) * 100) / 100)));
    }break;
    case 'print': {
      if (!wc) { notify('인쇄할 웹페이지를 먼저 열어 주세요.');break; }
      wc.print({ silent: false, printBackground: true }, (success, reason) => { if (!success && reason && reason !== 'cancelled') notify('인쇄하지 못했어요: ' + String(reason).slice(0, 200)); });break;
    }
    case 'savePDF': {
      if (!wc) { notify('PDF로 저장할 웹페이지를 먼저 열어 주세요.');break; }
      const filename = (tab.title || 'Orbit').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) + '.pdf';
      const picked = await dialog.showSaveDialog(win, { title: '페이지를 PDF로 저장', defaultPath: path.join(app.getPath('documents'), filename), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (picked.canceled || !picked.filePath) break;
      const pdf = await wc.printToPDF({ printBackground: true });await fs.promises.writeFile(picked.filePath, pdf);notify('페이지를 PDF로 저장했습니다.');break;
    }
    case 'saveCard': {
      const image = cardImage(payload.dataURL);
      const picked = await dialog.showSaveDialog(win, { title: '나의 Orbit 카드 저장', defaultPath: path.join(app.getPath('pictures'), 'Orbit-Card.png'), filters: [{ name: 'PNG', extensions: ['png'] }] });
      if (!picked.canceled && picked.filePath) { await fs.promises.writeFile(picked.filePath, image.toPNG());notify('카드를 저장했습니다.'); }break;
    }
    case 'copyCard': {
      const image = cardImage(payload.dataURL);
      clipboard.writeImage(image);notify('카드를 클립보드에 복사했습니다.');break;
    }
    case 'devTools': if (wc) wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' });break;
    case 'copyURL': { const target = tabById(payload.id || state.activeTabId);if (target && isWebURL(target.url)) { clipboard.writeText(target.url);notify('주소를 복사했습니다.'); }break; }
    case 'muteTab': { const target = tabById(payload.id || state.activeTabId), targetWC = views.get(target?.id)?.webContents;
      if (targetWC) { targetWC.setAudioMuted(!targetWC.isAudioMuted());target.muted = targetWC.isAudioMuted(); }break;
    }
    case 'importBookmarks': await importBookmarks();break;
    case 'loadExtension': await loadExtension();break;
    case 'removeExtension': {
      if (incognito) throw new Error('확장 프로그램 변경은 일반 창에서 사용할 수 있어요.');
      if (typeof payload.id === 'string' && /^[a-p]{32}$/.test(payload.id)) {
        const rpc = rpcExtensions.get(state.activeSpaceId);
        if (rpc?.id === payload.id) { rpcExtensions.delete(state.activeSpaceId);saveRpcExtensions();if (rpcExtensions.size) rpcBridge?.tick();else await rpcBridge?.stop(); }
        else {
          const ses = configureSession(state.activeSpaceId);
          for (const owner of controllers) owner.closeExtensionPopups(payload.id, ses);
          ses.extensions.removeExtension(payload.id);
        }
        for (const owner of controllers) owner.publish(false);
      }break;
    }
    case 'showExtension': if (typeof payload.id === 'string' && /^[a-p]{32}$/.test(payload.id)) await showExtension(payload.id);break;
    case 'checkUpdates': await dialog.showMessageBox(win, { type: 'info', title: 'Orbit 업데이트', message: `현재 버전 ${app.getVersion()}`,
      detail: 'Orbit은 수동 업데이트를 지원합니다. 배포받은 새 Orbit 설치 파일을 실행하면 기존 스페이스와 로그인 정보가 유지됩니다. 공개 업데이트 서버와 자동 업데이트는 아직 연결되지 않았습니다.', buttons: ['확인'] });break;
    case 'newTab': {
      const url = payload.url ? normalizeInput(payload.url) : HOME;
      const target = makeTab(url);
      const folder = state.folders.find(entry => entry.id === payload.folderId && entry.spaceId === target.spaceId);
      if (folder) target.folderId = folder.id;
      await activateTab(target); break;
    }
    case 'openContextTab': {
      const opener = tabById(payload.id);
      if (!opener || opener.spaceId !== state.activeSpaceId || !isWebURL(payload.url)) break;
      const target = makeTab(payload.url, opener.spaceId);
      target.openerId = opener.id;
      if (payload.background === true) ensureView(target);
      else await activateTab(target);
      break;
    }
    case 'activateTab': {
      const target = tabById(payload.id); if (target && target.spaceId === state.activeSpaceId) await activateTab(target); break;
    }
    case 'closeTab': {
      const target = tabById(payload.id); if (!target) break;
      if (await requestCloseView(target.id)) removeTab(target.id, target.openerId);
      break;
    }
    case 'pinTab': { const target = tabById(payload.id); if (target) target.pinned = !target.pinned; break; }
    case 'navigate': {
      if (payload.targetTabId && payload.targetTabId !== tab.id) break;
      const url = normalizeInput(payload.input);
      if(/^!y\s+/i.test(String(payload.input||'')))remember('search',String(payload.input).trim(),String(payload.input).trim());
      if(url!==HOME){const parsed=new URL(url);if(parsed.hostname==='www.google.com'&&parsed.pathname==='/search'&&parsed.searchParams.get('q')===String(payload.input||'').trim())remember('search',String(payload.input).trim(),String(payload.input).trim());}
      if (isInternal(tab.url) || !wc) { tab.url = url; tab.title = url === HOME ? '새 탭' : new URL(url).hostname; tab.error = null; ensureView(tab); }
      else if (isInternal(url)) { if (!await requestCloseView(tab.id, true)) break; Object.assign(tab, { url, title: url===HOME?'새 탭':new URL(url).hostname, faviconURL:null, error: null, loading: false, canGoBack: false, canGoForward: false }); }
      else { if (webOrigin(tab.url) !== webOrigin(url)) tab.faviconURL = null;tab.url = url; tab.error = null; wc.loadURL(url).catch(() => {}); }
      if (!overlayOpen && url !== HOME) views.get(tab.id)?.webContents.focus();
      break;
    }
    case 'back': if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
    case 'forward': if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
    case 'reload': if (wc) { tab.error = null; wc.reload(); } else ensureView(tab); break;
    case 'switchSpace': {
      const target = state.spaces.find(s => s.id === payload.id); if (!target || target.id === state.activeSpaceId) break;
      await enterPip(tab); state.activeSpaceId = target.id; state.splitTabIds = [];
      state.activeTabId = state.tabs.find(t => t.spaceId === target.id).id; ensureView(currentTab()); break;
    }
    case 'createSpace': {
      if (state.spaces.length >= 30) throw new Error('스페이스는 최대 30개까지 만들 수 있어요.');
      if (state.tabs.length >= 200) throw new Error('새 스페이스를 만들기 전에 사용하지 않는 탭을 닫아 주세요.');
      const name = String(payload.name || '').trim().slice(0, 40) || nextSpaceName(state.spaces);
      await enterPip(tab);
      const space = { id: randomUUID(), name, color: /^#[0-9a-f]{6}$/i.test(payload.color) ? payload.color : '#c8d8cb' };
      state.spaces.push(space); state.activeSpaceId = space.id; state.splitTabIds = []; state.activeTabId = makeTab(HOME, space.id).id; break;
    }
    case 'renameSpace': { const space = state.spaces.find(s => s.id === payload.id); const name = String(payload.name || '').trim().slice(0, 40); if (space && name) space.name = name; break; }
    case 'deleteSpace': {
      if (state.spaces.length === 1) throw new Error('스페이스는 하나 이상 필요해요.');
      const space = state.spaces.find(s => s.id === payload.id); if (!space) break;
      const { response } = await dialog.showMessageBox(win, { type: 'question', title: '스페이스 삭제', message: `“${space.name}” 스페이스와 탭을 삭제할까요?`, detail: '이 작업은 되돌릴 수 없어요.', buttons: ['취소', '삭제'], defaultId: 0, cancelId: 0 });
      if (response !== 1) break;
      let allowed = true;
      for (const entry of state.tabs.filter(t => t.spaceId === space.id)) {
        if (!await requestCloseView(entry.id)) { allowed = false;break; }
      }
      if (!allowed) break;
      state.tabs = state.tabs.filter(t => t.spaceId !== space.id); state.spaces = state.spaces.filter(s => s.id !== space.id);
      if (state.activeSpaceId === space.id) { state.activeSpaceId = state.spaces[0].id; state.activeTabId = state.tabs.find(t => t.spaceId === state.activeSpaceId).id; state.splitTabIds = []; ensureView(currentTab()); }
      state.folders = state.folders.filter(folder => folder.spaceId !== space.id);
      state.archivedTabs = state.archivedTabs.filter(entry => entry.spaceId !== space.id);
      if(!incognito){state.history=state.history.filter(entry=>entry.spaceId!==space.id);syncShared('history');}
      if (!incognito && rpcExtensions.delete(space.id)) {
        saveRpcExtensions();
        if (rpcExtensions.size) rpcBridge?.tick(); else await rpcBridge?.stop();
      }
      configureSession(space.id).clearStorageData().catch(() => {}); break;
    }
    case 'appearance': {
      const { customImage: _customImage, ...settings } = payload;
      state.appearance = sanitizeAppearance({ ...state.appearance, ...settings });
      if (!incognito) syncShared('appearance');
      break;
    }
    case 'exportAppearance': {
      if (incognito) break;
      const picked = await dialog.showSaveDialog(win, {
        title: '꾸미기 설정 내보내기',
        defaultPath: 'Orbit-appearance.json',
        filters: [{ name: 'Orbit 꾸미기', extensions: ['json'] }],
      });
      if (picked.canceled || !picked.filePath || quitting) break;
      await fs.promises.writeFile(picked.filePath, JSON.stringify({
        format: 'orbit-appearance', version: 1, appearance: state.appearance,
      }, null, 2) + '\n', 'utf8');
      notify('꾸미기 설정을 저장했습니다.');
      break;
    }
    case 'importAppearance': {
      if (incognito) break;
      const picked = await dialog.showOpenDialog(win, {
        title: '꾸미기 설정 가져오기',
        properties: ['openFile'],
        filters: [{ name: 'Orbit 꾸미기', extensions: ['json'] }],
      });
      if (picked.canceled || !picked.filePaths[0] || quitting) break;
      const appearance = await readAppearanceProfile(picked.filePaths[0]);
      if (quitting) break;
      state.appearance = appearance;
      syncShared('appearance');
      notify('꾸미기 설정을 적용했습니다.');
      break;
    }
    case 'resetAppearance':
    case 'removeWallpaper':
    case 'pickWallpaper': {
      if (name === 'resetAppearance') state.appearance = sanitizeAppearance();
      else if (name === 'removeWallpaper') {
        state.appearance = sanitizeAppearance({ ...state.appearance, customImage: null });
      } else {
        const picked = await dialog.showOpenDialog(win, {
          title: '새 탭 배경 사진 선택',
          properties: ['openFile'],
          filters: [{ name: '사진 (JPG, PNG)', extensions: ['jpg', 'jpeg', 'png'] }],
        });
        if (picked.canceled || !picked.filePaths[0] || quitting) break;
        const customImage = await loadWallpaper(picked.filePaths[0], nativeImage);
        if (quitting) break;
        state.appearance = sanitizeAppearance({ ...state.appearance, background: 'custom', customImage });
      }
      if (!incognito) syncShared('appearance');
      break;
    }
    case 'theme': if (/^#[0-9a-f]{6}$/i.test(payload.color)) { state.themeColor = payload.color; const space = state.spaces.find(s => s.id === state.activeSpaceId); space.color = payload.color; } break;
    case 'autoPip': state.autoPip = payload.enabled === true; break;
    case 'pip': await enterPip(tab, true); break;
    case 'split': {
      if (state.splitTabIds.length) { state.splitTabIds = []; break; }
      const selected = tabById(payload.id);
      const other = (selected?.spaceId === state.activeSpaceId && selected.id !== tab.id ? selected : null)
        || state.tabs.find(t => t.spaceId === state.activeSpaceId && t.id !== tab.id && t.url !== HOME)
        || state.tabs.find(t => t.spaceId === state.activeSpaceId && t.id !== tab.id) || makeTab(HOME);
      state.splitTabIds = [tab.id, other.id]; ensureView(tab); ensureView(other); break;
    }
    case 'unsplit': {
      const keep = state.splitTabIds.includes(payload.removeId) && state.splitTabIds.find(id => id !== payload.removeId);
      state.splitTabIds = [];
      if (keep) await activateTab(tabById(keep));
      break;
    }
    case 'replaceSplitTab': {
      const index = state.splitTabIds.indexOf(payload.id);
      if (state.splitTabIds.length !== 2 || index < 0) break;
      const target = payload.targetId ? tabById(payload.targetId) : makeTab(HOME);
      if (target?.spaceId !== state.activeSpaceId || state.splitTabIds.includes(target.id)) break;
      state.splitTabIds[index] = target.id;
      await activateTab(target);
      break;
    }
    case 'resizeSplit':
      if (state.splitTabIds.length === 2 && Number.isFinite(payload.ratio)) state.splitRatio = Math.min(73, Math.max(27, Math.round(payload.ratio)));
      break;
    case 'openWebPanel': await openWebPanel(payload.input); break;
    case 'closeWebPanel': await closeWebPanel(); break;
    case 'navigateWebPanel': {
      const contents = webPanel?.spaceId === state.activeSpaceId && webPanel.view.webContents;
      if (!contents || contents.isDestroyed()) break;
      if (payload.action === 'back' && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
      if (payload.action === 'forward' && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
      if (payload.action === 'reload') contents.reload();
      break;
    }
    case 'promoteWebPanel':
      if (webPanel?.spaceId === state.activeSpaceId && isWebURL(webPanel.details.url)) await activateTab(makeTab(webPanel.details.url));
      break;
    case 'toggleSidebar': state.sidebarCollapsed = !state.sidebarCollapsed; break;
    case 'motionPreference': reducedMotion = payload.reduced === true; break;
    case 'defaultBrowserSettings':
      if (process.platform === 'win32') {
        await shell.openExternal('ms-settings:defaultapps?registeredAppUser=Orbit').catch(() => shell.openExternal('ms-settings:defaultapps'));
      }
      break;
    case 'openLocalDocument': {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: 'Orbit에서 로컬 파일 열기',
        properties: ['openFile'],
        filters: [{ name: '웹 문서 및 PDF', extensions: [...fileTypes.keys()].map(extension => extension.slice(1)) }],
      });
      if (!canceled && filePaths[0]) await openDocument(filePaths[0]);
      break;
    }
    case 'clearSiteData': {
      const space = state.spaces.find(s => s.id === state.activeSpaceId);
      const { response } = await dialog.showMessageBox(win, { type: 'question', title: '사이트 데이터 삭제',
        message: `“${space.name}”의 쿠키와 캐시를 삭제할까요?`, detail: '이 스페이스의 사이트에서 로그아웃됩니다. 탭과 고정 탭은 유지됩니다.', buttons: ['취소', '삭제'], defaultId: 0, cancelId: 0 });
      if (response !== 1) break;
      const ses = configureSession(space.id);await ses.clearCache();await ses.clearStorageData();
      await flushPersistentSiteData([ses]);
      const partition = incognito ? `orbit-private-${windowId}-${space.id}` : `persist:orbit-${space.id}`;
      for (const key of permissionDecisions.keys()) if (key.startsWith(`${partition}|`)) permissionDecisions.delete(key);
      notify('현재 스페이스의 사이트 데이터를 삭제했습니다.');break;
    }
    case 'overlay': if(!payload.open)suggestionRequest?.abort(); overlayOpen = payload.open === true; if (overlayOpen) win.webContents.focus(); break;
    case 'minimize': win.minimize(); break;
    case 'maximize': win.isMaximized() ? win.unmaximize() : win.maximize(); break;
    case 'closeWindow': win.close(); return snapshot();
    case 'cancelDownload': downloadItems.get(payload.id)?.cancel(); break;
    case 'showDownload': { const item = downloads.find(d => d.id === payload.id && d.state === 'completed'); if (item?.path) shell.showItemInFolder(item.path); break; }
    case 'clearDownloads': downloads = downloads.filter(d => d.state === 'progressing'); break;
    default: throw new Error('Unknown action');
  }
  layout();
  if (win?.isFocused() && ['activateTab', 'switchSpace', 'split', 'unsplit', 'replaceSplitTab', 'newTab'].includes(name)) await restorePipIfVisible();
  publish(); return snapshot();
}

async function startWindow() {
  win = new BrowserWindow({ width: 1380, height: 900, minWidth: 900, minHeight: 600, frame: false,
    show: false, backgroundColor: state.themeColor, title: incognito ? 'Orbit · 시크릿' : 'Orbit', icon: path.join(__dirname, 'renderer', 'orbit.ico'), autoHideMenuBar: true,
    webPreferences: { ...securePreferences, preload: path.join(__dirname, 'preload.cjs') } });
  contentsOwners.set(win.webContents.id, controller);
  bindShortcuts(win.webContents);
  win.webContents.on('context-menu', (_event, params) => {
    const contents = win.webContents;
    const item = (id, label, click, enabled) => chromeMenuItem(id, label, () => {
      if (!contents.isDestroyed()) click();
    }, enabled);
    const items = params.isEditable ? editableItems(contents, params, item) : [];
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win, x: params.x, y: params.y, sourceType: params.menuSourceType, frame: params.frame || undefined });
  });
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('resize', layout); win.on('maximize', () => publish(false)); win.on('unmaximize', () => publish(false));
  win.on('blur', () => {
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => { if (win && !win.isDestroyed() && !win.isFocused()) enterPip(currentTab()); }, 180);
  });
  win.on('focus', () => { clearTimeout(blurTimer); restorePipIfVisible(); });
  win.on('close', event => {
    if (quitting) return;
    event.preventDefault();if (closingWindow) return;closingWindow = true;
    (async () => {
      if (!await closeWebPanel()) { closingWindow = false; return; }
      for (const id of [...views.keys()]) {
        if (!await requestCloseView(id)) {
          closingWindow = false;
          for (const visibleId of visibleIds()) { const entry = tabById(visibleId);if (entry) ensureView(entry); }
          layout();publish();return;
        }
      }
      if (!incognito) await flushPersistentSiteData(sessions.values());
      clearTimeout(saveTimer);saveNow();
      const otherNormalWindow = [...controllers].some(owner => owner !== controller && !owner.incognito && owner.win && !owner.win.isDestroyed());
      if (!incognito && !otherNormalWindow) saveNow(path.join(app.getPath('userData'), 'orbit-state.json'));
      quitting = true;
      win.destroy();
    })().catch(error => { closingWindow = false;notify(error.message); });
  });
  win.on('closed', () => {
    clearTimeout(blurTimer);clearTimeout(noticeTimer);clearTimeout(publishTimer);clearTimeout(saveTimer);
    win = null;
    if (webPanel && !webPanel.view.webContents.isDestroyed()) webPanel.view.webContents.close();
    for (const abort of faviconJobs.keys()) abort.abort();
    for (const popup of extensionWindows) if (!popup.isDestroyed()) popup.destroy();
    for (const item of downloadItems.values()) { try { item.cancel(); } catch {} }
    for (const [id, owner] of contentsOwners) if (owner === controller) contentsOwners.delete(id);
    controllers.delete(controller);
    if (!incognito && !primary) {
      // Only this controller's generated files are disposable. The last normal
      // window has already copied its state to orbit-state.json above.
      const ownFile = path.join(app.getPath('userData'), 'windows', windowId + '.json');
      if (path.resolve(stateFile) === path.resolve(ownFile)) {
        try { fs.rmSync(ownFile, { force: true });fs.rmSync(ownFile + '.tmp', { force: true }); } catch {}
      }
    }
    if (incognito) {
      for (const [partition, ses] of sessions) if (partition.startsWith('orbit-private-' + windowId + '-')) {
        ses.clearStorageData().catch(() => {});ses.clearCache().catch(() => {});sessions.delete(partition);
        for (const key of permissionDecisions.keys()) if (key.startsWith(partition + '|')) permissionDecisions.delete(key);
      }
    }
    for (const owner of controllers) owner.publish(false);
  });
  await win.loadFile(uiPath);
  for (const id of visibleIds()) { const tab = tabById(id); if (tab) ensureView(tab); }
  layout(); publish(false); win.show();
  for (const owner of controllers) if (owner !== controller) owner.publish(false);
  return controller;
}
controller.ready = startWindow();
return controller;
}

function trusted(event) {
  const owner = contentsOwners.get(event.sender.id);
  if (!owner?.win || owner.win.isDestroyed() || event.sender !== owner.win.webContents || event.senderFrame !== owner.win.webContents.mainFrame || event.senderFrame.url !== uiURL) throw new Error('Untrusted caller');
  return owner;
}
ipcMain.handle('orbit:state', event => trusted(event).snapshot());
ipcMain.handle('orbit:action', async (event, name, payload) => trusted(event).handleAction(name, payload));
ipcMain.handle('orbit:suggest',(event,query)=>trusted(event).suggest(query));
ipcMain.handle('orbit:seoul-weather', async event => {
  const owner = trusted(event);
  const allowWeather = () => !TEST && !owner.incognito && owner.state.appearance?.showWeather !== false;
  const weather = await getSeoulWeather(allowWeather());
  return allowWeather() ? weather : getSeoulWeather(false);
});
ipcMain.handle('orbit:chrome-menu', (event, request) => trusted(event).openChromeMenu(request));
ipcMain.on('orbit:guest-layout', (event, request) => {
  let owner;
  try { owner = trusted(event); } catch { return; }
  owner.applyGuestLayout(request);
});
for (const [channel, type] of [['orbit:login-ready', 'ready'], ['orbit:login-save', 'save']]) ipcMain.on(channel, (event, value) => {
  const owner = contentsOwners.get(event.sender.id);
  if (!owner || event.sender === owner.win?.webContents) return;
  owner.loginEvent(event, type, value).catch(() => {});
});

app.whenReady().then(async () => {
  if (!hasLock) return;
  const state = readNormalProfile();
  Menu.setApplicationMenu(null);
  await restoreRpcExtensions();
  rpcBridge = new OrbitRpcBridge({
    endpoint: TEST ? process.env.ORBIT_RPC_ENDPOINT || undefined : undefined,
    getCandidates: () => {
      if ([...controllers].some(owner => owner.incognito && owner.win?.isFocused())) return [];
      return [...controllers].flatMap(owner => owner.rpcCandidates());
    },
    onStatus: () => { for (const owner of controllers) owner.publish(false); }
  });
  if (rpcExtensions.size) rpcBridge.start();
  const primary = createController({ initialState: state, primary: true });
  await primary.ready;
  const queued = externalLaunches;
  externalLaunches = null;
  for (const args of queued) await routeExternalLaunch(args, { focus: false }).catch(console.error);
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => rpcBridge?.stop());
app.on('before-quit', event => {
  const live = [...controllers].filter(owner => owner.win && !owner.win.isDestroyed());
  if (live.length && !appQuitting) { event.preventDefault();for (const owner of live) owner.win.close();return; }
  appQuitting = true;for (const owner of controllers) owner.saveNow();
});
app.on('second-instance', (_event, args) => {
  if (externalLaunches) externalLaunches.push(args);
  else routeExternalLaunch(args).catch(console.error);
});
