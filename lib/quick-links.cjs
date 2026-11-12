'use strict';

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

module.exports = { cleanPanel };
