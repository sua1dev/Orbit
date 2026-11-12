'use strict';

const { randomUUID } = require('node:crypto');
const SLOT_COUNT = 6;
const ROW_LIMIT = 40;
const FOLDER_LIMIT = 30;

function webAddress(input) {
  if (typeof input !== 'string' || input.length > 4096 || /[\x00-\x1f\x7f\\]/.test(input)) return null;
  const parsed = URL.parse(input.trim());
  return parsed && ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password
    ? parsed : null;
}

function name(input, fallback) {
  return (typeof input === 'string' && input.trim().slice(0, 100)) || fallback;
}

function validId(id) {
  return typeof id === 'string' && /^[a-z0-9-]{1,100}$/i.test(id);
}

function cleanPanel(input) {
  const used = new Set();
  function link(value) {
    const url = webAddress(value?.url);
    if (!url || !validId(value.id) || used.has(value.id)) return null;
    used.add(value.id);
    return { id: value.id, url: url.href, title: name(value.title, url.hostname) };
  }
  const slots = Array.from({ length: SLOT_COUNT }, (_, i) => link(input?.slots?.[i]));
  const rows = [];
  if (Array.isArray(input?.rows)) for (const value of input.rows.slice(0, ROW_LIMIT)) {
    if (value?.type === 'folder') {
      if (!validId(value.id) || used.has(value.id)) continue;
      used.add(value.id);
      const links = Array.isArray(value.links) ? value.links.slice(0, FOLDER_LIMIT).map(link).filter(Boolean) : [];
      rows.push({ type: 'folder', id: value.id, title: name(value.title, '폴더'), open: value.open === true, links });
    } else {
      const entry = link(value);
      if (entry) rows.push(entry);
    }
  }
  return { slots, rows };
}

function findLink(panel, id) {
  for (const item of [...panel.slots, ...panel.rows]) {
    if (!item) continue;
    if (item.id === id && item.url) return item;
    const child = item.links?.find(entry => entry.id === id);
    if (child) return child;
  }
  return null;
}

function editPanel(current, change) {
  const panel = cleanPanel(current);
  const folder = panel.rows.find(item => item.type === 'folder' && item.id === change.parent);
  if (change.parent && !folder) throw new Error('폴더를 다시 선택해 주세요.');
  const inSlot = Number.isInteger(change.slot);
  if (inSlot && (change.slot < 0 || change.slot >= SLOT_COUNT || folder)) throw new Error('슬롯을 다시 선택해 주세요.');
  const list = inSlot ? panel.slots : folder?.links || panel.rows;
  const index = inSlot ? change.slot : list.findIndex(entry => entry.id === change.id);
  const existing = list[index];
  if ((change.id || null) !== (existing?.id || null)) throw new Error('항목이 변경됐어요. 다시 열어 주세요.');

  if (change.operation === 'toggle' && existing?.type === 'folder') {
    existing.open = !existing.open;
  } else if (change.operation === 'remove' && existing) {
    if (inSlot) list[index] = null; else list.splice(index, 1);
  } else if (change.operation === 'save') {
    if (index < 0 && list.length >= (folder ? FOLDER_LIMIT : ROW_LIMIT)) throw new Error('저장할 수 있는 항목 수에 도달했어요.');
    let item;
    if (change.type === 'folder' && !inSlot && !folder && (!existing || existing.type === 'folder')) {
      const title = name(change.title, '');
      if (!title) throw new Error('폴더 이름을 입력해 주세요.');
      item = { type: 'folder', id: existing?.id || randomUUID(), title, open: existing?.open ?? true, links: existing?.links || [] };
    } else {
      if (existing?.type === 'folder') throw new Error('링크 항목을 선택해 주세요.');
      const url = webAddress(change.url);
      if (!url) throw new Error('올바른 HTTP 또는 HTTPS 주소를 입력해 주세요.');
      item = { id: existing?.id || randomUUID(), title: name(change.title, url.hostname), url: url.href };
    }
    if (index >= 0) list[index] = item; else list.push(item);
  } else {
    throw new Error('항목을 다시 선택해 주세요.');
  }
  return panel;
}

module.exports = { cleanPanel, editPanel, findLink };
