'use strict';

const systemDarkTheme = matchMedia('(prefers-color-scheme: dark)');

function renderAppearance(spaceColor) {
  const app = $('app');
  const preferences = state.appearance || {};
  const channels = spaceColor.slice(1).match(/.{2}/g).map(channel => parseInt(channel, 16));
  const spaceIsDark = channels[0] * .299 + channels[1] * .587 + channels[2] * .114 < 130;
  const dark = preferences.theme === 'system' ? systemDarkTheme.matches
    : preferences.theme === 'dark' || (preferences.theme !== 'light' && spaceIsDark);
  app.classList.toggle('dark-chrome', dark);
  app.classList.toggle('sidebar-right', preferences.sidebar === 'right');
  app.dataset.density = preferences.density || 'comfortable';
  app.dataset.corners = preferences.corners || 'soft';
  app.classList.toggle('custom-accent', Boolean(preferences.accent));
  if (preferences.accent) app.style.setProperty('--user-accent', preferences.accent);
  else app.style.removeProperty('--user-accent');
  if (!sidebarDrag) paintSidebarWidth(preferences.sidebarWidth || 256);
  app.classList.toggle('hide-tab-close', preferences.showTabClose === false);
  for (const [key, id] of appearanceToolbarTools) $(id).hidden = preferences[key] === false;
  const editor = $('appearanceSettings');
  editor?.syncAppearance?.(preferences);
}

systemDarkTheme.addEventListener('change', () => {
  if (state?.appearance?.theme === 'system') renderAppearance(currentSpace()?.color || state.themeColor);
});

const appearanceToolbarTools = [
  ['showPasswordTool', 'passwordButton', '비밀번호 관리자'],
  ['showFavoriteTool', 'favoriteButton', '즐겨찾기 추가'],
  ['showPipTool', 'pipButton', '미니 플레이어'],
  ['showSplitTool', 'splitButton', '분할 화면'],
];

async function openAppearance() {
  if (!state) return;
  const epoch = await openOverlay('appearance');
  if (overlayKind !== 'appearance' || epoch !== overlayEpoch) return;
  const { body } = dialog('Orbit 꾸미기', '탭 배치, 색상, 도구 모음과 새 탭을 내 방식으로 설정하세요.', 'appearance-dialog');
  body.append(appearanceSettings());
}

let sidebarDrag = null;

function paintSidebarWidth(value) {
  const width = Math.min(360, Math.max(200, Math.round(value)));
  $('app').style.setProperty('--vertical-tab-width', width + 'px');
  $('sidebarResize').setAttribute('aria-valuenow', String(width));
  return width;
}

document.addEventListener('DOMContentLoaded', () => {
  const handle = $('sidebarResize');
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || state?.appearance?.tabPosition !== 'side' || state.sidebarCollapsed) return;
    event.preventDefault();
    const width = state.appearance.sidebarWidth || 256;
    sidebarDrag = { id: event.pointerId, start: event.clientX, original: width, width, direction: state.appearance.sidebar === 'right' ? -1 : 1 };
    $('app').classList.add('resizing-sidebar');
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (event.pointerId !== sidebarDrag?.id) return;
    sidebarDrag.width = paintSidebarWidth(sidebarDrag.original + (event.clientX - sidebarDrag.start) * sidebarDrag.direction);
  });
  handle.addEventListener('pointercancel', () => {
    sidebarDrag = null;
    $('app').classList.remove('resizing-sidebar');
    paintSidebarWidth(state?.appearance?.sidebarWidth || 256);
  });
  handle.addEventListener('lostpointercapture', async () => {
    if (!sidebarDrag) return;
    const { width } = sidebarDrag;
    sidebarDrag = null;
    $('app').classList.remove('resizing-sidebar');
    if (!await send('appearance', { sidebarWidth: width })) paintSidebarWidth(state?.appearance?.sidebarWidth || 256);
  });
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !state) return;
    event.preventDefault();
    const direction = state.appearance.sidebar === 'right' ? -1 : 1;
    const current = state.appearance.sidebarWidth || 256;
    const width = event.key === 'Home' ? 200 : event.key === 'End' ? 360 :
      current + direction * (event.key === 'ArrowRight' ? 12 : -12);
    send('appearance', { sidebarWidth: width });
  });
});

function appearanceSettings() {
  const root = el('div', 'appearance-settings');
  root.id = 'appearanceSettings';
  const updaters = [];
  const sections = [];
  const rail = el('nav', 'studio-nav');
  rail.setAttribute('aria-label', '꾸미기 카테고리');
  const workspace = el('div', 'studio-workspace');
  const header = el('div', 'studio-header');
  const search = el('input', 'text-input studio-search');
  search.type = 'search';
  search.placeholder = '꾸미기 설정 검색';
  search.setAttribute('aria-label', search.placeholder);
  header.append(icon('search'), search);
  const results = el('div', 'studio-results');
  const empty = el('p', 'empty-state studio-empty', '찾는 설정이 없습니다. 다른 검색어를 입력하세요.');
  results.append(empty);
  workspace.append(header, results);
  root.append(rail, workspace);
  let selected = 'layout';

  function showSections() {
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let found = false;
    for (const { key, section, navigation } of sections) {
      const matches = terms.every(term => section.textContent.toLowerCase().includes(term));
      section.hidden = terms.length ? !matches : selected !== key;
      navigation.setAttribute('aria-current', !terms.length && selected === key ? 'true' : 'false');
      found ||= !section.hidden;
    }
    empty.hidden = found;
    results.scrollTop = 0;
  }

  function group(key, title, subtitle, glyph) {
    const section = el('section', 'studio-section');
    section.dataset.studioSection = key;
    section.append(el('h3', 'studio-title', title));
    if (subtitle) section.append(el('p', 'settings-description studio-description', subtitle));
    const rows = el('div', 'appearance-rows');
    section.append(rows);
    const navigation = button('studio-category', title, glyph, () => {
      selected = key;
      search.value = '';
      showSections();
    });
    navigation.append(el('span', '', title));
    sections.push({ key, section, navigation });
    rail.append(navigation);
    results.insertBefore(section, empty);
    return rows;
  }

  function cards(rows, label, choices, valueFor, apply) {
    const group = el('fieldset', 'studio-cards');
    group.append(el('legend', '', label));
    const grid = el('div', 'studio-card-grid');
    for (const { value, title, visual, description, disabled } of choices) {
      const input = el('input');
      input.type = 'radio';
      input.name = 'studio-' + label;
      input.value = value;
      input.addEventListener('change', () => { if (input.checked) apply(value); });
      const card = el('label', 'studio-choice');
      const detail = el('span', 'studio-choice-detail');
      detail.append(visual, el('strong', '', title));
      if (description) detail.append(el('small', '', description));
      card.append(input, detail);
      grid.append(card);
      updaters.push(prefs => {
        input.checked = valueFor(prefs) === value;
        input.disabled = disabled?.(prefs) || false;
      });
    }
    group.append(grid);
    rows.append(group);
  }

  function controlRow(rows, label, control) {
    const row = el('label', 'appearance-row');
    row.append(el('span', '', label), control);
    rows.append(row);
  }

  function select(rows, key, label, options) {
    const input = el('select', 'appearance-select');
    input.setAttribute('aria-label', label);
    for (const [value, name] of options) {
      const option = el('option', '', name);
      option.value = value;
      input.append(option);
    }
    input.addEventListener('change', () => send('appearance', { [key]: input.value }));
    controlRow(rows, label, input);
    updaters.push(preferences => { input.value = preferences[key] ?? options[0][0]; });
    return input;
  }

  function colorInput(rows, key, label, fallback) {
    const input = el('input', 'appearance-color');
    input.type = 'color';
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => send('appearance', { [key]: input.value }));
    controlRow(rows, label, input);
    updaters.push(preferences => { input.value = preferences[key] || fallback; });
    return input;
  }

  function toggle(rows, key, label, description, defaultValue = true) {
    const row = el('div', 'appearance-row');
    const copy = el('div', 'appearance-copy');
    copy.append(el('span', '', label));
    if (description) copy.append(el('p', 'settings-description', description));
    const control = button('toggle', label, null, () => {
      send('appearance', { [key]: control.getAttribute('aria-checked') !== 'true' });
    });
    control.setAttribute('role', 'switch');
    row.append(copy, control);
    rows.append(row);
    updaters.push(preferences => control.setAttribute('aria-checked', String(preferences[key] ?? defaultValue)));
  }

  const layout = group('layout', '탭과 사이드바', '미리보기 카드를 눌러 탭 배치를 바로 바꿔 보세요.', 'sidebar');
  const layoutChoices = [
    ['top', '상단 탭', '두 줄 탭 그룹'],
    ['left', '왼쪽 세로 탭', '탭 이름과 폴더'],
    ['right', '오른쪽 세로 탭', '탭 이름과 폴더'],
  ].map(([value, title, description]) => {
    const visual = el('span', 'studio-wire');
    visual.dataset.previewLayout = value;
    visual.append(el('span'), el('span'), el('span'));
    return { value, title, description, visual };
  });
  cards(layout, '탭 배치', layoutChoices, prefs => prefs.tabPosition === 'side' ? prefs.sidebar : 'top',
    value => send('appearance', value === 'top' ? { tabPosition: 'top' } : { tabPosition: 'side', sidebar: value }));
  const width = el('input');
  width.type = 'range'; width.min = '200'; width.max = '360'; width.step = '1';
  width.setAttribute('aria-label', '세로 탭 너비');
  const widthValue = el('output');
  const widthWrap = el('span', 'appearance-range');
  widthWrap.append(width, widthValue);
  controlRow(layout, '세로 탭 너비', widthWrap);
  width.addEventListener('input', () => { widthValue.value = width.value + ' px'; });
  width.addEventListener('change', () => send('appearance', { sidebarWidth: Number(width.value) }));
  updaters.push(prefs => {
    width.disabled = prefs.tabPosition !== 'side';
    if (!width.matches(':active')) width.value = prefs.sidebarWidth ?? 256;
    widthValue.value = width.value + ' px';
  });
  const collapse = button('secondary-button', '사이드바 접기 또는 펼치기', 'sidebar', () => send('toggleSidebar'));
  layout.append(collapse);
  updaters.push(prefs => {
    collapse.replaceChildren(icon('sidebar'), document.createTextNode(
      (prefs.tabPosition === 'side' ? '세로 탭 ' : '도구 패널 ') + (state.sidebarCollapsed ? '펼치기' : '접기')));
  });
  select(layout, 'density', '탭 간격', [['comfortable', '여유 있게'], ['compact', '촘촘하게']]);
  toggle(layout, 'showTabClose', '탭 닫기 버튼 표시', '숨겨도 Ctrl + W 또는 탭 우클릭 메뉴로 닫을 수 있습니다.');

  const theme = group('theme', '테마와 색상', '브라우저의 분위기를 고르고 스페이스마다 바탕색을 바꿀 수 있습니다.', 'sparkles');
  select(theme, 'theme', '테마', [['space', '스페이스 색상에 맞춤'], ['system', 'Windows 설정 사용'], ['light', '밝게'], ['dark', '어둡게']]);
  select(theme, 'corners', '모서리', [['soft', '기본'], ['square', '각지게'], ['round', '둥글게']]);
  const accent = colorInput(theme, 'accent', '강조 색상', '#4949b5');
  accent.title = '버튼과 선택 표시의 강조 색상';
  const swatches = el('div', 'studio-swatches');
  for (const [name, color] of [['라벤더','#7164cc'], ['코발트','#3267cf'], ['민트','#2a947e'], ['로즈','#c4527e'], ['앰버','#b97826']]) {
    const swatch = button('color-swatch', name, null, () => send('appearance', { accent: color }));
    swatch.style.setProperty('--swatch', color);
    swatches.append(swatch);
    updaters.push(prefs => swatch.setAttribute('aria-pressed', String(prefs.accent === color)));
  }
  const resetAccent = button('secondary-button', '기본 강조 색상', null, () => send('appearance', { accent: null }));
  resetAccent.textContent = '기본 색상';
  swatches.append(resetAccent);
  theme.append(swatches);
  updaters.push(prefs => { resetAccent.disabled = !prefs.accent; });
  const spaceColor = el('input', 'appearance-color');
  spaceColor.type = 'color';
  spaceColor.id = 'themeColorInput';
  spaceColor.setAttribute('aria-label', '사용자 지정 배경색');
  spaceColor.addEventListener('change', () => send('theme', { color: spaceColor.value }));
  controlRow(theme, '현재 스페이스 바탕색', spaceColor);
  updaters.push(() => { spaceColor.value = currentSpace()?.color || '#c8d8cb'; });

  const start = group('start', '새 탭 페이지', '서울 배경, 바로가기, 시계와 위젯을 설정합니다.', 'home');
  const wallpaperChoices = [
    ['auto', '서울 자동', 'night'], ['day', '맑은 낮', 'day'], ['night', '서울 야경', 'night'],
    ['rain', '비 오는 창가', 'rain'], ['snow', '눈 오는 남산', 'snow'], ['solid', '단색', null],
    ['custom', '내 사진', null],
  ].map(([value, title, photo]) => {
    const visual = el('span', 'studio-wallpaper');
    if (photo) visual.style.backgroundImage = 'url("wallpapers/seoul-' + photo + '.jpg")';
    if (value === 'solid') updaters.push(prefs => { visual.style.backgroundColor = prefs.backgroundColor; });
    if (value === 'custom') updaters.push(prefs => { visual.style.backgroundImage = prefs.customImage ? 'url("' + prefs.customImage + '")' : ''; });
    return { value, title, visual, disabled: prefs => value === 'custom' && !prefs.customImage };
  });
  cards(start, '새 탭 배경', wallpaperChoices, prefs => prefs.background, value => send('appearance', { background: value }));
  const solidColor = colorInput(start, 'backgroundColor', '단색 배경', '#222237');
  const wallpaper = el('div', 'appearance-file-actions');
  const pick = button('secondary-button', '내 사진 선택', null, async () => {
    pick.disabled = true;
    try { await send('pickWallpaper'); } finally { pick.disabled = false; }
  });
  pick.textContent = '내 사진 선택';
  const remove = button('secondary-button', '저장한 사진 삭제', null, () => send('removeWallpaper'));
  remove.textContent = '저장한 사진 삭제';
  wallpaper.append(pick, remove);
  start.append(wallpaper);
  updaters.push(preferences => {
    solidColor.closest('label').hidden = preferences.background !== 'solid';
    remove.hidden = !preferences.customImage;
  });

  const range = el('input');
  range.type = 'range'; range.min = '0'; range.max = '85';
  range.setAttribute('aria-label', '배경 어둡기');
  const rangeWrap = el('span', 'appearance-range');
  const amount = el('output');
  rangeWrap.append(range, amount);
  controlRow(start, '배경 어둡기', rangeWrap);
  range.addEventListener('input', () => { amount.value = range.value + '%'; });
  range.addEventListener('change', () => send('appearance', { overlay: Number(range.value) }));
  updaters.push(preferences => {
    if (document.activeElement === range && range.matches(':active')) return;
    range.value = String(preferences.overlay ?? 35);
    amount.value = range.value + '%';
  });

  select(start, 'dialSize', '바로가기 크기', [['small', '작게'], ['medium', '보통'], ['large', '크게']]);
  toggle(start, 'showShortcuts', '바로가기 표시');
  toggle(start, 'showDashboard', '시작 페이지 위젯 표시');
  toggle(start, 'showPresets', '기본 추천 사이트 표시');
  toggle(start, 'showClock', '서울 시간 표시');
  toggle(start, 'showWeather', '서울 날씨 사용', '켜면 Open-Meteo에 서울의 고정 좌표로 날씨를 요청합니다. 끄면 자동 배경은 서울 시간으로만 바뀝니다.');
  toggle(start, 'focusNewTab', '새 탭 버튼을 눌렀을 때 주소 검색 시작', null, false);
  const toolbar = group('toolbar', '도구 모음', '자주 쓰는 버튼만 주소창 옆에 둡니다. 모든 명령은 Orbit 메뉴에서도 열 수 있습니다.', 'more');
  for (const [key, , label] of appearanceToolbarTools) toggle(toolbar, key, label);
  const profiles = group('profiles', '프리셋과 백업', '프리셋을 적용하거나, 꾸미기 설정과 배경 사진을 JSON 파일로 저장할 수 있습니다.', 'save');
  const shortcuts = el('div', 'studio-presets');
  const looks = [
    ['오로라', '왼쪽 세로 탭 · 다크', { tabPosition: 'side', sidebar: 'left', theme: 'dark', accent: '#7164cc', density: 'comfortable', corners: 'round' }],
    ['미니멀', '상단 탭 · 밝게', { tabPosition: 'top', theme: 'light', accent: null, density: 'compact', corners: 'square' }],
    ['시스템', '상단 탭 · Windows 테마', { tabPosition: 'top', theme: 'system', accent: null, density: 'comfortable', corners: 'soft' }],
  ];
  for (const [title, detail, preferences] of looks) {
    const preset = button('studio-preset', title + ' 프리셋 적용', null, () => send('appearance', preferences));
    preset.append(el('strong', '', title), el('small', '', detail));
    shortcuts.append(preset);
  }
  const actions = el('div', 'studio-profile-actions');
  for (const [label, action] of [['파일로 저장', 'exportAppearance'], ['파일 가져오기', 'importAppearance']]) {
    const control = button('secondary-button', label, null, async () => {
      control.disabled = true;
      try { await send(action); } finally { control.disabled = false; }
    });
    control.textContent = label;
    control.disabled = state.incognito;
    actions.append(control);
  }
  const reset = button('secondary-button', '모양과 새 탭 설정 초기화', null, async () => {
    if (await send('resetAppearance')) showToast('꾸미기 설정을 기본값으로 되돌렸습니다.');
  });
  reset.textContent = '기본값으로 초기화';
  actions.append(reset);
  profiles.append(shortcuts, actions);
  search.addEventListener('input', showSections);
  root.syncAppearance = preferences => updaters.forEach(update => update(preferences));
  root.syncAppearance(state.appearance || {});
  showSections();
  return root;
}
