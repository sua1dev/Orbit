'use strict';

const { isWebURL } = require('./model.cjs');

const labels = new Map([
  ['audio', '마이크'],
  ['video', '카메라'],
  ['geolocation', '위치'],
  ['notifications', '알림'],
  ['clipboard-read', '클립보드 읽기'],
  ['storage-access', '삽입된 로그인 서비스의 쿠키 접근'],
  ['top-level-storage-access', '연결된 로그인 서비스의 쿠키 접근'],
]);

function secureSite(origin) {
  if (!origin) return false;
  const url = new URL(origin);
  return url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function siteOrigin(value) {
  return isWebURL(value) ? new URL(value).origin : null;
}

function createSitePermissions({ ownerFor, prompt }) {
  const decisions = new Map();
  let prompting = false;
  let revision = 0;

  function scope(wc, permission, url, details) {
    if (!wc || wc.isDestroyed()) return null;
    const owner = ownerFor(wc);
    const window = owner?.win;
    if (!window || window.isDestroyed() || !owner.isVisibleSite(wc)) return null;
    const page = wc.getURL();
    const top = siteOrigin(page);
    const origin = siteOrigin(url);
    if (!origin || !top) return null;
    const storage = permission === 'storage-access' || permission === 'top-level-storage-access';
    const passive = permission === 'fullscreen' || permission === 'clipboard-sanitized-write';
    if (permission !== 'fullscreen' && (!secureSite(origin) || !secureSite(top))) return null;
    if (!passive && !storage && (details.isMainFrame !== true || origin !== top)) return null;
    if (details.securityOrigin && siteOrigin(details.securityOrigin) !== origin) return null;
    return { owner, window, origin, top, page, storage, passive };
  }

  function key({ origin, top }, capability) {
    return [top, origin, capability].join('|');
  }

  return {
    check(wc, permission, requestingOrigin, details = {}) {
      const site = scope(wc, permission, requestingOrigin, details);
      if (!site) return false;
      if (site.passive) return true;
      const capability = permission === 'media' ? details.mediaType : permission;
      if (permission === 'media' && capability !== 'audio' && capability !== 'video') return false;
      return capability !== 'clipboard-read' && decisions.get(key(site, capability)) === true;
    },

    async request(wc, permission, details = {}) {
      const site = scope(wc, permission, details.requestingUrl, details);
      if (!site || !site.window.isFocused()) return false;
      if (site.passive) return true;
      const media = permission === 'media';
      const capabilities = media ? details.mediaTypes : [permission];
      if (!Array.isArray(capabilities) || !capabilities.length || capabilities.some(capability =>
        media ? capability !== 'audio' && capability !== 'video' : !labels.has(capability))) return false;
      const needed = [...new Set(capabilities)].filter(capability => decisions.get(key(site, capability)) !== true);
      if (!needed.length) return true;
      if (prompting || needed.some(capability => decisions.get(key(site, capability)) === false)) return false;

      const initialRevision = revision;
      let navigated = false;
      const onNavigation = event => { if (event.isMainFrame && !event.isSameDocument) navigated = true; };
      prompting = true;
      wc.on('did-start-navigation', onNavigation);
      try {
        const granted = await prompt(site.window, site.storage ? site.top + ' → ' + site.origin : site.origin,
          needed.map(capability => labels.get(capability)).join(' · '), permission === 'clipboard-read');
        if (navigated || revision !== initialRevision || wc.isDestroyed() || wc.getURL() !== site.page ||
            !site.owner.isVisibleSite(wc)) return false;
        if (permission !== 'clipboard-read') {
          for (const capability of needed) decisions.set(key(site, capability), granted === true);
        }
        return granted === true;
      } finally {
        wc.removeListener('did-start-navigation', onNavigation);
        prompting = false;
      }
    },

    clear() {
      revision++;
      decisions.clear();
    },
  };
}

module.exports = { createSitePermissions };
