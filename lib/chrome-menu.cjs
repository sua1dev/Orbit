'use strict';

const { clipboard } = require('electron');
const { isWebURL } = require('./model.cjs');

function item(id, label, click, enabled = true) {
  return { id, label, click, enabled };
}

function chromeMenuItems({ target, id }, state, { run, command, contentsFor, copyAddress, incognito }) {
  const separator = { type: 'separator' };
  const action = (name, label, payload = { id }, enabled = true) =>
    item(name, label, () => run(name, payload), enabled);
  const move = (label, destination) => item(`moveTo-${destination.folderId || destination.spaceId || 'ungrouped'}`,
    label.replaceAll('&', '&&'), () => run('moveTab', { id, ...destination }));

  switch (target) {
    case 'tab': {
      const tab = state.tabs.find(entry => entry.id === id);
      if (!tab) return [];
      const web = isWebURL(tab.url);
      const favorite = state.favorites.some(entry => entry.url === tab.url);
      const contents = contentsFor(id);
      const folders = state.folders.filter(folder => folder.spaceId === tab.spaceId && folder.id !== tab.folderId);
      const folderOptions = folders.map(folder => move(folder.name, { folderId: folder.id }));
      if (tab.folderId) folderOptions.unshift(move('폴더 밖으로', { folderId: null }));
      const spaces = state.spaces.filter(space => space.id !== tab.spaceId);
      return [
        action('pinTab', tab.pinned ? '고정 해제' : '탭 고정'),
        action('muteTab', contents?.isAudioMuted() ? '탭 소리 켜기' : '탭 음소거', { id }, Boolean(contents)),
        action('favoriteTab', favorite ? '즐겨찾기에서 제거' : '즐겨찾기에 추가', { id }, web && !incognito),
        action('copyURL', '주소 복사', { id }, web),
        action('duplicateTab', '탭 복제', { id }, web),
        separator,
        item('newTabGroup', '새 탭 그룹 만들기', () => command('stack-editor', { tabId: id }), tab.spaceId === state.activeSpaceId),
        { label: '그룹으로 이동', enabled: folderOptions.length > 0, submenu: folderOptions },
        { label: '스페이스로 이동', enabled: spaces.length > 0, submenu: spaces.map(space =>
          move(space.name, { spaceId: space.id, folderId: null })) },
        separator,
        action('closeTab', '탭 닫기')
      ];
    }
    case 'stack':
    case 'folder': {
      const folder = state.folders.find(entry => entry.id === id);
      if (!folder) return [];
      return [
        ...(target === 'stack' ? [action('newTab', '그룹에 새 탭 추가', { folderId: id })] : [action('toggleFolder', folder.collapsed ? '폴더 펼치기' : '폴더 접기')]),
        item('renameFolder', target === 'stack' ? '그룹 편집' : '폴더 이름 바꾸기', () => command(target === 'stack' ? 'stack-editor' : 'folder-editor', { id })),
        separator,
        action('deleteFolder', target === 'stack' ? '그룹 해제' : '폴더만 삭제')
      ];
    }
    case 'favorite': {
      const index = state.favorites.findIndex(entry => entry.id === id);
      const favorite = state.favorites[index];
      if (!favorite) return [];
      return [
        action('openFavorite', '즐겨찾기 열기'),
        item('copyURL', '주소 복사', () => copyAddress(favorite.url)),
        separator,
        item('editFavorite', '이름과 주소 편집', () => command('favorite-editor', { id }), !incognito),
        item('favoriteEarlier', '앞으로 이동', () => run('moveFavorite', { id, direction: 'earlier' }), !incognito && index > 0),
        item('favoriteLater', '뒤로 이동', () => run('moveFavorite', { id, direction: 'later' }), !incognito && index < state.favorites.length - 1),
        separator,
        action('removeFavorite', '즐겨찾기에서 제거', { id }, !incognito)
      ];
    }
    case 'address': {
      const tab = state.tabs.find(entry => entry.id === state.activeTabId);
      return [
        item('editAddress', '주소 편집', () => command('focus-address')),
        item('copyURL', '주소 복사', () => copyAddress(tab?.url), Boolean(tab?.url && tab.url !== 'orbit://newtab')),
        item('pasteAndGo', '붙여넣고 이동', () => {
          const input = clipboard.readText().trim();
          if (input && tab) run('navigate', { input, targetTabId: tab.id });
        })
      ];
    }
    default:
      return [];
  }
}

module.exports = { chromeMenuItems, item };
