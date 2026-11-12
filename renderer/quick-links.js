'use strict';

let quickLinksViewKey;
let quickLinksEditSpace;

function renderQuickLinks() {
  const root = $('quickLinks');
  root.hidden = state.incognito || state.sidebarCollapsed;
  if (root.hidden) return;

  const space = state.activeSpaceId;
  const panel = state.quickLinks?.[space] || { slots: [], rows: [] };
  const editing = quickLinksEditSpace === space;
  const cached = new Map();
  for (const favorite of state.favorites) if (favorite.faviconURL) cached.set(favorite.url, favorite.faviconURL);
  for (const tab of state.tabs) if (tab.spaceId === space && tab.faviconURL) cached.set(tab.url, tab.faviconURL);
  const icons = new Map();
  for (const item of [...panel.slots, ...panel.rows.flatMap(row => row.links || [row])]) {
    if (!item?.url) continue;
    const saved = cached.get(item.url);
    if (saved) icons.set(item.url, saved);
  }
  const key = JSON.stringify([space, panel, editing, [...icons]]);
  if (quickLinksViewKey === key) return;
  quickLinksViewKey = key;

  function edit(options = {}, item) {
    return openQuickLinkEditor(space, options, item);
  }

  function textButton(label, glyph, click, css = 'quick-link-control') {
    const control = button(css, label, glyph, click);
    control.append(el('span', '', label));
    return control;
  }

  function link(item, options, tile) {
    const control = button(tile ? 'quick-link-tile' : 'quick-link-row', item.title, null,
      () => editing ? edit(options, item) : send('openQuickLink', { space, id: item.id }));
    control.append(favicon({ ...item, faviconURL: icons.get(item.url) }));
    if (!tile) control.append(el('span', 'quick-link-title', item.title));
    control.addEventListener('contextmenu', event => {
      event.preventDefault();
      edit(options, item);
    });
    return control;
  }

  const header = el('div', 'quick-links-header');
  const manage = textButton(editing ? '완료' : '편집', editing ? 'check' : 'edit', () => {
    quickLinksEditSpace = editing ? null : space;
    renderQuickLinks();
    root.querySelector('.quick-links-header button')?.focus();
  });
  manage.setAttribute('aria-pressed', String(editing));
  header.append(el('h2', '', '바로가기'), manage);
  const grid = el('div', 'quick-links-grid');
  for (let slot = 0; slot < 6; slot++) {
    const item = panel.slots[slot];
    grid.append(item ? link(item, { slot }, true)
      : button('quick-link-tile empty', (slot + 1) + '번 바로가기 추가', 'plus', () => edit({ slot })));
  }
  const rows = el('div', 'quick-links-rows');
  for (const item of panel.rows) {
    if (item.type !== 'folder') {
      rows.append(link(item, {}, false));
      continue;
    }
    const folder = el('div', 'quick-link-folder');
    const toggle = textButton(item.title, 'folder', async () => {
      if (editing) return edit({ type: 'folder' }, item);
      await send('quickLinks', { space, operation: 'toggle', id: item.id });
      root.querySelector('[data-folder-key="' + item.id + '"]')?.focus();
    }, 'quick-link-row quick-link-folder-title');
    toggle.dataset.folderKey = item.id;
    toggle.setAttribute('aria-expanded', String(item.open));
    toggle.append(icon(item.open ? 'chevronDown' : 'chevronRight'));
    toggle.addEventListener('contextmenu', event => {
      event.preventDefault();
      edit({ type: 'folder' }, item);
    });
    folder.append(toggle);
    if (item.open) {
      const children = el('div', 'quick-link-children');
      for (const child of item.links) children.append(link(child, { parent: item.id }, false));
      children.append(textButton('폴더에 링크 추가', 'plus', () => edit({ parent: item.id })));
      folder.append(children);
    }
    rows.append(folder);
  }
  const actions = el('div', 'quick-links-add');
  actions.append(textButton('링크 추가', 'plus', () => edit()),
    textButton('폴더 추가', 'folderPlus', () => edit({ type: 'folder' })));
  root.replaceChildren(header, grid, rows, actions);
}

async function openQuickLinkEditor(space, options, item) {
  const epoch = await openOverlay('quick-links-editor');
  if (epoch !== overlayEpoch) return;
  const folder = options.type === 'folder';
  const { body } = dialog(folder ? (item ? '폴더 편집' : '바로가기 폴더 추가')
    : (item ? '바로가기 편집' : '바로가기 추가'), null, 'quick-links-editor');
  const form = el('form', 'quick-links-form');
  function field(label, value, limit) {
    const container = el('label', 'quick-link-field', label);
    const input = el('input', 'text-input');
    input.value = value || '';
    input.maxLength = limit;
    container.append(input);
    form.append(container);
    return input;
  }
  const title = field('이름', item?.title, 100);
  title.required = folder;
  const url = folder ? null : field('웹 주소', item?.url, 4096);
  if (url) {
    url.required = true;
    url.inputMode = 'url';
    url.placeholder = 'example.com';
  }
  const actions = el('div', 'quick-links-editor-actions');
  if (item) {
    const remove = button('secondary-button', folder && item.links?.length ? '폴더와 안의 링크 삭제' : '삭제', 'trash', async () => {
      const next = await send('quickLinks', { ...options, space, id: item.id, operation: 'remove' });
      if (next) closeOverlay();
    });
    remove.type = 'button';
    remove.append(el('span', '', remove.getAttribute('aria-label')));
    actions.append(remove);
  }
  const save = el('button', 'primary-button', '저장');
  save.type = 'submit';
  actions.append(save);
  form.append(actions);
  body.append(form);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const raw = url?.value.trim();
    const address = raw && !/^[a-z][\w+.-]*:\/\//i.test(raw) ? 'https://' + raw : raw;
    const next = await send('quickLinks', {
      ...options, space, id: item?.id, operation: 'save', title: title.value, url: address,
    });
    if (next) closeOverlay();
  });
  title.focus();
}
