'use strict';

const presetDials = [
  ['Google', 'https://www.google.com/'],
  ['YouTube', 'https://www.youtube.com/'],
  ['네이버', 'https://www.naver.com/'],
  ['GitHub', 'https://github.com/'],
  ['Discord', 'https://discord.com/']
].map(([title, url]) => ({ id: url, title, url }));
const photoScenes = new Set(['day', 'night', 'rain', 'snow']);
const seoulClock = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const seoulDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long'
});
const sceneLabels = { day: '낮', night: '밤', rain: '비', snow: '눈' };
let startWeather = null;
let startWeatherRequest = null;
let startWeatherRefreshAt = 0;

function homePage(tab) {
  const page = el('div', 'home-page seoul-start');
  const photo = el('div', 'start-photo');
  const scrim = el('div', 'start-scrim');
  const frame = el('div', 'start-frame');
  const bar = el('nav', 'start-bar');
  bar.setAttribute('aria-label', '시작 페이지');
  const current = el('span', 'start-current', '시작 페이지');
  current.setAttribute('aria-current', 'page');
  bar.append(current,
    button('start-nav-button', '즐겨찾기', 'star', openFavorites),
    button('start-nav-button', '방문 기록', 'clock', openHistory),
    button('start-nav-button', '꾸미기', 'settings', openAppearance));

  const content = el('div', 'start-content');
  const location = el('div', 'start-location');
  const date = el('span', 'start-date');
  const weather = el('span', 'start-weather');
  location.append(el('strong', '', '서울'), date, weather);
  const heading = el('h1', 'home-title start-title', '새 탭');
  const clock = createStartClock();
  const search = button('start-search', '주소 또는 검색어 입력', null, () => openPalette(tab?.id));
  search.append(icon('search'), el('span', '', '검색하거나 웹 주소를 입력하세요'), el('kbd', '', 'Ctrl L'));
  const shortcuts = el('section', 'start-shortcuts');
  shortcuts.setAttribute('aria-label', '스피드 다이얼');
  const label = el('h2', 'start-dial-label', '스피드 다이얼');
  const tiles = el('div', 'start-tiles');
  const add = button('start-tile start-add', '사이트 추가', null, () => openDialEditor());
  add.append(el('span', 'start-tile-icon'), el('span', 'start-tile-name', '추가'));
  add.firstChild.append(icon('plus'));
  shortcuts.append(label, tiles, add);
  const dashboard = el('section', 'start-dashboard');
  dashboard.setAttribute('aria-label', '시작 페이지 위젯');
  const conditions = el('article', 'start-widget start-widget-weather');
  const weatherValue = el('strong', 'start-widget-reading');
  const weatherInfo = el('span', 'start-widget-subtitle');
  conditions.append(el('h2', '', '서울 날씨'), weatherValue, weatherInfo);
  const history = el('article', 'start-widget start-widget-history');
  const historyHead = el('div', 'start-widget-heading');
  historyHead.append(el('h2', '', '최근 방문'), button('icon-button', '방문 기록 열기', 'chevronRight', openHistory));
  const historyItems = el('div', 'start-recent-list');
  const empty = el('p', 'start-widget-subtitle', '방문한 사이트가 여기에 표시됩니다.');
  history.append(historyHead, historyItems, empty);
  dashboard.append(conditions, history);
  content.append(location, heading, clock, search, shortcuts, dashboard);

  const footer = el('footer', 'start-footer');
  const scene = el('span', 'start-scene');
  const credit = el('a', 'start-credit', 'Open-Meteo');
  credit.href = 'https://open-meteo.com/';
  credit.addEventListener('click', event => {
    event.preventDefault();
    send('newTab', { url: credit.href });
  });
  footer.append(scene, credit);
  frame.append(bar, content, footer);
  page.append(photo, scrim, frame);
  page.startParts = { tabId: tab?.id, photo, scrim, date, weather, heading, clock, shortcuts, tiles, add, scene, credit, dashboard, conditions, weatherValue, weatherInfo, history, historyItems, empty };
  return page;
}

function updateHomeDials(page) {
  const prefs = state?.appearance || {};
  const parts = page.startParts;
  const favorites = state?.favorites || [];
  const presets = prefs.showPresets === false ? [] : presetDials;
  const favoriteURLs = new Set(favorites.map(entry => entry.url));
  const items = [...presets.filter(entry => !favoriteURLs.has(entry.url)), ...favorites];
  parts.shortcuts.hidden = prefs.showShortcuts === false;
  parts.add.hidden = !state || state.incognito || favorites.length >= 50;
  parts.shortcuts.dataset.size = prefs.dialSize || 'medium';
  parts.dashboard.hidden = prefs.showDashboard === false;
  parts.history.hidden = Boolean(state?.incognito);
  parts.conditions.hidden = prefs.showWeather === false;
  parts.dashboard.classList.toggle('single-widget', parts.history.hidden || parts.conditions.hidden);
  if (!parts.dashboard.hidden && !parts.history.hidden) updateStartHistory(parts);
  if (parts.shortcuts.hidden) return;
  reconcile(parts.tiles, items, entry => entry.id, entry => {
    const saved = favorites.includes(entry);
    const tile = button('start-tile', entry.title, null, async () => {
      if (parts.tabId && parts.tabId !== state?.activeTabId) await send('activateTab', { id: parts.tabId });
      await send(saved ? 'openFavorite' : 'navigate',
        saved ? { id: entry.id } : { input: entry.url });
    });
    tile.append(el('span', 'start-tile-icon'), el('span', 'start-tile-name'));
    if (saved) attachContextMenu(tile, 'favorite', entry.id);
    return tile;
  }, (tile, entry) => {
    const title = entry.title || siteName(entry.url);
    tile.title = title + ' · ' + siteName(entry.url);
    tile.setAttribute('aria-label', title);
    tile.lastChild.textContent = title;
    const visual = entry.url + '|' + (entry.faviconURL || '');
    if (tile.dataset.visual !== visual) {
      tile.firstChild.replaceChildren(favicon(entry));
      tile.dataset.visual = visual;
    }
  });
}

function updateStartHistory(parts) {
  const history = (state?.history || []).filter(entry => entry.kind === 'visit' && entry.spaceId === state.activeSpaceId).slice(0, 3);
  parts.empty.hidden = history.length !== 0;
  reconcile(parts.historyItems, history, entry => entry.value, entry => {
    const row = button('start-recent', entry.title, null, async () => {
      if (parts.tabId && parts.tabId !== state?.activeTabId) await send('activateTab', { id: parts.tabId });
      await send('navigate', { input: entry.value });
    });
    row.append(el('span', 'start-recent-icon'), el('span', 'start-recent-title'));
    return row;
  }, (row, entry) => {
    row.title = entry.title || entry.value;
    row.setAttribute('aria-label', row.title);
    row.lastChild.textContent = row.title;
    const key = entry.value + '|' + (entry.faviconURL || '');
    if (row.dataset.visual !== key) {
      row.firstChild.replaceChildren(favicon({ url: entry.value, faviconURL: entry.faviconURL }));
      row.dataset.visual = key;
    }
  });
}

async function openDialEditor(id) {
  if (!state || state.incognito) return;
  const favorite = id && state.favorites.find(entry => entry.id === id);
  if (id && !favorite) { await closeOverlay(); return; }
  const epoch = await openOverlay('dial-editor');
  if (overlayKind !== 'dial-editor' || epoch !== overlayEpoch) return;
  const { body } = dialog(favorite ? '바로가기 편집' : '스피드 다이얼 추가', '시작 페이지와 즐겨찾기에 함께 적용됩니다.');
  const form = el('form', 'start-dial-form');
  const urlLabel = el('label', '', '웹 주소');
  const url = el('input', 'text-input');
  url.required = true;
  url.placeholder = 'example.com';
  url.autocomplete = 'off';
  url.value = favorite?.url || '';
  urlLabel.append(url);
  const nameLabel = el('label', '', '이름 (선택)');
  const name = el('input', 'text-input');
  name.maxLength = 100;
  name.value = favorite?.title || '';
  nameLabel.append(name);
  const save = el('button', 'primary-button', favorite ? '저장' : '추가');
  save.type = 'submit';
  form.append(urlLabel, nameLabel, save);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const input = url.value.trim();
    const address = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : 'https://' + input;
    const parsed = URL.parse(address);
    if (!parsed || !['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
      url.setCustomValidity('올바른 HTTP 또는 HTTPS 웹 주소를 입력해 주세요.');
      url.reportValidity();
      return;
    }
    save.disabled = true;
    const result = await send(favorite ? 'editFavorite' : 'addFavorite', { id, url: parsed.href, title: name.value });
    if (result) await closeOverlay();
    else save.disabled = false;
  });
  url.addEventListener('input', () => url.setCustomValidity(''));
  body.append(form);
}

function renderStartEnvironment(page, now) {
  const prefs = state?.appearance || {};
  const parts = page.startParts;
  const clockText = seoulClock.format(now);
  const hour = Number(clockText.slice(0, 2));
  const timeScene = hour >= 6 && hour < 18 ? 'day' : 'night';
  const canShowWeather = prefs.showWeather !== false && !state?.incognito;
  const weather = canShowWeather ? startWeather : null;
  const mode = prefs.background || 'auto';
  const scene = mode === 'auto' ? weather?.scene || timeScene : mode;
  const custom = scene === 'custom' && prefs.customImage;
  const backgroundImage = custom ? `url("${prefs.customImage}")` :
    photoScenes.has(scene) ? `url("wallpapers/seoul-${scene}.jpg")` : 'none';
  if (parts.photo.style.backgroundImage !== backgroundImage) parts.photo.style.backgroundImage = backgroundImage;
  parts.photo.style.backgroundColor = prefs.backgroundColor || '#202842';
  parts.scrim.style.opacity = String((prefs.overlay ?? 35) / 100);
  page.dataset.scene = scene;
  parts.heading.classList.toggle('start-title-hidden', prefs.showClock !== false);
  parts.clock.hidden = prefs.showClock === false;
  parts.clock.setDigits(clockText);
  parts.clock.dateTime = now.toISOString();
  parts.date.textContent = seoulDate.format(now);
  parts.date.hidden = prefs.showClock === false;
  parts.weather.hidden = !weather?.live;
  parts.weather.textContent = weather?.live
    ? [weather.condition, Number.isFinite(weather.temperature) ? `${weather.temperature} °C` : null].filter(Boolean).join(' · ')
    : '';
  parts.scene.textContent = photoScenes.has(scene) ? `남산 · ${sceneLabels[scene]}` :
    custom ? '사용자 배경' : '단색 배경';
  parts.credit.hidden = !weather?.live;
  parts.weatherValue.textContent = weather?.live && Number.isFinite(weather.temperature)
    ? `${weather.temperature} °C` : '서울';
  parts.weatherInfo.textContent = weather?.live ? weather.condition : '서울 시각으로 배경을 표시합니다.';
}

function syncStartEnvironment() {
  if (document.hidden) return;
  const pages = [...document.querySelectorAll('.seoul-start')];
  if (!pages.length) return;
  const now = new Date();
  for (const page of pages) renderStartEnvironment(page, now);
  if (!bridge?.getSeoulWeather || state?.incognito || state?.appearance?.showWeather === false ||
      startWeatherRequest || Date.now() < startWeatherRefreshAt) return;
  startWeatherRefreshAt = Date.now() + 15 * 60 * 1000;
  startWeatherRequest = bridge.getSeoulWeather().then(value => { startWeather = value?.live ? value : null; })
    .catch(() => { startWeather = null; }).finally(() => {
      if (!startWeather) startWeatherRefreshAt = Date.now() + 2 * 60 * 1000;
      startWeatherRequest = null;
      syncStartEnvironment();
    });
}

document.addEventListener('visibilitychange', syncStartEnvironment);
window.addEventListener('focus', syncStartEnvironment);
setInterval(syncStartEnvironment, 30_000);
