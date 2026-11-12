'use strict';

let refreshTabSearch;

async function openTabSearch() {
  if (!state) return;
  const existing = $('tabSearchInput');
  if (overlayKind === 'tab-search' && existing) {
    existing.focus();
    return;
  }
  const epoch = await openOverlay('tab-search');
  if (epoch !== overlayEpoch) return;

  const { body } = dialog('탭 검색', null, 'tab-search');
  const search = el('div', 'tab-search-field');
  const input = el('input', 'text-input');
  input.id = 'tabSearchInput';
  input.type = 'search';
  input.placeholder = '탭 제목, 주소, 스페이스 이름';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', '열린 탭과 닫은 탭 검색');
  input.setAttribute('aria-controls', 'tabSearchResults');
  input.setAttribute('aria-expanded', 'true');
  search.append(icon('search'), input);

  const list = el('div', 'tab-search-results');
  list.id = 'tabSearchResults';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', '탭 검색 결과');
  const status = el('p', 'tab-search-status');
  status.setAttribute('role', 'status');
  const footer = el('div', 'palette-footer');
  for (const [key, label] of [['↑ ↓', '이동'], ['Enter', '열기'], ['Esc', '닫기']]) {
    const hint = el('span');
    hint.append(el('kbd', '', key), document.createTextNode(label));
    footer.append(hint);
  }
  body.append(search, list, status, footer);

  let results = [];
  let selected = 0;
  let opening = false;

  function select(index, scroll = false) {
    list.querySelector('[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
    selected = index;
    const option = $('tab-search-result-' + index);
    if (!option) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    option.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', option.id);
    if (scroll) option.scrollIntoView({ block: 'nearest' });
  }

  async function open(result) {
    if (!result || opening) return;
    opening = true;
    await closeOverlay();
    if (result.closed) await send('reopenTab', { id: result.id });
    else await send('activateTab', { id: result.id, acrossSpaces: true });
  }

  function draw(reset = false) {
    if (!input.isConnected) return;
    const terms = input.value.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const spaces = new Map(state.spaces.map(space => [space.id, space.name]));
    const tabs = [...state.tabs].sort((a, b) =>
      Number(b.spaceId === state.activeSpaceId) - Number(a.spaceId === state.activeSpaceId));
    const closedTabs = state.incognito ? [] : state.archivedTabs || [];
    const matches = [tabs, closedTabs].flatMap((entries, group) => entries.map(tab => ({
      id: tab.id, title: tab.title || siteName(tab.url), url: tab.url,
      faviconURL: tab.faviconURL, space: spaces.get(tab.spaceId) || '',
      pinned: Boolean(tab.pinned), active: !group && tab.id === state.activeTabId,
      closed: Boolean(group),
    })).filter(tab => {
      const text = (tab.title + ' ' + tab.url + ' ' + tab.space).normalize('NFKC').toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    }));
    if (!reset && matches.length === results.length && matches.every((tab, i) =>
      Object.keys(tab).every(key => tab[key] === results[i][key]))) return;

    const previous = results[selected];
    results = matches;
    const groups = new Map();
    list.replaceChildren();
    results.forEach((result, index) => {
      if (!groups.has(result.closed)) {
        const group = el('div', 'tab-search-group');
        const heading = el('div', 'palette-label', result.closed ? '최근 닫은 탭' : '열린 탭');
        heading.id = result.closed ? 'closedTabResults' : 'openTabResults';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-labelledby', heading.id);
        group.append(heading);
        list.append(group);
        groups.set(result.closed, group);
      }
      const row = button('palette-result tab-search-result', result.title, null, () => open(result));
      row.tabIndex = -1;
      row.id = 'tab-search-result-' + index;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      const thumb = el('span', 'result-icon');
      thumb.append(favicon(result));
      const copy = el('span', 'result-content');
      const detail = [result.space, siteName(result.url)].filter(Boolean).join(' · ');
      copy.append(el('strong', '', result.title), el('small', '', detail));
      row.setAttribute('aria-label', [result.title, detail, result.active ? '현재 탭' : '',
        result.pinned ? '고정 탭' : '', result.closed ? '다시 열기' : ''].filter(Boolean).join(', '));
      row.append(thumb, copy);
      if (result.active) row.append(el('span', 'tab-search-current', '현재'));
      else if (result.pinned) row.append(icon('pin'));
      if (result.closed) row.append(icon('restoreTab'));
      row.addEventListener('mousedown', event => event.preventDefault());
      groups.get(result.closed).append(row);
    });
    status.textContent = results.length ? results.length + '개 탭' : '일치하는 탭이 없어요.';
    const keep = !reset && previous ? results.findIndex(tab => tab.id === previous.id && tab.closed === previous.closed) : -1;
    if (reset) list.scrollTop = 0;
    select(Math.max(keep, 0));
  }

  refreshTabSearch = draw;
  input.addEventListener('input', () => draw(true));
  input.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      open(results[selected]);
    }
    if (results.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      select((selected + direction + results.length) % results.length, true);
    }
  });
  draw(true);
  input.focus();
}
