// Weather Underground / The Weather Company data for the live observations worker.
// Needs the Worker secret WU_API_KEY (a PWS owner's API key). Without it, nothing here is used.
//
// - wuObservation(): current readings from a hand-picked Weather Underground station.
// - skyFor(): the current sky, in order of preference:
//     1. rain / drizzle / fog / thunder reported by The Weather Company's current conditions
//     2. daytime: the station's measured sunlight (30-minute average) vs. the clear-sky amount
//     3. The Weather Company's sky phrase
//   (the site falls back to the nearest airport report when this returns nothing)

// Hand-picked Weather Underground stations per town (temperature and sunlight).
export const WU_STATIONS = { moraga: 'KCAMORAG71', danville: 'KCADANVI231', greenbrook: 'KCADANVI128' };
// Towns whose temperature/humidity/wind come from Weather Underground (Moraga keeps Xweather + its archive).
export const WU_PRIMARY = new Set(['danville', 'greenbrook']);
export const TOWN_COORDS = { moraga: [37.8202, -122.1194], lafayette: [37.890, -122.115], danville: [37.813, -121.974], greenbrook: [37.799, -121.970] };
const MAX_AGE_MS = 45 * 60 * 1000;
const num = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

async function getJson(url, ttl, log, label) {
  const res = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true } });
  if (res.status === 204) { log.push(label + ': no data'); return null; }
  if (!res.ok) { log.push(label + ': http ' + res.status); return null; }
  return res.json();
}

function pwsUrl(path, station, key) {
  const u = new URL('https://api.weather.com/v2/pws/' + path);
  u.searchParams.set('stationId', station); u.searchParams.set('format', 'json'); u.searchParams.set('units', 'e');
  u.searchParams.set('numericPrecision', 'decimal'); u.searchParams.set('apiKey', key);
  return u.toString();
}

// Current Weather Underground reading, or null. Shape matches the worker's /observations fields.
export async function wuCurrent(station, env, log) {
  if (!env.WU_API_KEY || !station) return null;
  try {
    const data = await getJson(pwsUrl('observations/current', station, env.WU_API_KEY), 60, log, station);
    const ob = data?.observations?.[0];
    const at = Date.parse(ob?.obsTimeUtc || '');
    if (!ob || !Number.isFinite(at) || Date.now() - at > MAX_AGE_MS || at > Date.now() + 5 * 60000) { if (ob) log.push(station + ': stale'); return null; }
    const imp = ob.imperial || {};
    if (num(imp.temp) === null) { log.push(station + ': no temperature'); return null; }
    return {
      station, observed_utc: new Date(at).toISOString(),
      temperature_f: num(imp.temp), humidity_pct: num(ob.humidity), dew_point_f: num(imp.dewpt),
      wind_mph: num(imp.windSpeed), wind_direction_deg: num(ob.winddir), wind_gust_mph: num(imp.windGust),
      pressure_inhg: num(imp.pressure), precip_rate_in_hr: num(imp.precipRate), precip_today_in: num(imp.precipTotal),
      solar_radiation_wm2: num(ob.solarRadiation),
    };
  } catch (_) { log.push(station + ': error'); return null; }
}

// Mean of the last 30 minutes of sunlight (5-minute highs) plus the current reading.
async function wuSolarAverage(station, env, current, log) {
  const values = Number.isFinite(current) ? [current] : [];
  try {
    const data = await getJson(pwsUrl('observations/all/1day', station, env.WU_API_KEY), 240, log, station + ' 1day');
    for (const ob of data?.observations || []) {
      const t = Date.parse(ob.obsTimeUtc || '');
      if (Number.isFinite(t) && Date.now() - t <= 30 * 60000) {
        const v = num(ob.solarRadiationHigh ?? ob.solarRadiationAvg);
        if (v !== null) values.push(v);
      }
    }
  } catch (_) { /* current reading alone */ }
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// Solar elevation in degrees (NOAA approximation).
export function sunElevation(lat, lon, date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0), day = (date - start) / 86400000;
  const g = 2 * Math.PI / 365 * (day - 1 + (date.getUTCHours() - 12) / 24);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const tst = date.getUTCHours() * 60 + date.getUTCMinutes() + eq + 4 * lon;
  const ha = (tst / 4 - 180) * Math.PI / 180, la = lat * Math.PI / 180;
  return Math.asin(Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha)) * 180 / Math.PI;
}

// Clear-sky sunlight on a flat surface (Haurwitz model), W/m².
export const clearSkyGhi = (elevDeg) => { const c = Math.sin(elevDeg * Math.PI / 180); return c > 0 ? 1098 * c * Math.exp(-0.059 / c) : 0; };

// Sky words from the measured / clear-sky ratio. Code is the site's weather code (WMO style).
export function solarSky(ratio) {
  if (ratio >= 0.8) return { text: 'Sunny', code: 0 };
  if (ratio >= 0.6) return { text: 'Mostly sunny', code: 1 };
  if (ratio >= 0.4) return { text: 'Partly cloudy', code: 2 };
  if (ratio >= 0.22) return { text: 'Mostly cloudy', code: 2 };
  return { text: 'Cloudy', code: 3 };
}

// The Weather Company icon codes -> site weather codes.
function twcCode(icon) {
  if ([3, 4, 37, 38, 47].includes(icon)) return 95;
  if ([20, 21, 22].includes(icon)) return 45;
  if ([9].includes(icon)) return 51;
  if ([11, 12, 40].includes(icon)) return 61;
  if ([39, 45].includes(icon)) return 80;
  if ([5, 6, 7, 8, 10, 13, 14, 15, 16, 17, 18, 41, 42, 43, 46].includes(icon)) return 71;
  if ([32, 31, 36].includes(icon)) return 0;
  if ([34, 33].includes(icon)) return 1;
  if ([30, 29, 44, 28, 27].includes(icon)) return 2;
  if ([26, 19, 23, 24, 25].includes(icon)) return 3;
  return null;
}
const sentence = (s) => String(s || '').toLowerCase().replace(/^./, (c) => c.toUpperCase()).replace(/\bt-storms?\b/gi, 'thunderstorms');

export async function skyFor(city, env, solarNow, log) {
  const coords = TOWN_COORDS[city];
  if (!coords) return null;
  const elev = sunElevation(coords[0], coords[1]);
  let twc = null;
  if (env.WU_API_KEY) {
    try {
      const u = new URL('https://api.weather.com/v3/wx/observations/current');
      u.searchParams.set('geocode', coords[0] + ',' + coords[1]); u.searchParams.set('units', 'e');
      u.searchParams.set('language', 'en-US'); u.searchParams.set('format', 'json'); u.searchParams.set('apiKey', env.WU_API_KEY);
      const d = await getJson(u.toString(), 300, log, 'twc current');
      const code = twcCode(num(d?.iconCode));
      if (d && code !== null) twc = { text: sentence(d.wxPhraseLong || d.wxPhraseMedium), code, is_day: d.dayOrNight !== 'N', cloud_cover_pct: num(d.cloudCover) };
    } catch (_) { log.push('twc current: error'); }
  }
  if (twc && twc.code >= 45) return { ...twc, source: 'twc' };
  // Daytime with the sun high enough for a meaningful reading.
  const station = WU_STATIONS[city];
  if (elev >= 15 && (station || Number.isFinite(solarNow))) {
    const avg = station && env.WU_API_KEY ? await wuSolarAverage(station, env, solarNow, log) : solarNow;
    const clear = clearSkyGhi(elev);
    if (Number.isFinite(avg) && clear > 0) {
      const ratio = avg / clear;
      return { ...solarSky(ratio), is_day: true, source: 'station_sunlight', clear_sky_ratio: Math.round(ratio * 100) / 100 };
    }
  }
  if (twc) return { ...twc, source: 'twc' };
  return null;
}
