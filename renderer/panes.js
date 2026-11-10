'use strict';

const splitMinimum = 27;
const splitMaximum = 73;
let layoutFrame = 0;
let lastLayout = '';
let splitPointer = null;

function rectFor(node) {
  const rect = node.getBoundingClientRect();
  const x = Math.round(rect.left);
  const y = Math.round(rect.top);
  return { x, y, width: Math.round(rect.right) - x, height: Math.round(rect.bottom) - y };
}

function scheduleGuestLayout() {
  if (layoutFrame || !bridge?.sendLayout) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    const panes = [...$('workspaceSurface').children].map(pane => ({
      id: pane.dataset.tabId,
      ...rectFor(pane.querySelector('.pane-content')),
    }));
    const panel = state?.webPanel && !$('webPanel').hidden
      ? { id: state.webPanel.id, ...rectFor($('panelGuest')) } : null;
    const layout = { panes, panel };
    const signature = JSON.stringify(layout);
    if (signature === lastLayout) return;
    lastLayout = signature;
    bridge.sendLayout(layout);
  });
}

function createPaneHeader(id) {
  const header = el('header', 'pane-header');
  const title = button('pane-title', '', null, () => send('activateTab', { id }));
  title.append(el('span', 'pane-title-icon'), el('span', 'pane-title-label'));
  const choose = button('pane-action', '이 패널의 탭 선택', 'chevronDown', () => openPanePicker(id));
  choose.setAttribute('aria-haspopup', 'dialog');
  const close = button('pane-action', '이 패널 분할 해제', 'close', () => send('unsplit', { removeId: id }));
  close.title = '이 패널을 분할 화면에서 빼기';
  header.append(title, choose, close);
  return header;
}

function updatePaneHeader(pane, tab, split) {
  const header = pane.firstElementChild;
  header.hidden = !split;
  if (!split) return;
  const title = header.firstElementChild;
  title.lastElementChild.textContent = tab.title;
  title.title = tab.title;
  title.setAttribute('aria-label', tab.title + ' 패널 활성화');
  const visual = tab.url + '|' + (tab.faviconURL || '');
  if (title.dataset.visual !== visual) {
    title.firstElementChild.replaceChildren(favicon(tab));
    title.dataset.visual = visual;
  }
}

async function openPanePicker(id) {
  const epoch = await openOverlay('pane-picker');
  if (epoch !== overlayEpoch || overlayKind !== 'pane-picker') return;
  const { body } = dialog('분할 화면 탭 선택', '이 패널에 표시할 탭을 고르세요.');
  const current = state.tabs.find(tab => tab.id === id);
  const choices = state.tabs.filter(tab => tab.spaceId === state.activeSpaceId && !state.splitTabIds.includes(tab.id));
  const list = el('div', 'pane-choices');
  if (!choices.length) list.append(el('p', 'settings-description', '현재 스페이스에 고를 수 있는 다른 탭이 없습니다.'));
  for (const tab of choices) {
    const item = button('pane-choice', tab.title, null, async () => {
      if (await send('replaceSplitTab', { id, targetId: tab.id })) await closeOverlay();
    });
    item.append(favicon(tab), el('span', '', tab.title));
    list.append(item);
  }
  const create = button('secondary-button', '새 탭으로 바꾸기', null, async () => {
    if (await send('replaceSplitTab', { id })) await closeOverlay();
  });
  create.textContent = '새 탭으로 바꾸기';
  if (current) body.append(list, create);
}

function paintSplitRatio(value) {
  const ratio = Math.max(splitMinimum, Math.min(splitMaximum, Math.round(value)));
  $('workbench').style.setProperty('--split-ratio', ratio + '%');
  $('splitDivider').setAttribute('aria-valuenow', String(ratio));
  scheduleGuestLayout();
  return ratio;
}

function renderWorkArea(split) {
  $('workbench').classList.toggle('workbench-split', split);
  $('splitDivider').hidden = !split;
  if (split && !splitPointer) paintSplitRatio(state.splitRatio || 50);
  const panel = state.webPanel;
  $('webPanel').hidden = !panel;
  $('dockWebPanel').setAttribute('aria-expanded', String(Boolean(panel)));
  $('dockWebPanel').title = panel ? '웹 패널 닫기' : '웹 패널 열기';
  if (panel) {
    const address = $('panelAddress');
    address.textContent = panel.title || siteName(panel.url);
    address.title = panel.url;
    $('panelBack').disabled = !panel.canGoBack;
    $('panelForward').disabled = !panel.canGoForward;
    $('panelHost').textContent = siteName(panel.url);
    $('panelMessage').textContent = panel.error || (panel.loading ? '페이지를 여는 중입니다…' : '');
  }
  scheduleGuestLayout();
}

async function openWebPanelPicker() {
  const epoch = await openOverlay('web-panel-picker');
  if (epoch !== overlayEpoch || overlayKind !== 'web-panel-picker') return;
  const { body } = dialog('웹 패널', '현재 스페이스에서 웹사이트를 옆에 띄워 두세요.');
  const form = el('form', 'panel-picker-form');
  const address = el('input', 'text-input');
  address.setAttribute('aria-label', '웹 패널 주소 또는 검색어');
  address.placeholder = '웹 주소 또는 검색어';
  address.value = state.webPanel?.url || '';
  address.required = true;
  const submit = el('button', 'primary-button', '열기');
  submit.type = 'submit';
  form.append(address, submit);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (await send('openWebPanel', { input: address.value })) await closeOverlay();
  });
  body.append(form);
  const list = el('div', 'pane-choices');
  const current = activeTab();
  const choices = [];
  if (/^https?:\/\//.test(current?.url || '')) choices.push({ ...current, title: '현재 탭 · ' + current.title });
  choices.push(...state.favorites.filter(item => item.url !== current?.url).slice(0, 8));
  for (const item of choices) {
    const choice = button('pane-choice', item.title, null, async () => {
      if (await send('openWebPanel', { input: item.url })) await closeOverlay();
    });
    choice.append(favicon(item), el('span', '', item.title));
    list.append(choice);
  }
  body.append(list);
}

document.addEventListener('DOMContentLoaded', () => {
  $('dockFavorites').addEventListener('click', openFavorites);
  $('dockHistory').addEventListener('click', openHistory);
  $('dockDownloads').addEventListener('click', openDownloads);
  $('dockSettings').addEventListener('click', openSettings);
  $('dockAppearance').addEventListener('click', openAppearance);
  $('dockWebPanel').addEventListener('click', () => state?.webPanel ? send('closeWebPanel') : openWebPanelPicker());
  $('panelAddress').addEventListener('click', openWebPanelPicker);
  $('panelPromote').addEventListener('click', () => send('promoteWebPanel'));
  $('panelClose').addEventListener('click', () => send('closeWebPanel'));
  for (const [id, action] of [['panelBack', 'back'], ['panelForward', 'forward'], ['panelReload', 'reload']]) {
    $(id).addEventListener('click', () => send('navigateWebPanel', { action }));
  }

  const divider = $('splitDivider');
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    divider.setPointerCapture(event.pointerId);
    splitPointer = { id: event.pointerId, ratio: state.splitRatio };
    $('workbench').classList.add('split-dragging');
  });
  divider.addEventListener('pointermove', event => {
    if (event.pointerId !== splitPointer?.id) return;
    const bounds = $('workspaceSurface').getBoundingClientRect();
    splitPointer.ratio = paintSplitRatio((event.clientX - bounds.left) / bounds.width * 100);
  });
  divider.addEventListener('lostpointercapture', () => {
    if (!splitPointer) return;
    const { ratio } = splitPointer;
    splitPointer = null;
    $('workbench').classList.remove('split-dragging');
    send('resizeSplit', { ratio });
  });
  divider.addEventListener('dblclick', () => send('resizeSplit', { ratio: 50 }));
  divider.addEventListener('keydown', event => {
    const delta = { ArrowLeft: -3, ArrowRight: 3 };
    if (!Object.hasOwn(delta, event.key) && !['Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = Number(divider.getAttribute('aria-valuenow'));
    const ratio = event.key === 'Home' ? splitMinimum : event.key === 'End' ? splitMaximum : current + delta[event.key];
    send('resizeSplit', { ratio: paintSplitRatio(ratio) });
  });

  const resize = new ResizeObserver(scheduleGuestLayout);
  for (const id of ['workArea', 'workspaceSurface', 'panelGuest']) resize.observe($(id));
  window.addEventListener('resize', scheduleGuestLayout);
});
