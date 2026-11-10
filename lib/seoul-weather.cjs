'use strict';

const SEOUL_FORECAST = 'https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=weather_code,is_day,temperature_2m&timezone=Asia%2FSeoul';
const WEATHER_TTL = 15 * 60_000;
const RETRY_DELAY = 2 * 60_000;
const seoulHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  hour: 'numeric',
  hourCycle: 'h23',
});

function seoulTimeScene(at) {
  const hour = Number(seoulHour.format(at));
  const isDay = hour >= 6 && hour < 18;
  return { scene: isDay ? 'day' : 'night', condition: isDay ? '낮' : '밤', temperature: null, live: false };
}

function parseCurrentWeather(current) {
  if (!current || (current.is_day !== 0 && current.is_day !== 1)) return null;
  const code = current.weather_code;
  let scene = current.is_day === 1 ? 'day' : 'night';
  let condition;
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    scene = 'snow';
    condition = '눈';
  } else if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 97, 99].includes(code)) {
    scene = 'rain';
    condition = [95, 96, 97, 99].includes(code) ? '뇌우' : '비';
  } else if ([45, 48].includes(code)) {
    condition = '안개';
  } else if ([2, 3].includes(code)) {
    condition = '흐림';
  } else if ([0, 1].includes(code)) {
    condition = '맑음';
  } else {
    return null;
  }
  const temperature = current.temperature_2m;
  return { scene, condition, temperature: Number.isFinite(temperature) ? Math.round(temperature) : null, live: true };
}

async function requestCurrentWeather() {
  const response = await fetch(SEOUL_FORECAST, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(3500),
    redirect: 'error',
    credentials: 'omit',
  });
  if (!response.ok || !response.body) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 16_384) return null;
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')).current;
}

function createSeoulWeatherService({ request = requestCurrentWeather, now = Date.now } = {}) {
  let cached = null;
  let refreshedAt;
  let pending;

  async function refresh() {
    try {
      cached = parseCurrentWeather(await request());
    } catch {
      cached = null;
    }
    refreshedAt = now();

    return cached ?? seoulTimeScene(refreshedAt);
  }

  return async function getSeoulWeather(online) {
    const time = now();
    if (!online) return seoulTimeScene(time);
    const elapsed = time - refreshedAt;
    if (elapsed >= 0 && elapsed < (cached ? WEATHER_TTL : RETRY_DELAY)) {
      return cached ?? seoulTimeScene(time);
    }
    pending ??= refresh().finally(() => { pending = null; });
    return pending;
  };
}

module.exports = { createSeoulWeatherService };
