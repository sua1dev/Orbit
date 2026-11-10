'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createSeoulWeatherService } = require('../lib/seoul-weather.cjs');

test('offline weather follows the Seoul clock and never requests live conditions', async () => {
  let now = Date.parse('2026-11-09T08:59:00Z');
  let requests = 0;
  const weather = createSeoulWeatherService({
    now: () => now,
    request: () => { requests++; },
  });
  assert.deepEqual(await weather(false), { scene: 'day', condition: '낮', temperature: null, live: false });
  now += 60_000;
  assert.deepEqual(await weather(false), { scene: 'night', condition: '밤', temperature: null, live: false });
  assert.equal(requests, 0);
});

test('weather scenes prioritize precipitation, share an in-flight request and expire', async () => {
  let now = Date.parse('2026-11-09T05:00:00Z');
  let resolveRequest;
  let requests = 0;
  const weather = createSeoulWeatherService({
    now: () => now,
    request: () => {
      requests++;
      return new Promise(resolve => { resolveRequest = resolve; });
    },
  });
  const first = weather(true);
  const second = weather(true);
  resolveRequest({ is_day: 1, weather_code: 65, temperature_2m: 5.7 });
  const expected = { scene: 'rain', condition: '비', temperature: 6, live: true };
  assert.deepEqual(await first, expected);
  assert.deepEqual(await second, expected);
  assert.deepEqual(await weather(true), expected);
  assert.equal((await weather(false)).scene, 'day');
  assert.equal(requests, 1);
  now += 15 * 60_000;
  const later = weather(true);
  resolveRequest({ is_day: 0, weather_code: 86, temperature_2m: -3.7 });
  assert.deepEqual(await later, { scene: 'snow', condition: '눈', temperature: -4, live: true });
  assert.equal(requests, 2);
});

test('failed and malformed weather responses fall back and back off before retrying', async () => {
  let now = Date.parse('2026-11-09T08:59:00Z');
  let requests = 0;
  const weather = createSeoulWeatherService({
    now: () => now,
    request: () => {
      requests++;
      if (requests === 1) throw new Error('network failure');
      if (requests === 2) return { is_day: 0, weather_code: '75' };
      return { is_day: 0, weather_code: 3, temperature_2m: null };
    },
  });
  assert.equal((await weather(true)).scene, 'day');
  now += 60_000;
  assert.equal((await weather(true)).scene, 'night');
  assert.equal(requests, 1);
  now += 60_000;
  assert.equal((await weather(true)).live, false);
  now += 2 * 60_000;
  assert.deepEqual(await weather(true), { scene: 'night', condition: '흐림', temperature: null, live: true });
  assert.equal(requests, 3);
});
