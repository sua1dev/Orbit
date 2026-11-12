'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createSitePermissions } = require('../lib/site-permissions.cjs');

function fixture() {
  const site = 'https://example.com';
  const wc = new EventEmitter();
  wc.getURL = () => site + '/call';
  wc.isDestroyed = () => false;
  const owner = { win: { isFocused: () => true, isDestroyed: () => false }, isVisibleSite: () => true };
  const prompts = [];
  const permissions = createSitePermissions({
    ownerFor: () => owner,
    prompt: (...args) => new Promise(resolve => prompts.push({ args, resolve })),
  });
  return { site, wc, owner, prompts, permissions, details: { isMainFrame: true, requestingUrl: wc.getURL() } };
}

test('microphone consent does not grant camera access', async () => {
  const { wc, site, prompts, permissions, details } = fixture();
  const audio = permissions.request(wc, 'media', { ...details, mediaTypes: ['audio'] });
  assert.equal(prompts[0].args[2], '마이크');
  prompts[0].resolve(true);
  assert.equal(await audio, true);
  assert.equal(permissions.check(wc, 'media', site, { ...details, mediaType: 'audio' }), true);
  assert.equal(permissions.check(wc, 'media', site, { ...details, mediaType: 'video' }), false);
  const both = permissions.request(wc, 'media', { ...details, mediaTypes: ['audio', 'video'] });
  assert.equal(prompts[1].args[2], '카메라');
  prompts[1].resolve(false);
  assert.equal(await both, false);
  assert.equal(await permissions.request(wc, 'media', { ...details, mediaTypes: ['video'] }), false);
});

test('background pages, third-party frames, and insecure sites cannot request sensitive permissions', async () => {
  const { wc, owner, prompts, permissions, details } = fixture();
  assert.equal(await permissions.request(wc, 'geolocation', { ...details, isMainFrame: false }), false);
  owner.isVisibleSite = () => false;
  assert.equal(await permissions.request(wc, 'notifications', details), false);
  owner.isVisibleSite = () => true;
  owner.win.isFocused = () => false;
  assert.equal(await permissions.request(wc, 'clipboard-read', details), false);
  owner.win.isFocused = () => true;
  wc.getURL = () => 'http://example.com/';
  assert.equal(await permissions.request(wc, 'media', { ...details, requestingUrl: wc.getURL(), mediaTypes: ['audio'] }), false);
  assert.equal(prompts.length, 0);
});

test('navigation and site data clearing invalidate pending consent, including same-URL reloads', async () => {
  const { wc, site, prompts, permissions, details } = fixture();
  const first = permissions.request(wc, 'notifications', details);
  assert.equal(await permissions.request(wc, 'geolocation', details), false);
  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  prompts[0].resolve(true);
  assert.equal(await first, false);
  const second = permissions.request(wc, 'notifications', details);
  permissions.clear();
  prompts[1].resolve(true);
  assert.equal(await second, false);
  assert.equal(permissions.check(wc, 'notifications', site, details), false);
  assert.equal(wc.listenerCount('did-start-navigation'), 0);
});

test('clipboard reads are one-time and embedded sign-in consent stays with its top-level site', async () => {
  const { wc, prompts, permissions, details, site } = fixture();
  for (let i = 0; i < 2; i++) {
    const reading = permissions.request(wc, 'clipboard-read', details);
    assert.equal(prompts[i].args[3], true);
    prompts[i].resolve(true);
    assert.equal(await reading, true);
    assert.equal(permissions.check(wc, 'clipboard-read', site, details), false);
  }
  const embed = 'https://identity.example';
  const embeddedFrame = { isMainFrame: false, requestingUrl: embed };
  const access = permissions.request(wc, 'storage-access', embeddedFrame);
  prompts[2].resolve(true);
  assert.equal(await access, true);
  assert.equal(permissions.check(wc, 'storage-access', embed, embeddedFrame), true);
  wc.getURL = () => 'https://other.example/';
  assert.equal(permissions.check(wc, 'storage-access', embed, embeddedFrame), false);
});
