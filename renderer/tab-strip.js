'use strict';

const orbitTabDragType = 'application/x-orbit-tab';

function bindTabDrop(node, drop) {
  node.addEventListener('dragover', event => {
    if (!event.dataTransfer?.types.includes(orbitTabDragType)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    node.classList.add('top-drop');
  });
  node.addEventListener('dragleave', event => {
    if (!node.contains(event.relatedTarget)) node.classList.remove('top-drop');
  });
  node.addEventListener('drop', event => {
    const id = event.dataTransfer?.getData(orbitTabDragType);
    node.classList.remove('top-drop');
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    drop(id);
  });
}

function topTab(tab) {
  const row = el('div', 'top-tab');
  row.dataset.topTabId = tab.id;
  const select = button('top-tab-select', tab.title || '새 탭', null, () => send('activateTab', { id: tab.id }));
  select.append(el('span', 'top-tab-icon'), el('span', 'top-tab-title'));
  const close = button('top-tab-close', '탭 닫기', 'close', () => send('closeTab', { id: tab.id }));
  row.append(select, close);
  attachContextMenu(select, 'tab', tab.id);
  row.addEventListener('contextmenu', event => {
    if (event.target.closest('.top-tab-select')) return;
    event.preventDefault();
    bridge?.showChromeMenu({ target: 'tab', id: tab.id, x: event.clientX, y: event.clientY }).catch(() => {});
  });
  row.draggable = true;
  row.addEventListener('dragstart', event => {
    event.dataTransfer.setData(orbitTabDragType, tab.id);
    event.dataTransfer.effectAllowed = 'move';
    row.classList.add('top-dragging');
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('top-dragging');
    document.querySelectorAll('.top-drop').forEach(node => node.classList.remove('top-drop'));
  });
  row.addEventListener('auxclick', event => {
    if (event.button !== 1) return;
    event.preventDefault();
    send('closeTab', { id: tab.id });
  });
  bindTabDrop(row, async id => {
    const target = state.tabs.find(entry => entry.id === tab.id);
    if (!target || id === target.id) return;
    if (await send('moveTab', { id, folderId: target.folderId || null })) {
      await send('reorderTab', { id, beforeId: target.id });
    }
  });
  return row;
}

function updateTopTab(row, tab) {
  const select = row.firstChild;
  const active = tab.id === state.activeTabId;
  const title = tab.title || '새 탭';
  row.classList.toggle('active', active);
  row.classList.toggle('pinned', Boolean(tab.pinned));
  row.classList.toggle('tiled', state.splitTabIds.includes(tab.id));
  row.title = title;
  select.setAttribute('aria-label', title);
  select.setAttribute('aria-pressed', String(active));
  select.lastChild.textContent = title;
  row.lastChild.setAttribute('aria-label', title + ' 닫기');
  const visual = tab.url + '|' + (tab.faviconURL || '');
  if (select.firstChild.dataset.visual !== visual) {
    select.firstChild.replaceChildren(favicon(tab));
    select.firstChild.dataset.visual = visual;
  }
}

function topGroup(folder) {
  const group = button('top-stack', folder.name, null, () => {
    const tabs = state.tabs.filter(tab => tab.folderId === folder.id);
    if (tabs.some(tab => tab.id === state.activeTabId)) return;
    const selected = tabs.find(tab => tab.id === lastStackTabs.get(folder.id)) || tabs[0];
    if (selected) send('activateTab', { id: selected.id });
    else openFolderEditor(folder.id, null, true);
  });
  group.append(el('span', 'top-stack-mark'), el('span', 'top-tab-title'), el('span', 'top-stack-count'));
  attachContextMenu(group, 'stack', folder.id);
  bindTabDrop(group, id => send('moveTab', { id, folderId: folder.id }));
  return group;
}

const lastStackTabs = new Map();

function renderTopTabs() {
  const horizontal = state.appearance?.tabPosition !== 'side';
  $('app').classList.toggle('tabs-top', horizontal);
  $('topTabStrip').hidden = !horizontal;
  if (!horizontal) { $('stackStrip').hidden = true; return; }
  $('topSpaceName').textContent = currentSpace()?.name || '스페이스';
  const tabs = state.tabs.filter(tab => tab.spaceId === state.activeSpaceId);
  const folders = state.folders.filter(folder => folder.spaceId === state.activeSpaceId);
  const groups = new Map(folders.map(folder => [folder.id, { folder, count: 0 }]));
  const rows = [];
  for (const tab of tabs) {
    const group = groups.get(tab.folderId);
    if (group) {
      if (!group.count) rows.push(group);
      group.count++;
    } else rows.push({ tab });
  }
  for (const group of groups.values()) if (!group.count) rows.push(group);
  rows.sort((a, b) => Number(Boolean(b.tab?.pinned)) - Number(Boolean(a.tab?.pinned)));
  const groupId = activeTab()?.folderId;
  if (groupId) lastStackTabs.set(groupId, state.activeTabId);
  reconcile($('topTabs'), rows,
    entry => entry.tab ? 'tab:' + entry.tab.id : 'group:' + entry.folder.id,
    entry => entry.tab ? topTab(entry.tab) : topGroup(entry.folder),
    (node, entry) => {
      if (entry.tab) return updateTopTab(node, entry.tab);
      const { folder, count } = entry;
      node.style.setProperty('--stack-color', folder.color || '#8795dc');
      node.firstChild.style.backgroundColor = folder.color || '#8795dc';
      node.children[1].textContent = folder.name;
      node.children[2].textContent = String(count);
      node.title = folder.name + ' · ' + count + '개 탭';
      node.setAttribute('aria-label', node.title);
      node.setAttribute('aria-pressed', String(groupId === folder.id));
    });
  const current = groups.get(groupId);
  $('stackStrip').hidden = !current;
  if (!current) return;
  $('stackName').textContent = current.folder.name;
  $('stackName').style.setProperty('--stack-color', current.folder.color || '#8795dc');
  reconcile($('stackTabs'), tabs.filter(tab => tab.folderId === groupId), tab => tab.id, topTab, updateTopTab);
}

function bindTopTabs() {
  $('topSpaceButton').addEventListener('click', openSpaces);
  $('topNewTab').addEventListener('click', () => newTab());
  $('topGroupButton').addEventListener('click', () => openFolderEditor(null, state?.activeTabId, true));
  $('stackNewTab').addEventListener('click', async () => {
    const folderId = activeTab()?.folderId;
    if (folderId && await send('newTab', { folderId })) await openPalette();
  });
  for (const id of ['topTabs', 'stackTabs']) {
    $(id).addEventListener('wheel', event => {
      if (!event.deltaY || event.deltaX || event.ctrlKey || $(id).scrollWidth <= $(id).clientWidth) return;
      event.preventDefault();
      $(id).scrollLeft += event.deltaY;
    }, { passive: false });
  }
}
