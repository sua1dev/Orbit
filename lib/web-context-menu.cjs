'use strict';

const { isWebURL } = require('./model.cjs');
const { sameOriginBlob } = require('./popup-policy.cjs');

function editableItems(wc, params, item) {
  const flags = params.editFlags;
  const isPassword = params.formControlType === 'input-password';
  return [
    item('undo', '실행 취소', () => wc.undo(), flags.canUndo),
    item('redo', '다시 실행', () => wc.redo(), flags.canRedo),
    { type: 'separator' },
    item('cut', '잘라내기', () => wc.cut(), !isPassword && flags.canCut),
    item('copy', '복사', () => wc.copy(), !isPassword && flags.canCopy),
    item('paste', '붙여넣기', () => wc.paste(), flags.canPaste),
    ...(flags.canEditRichly ? [item('pastePlain', '일반 텍스트로 붙여넣기', () => wc.pasteAndMatchStyle(), flags.canPaste)] : []),
    item('selectAll', '모두 선택', () => wc.selectAll(), flags.canSelectAll),
  ];
}

function webContextMenu(wc, params, { openTab, copyText, guard }) {
  const groups = [];
  const item = (id, label, click, enabled = true) => ({ id: `page-${id}`, label, enabled, click: () => guard(click) });
  const { linkURL, srcURL, pageURL, mediaType, x, y, editFlags } = params;
  const sourceURL = params.frameURL || pageURL;
  const downloadable = url => isWebURL(url) || sameOriginBlob(url, sourceURL);

  if (isWebURL(linkURL)) {
    groups.push([
      item('openLink', '새 탭에서 링크 열기', () => openTab(linkURL, true)),
      item('copyLink', '링크 주소 복사', () => copyText(linkURL)),
      item('saveLink', '링크 저장…', () => wc.downloadURL(linkURL)),
    ]);
  }

  if (mediaType === 'image' || mediaType === 'canvas') {
    const images = [];
    if (isWebURL(srcURL)) images.push(item('openImage', '새 탭에서 이미지 열기', () => openTab(srcURL, true)));
    if (params.hasImageContents) images.push(item('copyImage', '이미지 복사', () => wc.copyImageAt(x, y)));
    if (downloadable(srcURL)) images.push(
      item('copyImageURL', '이미지 주소 복사', () => copyText(srcURL)),
      item('saveImage', '이미지 저장…', () => wc.downloadURL(srcURL)),
    );
    if (images.length) groups.push(images);
  }

  if ((mediaType === 'audio' || mediaType === 'video') && downloadable(srcURL)) {
    const label = mediaType === 'video' ? '동영상' : '오디오';
    groups.push([
      item('copyMediaURL', `${label} 주소 복사`, () => copyText(srcURL)),
      ...(params.mediaFlags.canSave ? [item('saveMedia', `${label} 저장…`, () => wc.downloadURL(srcURL))] : []),
    ]);
  }

  if (params.isEditable) {
    groups.push(editableItems(wc, params, item));
  } else if (params.selectionText.trim() && params.formControlType !== 'input-password') {
    const query = new URLSearchParams({ q: params.selectionText.trim().slice(0, 2048) });
    groups.push([
      item('copy', '복사', () => wc.copy(), editFlags.canCopy),
      item('search', '선택한 텍스트로 Google 검색', () => openTab(`https://www.google.com/search?${query}`, false)),
    ]);
  }

  if (!groups.length) {
    const history = wc.navigationHistory;
    groups.push([
      item('back', '뒤로', () => history.goBack(), history.canGoBack()),
      item('forward', '앞으로', () => history.goForward(), history.canGoForward()),
      item('reload', '새로고침', () => wc.reload()),
      ...(isWebURL(pageURL) ? [item('copyPageURL', '페이지 주소 복사', () => copyText(pageURL))] : []),
    ]);
  }

  groups.push([item('inspect', '검사', () => {
    if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' });
    wc.inspectElement(x, y);
  })]);
  return groups.flatMap((group, index) => index === 0 ? group : [{ type: 'separator' }, ...group]);
}

module.exports = { webContextMenu, editableItems };
