'use strict';

const fs = require('node:fs/promises');

const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 384 * 1024;
const MAX_PIXELS = 32 * 1024 * 1024;
const MAX_DIMENSION = 10000;
const JPEG_PREFIX = 'data:image/jpeg;base64,';
const hex = /^#[a-f0-9]{6}$/i;

function jpegDataURL(value) {
  if (typeof value !== 'string' || !value.startsWith(JPEG_PREFIX)
      || value.length > JPEG_PREFIX.length + Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return null;
  const encoded = value.slice(JPEG_PREFIX.length);
  if (!/^[a-z0-9+/]+={0,2}$/i.test(encoded)) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.toString('base64') !== encoded
      || !validDimensions(imageDimensions(bytes))) return null;
  return value;
}

function sanitizeAppearance(input) {
  const value = input && typeof input === 'object' ? input : {};
  const option = (key, options) => options.includes(value[key]) ? value[key] : options[0];
  const validColor = (candidate, fallback) => typeof candidate === 'string' && hex.test(candidate)
    ? candidate.toLowerCase() : fallback;
  const customImage = jpegDataURL(value.customImage);
  let background = option('background', ['auto', 'day', 'night', 'rain', 'snow', 'solid', 'custom']);
  if (background === 'custom' && !customImage) background = 'auto';
  return {
    theme: option('theme', ['space', 'system', 'light', 'dark']),
    accent: validColor(value.accent, null),
    density: option('density', ['comfortable', 'compact']),
    corners: option('corners', ['soft', 'square', 'round']),
    tabPosition: option('tabPosition', ['top', 'side']),
    sidebar: option('sidebar', ['left', 'right']),
    sidebarWidth: Number.isFinite(value.sidebarWidth) ? Math.min(360, Math.max(200, Math.round(value.sidebarWidth))) : 256,
    showTabClose: value.showTabClose !== false,
    showPasswordTool: value.showPasswordTool !== false,
    showFavoriteTool: value.showFavoriteTool !== false,
    showPipTool: value.showPipTool !== false,
    showSplitTool: value.showSplitTool !== false,
    showTabSearchTool: value.showTabSearchTool !== false,
    background,
    backgroundColor: validColor(value.backgroundColor, '#222237'),
    overlay: Number.isFinite(value.overlay) ? Math.max(0, Math.min(85, Math.round(value.overlay))) : 35,
    showShortcuts: value.showShortcuts !== false,
    showPresets: value.showPresets !== false,
    showClock: value.showClock !== false,
    showWeather: value.showWeather !== false,
    showDashboard: value.showDashboard !== false,
    dialSize: option('dialSize', ['medium', 'small', 'large']),
    focusNewTab: value.focusNewTab === true,
    customImage,
  };
}

const maxAppearanceProfileBytes = 768 * 1024;

async function readAppearanceProfile(filename) {
  const file = await fs.open(filename, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maxAppearanceProfileBytes) throw new Error('꾸미기 파일 크기가 너무 큽니다.');
    const buffer = Buffer.alloc(maxAppearanceProfileBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length);
    if (bytesRead > maxAppearanceProfileBytes) throw new Error('꾸미기 파일 크기가 너무 큽니다.');
    let profile;
    try { profile = JSON.parse(buffer.toString('utf8', 0, bytesRead).replace(/^\uFEFF/, '')); } catch {}
    if (profile?.format !== 'orbit-appearance' || profile.version !== 1
        || !profile.appearance || typeof profile.appearance !== 'object' || Array.isArray(profile.appearance)) {
      throw new Error('Orbit 꾸미기 파일을 선택하세요.');
    }
    const appearance = sanitizeAppearance(profile.appearance);
    if (profile.appearance.customImage && !appearance.customImage) throw new Error('꾸미기 파일의 배경 사진을 읽을 수 없습니다.');
    return appearance;
  } finally { await file.close(); }
}

function imageDimensions(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return null;
  const startOfFrame = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf];
  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    if (offset + 3 > bytes.length) return null;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (startOfFrame.includes(marker) && length >= 8) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function validDimensions(size) {
  return size && size.width > 0 && size.height > 0 && size.width <= MAX_DIMENSION
    && size.height <= MAX_DIMENSION && size.width * size.height <= MAX_PIXELS;
}

async function loadWallpaper(filename, nativeImage) {
  const file = await fs.open(filename, 'r');
  let bytes;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SOURCE_BYTES) {
      throw new Error('12MB 이하의 JPG 또는 PNG 사진을 선택해 주세요.');
    }
    const buffer = Buffer.alloc(stat.size);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    bytes = buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
  const size = imageDimensions(bytes);
  if (!validDimensions(size)) throw new Error('사진의 형식이나 해상도를 확인해 주세요. JPG와 PNG를 지원합니다.');
  const original = nativeImage.createFromBuffer(bytes);
  if (original.isEmpty()) throw new Error('사진을 열지 못했습니다.');
  const decoded = original.getSize();
  if (!validDimensions(decoded)) throw new Error('사진 해상도가 너무 높습니다.');
  for (const [edge, quality] of [[1920, 82], [1600, 76], [1280, 68], [960, 60]]) {
    const image = decoded.width > edge || decoded.height > edge
      ? original.resize(decoded.width >= decoded.height ? { width: edge } : { height: edge }) : original;
    const jpeg = image.toJPEG(quality);
    if (jpeg.length > 0 && jpeg.length <= MAX_IMAGE_BYTES) return JPEG_PREFIX + jpeg.toString('base64');
  }
  throw new Error('배경 사진을 최적화하지 못했습니다. 더 작은 사진을 선택해 주세요.');
}

module.exports = { sanitizeAppearance, loadWallpaper, readAppearanceProfile };
