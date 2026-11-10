'use strict';

const maxIconBytes = 256 * 1024;
const rasterData = /^data:image\/(?:png|jpeg|x-icon|vnd\.microsoft\.icon|ico|webp);base64,([A-Za-z0-9+/]+={0,2})$/i;

function safeRasterFaviconURL(value) {
  if (typeof value !== 'string' || value.length > 128 * 1024) return null;
  const match = value.match(rasterData);
  return match && Buffer.from(match[1], 'base64').toString('base64') === match[1] ? value : null;
}

function decodeInlineFavicon(url) {
  if (typeof url !== 'string' || url.length > maxIconBytes) return null;
  const match = url.match(/^data:(image\/(?:svg\+xml|png|jpeg|x-icon|vnd\.microsoft\.icon|ico|webp))(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  try {
    const payload = decodeURIComponent(match[3]);
    const bytes = Buffer.from(payload, match[2] ? 'base64' : 'utf8');
    return { bytes, type: match[1].toLowerCase() };
  } catch {
    return null;
  }
}

function svgFavicon(bytes, type) {
  if (type !== 'image/svg+xml' || bytes.length > 96 * 1024) return false;
  const source = bytes.toString('utf8');
  return !/<!DOCTYPE|<!ENTITY/i.test(source) && /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?=[\s>])/i.test(source);
}

function faviconImageScript(bytes, type) {
  const url = `data:${type};base64,${bytes.toString('base64')}`;
  // Chromium decodes vector and ICO formats in the originating sandboxed view.
  // The SVG stays inside an image context where scripts and external loads are disabled.
  return `(async () => {
    const image = new Image();
    image.src = ${JSON.stringify(url)};
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || width > 2048 || height > 2048) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const scale = 32 / Math.max(width, height);
    canvas.getContext('2d').drawImage(image, (32 - width * scale) / 2, (32 - height * scale) / 2, width * scale, height * scale);
    return canvas.toDataURL('image/png');
  })()`;
}

module.exports = { maxIconBytes, safeRasterFaviconURL, decodeInlineFavicon, svgFavicon, faviconImageScript };
